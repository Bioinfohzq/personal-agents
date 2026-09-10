package systemknowledge

import (
	"database/sql"
	"errors"
	"net/http"

	"github.com/labstack/echo/v4"

	"personal-agents/backend/internal/middleware"
)

// Handler 系统知识 HTTP 处理器
type Handler struct {
	store *Store
}

// NewHandler 创建处理器
func NewHandler(store *Store) *Handler {
	return &Handler{store: store}
}

func currentUser(c echo.Context) (int64, error) {
	userID, ok := middleware.EchoCurrentUserID(c)
	if !ok {
		return 0, echo.NewHTTPError(http.StatusUnauthorized, "missing authenticated user")
	}
	return userID, nil
}

// Register 注册路由
func (h *Handler) Register(g *echo.Group) {
	sk := g.Group("/system-knowledge")
	sk.GET("/nodes", h.list)
	sk.POST("/nodes", h.create)
	sk.PUT("/nodes", h.update) // body 带 category+path
	sk.DELETE("/nodes", h.delete)
	sk.POST("/reset", h.reset)
}

// 路径参数通过 query 传递(?category=linux-fhs&path=/etc)

// GET /api/v1/system-knowledge/nodes?category=linux-fhs
func (h *Handler) list(c echo.Context) error {
	userID, err := currentUser(c)
	if err != nil {
		return err
	}
	category := c.QueryParam("category")
	if category == "" {
		category = CategoryLinuxFHS
	}
	if !validCategories[category] {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid category")
	}

	// 确保内置种子数据已初始化
	if err := h.store.EnsureSeed(c.Request().Context()); err != nil {
		return err
	}

	nodes, err := h.store.ListByCategory(c.Request().Context(), userID, category)
	if err != nil {
		return err
	}
	if nodes == nil {
		nodes = []Node{}
	}
	return c.JSON(http.StatusOK, map[string]any{"nodes": nodes})
}

// createRequest 创建节点请求
type createRequest struct {
	Category    string   `json:"category"`
	ParentPath  string   `json:"parent_path"`
	Name        string   `json:"name"`
	NodeType    string   `json:"node_type"`
	Description string   `json:"description"`
	Contents    string   `json:"contents"`
	Examples    []string `json:"examples"`
}

// POST /api/v1/system-knowledge/nodes
func (h *Handler) create(c echo.Context) error {
	userID, err := currentUser(c)
	if err != nil {
		return err
	}
	var req createRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid body")
	}

	inner := CreateRequest{
		Category:    req.Category,
		ParentPath:  req.ParentPath,
		Name:        req.Name,
		NodeType:    req.NodeType,
		Description: req.Description,
		Contents:    req.Contents,
		Examples:    req.Examples,
	}
	inner.normalize()
	if err := inner.validate(); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	// 父节点必须存在(要么是内置要么是用户节点)
	if inner.ParentPath != "" {
		parent, err := h.store.FindByPath(c.Request().Context(), userID, inner.Category, inner.ParentPath)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return echo.NewHTTPError(http.StatusBadRequest, "parent path not found")
			}
			return err
		}
		if parent == nil {
			return echo.NewHTTPError(http.StatusBadRequest, "parent path not found")
		}
	}

	node, err := h.store.Create(c.Request().Context(), userID, inner.Category, inner.ParentPath, inner.Name, inner.NodeType, inner.Description, inner.Contents, inner.Examples)
	if err != nil {
		if err.Error() == "node already exists at this path" {
			return echo.NewHTTPError(http.StatusConflict, err.Error())
		}
		return err
	}
	return c.JSON(http.StatusCreated, node)
}

// updateRequest 更新节点请求
type updateRequest struct {
	Category    string   `json:"category"`
	Path        string   `json:"path"`
	Description *string  `json:"description"`
	Contents    *string  `json:"contents"`
	Examples    []string `json:"examples"`
}

// PUT /api/v1/system-knowledge/nodes
func (h *Handler) update(c echo.Context) error {
	userID, err := currentUser(c)
	if err != nil {
		return err
	}
	var req updateRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid body")
	}
	if req.Category == "" || req.Path == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "category and path required")
	}
	if !validCategories[req.Category] {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid category")
	}

	inner := UpdateRequest{
		Description: req.Description,
		Contents:    req.Contents,
		Examples:    req.Examples,
	}
	inner.normalize()

	node, err := h.store.Update(c.Request().Context(), userID, req.Category, req.Path, inner)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return echo.NewHTTPError(http.StatusNotFound, "node not found")
		}
		return err
	}
	return c.JSON(http.StatusOK, node)
}

// DELETE /api/v1/system-knowledge/nodes?category=linux-fhs&path=/etc/my
func (h *Handler) delete(c echo.Context) error {
	userID, err := currentUser(c)
	if err != nil {
		return err
	}
	category := c.QueryParam("category")
	path := c.QueryParam("path")
	if category == "" || path == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "category and path required")
	}
	if !validCategories[category] {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid category")
	}

	restored, err := h.store.Delete(c.Request().Context(), userID, category, path)
	if err != nil {
		if err.Error() == "cannot delete builtin node" {
			return echo.NewHTTPError(http.StatusForbidden, err.Error())
		}
		return err
	}
	return c.JSON(http.StatusOK, map[string]any{"restored_builtin": restored})
}

// POST /api/v1/system-knowledge/reset?category=linux-fhs
func (h *Handler) reset(c echo.Context) error {
	userID, err := currentUser(c)
	if err != nil {
		return err
	}
	category := c.QueryParam("category")
	if category == "" {
		category = CategoryLinuxFHS
	}
	if !validCategories[category] {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid category")
	}
	if err := h.store.ResetUserCategory(c.Request().Context(), userID, category); err != nil {
		return err
	}
	// 重置后重新拉取
	nodes, err := h.store.ListByCategory(c.Request().Context(), userID, category)
	if err != nil {
		return err
	}
	if nodes == nil {
		nodes = []Node{}
	}
	return c.JSON(http.StatusOK, map[string]any{"nodes": nodes})
}
