package knowledgebook

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"personal-agents/backend/internal/config"
	"personal-agents/backend/internal/database"
	"personal-agents/backend/internal/middleware"
)

// knowledgePathPrefix 单条知识的路由前缀
const knowledgePathPrefix = "/api/v1/knowledge/"

// 有效分类集合(后端做白名单校验,前端固定列表)
var validCategories = map[string]bool{
	"system-path":  true,
	"url-resource": true,
	"hardware":     true,
	"algorithm":    true,
	"other":        true,
}

// Handler 知识库 HTTP 处理器
type Handler struct {
	store *database.Store
	llm   config.LLMConfig
}

// KnowledgeRequest 创建/更新知识请求体
type KnowledgeRequest struct {
	Title        string `json:"title"`
	Category     string `json:"category"`
	SubCategory  string `json:"sub_category"`
	Tags         string `json:"tags"`
	Summary      string `json:"summary"`
	Content      string `json:"content"`
	Notes        string `json:"notes"`
	ReferenceURL string `json:"reference_url"`
	Extra        string `json:"extra"`
}

// KnowledgeSummary 知识摘要(列表用)
type KnowledgeSummary struct {
	ID          int64     `json:"id"`
	Title       string    `json:"title"`
	Category    string    `json:"category"`
	SubCategory string    `json:"sub_category,omitempty"`
	Tags        string    `json:"tags,omitempty"`
	Summary     string    `json:"summary,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// KnowledgeDetail 知识详情
type KnowledgeDetail struct {
	KnowledgeSummary
	Content      string `json:"content,omitempty"`
	Notes        string `json:"notes,omitempty"`
	ReferenceURL string `json:"reference_url,omitempty"`
	Extra        string `json:"extra,omitempty"`
}

// knowledgeRecord 数据库行映射结构体
type knowledgeRecord struct {
	ID           int64
	Title        string
	Category     string
	SubCategory  sql.NullString
	Tags         sql.NullString
	Summary      sql.NullString
	Content      sql.NullString
	Notes        sql.NullString
	ReferenceURL sql.NullString
	Extra        sql.NullString
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// NewHandler 创建知识库处理器
func NewHandler(store *database.Store, llm config.LLMConfig) *Handler {
	return &Handler{store: store, llm: llm}
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
//	?category=system-path    按分类过滤
//	?q=缓存                  关键词搜索(title / content / notes / tags / summary)
func (handler *Handler) ListKnowledgeItems(w http.ResponseWriter, r *http.Request) {
	userID, ok := currentUserID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing authenticated user")
		return
	}

	category := strings.TrimSpace(r.URL.Query().Get("category"))
	keyword := strings.TrimSpace(r.URL.Query().Get("q"))

	if category != "" && !validCategories[category] {
		writeError(w, http.StatusBadRequest, "invalid category")
		return
	}

	likePattern := "%" + keyword + "%"

	rows, err := handler.store.DB().QueryContext(
		r.Context(),
		`SELECT id, title, category, sub_category, tags, summary, created_at, updated_at
		 FROM knowledge_items
		 WHERE user_id = ?
		   AND (? = '' OR category = ?)
		   AND (? = '' OR title LIKE ? OR summary LIKE ? OR content LIKE ? OR notes LIKE ? OR tags LIKE ?)
		 ORDER BY updated_at DESC`,
		userID,
		category, category,
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
		if err := rows.Scan(&record.ID, &record.Title, &record.Category, &record.SubCategory, &record.Tags, &record.Summary, &record.CreatedAt, &record.UpdatedAt); err != nil {
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
	if request.Title == "" || request.Category == "" {
		writeError(w, http.StatusBadRequest, "title and category are required")
		return
	}

	if !validCategories[request.Category] {
		writeError(w, http.StatusBadRequest, "invalid category")
		return
	}

	if err := request.validateExtra(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := handler.store.DB().ExecContext(
		r.Context(),
		`INSERT INTO knowledge_items (user_id, title, category, sub_category, tags, summary, content, notes, reference_url, extra)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		userID,
		request.Title,
		request.Category,
		nullableString(request.SubCategory),
		nullableString(request.Tags),
		nullableString(request.Summary),
		nullableString(request.Content),
		nullableString(request.Notes),
		nullableString(request.ReferenceURL),
		nullableJSON(request.Extra),
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
	if request.Title == "" || request.Category == "" {
		writeError(w, http.StatusBadRequest, "title and category are required")
		return
	}

	if !validCategories[request.Category] {
		writeError(w, http.StatusBadRequest, "invalid category")
		return
	}

	if err := request.validateExtra(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := handler.store.DB().ExecContext(
		r.Context(),
		`UPDATE knowledge_items
		 SET title = ?, category = ?, sub_category = ?, tags = ?, summary = ?, content = ?, notes = ?, reference_url = ?, extra = ?
		 WHERE id = ? AND user_id = ?`,
		request.Title,
		request.Category,
		nullableString(request.SubCategory),
		nullableString(request.Tags),
		nullableString(request.Summary),
		nullableString(request.Content),
		nullableString(request.Notes),
		nullableString(request.ReferenceURL),
		nullableJSON(request.Extra),
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
		`SELECT id, title, category, sub_category, tags, summary, content, notes, reference_url, extra, created_at, updated_at
		 FROM knowledge_items
		 WHERE id = ? AND user_id = ?
		 LIMIT 1`,
		itemID,
		userID,
	)

	if err := row.Scan(&record.ID, &record.Title, &record.Category, &record.SubCategory, &record.Tags, &record.Summary, &record.Content, &record.Notes, &record.ReferenceURL, &record.Extra, &record.CreatedAt, &record.UpdatedAt); err != nil {
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
	request.Category = strings.TrimSpace(request.Category)
	request.SubCategory = strings.TrimSpace(request.SubCategory)
	request.Tags = strings.TrimSpace(request.Tags)
	request.Summary = strings.TrimSpace(request.Summary)
	request.Content = strings.TrimSpace(request.Content)
	request.Notes = strings.TrimSpace(request.Notes)
	request.ReferenceURL = strings.TrimSpace(request.ReferenceURL)
	request.Extra = strings.TrimSpace(request.Extra)
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

// summary 将数据库记录转换为列表摘要
func (record knowledgeRecord) summary() KnowledgeSummary {
	return KnowledgeSummary{
		ID:          record.ID,
		Title:       record.Title,
		Category:    record.Category,
		SubCategory: nullStringValue(record.SubCategory),
		Tags:        nullStringValue(record.Tags),
		Summary:     nullStringValue(record.Summary),
		CreatedAt:   record.CreatedAt,
		UpdatedAt:   record.UpdatedAt,
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
