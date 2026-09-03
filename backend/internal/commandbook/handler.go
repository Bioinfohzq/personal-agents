package commandbook

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"

	"personal-agents/backend/internal/config"
	"personal-agents/backend/internal/database"
	"personal-agents/backend/internal/middleware"
)

// Handler 命令手册 HTTP 处理器
type Handler struct {
	store *Store
	llm   config.LLMConfig
}

// NewHandler 创建命令手册处理器
func NewHandler(store *database.Store, llm config.LLMConfig) *Handler {
	return &Handler{store: NewStore(store), llm: llm}
}

// ListCommands GET /api/v1/commands
// 支持可选 query 参数:
//
//	?category_id=1    按分类 ID 过滤
//	?q=grep           关键词搜索(title / command_text / introduction / parameters / notes)
func (handler *Handler) ListCommands(c echo.Context) error {
	userID, ok := middleware.EchoCurrentUserID(c)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "missing authenticated user")
	}

	categoryIDStr := strings.TrimSpace(c.QueryParam("category_id"))
	keyword := strings.TrimSpace(c.QueryParam("q"))

	var categoryID int64
	var filterByCategory bool
	if categoryIDStr != "" {
		id, err := strconv.ParseInt(categoryIDStr, 10, 64)
		if err != nil || id <= 0 {
			return echo.NewHTTPError(http.StatusBadRequest, "invalid category_id")
		}
		categoryID = id
		filterByCategory = true
	}

	commands, err := handler.store.List(c.Request().Context(), userID, filterByCategory, categoryID, keyword)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to query commands")
	}

	return c.JSON(http.StatusOK, map[string]any{
		"commands": commands,
	})
}

// CreateCommand POST /api/v1/commands
func (handler *Handler) CreateCommand(c echo.Context) error {
	userID, ok := middleware.EchoCurrentUserID(c)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "missing authenticated user")
	}

	var request CommandRequest
	if err := c.Bind(&request); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid json body")
	}

	request.normalize()
	if request.TemplateType == "" {
		request.TemplateType = "article"
	}
	if !isValidTemplateType(request.TemplateType) {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid template_type")
	}
	if request.CategoryID <= 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "category_id is required")
	}
	if request.TemplateType == "article" && request.CommandText == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "command_text is required for article template")
	}
	if request.TemplateType == "procedure" && len(request.Steps) == 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "steps are required for procedure template")
	}

	if err := handler.store.ValidateCategoryID(c.Request().Context(), userID, request.CategoryID); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid category_id")
	}

	stepsJSON, err := marshalSteps(request.Steps)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid steps")
	}

	commandID, err := handler.store.Create(c.Request().Context(), userID, request, stepsJSON)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to create command")
	}

	detail, err := handler.store.FindDetail(c.Request().Context(), userID, commandID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read created command")
	}

	return c.JSON(http.StatusCreated, detail)
}

// GetCommand GET /api/v1/commands/:id
func (handler *Handler) GetCommand(c echo.Context) error {
	userID, ok := middleware.EchoCurrentUserID(c)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "missing authenticated user")
	}

	commandID, err := parseCommandID(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "command not found")
	}

	detail, err := handler.store.FindDetail(c.Request().Context(), userID, commandID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return echo.NewHTTPError(http.StatusNotFound, "command not found")
		}
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read command")
	}

	return c.JSON(http.StatusOK, detail)
}

// UpdateCommand PUT /api/v1/commands/:id
func (handler *Handler) UpdateCommand(c echo.Context) error {
	userID, ok := middleware.EchoCurrentUserID(c)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "missing authenticated user")
	}

	commandID, err := parseCommandID(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "command not found")
	}

	var request CommandRequest
	if err := c.Bind(&request); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid json body")
	}

	request.normalize()
	if request.TemplateType == "" {
		request.TemplateType = "article"
	}
	if !isValidTemplateType(request.TemplateType) {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid template_type")
	}
	if request.CategoryID <= 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "category_id is required")
	}
	// 更新接口不再强制要求 command_text / steps 非空（符合 project_memory 中的约束）
	if err := handler.store.ValidateCategoryID(c.Request().Context(), userID, request.CategoryID); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid category_id")
	}

	stepsJSON, err := marshalSteps(request.Steps)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid steps")
	}

	rowsAffected, err := handler.store.Update(c.Request().Context(), userID, commandID, request, stepsJSON)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to update command")
	}

	if rowsAffected == 0 {
		// 没有更新行,检查是命令不存在还是数据没变化
		exists, err := handler.store.Exists(c.Request().Context(), userID, commandID)
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "failed to read updated command")
		}
		if !exists {
			return echo.NewHTTPError(http.StatusNotFound, "command not found")
		}
	}

	detail, err := handler.store.FindDetail(c.Request().Context(), userID, commandID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read updated command")
	}

	return c.JSON(http.StatusOK, detail)
}

// DeleteCommand DELETE /api/v1/commands/:id
func (handler *Handler) DeleteCommand(c echo.Context) error {
	userID, ok := middleware.EchoCurrentUserID(c)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "missing authenticated user")
	}

	commandID, err := parseCommandID(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "command not found")
	}

	rowsAffected, err := handler.store.Delete(c.Request().Context(), userID, commandID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to delete command")
	}
	if rowsAffected == 0 {
		return echo.NewHTTPError(http.StatusNotFound, "command not found")
	}

	return c.NoContent(http.StatusNoContent)
}

// MoveCommandCategory POST /api/v1/commands/:id/move
// 专用移动分类接口，只更新 category_id
func (handler *Handler) MoveCommandCategory(c echo.Context) error {
	userID, ok := middleware.EchoCurrentUserID(c)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "missing authenticated user")
	}

	commandID, err := parseCommandID(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "command not found")
	}

	var request MoveCommandRequest
	if err := c.Bind(&request); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid json body")
	}

	if request.CategoryID <= 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "category_id is required and must be > 0")
	}

	// 校验分类存在且属于当前用户
	if err := handler.store.ValidateCategoryID(c.Request().Context(), userID, request.CategoryID); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid category_id")
	}

	rowsAffected, err := handler.store.MoveCategory(c.Request().Context(), userID, commandID, request.CategoryID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to move category")
	}

	if rowsAffected == 0 {
		return echo.NewHTTPError(http.StatusNotFound, "command item not found or not owned by current user")
	}

	return c.NoContent(http.StatusOK)
}
