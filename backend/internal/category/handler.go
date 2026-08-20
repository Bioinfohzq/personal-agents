package category

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"personal-agents/backend/internal/database"
	"personal-agents/backend/internal/middleware"
)

// Handler 分类管理 HTTP 处理器
type Handler struct {
	store *Store
}

// NewHandler 创建分类管理处理器
func NewHandler(store *database.Store) *Handler {
	return &Handler{store: NewStore(store)}
}

// CreateRequest 创建分类请求体
type CreateRequest struct {
	Scope string `json:"scope"`
	Name  string `json:"name"`
}

// RenameRequest 重命名分类请求体
type RenameRequest struct {
	Name string `json:"name"`
}

// Categories 处理 /api/v1/categories 路由
func (handler *Handler) Categories(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		handler.ListCategories(w, r)
	case http.MethodPost:
		handler.CreateCategory(w, r)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// Category 处理 /api/v1/categories/{id} 路由
func (handler *Handler) Category(w http.ResponseWriter, r *http.Request) {
	categoryID, ok := categoryIDFromPath(r.URL.Path)
	if !ok {
		writeError(w, http.StatusNotFound, "category not found")
		return
	}

	switch r.Method {
	case http.MethodPut:
		handler.RenameCategory(w, r, categoryID)
	case http.MethodDelete:
		handler.DeleteCategory(w, r, categoryID)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// ListCategories 查询当前用户的分类列表
// 支持 query 参数: ?scope=knowledge|command
func (handler *Handler) ListCategories(w http.ResponseWriter, r *http.Request) {
	userID, ok := currentUserID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing authenticated user")
		return
	}

	scope := strings.TrimSpace(r.URL.Query().Get("scope"))
	if scope != ScopeKnowledge && scope != ScopeCommand {
		writeError(w, http.StatusBadRequest, "invalid scope")
		return
	}

	categories, err := handler.store.List(r.Context(), userID, scope)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list categories")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"categories": categories,
	})
}

// CreateCategory 创建自定义分类
func (handler *Handler) CreateCategory(w http.ResponseWriter, r *http.Request) {
	userID, ok := currentUserID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing authenticated user")
		return
	}

	var req CreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}

	req.Scope = strings.TrimSpace(req.Scope)
	req.Name = strings.TrimSpace(req.Name)

	if req.Scope != ScopeKnowledge && req.Scope != ScopeCommand {
		writeError(w, http.StatusBadRequest, "invalid scope")
		return
	}
	if req.Name == "" || len(req.Name) > 40 {
		writeError(w, http.StatusBadRequest, "invalid category name")
		return
	}

	category, err := handler.store.Create(r.Context(), userID, req.Scope, req.Name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create category")
		return
	}

	writeJSON(w, http.StatusCreated, category)
}

// RenameCategory 重命名自定义分类
func (handler *Handler) RenameCategory(w http.ResponseWriter, r *http.Request, categoryID int64) {
	userID, ok := currentUserID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing authenticated user")
		return
	}

	var req RenameRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || len(req.Name) > 40 {
		writeError(w, http.StatusBadRequest, "invalid category name")
		return
	}

	// 校验分类属于当前用户
	existing, err := handler.store.GetByID(r.Context(), categoryID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read category")
		return
	}
	if existing == nil {
		writeError(w, http.StatusNotFound, "category not found")
		return
	}
	if existing.UserID == nil || *existing.UserID != userID {
		writeError(w, http.StatusForbidden, "category not owned by current user")
		return
	}

	if err := handler.store.Rename(r.Context(), categoryID, req.Name); err != nil {
		if errors.Is(err, errors.New("category not found")) {
			writeError(w, http.StatusNotFound, "category not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to rename category")
		return
	}

	updated, err := handler.store.GetByID(r.Context(), categoryID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read renamed category")
		return
	}

	writeJSON(w, http.StatusOK, updated)
}

// DeleteCategory 删除自定义分类
// 删除前需将该分类下的记录移动到"其他"分类
func (handler *Handler) DeleteCategory(w http.ResponseWriter, r *http.Request, categoryID int64) {
	userID, ok := currentUserID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing authenticated user")
		return
	}

	existing, err := handler.store.GetByID(r.Context(), categoryID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read category")
		return
	}
	if existing == nil {
		writeError(w, http.StatusNotFound, "category not found")
		return
	}
	if existing.UserID == nil || *existing.UserID != userID {
		writeError(w, http.StatusForbidden, "category not owned by current user")
		return
	}

	// 查找该 scope 下的 "其他" 固定分类作为默认归类
	other, err := handler.store.GetBySlug(r.Context(), userID, existing.Scope, "other")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to resolve default category")
		return
	}
	if other == nil {
		writeError(w, http.StatusInternalServerError, "default category not found")
		return
	}

	if err := handler.store.Delete(r.Context(), existing, userID, other.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete category")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func categoryIDFromPath(path string) (int64, bool) {
	const prefix = "/api/v1/categories/"
	if !strings.HasPrefix(path, prefix) {
		return 0, false
	}
	idStr := strings.TrimSpace(path[len(prefix):])
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}

func currentUserID(r *http.Request) (int64, bool) {
	return middleware.CurrentUserID(r)
}

func writeJSON(w http.ResponseWriter, statusCode int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(statusCode)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		http.Error(w, "failed to encode response", http.StatusInternalServerError)
	}
}

func writeError(w http.ResponseWriter, statusCode int, message string) {
	writeJSON(w, statusCode, map[string]string{"error": message})
}
