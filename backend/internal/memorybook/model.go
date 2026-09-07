package memorybook

import (
	"database/sql"
	"errors"
	"strconv"
	"strings"
	"time"
)

// 记忆主题分类(白名单校验)
const (
	TopicPersonalFact       = "personal_fact"        // 个人事实(设备、角色、环境)
	TopicTechPreference     = "tech_preference"      // 技术偏好(语言、框架、工具)
	TopicProjectConvention  = "project_convention"   // 项目约定(规范、配置)
	TopicLessonLearned      = "lesson_learned"       // 踩坑教训(bug和解决方案)
	TopicCommunicationStyle = "communication_style"  // 沟通偏好(语言、风格)
)

// validTopics 允许的 topic 集合
var validTopics = map[string]bool{
	TopicPersonalFact:       true,
	TopicTechPreference:     true,
	TopicProjectConvention:  true,
	TopicLessonLearned:      true,
	TopicCommunicationStyle: true,
}

// MemoryRequest 创建/更新记忆请求体(前端B8管理页用)
type MemoryRequest struct {
	Topic      string `json:"topic"`
	Title      string `json:"title"`
	Content    string `json:"content"`
	Importance int    `json:"importance"`
	IsActive   bool   `json:"is_active"`
}

// InternalSaveRequest Agent内部保存记忆请求(save_memory工具用)
// 支持通过 similarity_threshold 控制"同主题相似记忆"的合并策略
type InternalSaveRequest struct {
	Topic      string `json:"topic"`
	Title      string `json:"title"`
	Content    string `json:"content"`
	Importance int    `json:"importance"`
}

// MemorySummary 记忆摘要(列表用/B8管理页)
type MemorySummary struct {
	ID         int64     `json:"id"`
	Topic      string    `json:"topic"`
	Title      string    `json:"title"`
	Content    string    `json:"content"`
	Importance int       `json:"importance"`
	IsActive   bool      `json:"is_active"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// MemoryDetail 记忆详情(目前和Summary一致,预留扩展)
type MemoryDetail = MemorySummary

// memoryRecord 数据库行映射
type memoryRecord struct {
	ID         int64
	Topic      string
	Title      string
	Content    string
	Importance int
	IsActive   bool
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

// normalize 去除首尾空白、补默认值
func (r *MemoryRequest) normalize() {
	r.Topic = strings.TrimSpace(r.Topic)
	r.Title = strings.TrimSpace(r.Title)
	r.Content = strings.TrimSpace(r.Content)
	if r.Importance < 1 || r.Importance > 5 {
		r.Importance = 3
	}
}

// validate 校验请求合法性
func (r *MemoryRequest) validate() error {
	if r.Topic == "" {
		return errors.New("topic is required")
	}
	if !validTopics[r.Topic] {
		return errors.New("invalid topic")
	}
	if r.Title == "" {
		return errors.New("title is required")
	}
	if len(r.Title) > 200 {
		return errors.New("title too long (max 200)")
	}
	if r.Content == "" {
		return errors.New("content is required")
	}
	return nil
}

// normalize 内部保存请求默认值
func (r *InternalSaveRequest) normalize() {
	r.Topic = strings.TrimSpace(r.Topic)
	r.Title = strings.TrimSpace(r.Title)
	r.Content = strings.TrimSpace(r.Content)
	if r.Importance < 1 || r.Importance > 5 {
		r.Importance = 3
	}
	if r.Topic == "" {
		r.Topic = TopicPersonalFact
	}
}

// toSummary 行记录转响应
func (rec memoryRecord) toSummary() MemorySummary {
	return MemorySummary{
		ID:         rec.ID,
		Topic:      rec.Topic,
		Title:      rec.Title,
		Content:    rec.Content,
		Importance: rec.Importance,
		IsActive:   rec.IsActive,
		CreatedAt:  rec.CreatedAt,
		UpdatedAt:  rec.UpdatedAt,
	}
}

// parseMemoryID 解析路径参数中的记忆ID
func parseMemoryID(idText string) (int64, error) {
	id, err := strconv.ParseInt(idText, 10, 64)
	if err != nil || id <= 0 {
		return 0, errors.New("invalid memory id")
	}
	return id, nil
}

// nullableString 将字符串转为 sql.NullString(空串→NULL)
func nullableString(s string) sql.NullString {
	return sql.NullString{String: s, Valid: s != ""}
}
