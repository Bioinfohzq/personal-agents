package passwordbook

import (
	"database/sql"
	"errors"
	"net/http"

	"github.com/labstack/echo/v4"

	"personal-agents/backend/internal/database"
	"personal-agents/backend/internal/middleware"
)

// Handler 密码本 HTTP 处理器
type Handler struct {
	store *Store
}

// NewHandler 创建密码本处理器
func NewHandler(store *database.Store, encryptionSecret string) *Handler {
	return &Handler{store: NewStore(store, encryptionSecret)}
}

// ListItems GET /api/v1/passwordbook/items
func (handler *Handler) ListItems(c echo.Context) error {
	userID, ok := middleware.EchoCurrentUserID(c)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "missing authenticated user")
	}

	items, err := handler.store.List(c.Request().Context(), userID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to query passwordbook items")
	}

	return c.JSON(http.StatusOK, map[string]any{
		"items": items,
	})
}

// CreateItem POST /api/v1/passwordbook/items
func (handler *Handler) CreateItem(c echo.Context) error {
	userID, ok := middleware.EchoCurrentUserID(c)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "missing authenticated user")
	}

	var request CreateItemRequest
	if err := c.Bind(&request); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid json body")
	}

	request.normalize()
	if request.Platform == "" || request.LoginAccount == "" || request.Password == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "platform, login_account and password are required")
	}

	itemID, err := handler.store.Create(c.Request().Context(), userID, request)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to create passwordbook item")
	}

	detail, err := handler.store.FindDetail(c.Request().Context(), userID, itemID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read created passwordbook item")
	}

	return c.JSON(http.StatusCreated, detail)
}

// GetItem GET /api/v1/passwordbook/items/:id
func (handler *Handler) GetItem(c echo.Context) error {
	userID, ok := middleware.EchoCurrentUserID(c)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "missing authenticated user")
	}

	itemID, err := parseItemID(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "passwordbook item not found")
	}

	detail, err := handler.store.FindDetail(c.Request().Context(), userID, itemID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return echo.NewHTTPError(http.StatusNotFound, "passwordbook item not found")
		}

		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read passwordbook item")
	}

	return c.JSON(http.StatusOK, detail)
}

// UpdateItem PUT /api/v1/passwordbook/items/:id
// password 为空表示不修改密码
func (handler *Handler) UpdateItem(c echo.Context) error {
	userID, ok := middleware.EchoCurrentUserID(c)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "missing authenticated user")
	}

	itemID, err := parseItemID(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "passwordbook item not found")
	}

	var request UpdateItemRequest
	if err := c.Bind(&request); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid json body")
	}

	request.normalize()
	if request.Platform == "" || request.LoginAccount == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "platform and login_account are required")
	}

	rowsAffected, err := handler.store.Update(c.Request().Context(), userID, itemID, request)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to update passwordbook item")
	}

	if rowsAffected == 0 {
		// 没有更新行,检查是条目不存在还是数据没变化
		exists, err := handler.store.Exists(c.Request().Context(), userID, itemID)
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "failed to read updated passwordbook item")
		}
		if !exists {
			return echo.NewHTTPError(http.StatusNotFound, "passwordbook item not found")
		}
	}

	detail, err := handler.store.FindDetail(c.Request().Context(), userID, itemID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read updated passwordbook item")
	}

	return c.JSON(http.StatusOK, detail)
}

// DeleteItem DELETE /api/v1/passwordbook/items/:id
func (handler *Handler) DeleteItem(c echo.Context) error {
	userID, ok := middleware.EchoCurrentUserID(c)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "missing authenticated user")
	}

	itemID, err := parseItemID(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "passwordbook item not found")
	}

	rowsAffected, err := handler.store.Delete(c.Request().Context(), userID, itemID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to delete passwordbook item")
	}
	if rowsAffected == 0 {
		return echo.NewHTTPError(http.StatusNotFound, "passwordbook item not found")
	}

	return c.NoContent(http.StatusNoContent)
}
