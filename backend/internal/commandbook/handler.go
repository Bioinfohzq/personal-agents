package commandbook

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"personal-agents/backend/internal/database"
	"personal-agents/backend/internal/middleware"
)

// commandPathPrefix 单条命令的路由前缀
const commandPathPrefix = "/api/v1/commands/"

// 有效分类集合(后端做白名单校验,前端固定列表)
var validCategories = map[string]bool{
	"linux":  true,
	"python": true,
	"java":   true,
	"git":    true,
	"docker": true,
	"sql":    true,
	"other":  true,
}

// Handler 命令手册 HTTP 处理器
type Handler struct {
	store *database.Store
}

// CommandRequest 创建/更新命令请求体
//
// title 字段合并了"标题"和"一句话含义",所以没有独立的 description 字段。
// parameters 为三级参数说明,多行文本,每行格式 "参数|全称|含义"(如 "-s|--summarize|只显示总计")。
// introduction 为命令的详细介绍(官方/通用说明),notes 为个人理解(我的笔记)。
type CommandRequest struct {
	Title        string `json:"title"`
	CommandText  string `json:"command_text"`
	Category     string `json:"category"`
	SubCategory  string `json:"sub_category"`
	Introduction string `json:"introduction"`
	Parameters   string `json:"parameters"`
	Notes        string `json:"notes"`
	ReferenceURL string `json:"reference_url"`
}

// CommandSummary 命令摘要(列表用,不含 introduction / parameters / notes 正文)
type CommandSummary struct {
	ID          int64     `json:"id"`
	Title       string    `json:"title"`
	CommandText string    `json:"command_text"`
	Category    string    `json:"category"`
	SubCategory string    `json:"sub_category,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// CommandDetail 命令详情(含 introduction / parameters / notes)
type CommandDetail struct {
	CommandSummary
	Introduction string `json:"introduction,omitempty"`
	Parameters   string `json:"parameters,omitempty"`
	Notes        string `json:"notes,omitempty"`
	ReferenceURL string `json:"reference_url,omitempty"`
}

// commandRecord 数据库行映射结构体(可空字段用 sql.NullString)
type commandRecord struct {
	ID           int64
	Title        string
	CommandText  string
	Category     string
	SubCategory  sql.NullString
	Introduction sql.NullString
	Parameters   sql.NullString
	Notes        sql.NullString
	ReferenceURL sql.NullString
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// NewHandler 创建命令手册处理器
func NewHandler(store *database.Store) *Handler {
	return &Handler{store: store}
}

// Commands 处理 /api/v1/commands 路由(GET 列表 / POST 创建)
func (handler *Handler) Commands(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		handler.ListCommands(w, r)
	case http.MethodPost:
		handler.CreateCommand(w, r)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// Command 处理 /api/v1/commands/{id} 路由(GET / PUT / DELETE)
func (handler *Handler) Command(w http.ResponseWriter, r *http.Request) {
	commandID, ok := commandIDFromPath(r.URL.Path)
	if !ok {
		writeError(w, http.StatusNotFound, "command not found")
		return
	}

	switch r.Method {
	case http.MethodGet:
		handler.GetCommand(w, r, commandID)
	case http.MethodPut:
		handler.UpdateCommand(w, r, commandID)
	case http.MethodDelete:
		handler.DeleteCommand(w, r, commandID)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// ListCommands 查询当前用户的命令列表
// 支持可选 query 参数:
//
//	?category=linux    按分类过滤
//	?q=grep            关键词搜索(title / command_text / introduction / parameters / notes)
func (handler *Handler) ListCommands(w http.ResponseWriter, r *http.Request) {
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
		`SELECT id, title, command_text, category, sub_category, created_at, updated_at
		 FROM commands
		 WHERE user_id = ?
		   AND (? = '' OR category = ?)
		   AND (? = '' OR title LIKE ? OR command_text LIKE ? OR introduction LIKE ? OR parameters LIKE ? OR notes LIKE ?)
		 ORDER BY updated_at DESC`,
		userID,
		category, category,
		keyword, likePattern, likePattern, likePattern, likePattern, likePattern,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to query commands")
		return
	}
	defer rows.Close()

	commands := make([]CommandSummary, 0)
	for rows.Next() {
		var record commandRecord
		if err := rows.Scan(&record.ID, &record.Title, &record.CommandText, &record.Category, &record.SubCategory, &record.CreatedAt, &record.UpdatedAt); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read command")
			return
		}
		commands = append(commands, record.summary())
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read commands")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"commands": commands,
	})
}

// CreateCommand 创建命令
func (handler *Handler) CreateCommand(w http.ResponseWriter, r *http.Request) {
	userID, ok := currentUserID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing authenticated user")
		return
	}

	var request CommandRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}

	request.normalize()
	if request.Title == "" || request.CommandText == "" || request.Category == "" {
		writeError(w, http.StatusBadRequest, "title, command_text and category are required")
		return
	}

	if !validCategories[request.Category] {
		writeError(w, http.StatusBadRequest, "invalid category")
		return
	}

	result, err := handler.store.DB().ExecContext(
		r.Context(),
		`INSERT INTO commands (user_id, title, command_text, category, sub_category, introduction, parameters, notes, reference_url)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		userID,
		request.Title,
		request.CommandText,
		request.Category,
		nullableString(request.SubCategory),
		nullableString(request.Introduction),
		nullableString(request.Parameters),
		nullableString(request.Notes),
		nullableString(request.ReferenceURL),
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create command")
		return
	}

	commandID, err := result.LastInsertId()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read created command")
		return
	}

	detail, err := handler.findCommandDetail(r, userID, commandID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read created command")
		return
	}

	writeJSON(w, http.StatusCreated, detail)
}

// GetCommand 获取单条命令详情(含 introduction / parameters / notes)
func (handler *Handler) GetCommand(w http.ResponseWriter, r *http.Request, commandID int64) {
	userID, ok := currentUserID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing authenticated user")
		return
	}

	detail, err := handler.findCommandDetail(r, userID, commandID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "command not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to read command")
		return
	}

	writeJSON(w, http.StatusOK, detail)
}

// UpdateCommand 更新命令
func (handler *Handler) UpdateCommand(w http.ResponseWriter, r *http.Request, commandID int64) {
	userID, ok := currentUserID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing authenticated user")
		return
	}

	var request CommandRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}

	request.normalize()
	if request.Title == "" || request.CommandText == "" || request.Category == "" {
		writeError(w, http.StatusBadRequest, "title, command_text and category are required")
		return
	}

	if !validCategories[request.Category] {
		writeError(w, http.StatusBadRequest, "invalid category")
		return
	}

	result, err := handler.store.DB().ExecContext(
		r.Context(),
		`UPDATE commands
		 SET title = ?, command_text = ?, category = ?, sub_category = ?, introduction = ?, parameters = ?, notes = ?, reference_url = ?
		 WHERE id = ? AND user_id = ?`,
		request.Title,
		request.CommandText,
		request.Category,
		nullableString(request.SubCategory),
		nullableString(request.Introduction),
		nullableString(request.Parameters),
		nullableString(request.Notes),
		nullableString(request.ReferenceURL),
		commandID,
		userID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update command")
		return
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read updated command")
		return
	}
	if rowsAffected == 0 {
		exists, err := handler.commandExists(r, userID, commandID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read updated command")
			return
		}
		if !exists {
			writeError(w, http.StatusNotFound, "command not found")
			return
		}
	}

	detail, err := handler.findCommandDetail(r, userID, commandID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read updated command")
		return
	}

	writeJSON(w, http.StatusOK, detail)
}

// DeleteCommand 删除命令
func (handler *Handler) DeleteCommand(w http.ResponseWriter, r *http.Request, commandID int64) {
	userID, ok := currentUserID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing authenticated user")
		return
	}

	result, err := handler.store.DB().ExecContext(
		r.Context(),
		`DELETE FROM commands WHERE id = ? AND user_id = ?`,
		commandID,
		userID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete command")
		return
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read deleted command")
		return
	}
	if rowsAffected == 0 {
		writeError(w, http.StatusNotFound, "command not found")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// findCommandDetail 查询单条命令详情(含 introduction / parameters / notes)
func (handler *Handler) findCommandDetail(r *http.Request, userID int64, commandID int64) (CommandDetail, error) {
	var record commandRecord
	row := handler.store.DB().QueryRowContext(
		r.Context(),
		`SELECT id, title, command_text, category, sub_category, introduction, parameters, notes, reference_url, created_at, updated_at
		 FROM commands
		 WHERE id = ? AND user_id = ?
		 LIMIT 1`,
		commandID,
		userID,
	)

	if err := row.Scan(&record.ID, &record.Title, &record.CommandText, &record.Category, &record.SubCategory, &record.Introduction, &record.Parameters, &record.Notes, &record.ReferenceURL, &record.CreatedAt, &record.UpdatedAt); err != nil {
		return CommandDetail{}, err
	}

	return record.detail(), nil
}

// commandExists 检查命令是否存在(用于 UpdateCommand 的 0 行更新判断)
func (handler *Handler) commandExists(r *http.Request, userID int64, commandID int64) (bool, error) {
	var count int
	err := handler.store.DB().QueryRowContext(
		r.Context(),
		`SELECT COUNT(*) FROM commands WHERE id = ? AND user_id = ?`,
		commandID,
		userID,
	).Scan(&count)
	return count > 0, err
}

// normalize 去除请求字段首尾空白
func (request *CommandRequest) normalize() {
	request.Title = strings.TrimSpace(request.Title)
	request.CommandText = strings.TrimSpace(request.CommandText)
	request.Category = strings.TrimSpace(request.Category)
	request.SubCategory = strings.TrimSpace(request.SubCategory)
	request.Introduction = strings.TrimSpace(request.Introduction)
	request.Parameters = strings.TrimSpace(request.Parameters)
	request.Notes = strings.TrimSpace(request.Notes)
	request.ReferenceURL = strings.TrimSpace(request.ReferenceURL)
}

// summary 将数据库记录转换为列表摘要
func (record commandRecord) summary() CommandSummary {
	return CommandSummary{
		ID:          record.ID,
		Title:       record.Title,
		CommandText: record.CommandText,
		Category:    record.Category,
		SubCategory: nullStringValue(record.SubCategory),
		CreatedAt:   record.CreatedAt,
		UpdatedAt:   record.UpdatedAt,
	}
}

// detail 将数据库记录转换为详情
func (record commandRecord) detail() CommandDetail {
	return CommandDetail{
		CommandSummary: record.summary(),
		Introduction:   nullStringValue(record.Introduction),
		Parameters:     nullStringValue(record.Parameters),
		Notes:          nullStringValue(record.Notes),
		ReferenceURL:   nullStringValue(record.ReferenceURL),
	}
}

// commandIDFromPath 从 URL 路径解析命令 ID
func commandIDFromPath(path string) (int64, bool) {
	idText := strings.TrimPrefix(path, commandPathPrefix)
	if idText == "" || strings.Contains(idText, "/") {
		return 0, false
	}

	commandID, err := strconv.ParseInt(idText, 10, 64)
	if err != nil || commandID <= 0 {
		return 0, false
	}

	return commandID, true
}

// currentUserID 从请求上下文获取当前用户 ID(由 JWT 中间件注入)
func currentUserID(r *http.Request) (int64, bool) {
	return middleware.CurrentUserID(r)
}

// nullableString 将字符串转为 sql.NullString(空字符串 → NULL)
func nullableString(value string) sql.NullString {
	return sql.NullString{
		String: value,
		Valid:  value != "",
	}
}

// nullStringValue 将 sql.NullString 转为字符串(NULL → 空字符串)
func nullStringValue(value sql.NullString) string {
	if !value.Valid {
		return ""
	}
	return value.String
}
