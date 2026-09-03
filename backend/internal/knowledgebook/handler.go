package knowledgebook

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

// Handler 知识库 HTTP 处理器
type Handler struct {
	store *Store
	llm   config.LLMConfig
}

// NewHandler 创建知识库处理器
func NewHandler(store *database.Store, llm config.LLMConfig) *Handler {
	return &Handler{store: NewStore(store), llm: llm}
}

// ListKnowledgeItems GET /api/v1/knowledge
// 支持可选 query 参数:
//
//	?category_id=1    按分类 ID 过滤
//	?q=缓存           关键词搜索(title / content / notes / tags / summary)
func (handler *Handler) ListKnowledgeItems(c echo.Context) error {
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

	items, err := handler.store.List(c.Request().Context(), userID, filterByCategory, categoryID, keyword)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to query knowledge items")
	}

	return c.JSON(http.StatusOK, map[string]any{
		"items": items,
	})
}

// CreateKnowledgeItem POST /api/v1/knowledge
func (handler *Handler) CreateKnowledgeItem(c echo.Context) error {
	userID, ok := middleware.EchoCurrentUserID(c)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "missing authenticated user")
	}

	var request KnowledgeRequest
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
	if request.TemplateType == "article" && request.Content == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "content is required for article template")
	}
	// 文档模板:Markdown 全文存 content,必填
	if request.TemplateType == "document" && request.Content == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "content is required for document template")
	}
	if request.TemplateType == "procedure" && len(request.Steps) == 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "steps are required for procedure template")
	}
	if request.TemplateType == "comparison" && (request.Comparison == nil || len(request.Comparison.Headers) < 2 || len(request.Comparison.Rows) == 0) {
		return echo.NewHTTPError(http.StatusBadRequest, "comparison requires at least 2 columns and 1 row")
	}

	if err := handler.store.ValidateCategoryID(c.Request().Context(), userID, request.CategoryID); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid category_id")
	}

	if err := request.validateExtra(); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	stepsJSON, err := marshalSteps(request.Steps)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid steps")
	}

	comparisonJSON, err := marshalComparison(request.Comparison)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid comparison")
	}

	itemID, err := handler.store.Create(c.Request().Context(), userID, request, stepsJSON, comparisonJSON)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to create knowledge item")
	}

	detail, err := handler.store.FindDetail(c.Request().Context(), userID, itemID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read created knowledge item")
	}

	return c.JSON(http.StatusCreated, detail)
}

// GetKnowledgeItem GET /api/v1/knowledge/:id
func (handler *Handler) GetKnowledgeItem(c echo.Context) error {
	userID, ok := middleware.EchoCurrentUserID(c)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "missing authenticated user")
	}

	itemID, err := parseKnowledgeID(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "knowledge item not found")
	}

	detail, err := handler.store.FindDetail(c.Request().Context(), userID, itemID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return echo.NewHTTPError(http.StatusNotFound, "knowledge item not found")
		}
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read knowledge item")
	}

	return c.JSON(http.StatusOK, detail)
}

// UpdateKnowledgeItem PUT /api/v1/knowledge/:id
func (handler *Handler) UpdateKnowledgeItem(c echo.Context) error {
	userID, ok := middleware.EchoCurrentUserID(c)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "missing authenticated user")
	}

	itemID, err := parseKnowledgeID(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "knowledge item not found")
	}

	var request KnowledgeRequest
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
	// 更新接口不再强制要求 content / steps 非空（符合 project_memory 中的约束）
	if err := handler.store.ValidateCategoryID(c.Request().Context(), userID, request.CategoryID); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid category_id")
	}

	if err := request.validateExtra(); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	stepsJSON, err := marshalSteps(request.Steps)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid steps")
	}

	comparisonJSON, err := marshalComparison(request.Comparison)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid comparison")
	}

	rowsAffected, err := handler.store.Update(c.Request().Context(), userID, itemID, request, stepsJSON, comparisonJSON)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to update knowledge item")
	}

	if rowsAffected == 0 {
		// 没有更新行,检查是条目不存在还是数据没变化
		exists, err := handler.store.Exists(c.Request().Context(), userID, itemID)
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "failed to read updated knowledge item")
		}
		if !exists {
			return echo.NewHTTPError(http.StatusNotFound, "knowledge item not found")
		}
	}

	detail, err := handler.store.FindDetail(c.Request().Context(), userID, itemID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read updated knowledge item")
	}

	return c.JSON(http.StatusOK, detail)
}

// DeleteKnowledgeItem DELETE /api/v1/knowledge/:id
func (handler *Handler) DeleteKnowledgeItem(c echo.Context) error {
	userID, ok := middleware.EchoCurrentUserID(c)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "missing authenticated user")
	}

	itemID, err := parseKnowledgeID(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "knowledge item not found")
	}

	rowsAffected, err := handler.store.Delete(c.Request().Context(), userID, itemID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to delete knowledge item")
	}
	if rowsAffected == 0 {
		return echo.NewHTTPError(http.StatusNotFound, "knowledge item not found")
	}

	return c.NoContent(http.StatusNoContent)
}

// MoveKnowledgeCategory POST /api/v1/knowledge/:id/move
// 专用移动分类接口，只更新 category_id
func (handler *Handler) MoveKnowledgeCategory(c echo.Context) error {
	userID, ok := middleware.EchoCurrentUserID(c)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "missing authenticated user")
	}

	itemID, err := parseKnowledgeID(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "knowledge item not found")
	}

	var request MoveKnowledgeRequest
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

	rowsAffected, err := handler.store.MoveCategory(c.Request().Context(), userID, itemID, request.CategoryID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to move category")
	}

	if rowsAffected == 0 {
		return echo.NewHTTPError(http.StatusNotFound, "knowledge item not found or not owned by current user")
	}

	return c.NoContent(http.StatusOK)
}
