package memorybook

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"

	"github.com/labstack/echo/v4"

	"personal-agents/backend/internal/middleware"
)

// Handler 记忆 HTTP 处理器
type Handler struct {
	store       *Store
	internalKey string
}

// NewHandler 创建记忆处理器
func NewHandler(store *Store, internalKey string) *Handler {
	return &Handler{store: store, internalKey: internalKey}
}

// currentUser JWT接口从context取用户ID
func currentUser(c echo.Context) (int64, error) {
	userID, ok := middleware.EchoCurrentUserID(c)
	if !ok {
		return 0, echo.NewHTTPError(http.StatusUnauthorized, "missing authenticated user")
	}
	return userID, nil
}

// Register 注册路由
//   - JWT 路由给 B8 管理页用
//   - Internal 路由给 Agent 工具用(X-Internal-Key 鉴权)
func (h *Handler) Register(g *echo.Group, internal *echo.Group) {
	// JWT 路由
	memJWT := g.Group("/memories")
	memJWT.GET("", h.list)
	memJWT.GET("/:id", h.detail)
	memJWT.POST("", h.create)
	memJWT.PUT("/:id", h.update)
	memJWT.DELETE("/:id", h.delete)

	// Internal 路由(Agent工具)
	if internal != nil {
		memInt := internal.Group("/memories")
		memInt.POST("/save", h.internalSave)    // save_memory: 自动去重合并
		memInt.GET("/recall", h.internalRecall) // recall_memory: 语义检索
		memInt.GET("/core", h.internalCore)     // core_memories: 启动时预注入
	}
}

// ==================== JWT 接口(B8管理页) ====================

// GET /api/v1/memories?topic=&active=1
func (h *Handler) list(c echo.Context) error {
	userID, err := currentUser(c)
	if err != nil {
		return err
	}
	topic := c.QueryParam("topic")
	activeOnly := c.QueryParam("active") == "1" || c.QueryParam("active") == "true"

	items, err := h.store.List(c.Request().Context(), userID, topic, activeOnly)
	if err != nil {
		return err
	}
	if items == nil {
		items = []MemorySummary{}
	}
	return c.JSON(http.StatusOK, map[string]any{"items": items})
}

// GET /api/v1/memories/:id
func (h *Handler) detail(c echo.Context) error {
	userID, err := currentUser(c)
	if err != nil {
		return err
	}
	id, err := parseMemoryID(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid id")
	}
	item, err := h.store.FindDetail(c.Request().Context(), userID, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return echo.NewHTTPError(http.StatusNotFound, "memory not found")
		}
		return err
	}
	return c.JSON(http.StatusOK, item)
}

// POST /api/v1/memories
func (h *Handler) create(c echo.Context) error {
	userID, err := currentUser(c)
	if err != nil {
		return err
	}
	var req MemoryRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid body")
	}
	req.normalize()
	if err := req.validate(); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	if !req.IsActive {
		req.IsActive = true
	}
	id, err := h.store.Create(c.Request().Context(), userID, req)
	if err != nil {
		return err
	}
	item, err := h.store.FindDetail(c.Request().Context(), userID, id)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, item)
}

// PUT /api/v1/memories/:id
func (h *Handler) update(c echo.Context) error {
	userID, err := currentUser(c)
	if err != nil {
		return err
	}
	id, err := parseMemoryID(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid id")
	}
	var req MemoryRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid body")
	}
	req.normalize()
	if err := req.validate(); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	rows, err := h.store.Update(c.Request().Context(), userID, id, req)
	if err != nil {
		return err
	}
	if rows == 0 {
		return echo.NewHTTPError(http.StatusNotFound, "memory not found")
	}
	item, err := h.store.FindDetail(c.Request().Context(), userID, id)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, item)
}

// DELETE /api/v1/memories/:id
func (h *Handler) delete(c echo.Context) error {
	userID, err := currentUser(c)
	if err != nil {
		return err
	}
	id, err := parseMemoryID(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid id")
	}
	rows, err := h.store.Delete(c.Request().Context(), userID, id)
	if err != nil {
		return err
	}
	if rows == 0 {
		return echo.NewHTTPError(http.StatusNotFound, "memory not found")
	}
	return c.NoContent(http.StatusNoContent)
}

// ==================== Internal 接口(Agent工具,X-Internal-Key) ====================

func (h *Handler) checkInternal(c echo.Context) error {
	if c.Request().Header.Get("X-Internal-Key") != h.internalKey {
		return echo.NewHTTPError(http.StatusUnauthorized, "invalid internal key")
	}
	return nil
}

// internalUserID 从query取user_id(Agent无JWT,用配置中固定user_id)
func internalUserID(c echo.Context) (int64, error) {
	uidStr := c.QueryParam("user_id")
	id, err := strconv.ParseInt(uidStr, 10, 64)
	if err != nil || id <= 0 {
		return 0, echo.NewHTTPError(http.StatusBadRequest, "user_id required")
	}
	return id, nil
}

// POST /api/v1/internal/memories/save
// Body: {topic, title, content, importance}
// 自动去重合并;返回 {id, created: bool}
func (h *Handler) internalSave(c echo.Context) error {
	if err := h.checkInternal(c); err != nil {
		return err
	}
	userID, err := internalUserID(c)
	if err != nil {
		return err
	}
	var req InternalSaveRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid body")
	}
	req.normalize()
	id, created, err := h.store.SaveWithDedup(c.Request().Context(), userID, req)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, map[string]any{"id": id, "created": created})
}

// GET /api/v1/internal/memories/recall?q=...&limit=5
func (h *Handler) internalRecall(c echo.Context) error {
	if err := h.checkInternal(c); err != nil {
		return err
	}
	userID, err := internalUserID(c)
	if err != nil {
		return err
	}
	q := c.QueryParam("q")
	if q == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "q required")
	}
	limit := 5
	if l := c.QueryParam("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 {
			limit = n
		}
	}
	results, err := h.store.Recall(c.Request().Context(), userID, q, limit)
	if err != nil {
		return err
	}
	if results == nil {
		results = []RecallResult{}
	}
	return c.JSON(http.StatusOK, map[string]any{"results": results})
}

// GET /api/v1/internal/memories/core?min_importance=4
// 返回核心记忆,Agent启动时预注入
func (h *Handler) internalCore(c echo.Context) error {
	if err := h.checkInternal(c); err != nil {
		return err
	}
	userID, err := internalUserID(c)
	if err != nil {
		return err
	}
	minImp := 4
	if m := c.QueryParam("min_importance"); m != "" {
		if n, err := strconv.Atoi(m); err == nil && n >= 1 && n <= 5 {
			minImp = n
		}
	}
	items, err := h.store.CoreMemories(c.Request().Context(), userID, minImp)
	if err != nil {
		return err
	}
	if items == nil {
		items = []MemorySummary{}
	}
	return c.JSON(http.StatusOK, map[string]any{"memories": items})
}
