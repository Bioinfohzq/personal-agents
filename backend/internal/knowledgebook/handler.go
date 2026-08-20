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

	"personal-agents/backend/internal/category"
	"personal-agents/backend/internal/config"
	"personal-agents/backend/internal/database"
	"personal-agents/backend/internal/middleware"
)

// knowledgePathPrefix 单条知识的路由前缀
const knowledgePathPrefix = "/api/v1/knowledge/"

// isValidCategory 校验分类格式:非空、长度不超过 40、不含空白字符。
// 前端提供固定分类 + 用户自定义分类,后端只做格式校验,不再维护白名单。
func isValidCategory(category string) bool {
	if category == "" || len(category) > 40 {
		return false
	}
	return !strings.ContainsAny(category, " \t\r\n")
}

// isValidTemplateType 校验模板类型
func isValidTemplateType(templateType string) bool {
	return templateType == "article" || templateType == "procedure"
}

// ProcedureStep 流程模板单步骤
type ProcedureStep struct {
	Title string `json:"title"`
	Code  string `json:"code,omitempty"`
	Note  string `json:"note,omitempty"`
}

// Handler 知识库 HTTP 处理器
type Handler struct {
	store         *database.Store
	categoryStore *category.Store
	llm           config.LLMConfig
}

// KnowledgeRequest 创建/更新知识请求体
type KnowledgeRequest struct {
	Title        string          `json:"title"`
	CategoryID   int64           `json:"category_id"`
	SubCategory  string          `json:"sub_category"`
	Tags         string          `json:"tags"`
	Summary      string          `json:"summary"`
	Content      string          `json:"content"`
	Notes        string          `json:"notes"`
	ReferenceURL string          `json:"reference_url"`
	Extra        string          `json:"extra"`
	TemplateType string          `json:"template_type"`
	Steps        []ProcedureStep `json:"steps"`
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
	Content      string          `json:"content,omitempty"`
	Notes        string          `json:"notes,omitempty"`
	ReferenceURL string          `json:"reference_url,omitempty"`
	Extra        string          `json:"extra,omitempty"`
	Steps        []ProcedureStep `json:"steps,omitempty"`
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
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// NewHandler 创建知识库处理器
func NewHandler(store *database.Store, llm config.LLMConfig) *Handler {
	return &Handler{store: store, categoryStore: category.NewStore(store), llm: llm}
}

// KnowledgeItems 处理 /api/v1/knowledge 路由(GET 列表 / POST 创建)
func (handler *Handler) KnowledgeItems(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		handler.ListKnowledgeItems(w, r)
	case http.MethodPost:
		handler.CreateKnowledgeItem(w, r)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// KnowledgeItem 处理 /api/v1/knowledge/{id} 路由(GET / PUT / DELETE)
func (handler *Handler) KnowledgeItem(w http.ResponseWriter, r *http.Request) {
	itemID, ok := knowledgeIDFromPath(r.URL.Path)
	if !ok {
		writeError(w, http.StatusNotFound, "knowledge item not found")
		return
	}

	switch r.Method {
	case http.MethodGet:
		handler.GetKnowledgeItem(w, r, itemID)
	case http.MethodPut:
		handler.UpdateKnowledgeItem(w, r, itemID)
	case http.MethodDelete:
		handler.DeleteKnowledgeItem(w, r, itemID)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// ListKnowledgeItems 查询当前用户的知识列表
// 支持可选 query 参数:
//
//	?category_id=1    按分类 ID 过滤
//	?q=缓存           关键词搜索(title / content / notes / tags / summary)
func (handler *Handler) ListKnowledgeItems(w http.ResponseWriter, r *http.Request) {
	userID, ok := currentUserID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing authenticated user")
		return
	}

	categoryIDStr := strings.TrimSpace(r.URL.Query().Get("category_id"))
	keyword := strings.TrimSpace(r.URL.Query().Get("q"))

	var categoryID int64
	var filterByCategory bool
	if categoryIDStr != "" {
		id, err := strconv.ParseInt(categoryIDStr, 10, 64)
		if err != nil || id <= 0 {
			writeError(w, http.StatusBadRequest, "invalid category_id")
			return
		}
		categoryID = id
		filterByCategory = true
	}

	likePattern := "%" + keyword + "%"

	rows, err := handler.store.DB().QueryContext(
		r.Context(),
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
		writeError(w, http.StatusInternalServerError, "failed to query knowledge items")
		return
	}
	defer rows.Close()

	items := make([]KnowledgeSummary, 0)
	for rows.Next() {
		var record knowledgeRecord
		if err := rows.Scan(&record.ID, &record.Title, &record.CategoryID, &record.CategoryName, &record.CategorySlug, &record.SubCategory, &record.Tags, &record.Summary, &record.TemplateType, &record.CreatedAt, &record.UpdatedAt); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read knowledge item")
			return
		}
		items = append(items, record.summary())
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read knowledge items")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"items": items,
	})
}

// CreateKnowledgeItem 创建知识条目
func (handler *Handler) CreateKnowledgeItem(w http.ResponseWriter, r *http.Request) {
	userID, ok := currentUserID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing authenticated user")
		return
	}

	var request KnowledgeRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}

	request.normalize()
	if request.TemplateType == "" {
		request.TemplateType = "article"
	}
	if !isValidTemplateType(request.TemplateType) {
		writeError(w, http.StatusBadRequest, "invalid template_type")
		return
	}
	if request.Title == "" || request.CategoryID <= 0 {
		writeError(w, http.StatusBadRequest, "title and category_id are required")
		return
	}
	if request.TemplateType == "article" && request.Content == "" {
		writeError(w, http.StatusBadRequest, "content is required for article template")
		return
	}
	if request.TemplateType == "procedure" && len(request.Steps) == 0 {
		writeError(w, http.StatusBadRequest, "steps are required for procedure template")
		return
	}

	if err := handler.validateCategoryID(r.Context(), userID, request.CategoryID); err != nil {
		writeError(w, http.StatusBadRequest, "invalid category_id")
		return
	}

	if err := request.validateExtra(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	stepsJSON, err := json.Marshal(request.Steps)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid steps")
		return
	}

	result, err := handler.store.DB().ExecContext(
		r.Context(),
		`INSERT INTO knowledge_items (user_id, title, category_id, sub_category, tags, summary, content, notes, reference_url, extra, template_type, steps)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create knowledge item")
		return
	}

	itemID, err := result.LastInsertId()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read created knowledge item")
		return
	}

	detail, err := handler.findKnowledgeDetail(r, userID, itemID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read created knowledge item")
		return
	}

	writeJSON(w, http.StatusCreated, detail)
}

// GetKnowledgeItem 获取单条知识详情
func (handler *Handler) GetKnowledgeItem(w http.ResponseWriter, r *http.Request, itemID int64) {
	userID, ok := currentUserID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing authenticated user")
		return
	}

	detail, err := handler.findKnowledgeDetail(r, userID, itemID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "knowledge item not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to read knowledge item")
		return
	}

	writeJSON(w, http.StatusOK, detail)
}

// UpdateKnowledgeItem 更新知识条目
func (handler *Handler) UpdateKnowledgeItem(w http.ResponseWriter, r *http.Request, itemID int64) {
	userID, ok := currentUserID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing authenticated user")
		return
	}

	var request KnowledgeRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}

	request.normalize()
	if request.TemplateType == "" {
		request.TemplateType = "article"
	}
	if !isValidTemplateType(request.TemplateType) {
		writeError(w, http.StatusBadRequest, "invalid template_type")
		return
	}
	if request.Title == "" || request.CategoryID <= 0 {
		writeError(w, http.StatusBadRequest, "title and category_id are required")
		return
	}
	if request.TemplateType == "article" && request.Content == "" {
		writeError(w, http.StatusBadRequest, "content is required for article template")
		return
	}
	if request.TemplateType == "procedure" && len(request.Steps) == 0 {
		writeError(w, http.StatusBadRequest, "steps are required for procedure template")
		return
	}

	if err := handler.validateCategoryID(r.Context(), userID, request.CategoryID); err != nil {
		writeError(w, http.StatusBadRequest, "invalid category_id")
		return
	}

	if err := request.validateExtra(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	stepsJSON, err := json.Marshal(request.Steps)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid steps")
		return
	}

	result, err := handler.store.DB().ExecContext(
		r.Context(),
		`UPDATE knowledge_items
		 SET title = ?, category_id = ?, sub_category = ?, tags = ?, summary = ?, content = ?, notes = ?, reference_url = ?, extra = ?, template_type = ?, steps = ?
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
		itemID,
		userID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update knowledge item")
		return
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read updated knowledge item")
		return
	}
	if rowsAffected == 0 {
		exists, err := handler.knowledgeExists(r, userID, itemID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read updated knowledge item")
			return
		}
		if !exists {
			writeError(w, http.StatusNotFound, "knowledge item not found")
			return
		}
	}

	detail, err := handler.findKnowledgeDetail(r, userID, itemID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read updated knowledge item")
		return
	}

	writeJSON(w, http.StatusOK, detail)
}

// DeleteKnowledgeItem 删除知识条目
func (handler *Handler) DeleteKnowledgeItem(w http.ResponseWriter, r *http.Request, itemID int64) {
	userID, ok := currentUserID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing authenticated user")
		return
	}

	result, err := handler.store.DB().ExecContext(
		r.Context(),
		`DELETE FROM knowledge_items WHERE id = ? AND user_id = ?`,
		itemID,
		userID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete knowledge item")
		return
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read deleted knowledge item")
		return
	}
	if rowsAffected == 0 {
		writeError(w, http.StatusNotFound, "knowledge item not found")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// findKnowledgeDetail 查询单条知识详情
func (handler *Handler) findKnowledgeDetail(r *http.Request, userID int64, itemID int64) (KnowledgeDetail, error) {
	var record knowledgeRecord
	row := handler.store.DB().QueryRowContext(
		r.Context(),
		`SELECT ki.id, ki.title, ki.category_id, c.name, c.slug, ki.sub_category, ki.tags, ki.summary, ki.content, ki.notes, ki.reference_url, ki.extra, ki.template_type, ki.steps, ki.created_at, ki.updated_at
		 FROM knowledge_items ki
		 JOIN categories c ON c.id = ki.category_id
		 WHERE ki.id = ? AND ki.user_id = ?
		 LIMIT 1`,
		itemID,
		userID,
	)

	if err := row.Scan(&record.ID, &record.Title, &record.CategoryID, &record.CategoryName, &record.CategorySlug, &record.SubCategory, &record.Tags, &record.Summary, &record.Content, &record.Notes, &record.ReferenceURL, &record.Extra, &record.TemplateType, &record.Steps, &record.CreatedAt, &record.UpdatedAt); err != nil {
		return KnowledgeDetail{}, err
	}

	return record.detail(), nil
}

// knowledgeExists 检查知识条目是否存在
func (handler *Handler) knowledgeExists(r *http.Request, userID int64, itemID int64) (bool, error) {
	var count int
	err := handler.store.DB().QueryRowContext(
		r.Context(),
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
	}
}

// knowledgeIDFromPath 从 URL 路径解析知识条目 ID
func knowledgeIDFromPath(path string) (int64, bool) {
	idText := strings.TrimPrefix(path, knowledgePathPrefix)
	if idText == "" || strings.Contains(idText, "/") {
		return 0, false
	}

	itemID, err := strconv.ParseInt(idText, 10, 64)
	if err != nil || itemID <= 0 {
		return 0, false
	}

	return itemID, true
}

// currentUserID 从请求上下文获取当前用户 ID
func currentUserID(r *http.Request) (int64, bool) {
	return middleware.CurrentUserID(r)
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
