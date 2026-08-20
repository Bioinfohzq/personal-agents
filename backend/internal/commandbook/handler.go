package commandbook

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

// commandPathPrefix 单条命令的路由前缀
const commandPathPrefix = "/api/v1/commands/"

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

// Handler 命令手册 HTTP 处理器
type Handler struct {
	store *database.Store
	llm   config.LLMConfig
}

// CommandRequest 创建/更新命令请求体
//
// title 字段合并了"标题"和"一句话含义",所以没有独立的 description 字段。
// parameters 为三级参数说明,多行文本,每行格式 "参数|全称|含义"(如 "-s|--summarize|只显示总计")。
// introduction 为命令的详细介绍(官方/通用说明),notes 为个人理解(我的笔记)。
// template_type 为模板类型: article=单条命令, procedure=流程模板; steps 为流程模板步骤列表。
type CommandRequest struct {
	Title        string          `json:"title"`
	CommandText  string          `json:"command_text"`
	Category     string          `json:"category"`
	SubCategory  string          `json:"sub_category"`
	Introduction string          `json:"introduction"`
	Parameters   string          `json:"parameters"`
	Scenarios    string          `json:"scenarios"`
	Notes        string          `json:"notes"`
	ReferenceURL string          `json:"reference_url"`
	TemplateType string          `json:"template_type"`
	Steps        []ProcedureStep `json:"steps"`
}

// CommandSummary 命令摘要(列表用,不含 introduction / parameters / notes 正文)
type CommandSummary struct {
	ID           int64     `json:"id"`
	Title        string    `json:"title"`
	CommandText  string    `json:"command_text"`
	Category     string    `json:"category"`
	SubCategory  string    `json:"sub_category,omitempty"`
	TemplateType string    `json:"template_type"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// CommandDetail 命令详情(含 introduction / parameters / notes)
type CommandDetail struct {
	CommandSummary
	Introduction string          `json:"introduction,omitempty"`
	Parameters   string          `json:"parameters,omitempty"`
	Scenarios    string          `json:"scenarios,omitempty"`
	Notes        string          `json:"notes,omitempty"`
	ReferenceURL string          `json:"reference_url,omitempty"`
	Steps        []ProcedureStep `json:"steps,omitempty"`
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
	Scenarios    sql.NullString
	Notes        sql.NullString
	ReferenceURL sql.NullString
	TemplateType string
	Steps        sql.NullString
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// NewHandler 创建命令手册处理器
func NewHandler(store *database.Store, llm config.LLMConfig) *Handler {
	return &Handler{store: store, llm: llm}
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

	if category != "" && !isValidCategory(category) {
		writeError(w, http.StatusBadRequest, "invalid category")
		return
	}

	likePattern := "%" + keyword + "%"

	rows, err := handler.store.DB().QueryContext(
		r.Context(),
		`SELECT id, title, command_text, category, sub_category, template_type, created_at, updated_at
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
		if err := rows.Scan(&record.ID, &record.Title, &record.CommandText, &record.Category, &record.SubCategory, &record.TemplateType, &record.CreatedAt, &record.UpdatedAt); err != nil {
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
	if request.TemplateType == "" {
		request.TemplateType = "article"
	}
	if !isValidTemplateType(request.TemplateType) {
		writeError(w, http.StatusBadRequest, "invalid template_type")
		return
	}
	if request.Title == "" || request.Category == "" {
		writeError(w, http.StatusBadRequest, "title and category are required")
		return
	}
	if request.TemplateType == "article" && request.CommandText == "" {
		writeError(w, http.StatusBadRequest, "command_text is required for article template")
		return
	}
	if request.TemplateType == "procedure" && len(request.Steps) == 0 {
		writeError(w, http.StatusBadRequest, "steps are required for procedure template")
		return
	}

	if !isValidCategory(request.Category) {
		writeError(w, http.StatusBadRequest, "invalid category")
		return
	}

	stepsJSON, err := json.Marshal(request.Steps)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid steps")
		return
	}

	result, err := handler.store.DB().ExecContext(
		r.Context(),
		`INSERT INTO commands (user_id, title, command_text, category, sub_category, introduction, parameters, scenarios, notes, reference_url, template_type, steps)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		userID,
		request.Title,
		request.CommandText,
		request.Category,
		nullableString(request.SubCategory),
		nullableString(request.Introduction),
		nullableString(request.Parameters),
		nullableString(request.Scenarios),
		nullableString(request.Notes),
		nullableString(request.ReferenceURL),
		request.TemplateType,
		nullableString(string(stepsJSON)),
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
	if request.TemplateType == "" {
		request.TemplateType = "article"
	}
	if !isValidTemplateType(request.TemplateType) {
		writeError(w, http.StatusBadRequest, "invalid template_type")
		return
	}
	if request.Title == "" || request.Category == "" {
		writeError(w, http.StatusBadRequest, "title and category are required")
		return
	}
	if request.TemplateType == "article" && request.CommandText == "" {
		writeError(w, http.StatusBadRequest, "command_text is required for article template")
		return
	}
	if request.TemplateType == "procedure" && len(request.Steps) == 0 {
		writeError(w, http.StatusBadRequest, "steps are required for procedure template")
		return
	}

	if !isValidCategory(request.Category) {
		writeError(w, http.StatusBadRequest, "invalid category")
		return
	}

	stepsJSON, err := json.Marshal(request.Steps)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid steps")
		return
	}

	result, err := handler.store.DB().ExecContext(
		r.Context(),
		`UPDATE commands
		 SET title = ?, command_text = ?, category = ?, sub_category = ?, introduction = ?, parameters = ?, scenarios = ?, notes = ?, reference_url = ?, template_type = ?, steps = ?
		 WHERE id = ? AND user_id = ?`,
		request.Title,
		request.CommandText,
		request.Category,
		nullableString(request.SubCategory),
		nullableString(request.Introduction),
		nullableString(request.Parameters),
		nullableString(request.Scenarios),
		nullableString(request.Notes),
		nullableString(request.ReferenceURL),
		request.TemplateType,
		nullableString(string(stepsJSON)),
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

// MoveCategoryRequest 批量迁移分类请求体
type MoveCategoryRequest struct {
	OldCategory string `json:"old_category"`
	NewCategory string `json:"new_category"`
}

// MoveCategory 将当前用户某分类下的所有命令批量迁移到另一分类
// 用于删除自定义分类时,将其下命令移动到"其他"等默认分类
func (handler *Handler) MoveCategory(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	userID, ok := currentUserID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing authenticated user")
		return
	}

	var request MoveCategoryRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}
	request.OldCategory = strings.TrimSpace(request.OldCategory)
	request.NewCategory = strings.TrimSpace(request.NewCategory)

	if request.OldCategory == "" || request.NewCategory == "" {
		writeError(w, http.StatusBadRequest, "old_category and new_category are required")
		return
	}
	if !isValidCategory(request.OldCategory) || !isValidCategory(request.NewCategory) {
		writeError(w, http.StatusBadRequest, "invalid category")
		return
	}

	_, err := handler.store.DB().ExecContext(
		r.Context(),
		`UPDATE commands
		 SET category = ?, updated_at = ?
		 WHERE user_id = ? AND category = ?`,
		request.NewCategory,
		time.Now(),
		userID,
		request.OldCategory,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to move commands category")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// findCommandDetail 查询单条命令详情(含 introduction / parameters / notes / steps)
func (handler *Handler) findCommandDetail(r *http.Request, userID int64, commandID int64) (CommandDetail, error) {
	var record commandRecord
	row := handler.store.DB().QueryRowContext(
		r.Context(),
		`SELECT id, title, command_text, category, sub_category, introduction, parameters, scenarios, notes, reference_url, template_type, steps, created_at, updated_at
		 FROM commands
		 WHERE id = ? AND user_id = ?
		 LIMIT 1`,
		commandID,
		userID,
	)

	if err := row.Scan(&record.ID, &record.Title, &record.CommandText, &record.Category, &record.SubCategory, &record.Introduction, &record.Parameters, &record.Scenarios, &record.Notes, &record.ReferenceURL, &record.TemplateType, &record.Steps, &record.CreatedAt, &record.UpdatedAt); err != nil {
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
	request.Scenarios = strings.TrimSpace(request.Scenarios)
	request.Notes = strings.TrimSpace(request.Notes)
	request.ReferenceURL = strings.TrimSpace(request.ReferenceURL)
	request.TemplateType = strings.TrimSpace(request.TemplateType)
	for i := range request.Steps {
		request.Steps[i].Title = strings.TrimSpace(request.Steps[i].Title)
		request.Steps[i].Code = strings.TrimSpace(request.Steps[i].Code)
		request.Steps[i].Note = strings.TrimSpace(request.Steps[i].Note)
	}
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
func (record commandRecord) summary() CommandSummary {
	return CommandSummary{
		ID:           record.ID,
		Title:        record.Title,
		CommandText:  record.CommandText,
		Category:     record.Category,
		SubCategory:  nullStringValue(record.SubCategory),
		TemplateType: record.TemplateType,
		CreatedAt:    record.CreatedAt,
		UpdatedAt:    record.UpdatedAt,
	}
}

// detail 将数据库记录转换为详情
func (record commandRecord) detail() CommandDetail {
	return CommandDetail{
		CommandSummary: record.summary(),
		Introduction:   nullStringValue(record.Introduction),
		Parameters:     nullStringValue(record.Parameters),
		Scenarios:      nullStringValue(record.Scenarios),
		Notes:          nullStringValue(record.Notes),
		ReferenceURL:   nullStringValue(record.ReferenceURL),
		Steps:          parseSteps(record.Steps),
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
