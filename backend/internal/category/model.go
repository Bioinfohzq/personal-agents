package category

import (
	"regexp"
	"strings"
	"time"
)

// slugRegex slug 格式：小写字母数字 + 短横线分隔
var slugRegex = regexp.MustCompile("^[a-z0-9]+(-[a-z0-9]+)*$")

// Scope 分类所属模块
const (
	ScopeKnowledge = "knowledge"
	ScopeCommand   = "command"
)

// Category 分类实体
type Category struct {
	ID        int64     `json:"id"`
	UserID    *int64    `json:"user_id,omitempty"`
	Scope     string    `json:"scope"`
	Name      string    `json:"name"`
	Slug      string    `json:"slug"`
	SortOrder int       `json:"sort_order"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// slugify 将分类名称转换为 slug
// 与前端 slugifyCategory 保持一致:纯英文数字短横线直接返回,否则前缀 custom-
func slugify(name string) string {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return ""
	}
	if slugRegex.MatchString(trimmed) {
		return trimmed
	}
	return "custom-" + trimmed
}
