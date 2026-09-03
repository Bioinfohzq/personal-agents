package commandbook

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"
)

// ProcedureStep 流程模板单步骤
type ProcedureStep struct {
	Title string `json:"title"`
	Code  string `json:"code,omitempty"`
	Note  string `json:"note,omitempty"`
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

// marshalSteps 将步骤列表序列化为 JSON 字符串(入库用)
func marshalSteps(steps []ProcedureStep) (string, error) {
	stepsJSON, err := json.Marshal(steps)
	if err != nil {
		return "", err
	}
	return string(stepsJSON), nil
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
