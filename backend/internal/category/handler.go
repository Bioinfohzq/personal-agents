package category

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"

	"personal-agents/backend/internal/database"
	"personal-agents/backend/internal/middleware"
)

// Handler 分类管理 HTTP 处理器
type Handler struct {
	store *Store
}

// NewHandler 创建分类管理处理器
func NewHandler(store *database.Store) *Handler {
	return &Handler{store: NewStore(store)}
}

// CreateRequest 创建分类请求体
type CreateRequest struct {
	Scope string `json:"scope"`
	Name  string `json:"name"`
}

// RenameRequest 重命名分类请求体
type RenameRequest struct {
	Name string `json:"name"`
}

// ListCategories GET /api/v1/categories
// 支持 query 参数: ?scope=knowledge|command
func (handler *Handler) ListCategories(c echo.Context) error {
	userID, ok := middleware.EchoCurrentUserID(c)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "missing authenticated user")
	}

	scope := strings.TrimSpace(c.QueryParam("scope"))
	if scope != ScopeKnowledge && scope != ScopeCommand {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid scope")
	}

	categories, err := handler.store.List(c.Request().Context(), userID, scope)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to list categories")
	}

	return c.JSON(http.StatusOK, map[string]any{
		"categories": categories,
	})
}

// CreateCategory POST /api/v1/categories
func (handler *Handler) CreateCategory(c echo.Context) error {
	userID, ok := middleware.EchoCurrentUserID(c)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "missing authenticated user")
	}

	var req CreateRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid json body")
	}

	req.Scope = strings.TrimSpace(req.Scope)
	req.Name = strings.TrimSpace(req.Name)

	if req.Scope != ScopeKnowledge && req.Scope != ScopeCommand {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid scope")
	}
	if req.Name == "" || len(req.Name) > 40 {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid category name")
	}

	category, err := handler.store.Create(c.Request().Context(), userID, req.Scope, req.Name)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to create category")
	}

	return c.JSON(http.StatusCreated, category)
}

// RenameCategory PUT /api/v1/categories/:id
func (handler *Handler) RenameCategory(c echo.Context) error {
	userID, ok := middleware.EchoCurrentUserID(c)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "missing authenticated user")
	}

	categoryID, err := parseCategoryID(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "category not found")
	}

	var req RenameRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid json body")
	}

	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || len(req.Name) > 40 {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid category name")
	}

	// 校验分类属于当前用户
	existing, err := handler.store.GetByID(c.Request().Context(), categoryID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read category")
	}
	if existing == nil {
		return echo.NewHTTPError(http.StatusNotFound, "category not found")
	}
	if existing.UserID == nil || *existing.UserID != userID {
		return echo.NewHTTPError(http.StatusForbidden, "category not owned by current user")
	}

	if err := handler.store.Rename(c.Request().Context(), categoryID, req.Name); err != nil {
		if errors.Is(err, errors.New("category not found")) {
			return echo.NewHTTPError(http.StatusNotFound, "category not found")
		}
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to rename category")
	}

	updated, err := handler.store.GetByID(c.Request().Context(), categoryID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read renamed category")
	}

	return c.JSON(http.StatusOK, updated)
}

// DeleteCategory DELETE /api/v1/categories/:id
// 删除前需将该分类下的记录移动到"其他"分类
func (handler *Handler) DeleteCategory(c echo.Context) error {
	userID, ok := middleware.EchoCurrentUserID(c)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "missing authenticated user")
	}

	categoryID, err := parseCategoryID(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "category not found")
	}

	existing, err := handler.store.GetByID(c.Request().Context(), categoryID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read category")
	}
	if existing == nil {
		return echo.NewHTTPError(http.StatusNotFound, "category not found")
	}
	if existing.UserID == nil || *existing.UserID != userID {
		return echo.NewHTTPError(http.StatusForbidden, "category not owned by current user")
	}

	// 查找该 scope 下的 "其他" 固定分类作为默认归类
	other, err := handler.store.GetBySlug(c.Request().Context(), userID, existing.Scope, "other")
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to resolve default category")
	}
	if other == nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "default category not found")
	}

	if err := handler.store.Delete(c.Request().Context(), existing, userID, other.ID); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to delete category")
	}

	return c.NoContent(http.StatusNoContent)
}

// parseCategoryID 从路径参数解析分类 ID
func parseCategoryID(idText string) (int64, error) {
	categoryID, err := strconv.ParseInt(idText, 10, 64)
	if err != nil || categoryID <= 0 {
		return 0, errors.New("invalid category id")
	}
	return categoryID, nil
}
