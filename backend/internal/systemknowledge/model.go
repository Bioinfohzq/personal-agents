package systemknowledge

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

// 分类常量(白名单)
const (
	CategoryLinuxFHS = "linux-fhs"
	CategorySyscall  = "syscall"
	CategoryProcess  = "process"
	CategoryMemory   = "memory"
	CategoryDriver   = "driver"
	CategoryCPU      = "cpu"
)

var validCategories = map[string]bool{
	CategoryLinuxFHS: true,
	CategorySyscall:  true,
	CategoryProcess:  true,
	CategoryMemory:   true,
	CategoryDriver:   true,
	CategoryCPU:      true,
}

// 节点类型
const (
	TypeDir  = "dir"
	TypeFile = "file"
)

var validNodeTypes = map[string]bool{
	TypeDir:  true,
	TypeFile: true,
}

// Node 系统知识节点(响应结构)
type Node struct {
	ID          int64     `json:"id"`
	UserID      int64     `json:"user_id"`
	Category    string    `json:"category"`
	ParentPath  string    `json:"parent_path"`
	Path        string    `json:"path"`
	Name        string    `json:"name"`
	NodeType    string    `json:"node_type"`
	Description string    `json:"description"`
	Contents    string    `json:"contents"`
	Examples    []string  `json:"examples"`
	SortOrder   int       `json:"sort_order"`
	IsBuiltin   bool      `json:"is_builtin"`
	IsCustom    bool      `json:"is_custom"` // = user_id > 0,方便前端判断
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// CreateRequest 创建节点请求
type CreateRequest struct {
	Category    string   `json:"category"`
	ParentPath  string   `json:"parent_path"`
	Name        string   `json:"name"`
	NodeType    string   `json:"node_type"`
	Description string   `json:"description"`
	Contents    string   `json:"contents"`
	Examples    []string `json:"examples"`
}

// UpdateRequest 更新节点请求
type UpdateRequest struct {
	Description *string  `json:"description"`
	Contents    *string  `json:"contents"`
	Examples    []string `json:"examples"`
	Name        *string  `json:"name"`
}

// nodeRecord 数据库行映射
type nodeRecord struct {
	ID          int64
	UserID      int64
	Category    string
	ParentPath  string
	Path        string
	Name        string
	NodeType    string
	Description string
	Contents    string
	ExamplesRaw []byte // JSONB
	SortOrder   int
	IsBuiltin   bool
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

func (r nodeRecord) toNode() (Node, error) {
	var examples []string
	if len(r.ExamplesRaw) > 0 {
		if err := json.Unmarshal(r.ExamplesRaw, &examples); err != nil {
			return Node{}, err
		}
	}
	if examples == nil {
		examples = []string{}
	}
	return Node{
		ID:          r.ID,
		UserID:      r.UserID,
		Category:    r.Category,
		ParentPath:  r.ParentPath,
		Path:        r.Path,
		Name:        r.Name,
		NodeType:    r.NodeType,
		Description: r.Description,
		Contents:    r.Contents,
		Examples:    examples,
		SortOrder:   r.SortOrder,
		IsBuiltin:   r.IsBuiltin,
		IsCustom:    r.UserID > 0,
		CreatedAt:   r.CreatedAt,
		UpdatedAt:   r.UpdatedAt,
	}, nil
}

func (r *CreateRequest) normalize() {
	r.Category = strings.TrimSpace(r.Category)
	r.ParentPath = strings.TrimSpace(r.ParentPath)
	r.Name = strings.TrimSpace(r.Name)
	r.NodeType = strings.TrimSpace(r.NodeType)
	r.Description = strings.TrimSpace(r.Description)
	r.Contents = strings.TrimSpace(r.Contents)
	if r.Examples == nil {
		r.Examples = []string{}
	}
	// 过滤掉空示例
	cleaned := make([]string, 0, len(r.Examples))
	for _, e := range r.Examples {
		e = strings.TrimSpace(e)
		if e != "" {
			cleaned = append(cleaned, e)
		}
	}
	r.Examples = cleaned
	if r.Category == "" {
		r.Category = CategoryLinuxFHS
	}
	if r.NodeType == "" {
		r.NodeType = TypeDir
	}
}

func (r *CreateRequest) computeFullPath() string {
	if r.ParentPath == "" || r.ParentPath == "/" {
		if r.ParentPath == "/" {
			return "/" + r.Name
		}
		return "/" + r.Name
	}
	// parent_path 不以/结尾
	return r.ParentPath + "/" + r.Name
}

func (r *CreateRequest) validate() error {
	if !validCategories[r.Category] {
		return errors.New("invalid category")
	}
	if r.Name == "" {
		return errors.New("name is required")
	}
	if strings.Contains(r.Name, "/") {
		return errors.New("name must not contain '/'")
	}
	if len(r.Name) > 200 {
		return errors.New("name too long (max 200)")
	}
	if !validNodeTypes[r.NodeType] {
		return errors.New("invalid node_type")
	}
	return nil
}

func (r *UpdateRequest) normalize() {
	if r.Description != nil {
		*r.Description = strings.TrimSpace(*r.Description)
	}
	if r.Contents != nil {
		*r.Contents = strings.TrimSpace(*r.Contents)
	}
	if r.Name != nil {
		*r.Name = strings.TrimSpace(*r.Name)
	}
	if r.Examples != nil {
		cleaned := make([]string, 0, len(r.Examples))
		for _, e := range r.Examples {
			e = strings.TrimSpace(e)
			if e != "" {
				cleaned = append(cleaned, e)
			}
		}
		r.Examples = cleaned
	}
}

func (r *UpdateRequest) toSQLArgs() (desc sql.NullString, cont sql.NullString, name sql.NullString, examplesJSON []byte, hasExamples bool, err error) {
	if r.Description != nil {
		desc = sql.NullString{String: *r.Description, Valid: true}
	}
	if r.Contents != nil {
		cont = sql.NullString{String: *r.Contents, Valid: true}
	}
	if r.Name != nil {
		if *r.Name == "" {
			err = errors.New("name cannot be empty")
			return
		}
		if strings.Contains(*r.Name, "/") {
			err = errors.New("name must not contain '/'")
			return
		}
		name = sql.NullString{String: *r.Name, Valid: true}
	}
	if r.Examples != nil {
		hasExamples = true
		examplesJSON, err = json.Marshal(r.Examples)
		if err != nil {
			return
		}
	}
	return
}
