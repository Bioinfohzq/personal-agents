package knowledgebook

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

// nullableString 将字符串转为 sql.NullString(空字符串 → NULL)
func nullableString(value string) sql.NullString {
	return sql.NullString{
		String: value,
		Valid:  value != "",
	}
}

// nullableJSON 将 JSON 字符串转为 sql.NullString(与 nullableString 行为一致,空 → NULL)
func nullableJSON(value string) sql.NullString {
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
