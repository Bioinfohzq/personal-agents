package knowledgebook

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"

	"personal-agents/backend/internal/category"
	"personal-agents/backend/internal/config"
	"personal-agents/backend/internal/database"
	"personal-agents/backend/internal/middleware"
)

// isValidCategory 校验分类格式:非空、长度不超过 40、不含空白字符。
// 前端提供固定分类 + 用户自定义分类,后端只做格式校验,不再维护白名单。
func isValidCategory(category string) bool {
	if category == "" || len(category) > 40 {
		return false
	}
	return !strings.ContainsAny(category, " \t\r\n")
}

// isValidTemplateType 校验模板类型(document 为 Markdown 文档模板)
func isValidTemplateType(templateType string) bool {
	return templateType == "article" || templateType == "procedure" || templateType == "comparison" || templateType == "document"
}

// ProcedureStep 流程模板单步骤
type ProcedureStep struct {
	Title string `json:"title"`
	Code  string `json:"code,omitempty"`
	Note  string `json:"note,omitempty"`
}

// ComparisonTable 对比模板表格数据
// Headers: 列标题数组(第一列通常是"对比维度/项目")
// Rows: 行数据二维数组,每行长度应与 headers 长度一致
// Intro: 基础介绍
// Supplement: 补充说明
type ComparisonTable struct {
	Headers    []string   `json:"headers"`
	Rows       [][]string `json:"rows"`
	Intro      string     `json:"intro,omitempty"`
	Supplement string     `json:"supplement,omitempty"`
}

// Handler 知识库 HTTP 处理器
type Handler struct {
	store         *database.Store
	categoryStore *category.Store
	llm           config.LLMConfig
}

// KnowledgeRequest 创建/更新知识请求体
type KnowledgeRequest struct {
	Title        string           `json:"title"`
	CategoryID   int64            `json:"category_id"`
	SubCategory  string           `json:"sub_category"`
	Tags         string           `json:"tags"`
	Summary      string           `json:"summary"`
	Content      string           `json:"content"`
	Notes        string           `json:"notes"`
	ReferenceURL string           `json:"reference_url"`
	Extra        string           `json:"extra"`
	TemplateType string           `json:"template_type"`
	Steps        []ProcedureStep  `json:"steps"`
	Comparison   *ComparisonTable `json:"comparison"`
}

// MoveKnowledgeRequest 移动分类请求体（只接收 category_id）
type MoveKnowledgeRequest struct {
	CategoryID int64 `json:"category_id"`
}

// KnowledgeSummary 知识摘要(列表用)
type KnowledgeSummary struct {
	ID           int64     `json:"id"`
	Title        string    `json:"title"`
	CategoryID   int64     `json:"category_id"`
	Category     string    `json:"category"`
	CategorySlug string    `json:"category_slug"`
	SubCategory  string    `json:"sub_category,omitempty"`
	Tags         string    `json:"tags,omitempty"`
	Summary      string    `json:"summary,omitempty"`
	TemplateType string    `json:"template_type"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// KnowledgeDetail 知识详情
type KnowledgeDetail struct {
	KnowledgeSummary
	Content      string           `json:"content,omitempty"`
	Notes        string           `json:"notes,omitempty"`
	ReferenceURL string           `json:"reference_url,omitempty"`
	Extra        string           `json:"extra,omitempty"`
	Steps        []ProcedureStep  `json:"steps,omitempty"`
	Comparison   *ComparisonTable `json:"comparison,omitempty"`
}

// knowledgeRecord 数据库行映射结构体
type knowledgeRecord struct {
	ID           int64
	Title        string
	CategoryID   int64
	CategoryName string
	CategorySlug string
	SubCategory  sql.NullString
	Tags         sql.NullString
	Summary      sql.NullString
	Content      sql.NullString
	Notes        sql.NullString
	ReferenceURL sql.NullString
	Extra        sql.NullString
	TemplateType string
	Steps        sql.NullString
	Comparison   sql.NullString
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// NewHandler 创建知识库处理器
func NewHandler(store *database.Store, llm config.LLMConfig) *Handler {
	return &Handler{store: store, categoryStore: category.NewStore(store), llm: llm}
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

	likePattern := "%" + keyword + "%"

	rows, err := handler.store.DB().QueryContext(
		c.Request().Context(),
		`SELECT ki.id, ki.title, ki.category_id, c.name, c.slug, ki.sub_category, ki.tags, ki.summary, ki.template_type, ki.created_at, ki.updated_at
		 FROM knowledge_items ki
		 JOIN categories c ON c.id = ki.category_id
		 WHERE ki.user_id = ?
		   AND (? = FALSE OR ki.category_id = ?)
		   AND (? = '' OR ki.title LIKE ? OR ki.summary LIKE ? OR ki.content LIKE ? OR ki.notes LIKE ? OR ki.tags LIKE ?)
		 ORDER BY ki.updated_at DESC`,
		userID,
		filterByCategory, categoryID,
		keyword, likePattern, likePattern, likePattern, likePattern, likePattern,
	)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to query knowledge items")
	}
	defer rows.Close()

	items := make([]KnowledgeSummary, 0)
	for rows.Next() {
		var record knowledgeRecord
		if err := rows.Scan(&record.ID, &record.Title, &record.CategoryID, &record.CategoryName, &record.CategorySlug, &record.SubCategory, &record.Tags, &record.Summary, &record.TemplateType, &record.CreatedAt, &record.UpdatedAt); err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "failed to read knowledge item")
		}
		items = append(items, record.summary())
	}
	if err := rows.Err(); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read knowledge items")
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

	if err := handler.validateCategoryID(c.Request().Context(), userID, request.CategoryID); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid category_id")
	}

	if err := request.validateExtra(); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	stepsJSON, err := json.Marshal(request.Steps)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid steps")
	}

	comparisonJSON, err := marshalComparison(request.Comparison)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid comparison")
	}

	result, err := handler.store.DB().ExecContext(
		c.Request().Context(),
		`INSERT INTO knowledge_items (user_id, title, category_id, sub_category, tags, summary, content, notes, reference_url, extra, template_type, steps, comparison)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		userID,
		request.Title,
		request.CategoryID,
		nullableString(request.SubCategory),
		nullableString(request.Tags),
		nullableString(request.Summary),
		nullableString(request.Content),
		nullableString(request.Notes),
		nullableString(request.ReferenceURL),
		nullableJSON(request.Extra),
		request.TemplateType,
		nullableString(string(stepsJSON)),
		nullableString(comparisonJSON),
	)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to create knowledge item")
	}

	itemID, err := result.LastInsertId()
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read created knowledge item")
	}

	detail, err := handler.findKnowledgeDetail(c.Request().Context(), userID, itemID)
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

	detail, err := handler.findKnowledgeDetail(c.Request().Context(), userID, itemID)
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
	if err := handler.validateCategoryID(c.Request().Context(), userID, request.CategoryID); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid category_id")
	}

	if err := request.validateExtra(); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	stepsJSON, err := json.Marshal(request.Steps)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid steps")
	}

	comparisonJSON, err := marshalComparison(request.Comparison)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid comparison")
	}

	result, err := handler.store.DB().ExecContext(
		c.Request().Context(),
		`UPDATE knowledge_items
		 SET title = ?, category_id = ?, sub_category = ?, tags = ?, summary = ?, content = ?, notes = ?, reference_url = ?, extra = ?, template_type = ?, steps = ?, comparison = ?
		 WHERE id = ? AND user_id = ?`,
		request.Title,
		request.CategoryID,
		nullableString(request.SubCategory),
		nullableString(request.Tags),
		nullableString(request.Summary),
		nullableString(request.Content),
		nullableString(request.Notes),
		nullableString(request.ReferenceURL),
		nullableJSON(request.Extra),
		request.TemplateType,
		nullableString(string(stepsJSON)),
		nullableString(comparisonJSON),
		itemID,
		userID,
	)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to update knowledge item")
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read updated knowledge item")
	}
	if rowsAffected == 0 {
		exists, err := handler.knowledgeExists(c.Request().Context(), userID, itemID)
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "failed to read updated knowledge item")
		}
		if !exists {
			return echo.NewHTTPError(http.StatusNotFound, "knowledge item not found")
		}
	}

	detail, err := handler.findKnowledgeDetail(c.Request().Context(), userID, itemID)
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

	result, err := handler.store.DB().ExecContext(
		c.Request().Context(),
		`DELETE FROM knowledge_items WHERE id = ? AND user_id = ?`,
		itemID,
		userID,
	)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to delete knowledge item")
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read deleted knowledge item")
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
	if err := handler.validateCategoryID(c.Request().Context(), userID, request.CategoryID); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid category_id")
	}

	// 只更新 category_id
	result, err := handler.store.DB().ExecContext(
		c.Request().Context(),
		`UPDATE knowledge_items SET category_id = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
		request.CategoryID,
		time.Now(),
		itemID,
		userID,
	)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to move category")
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to get rows affected")
	}

	if rowsAffected == 0 {
		return echo.NewHTTPError(http.StatusNotFound, "knowledge item not found or not owned by current user")
	}

	return c.NoContent(http.StatusOK)
}

// findKnowledgeDetail 查询单条知识详情
func (handler *Handler) findKnowledgeDetail(ctx context.Context, userID int64, itemID int64) (KnowledgeDetail, error) {
	var record knowledgeRecord
	row := handler.store.DB().QueryRowContext(
		ctx,
		`SELECT ki.id, ki.title, ki.category_id, c.name, c.slug, ki.sub_category, ki.tags, ki.summary, ki.content, ki.notes, ki.reference_url, ki.extra, ki.template_type, ki.steps, ki.comparison, ki.created_at, ki.updated_at
		 FROM knowledge_items ki
		 JOIN categories c ON c.id = ki.category_id
		 WHERE ki.id = ? AND ki.user_id = ?
		 LIMIT 1`,
		itemID,
		userID,
	)

	if err := row.Scan(&record.ID, &record.Title, &record.CategoryID, &record.CategoryName, &record.CategorySlug, &record.SubCategory, &record.Tags, &record.Summary, &record.Content, &record.Notes, &record.ReferenceURL, &record.Extra, &record.TemplateType, &record.Steps, &record.Comparison, &record.CreatedAt, &record.UpdatedAt); err != nil {
		return KnowledgeDetail{}, err
	}

	return record.detail(), nil
}

// knowledgeExists 检查知识条目是否存在
func (handler *Handler) knowledgeExists(ctx context.Context, userID int64, itemID int64) (bool, error) {
	var count int
	err := handler.store.DB().QueryRowContext(
		ctx,
		`SELECT COUNT(*) FROM knowledge_items WHERE id = ? AND user_id = ?`,
		itemID,
		userID,
	).Scan(&count)
	return count > 0, err
}

// normalize 去除请求字段首尾空白
func (request *KnowledgeRequest) normalize() {
	request.Title = strings.TrimSpace(request.Title)
	request.SubCategory = strings.TrimSpace(request.SubCategory)
	request.Tags = strings.TrimSpace(request.Tags)
	request.Summary = strings.TrimSpace(request.Summary)
	request.Content = strings.TrimSpace(request.Content)
	request.Notes = strings.TrimSpace(request.Notes)
	request.ReferenceURL = strings.TrimSpace(request.ReferenceURL)
	request.Extra = strings.TrimSpace(request.Extra)
	request.TemplateType = strings.TrimSpace(request.TemplateType)
	for i := range request.Steps {
		request.Steps[i].Title = strings.TrimSpace(request.Steps[i].Title)
		request.Steps[i].Code = strings.TrimSpace(request.Steps[i].Code)
		request.Steps[i].Note = strings.TrimSpace(request.Steps[i].Note)
	}
	if request.Comparison != nil {
		for i := range request.Comparison.Headers {
			request.Comparison.Headers[i] = strings.TrimSpace(request.Comparison.Headers[i])
		}
		for i := range request.Comparison.Rows {
			for j := range request.Comparison.Rows[i] {
				request.Comparison.Rows[i][j] = strings.TrimSpace(request.Comparison.Rows[i][j])
			}
		}
		request.Comparison.Intro = strings.TrimSpace(request.Comparison.Intro)
		request.Comparison.Supplement = strings.TrimSpace(request.Comparison.Supplement)
	}
}

// validateExtra 校验 extra 字段必须是合法 JSON 或空字符串
func (request *KnowledgeRequest) validateExtra() error {
	if request.Extra == "" {
		return nil
	}
	var raw map[string]any
	if err := json.Unmarshal([]byte(request.Extra), &raw); err != nil {
		return errors.New("extra must be valid json")
	}
	return nil
}

// parseSteps 将 JSON 字符串解析为步骤列表
func parseSteps(stepsJSON sql.NullString) []ProcedureStep {
	if !stepsJSON.Valid || stepsJSON.String == "" {
		return nil
	}
	var steps []ProcedureStep
	if err := json.Unmarshal([]byte(stepsJSON.String), &steps); err != nil {
		return nil
	}
	return steps
}

// parseComparison 将 JSON 字符串解析为对比表格
func parseComparison(comparisonJSON sql.NullString) *ComparisonTable {
	if !comparisonJSON.Valid || comparisonJSON.String == "" {
		return nil
	}
	var table ComparisonTable
	if err := json.Unmarshal([]byte(comparisonJSON.String), &table); err != nil {
		return nil
	}
	if len(table.Headers) == 0 || len(table.Rows) == 0 {
		return nil
	}
	return &table
}

// marshalComparison 将对比表格序列化为 JSON 字符串
func marshalComparison(table *ComparisonTable) (string, error) {
	if table == nil || len(table.Headers) == 0 {
		return "", nil
	}
	data, err := json.Marshal(table)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// summary 将数据库记录转换为列表摘要
func (record knowledgeRecord) summary() KnowledgeSummary {
	return KnowledgeSummary{
		ID:           record.ID,
		Title:        record.Title,
		CategoryID:   record.CategoryID,
		Category:     record.CategoryName,
		CategorySlug: record.CategorySlug,
		SubCategory:  nullStringValue(record.SubCategory),
		Tags:         nullStringValue(record.Tags),
		Summary:      nullStringValue(record.Summary),
		TemplateType: record.TemplateType,
		CreatedAt:    record.CreatedAt,
		UpdatedAt:    record.UpdatedAt,
	}
}

// detail 将数据库记录转换为详情
func (record knowledgeRecord) detail() KnowledgeDetail {
	return KnowledgeDetail{
		KnowledgeSummary: record.summary(),
		Content:          nullStringValue(record.Content),
		Notes:            nullStringValue(record.Notes),
		ReferenceURL:     nullStringValue(record.ReferenceURL),
		Extra:            nullStringValue(record.Extra),
		Steps:            parseSteps(record.Steps),
		Comparison:       parseComparison(record.Comparison),
	}
}

// parseKnowledgeID 从路径参数解析知识条目 ID
func parseKnowledgeID(idText string) (int64, error) {
	itemID, err := strconv.ParseInt(idText, 10, 64)
	if err != nil || itemID <= 0 {
		return 0, errors.New("invalid knowledge id")
	}
	return itemID, nil
}

// validateCategoryID 校验分类 ID 属于当前用户且为知识库分类
func (handler *Handler) validateCategoryID(ctx context.Context, userID int64, categoryID int64) error {
	cat, err := handler.categoryStore.GetByID(ctx, categoryID)
	if err != nil {
		return err
	}
	if cat == nil {
		return errors.New("category not found")
	}
	if cat.Scope != category.ScopeKnowledge {
		return errors.New("invalid category scope")
	}
	if cat.UserID == nil || *cat.UserID != userID {
		return errors.New("category not owned by user")
	}
	return nil
}

// nullableString 将字符串转为 sql.NullString
func nullableString(value string) sql.NullString {
	return sql.NullString{
		String: value,
		Valid:  value != "",
	}
}

// nullableJSON 将 JSON 字符串转为 sql.NullString
func nullableJSON(value string) sql.NullString {
	return sql.NullString{
		String: value,
		Valid:  value != "",
	}
}

// nullStringValue 将 sql.NullString 转为字符串
func nullStringValue(value sql.NullString) string {
	if !value.Valid {
		return ""
	}
	return value.String
}
