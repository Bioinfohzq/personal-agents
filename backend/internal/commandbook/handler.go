package commandbook

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
	store         *database.Store
	categoryStore *category.Store
	llm           config.LLMConfig
}

// CommandRequest 创建/更新命令请求体
type CommandRequest struct {
	Title        string          `json:"title"`
	CommandText  string          `json:"command_text"`
	CategoryID   int64           `json:"category_id"`
	SubCategory  string          `json:"sub_category"`
	Introduction string          `json:"introduction"`
	Parameters   string          `json:"parameters"`
	Scenarios    string          `json:"scenarios"`
	Notes        string          `json:"notes"`
	ReferenceURL string          `json:"reference_url"`
	TemplateType string          `json:"template_type"`
	Steps        []ProcedureStep `json:"steps"`
}

// MoveCommandRequest 移动分类请求体（只接收 category_id）
type MoveCommandRequest struct {
	CategoryID int64 `json:"category_id"`
}

// CommandSummary 命令摘要(列表用,不含 introduction / parameters / notes 正文)
type CommandSummary struct {
	ID           int64     `json:"id"`
	Title        string    `json:"title"`
	CommandText  string    `json:"command_text"`
	CategoryID   int64     `json:"category_id"`
	Category     string    `json:"category"`
	CategorySlug string    `json:"category_slug"`
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
	CategoryID   int64
	CategoryName string
	CategorySlug string
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
	return &Handler{store: store, categoryStore: category.NewStore(store), llm: llm}
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

	likePattern := "%" + keyword + "%"

	rows, err := handler.store.QueryContext(
		c.Request().Context(),
		`SELECT c.id, c.title, c.command_text, c.category_id, cat.name, cat.slug, c.sub_category, c.template_type, c.created_at, c.updated_at
		 FROM commands c
		 JOIN categories cat ON cat.id = c.category_id
		 WHERE c.user_id = ?
		   AND (? = FALSE OR c.category_id = ?)
		   AND (? = '' OR c.title LIKE ? OR c.command_text LIKE ? OR c.introduction LIKE ? OR c.parameters LIKE ? OR c.notes LIKE ?)
		 ORDER BY c.updated_at DESC`,
		userID,
		filterByCategory, categoryID,
		keyword, likePattern, likePattern, likePattern, likePattern, likePattern,
	)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to query commands")
	}
	defer rows.Close()

	commands := make([]CommandSummary, 0)
	for rows.Next() {
		var record commandRecord
		if err := rows.Scan(&record.ID, &record.Title, &record.CommandText, &record.CategoryID, &record.CategoryName, &record.CategorySlug, &record.SubCategory, &record.TemplateType, &record.CreatedAt, &record.UpdatedAt); err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "failed to read command")
		}
		commands = append(commands, record.summary())
	}
	if err := rows.Err(); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read commands")
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

	if err := handler.validateCategoryID(c.Request().Context(), userID, request.CategoryID); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid category_id")
	}

	stepsJSON, err := json.Marshal(request.Steps)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid steps")
	}

	// PG 不支持 LastInsertId,通过 RETURNING 直接拿新记录 id
	var commandID int64
	err = handler.store.QueryRowContext(
		c.Request().Context(),
		`INSERT INTO commands (user_id, title, command_text, category_id, sub_category, introduction, parameters, scenarios, notes, reference_url, template_type, steps)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
		userID,
		request.Title,
		request.CommandText,
		request.CategoryID,
		nullableString(request.SubCategory),
		nullableString(request.Introduction),
		nullableString(request.Parameters),
		nullableString(request.Scenarios),
		nullableString(request.Notes),
		nullableString(request.ReferenceURL),
		request.TemplateType,
		nullableString(string(stepsJSON)),
	).Scan(&commandID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to create command")
	}

	detail, err := handler.findCommandDetail(c.Request().Context(), userID, commandID)
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

	detail, err := handler.findCommandDetail(c.Request().Context(), userID, commandID)
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
	if err := handler.validateCategoryID(c.Request().Context(), userID, request.CategoryID); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid category_id")
	}

	stepsJSON, err := json.Marshal(request.Steps)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid steps")
	}

	result, err := handler.store.ExecContext(
		c.Request().Context(),
		`UPDATE commands
		 SET title = ?, command_text = ?, category_id = ?, sub_category = ?, introduction = ?, parameters = ?, scenarios = ?, notes = ?, reference_url = ?, template_type = ?, steps = ?
		 WHERE id = ? AND user_id = ?`,
		request.Title,
		request.CommandText,
		request.CategoryID,
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
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to update command")
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read updated command")
	}
	if rowsAffected == 0 {
		exists, err := handler.commandExists(c.Request().Context(), userID, commandID)
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "failed to read updated command")
		}
		if !exists {
			return echo.NewHTTPError(http.StatusNotFound, "command not found")
		}
	}

	detail, err := handler.findCommandDetail(c.Request().Context(), userID, commandID)
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

	result, err := handler.store.ExecContext(
		c.Request().Context(),
		`DELETE FROM commands WHERE id = ? AND user_id = ?`,
		commandID,
		userID,
	)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to delete command")
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read deleted command")
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
	if err := handler.validateCategoryID(c.Request().Context(), userID, request.CategoryID); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid category_id")
	}

	// 只更新 category_id
	result, err := handler.store.ExecContext(
		c.Request().Context(),
		`UPDATE commands SET category_id = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
		request.CategoryID,
		time.Now(),
		commandID,
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
		return echo.NewHTTPError(http.StatusNotFound, "command item not found or not owned by current user")
	}

	return c.NoContent(http.StatusOK)
}

// findCommandDetail 查询单条命令详情(含 introduction / parameters / notes / steps)
func (handler *Handler) findCommandDetail(ctx context.Context, userID int64, commandID int64) (CommandDetail, error) {
	var record commandRecord
	row := handler.store.QueryRowContext(
		ctx,
		`SELECT c.id, c.title, c.command_text, c.category_id, cat.name, cat.slug, c.sub_category, c.introduction, c.parameters, c.scenarios, c.notes, c.reference_url, c.template_type, c.steps, c.created_at, c.updated_at
		 FROM commands c
		 JOIN categories cat ON cat.id = c.category_id
		 WHERE c.id = ? AND c.user_id = ?
		 LIMIT 1`,
		commandID,
		userID,
	)

	if err := row.Scan(&record.ID, &record.Title, &record.CommandText, &record.CategoryID, &record.CategoryName, &record.CategorySlug, &record.SubCategory, &record.Introduction, &record.Parameters, &record.Scenarios, &record.Notes, &record.ReferenceURL, &record.TemplateType, &record.Steps, &record.CreatedAt, &record.UpdatedAt); err != nil {
		return CommandDetail{}, err
	}

	return record.detail(), nil
}

// commandExists 检查命令是否存在(用于 UpdateCommand 的 0 行更新判断)
func (handler *Handler) commandExists(ctx context.Context, userID int64, commandID int64) (bool, error) {
	var count int
	err := handler.store.QueryRowContext(
		ctx,
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
		CategoryID:   record.CategoryID,
		Category:     record.CategoryName,
		CategorySlug: record.CategorySlug,
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

// parseCommandID 从路径参数解析命令 ID
func parseCommandID(idText string) (int64, error) {
	commandID, err := strconv.ParseInt(idText, 10, 64)
	if err != nil || commandID <= 0 {
		return 0, errors.New("invalid command id")
	}
	return commandID, nil
}

// validateCategoryID 校验分类 ID 属于当前用户且为命令手册分类
func (handler *Handler) validateCategoryID(ctx context.Context, userID int64, categoryID int64) error {
	cat, err := handler.categoryStore.GetByID(ctx, categoryID)
	if err != nil {
		return err
	}
	if cat == nil {
		return errors.New("category not found")
	}
	if cat.Scope != category.ScopeCommand {
		return errors.New("invalid category scope")
	}
	if cat.UserID == nil || *cat.UserID != userID {
		return errors.New("category not owned by user")
	}
	return nil
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
