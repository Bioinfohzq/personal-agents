package server

import (
	"net/http"

	"personal-agents/backend/internal/auth"
	"personal-agents/backend/internal/category"
	"personal-agents/backend/internal/commandbook"
	"personal-agents/backend/internal/config"
	"personal-agents/backend/internal/database"
	"personal-agents/backend/internal/filesystem"
	"personal-agents/backend/internal/knowledgebook"
	"personal-agents/backend/internal/middleware"
	"personal-agents/backend/internal/passwordbook"
	"personal-agents/backend/internal/schedule"
	"personal-agents/backend/internal/user"
)

type Server struct {
	cfg   config.Config
	store *database.Store
}

func New(cfg config.Config, store *database.Store) *Server {
	return &Server{
		cfg:   cfg,
		store: store,
	}
}

func (server *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	authHandler := auth.NewHandler(server.store, server.cfg.Auth)
	passwordbookHandler := passwordbook.NewHandler(server.store, server.cfg.Auth.JWTSecret)
	scheduleHandler := schedule.NewHandler(server.store)
	categoryHandler := category.NewHandler(server.store)
	commandbookHandler := commandbook.NewHandler(server.store, server.cfg.LLM)
	knowledgebookHandler := knowledgebook.NewHandler(server.store, server.cfg.LLM)
	userHandler := user.NewHandler()

	mux.HandleFunc("/healthz", server.handleHealth)
	mux.HandleFunc("/api/v1/health", server.handleHealth)
	mux.HandleFunc("/api/v1/auth/login", authHandler.Login)
	mux.HandleFunc("/api/v1/auth/register", authHandler.Register)
	mux.Handle("/api/v1/users/me", middleware.RequireAuth(server.cfg.Auth.JWTSecret, http.HandlerFunc(userHandler.Me)))
	mux.Handle("/api/v1/passwordbook/items", middleware.RequireAuth(server.cfg.Auth.JWTSecret, http.HandlerFunc(passwordbookHandler.Items)))
	mux.Handle("/api/v1/passwordbook/items/", middleware.RequireAuth(server.cfg.Auth.JWTSecret, http.HandlerFunc(passwordbookHandler.Item)))
	// 日程管理:需要 JWT 鉴权,支持按 ?start=&end= 过滤时间范围
	mux.Handle("/api/v1/schedules", middleware.RequireAuth(server.cfg.Auth.JWTSecret, http.HandlerFunc(scheduleHandler.Schedules)))
	mux.Handle("/api/v1/schedules/", middleware.RequireAuth(server.cfg.Auth.JWTSecret, http.HandlerFunc(scheduleHandler.Schedule)))
	// 命令手册:记录各类命令及个人理解,支持 ?category_id=&q= 过滤搜索
	mux.Handle("/api/v1/commands", middleware.RequireAuth(server.cfg.Auth.JWTSecret, http.HandlerFunc(commandbookHandler.Commands)))
	mux.Handle("/api/v1/commands/", middleware.RequireAuth(server.cfg.Auth.JWTSecret, http.HandlerFunc(commandbookHandler.Command)))
	// 命令手册:AI 智能解析 AI 解释文本并预填命令字段
	mux.Handle("/api/v1/commands/parse-ai", middleware.RequireAuth(server.cfg.Auth.JWTSecret, http.HandlerFunc(commandbookHandler.ParseAI)))
	// 知识库:记录结构化知识点,支持 ?category_id=&q= 过滤搜索
	mux.Handle("/api/v1/knowledge", middleware.RequireAuth(server.cfg.Auth.JWTSecret, http.HandlerFunc(knowledgebookHandler.KnowledgeItems)))
	mux.Handle("/api/v1/knowledge/", middleware.RequireAuth(server.cfg.Auth.JWTSecret, http.HandlerFunc(knowledgebookHandler.KnowledgeItem)))
	// 知识库:AI 智能解析 AI 解释文本并预填知识字段
	mux.Handle("/api/v1/knowledge/parse-ai", middleware.RequireAuth(server.cfg.Auth.JWTSecret, http.HandlerFunc(knowledgebookHandler.ParseAI)))
	// 分类管理:支持知识库/命令手册的分类增删改查和重命名
	mux.Handle("/api/v1/categories", middleware.RequireAuth(server.cfg.Auth.JWTSecret, http.HandlerFunc(categoryHandler.Categories)))
	mux.Handle("/api/v1/categories/", middleware.RequireAuth(server.cfg.Auth.JWTSecret, http.HandlerFunc(categoryHandler.Category)))

	// 文件系统管理:目录扫描/存储分析/权限查看,仅 macOS/Linux 可用
	filesystemHandler := filesystem.NewHandler()
	mux.Handle("/api/v1/filesystem/scan", middleware.RequireAuth(server.cfg.Auth.JWTSecret, http.HandlerFunc(filesystemHandler.Scan)))
	mux.Handle("/api/v1/filesystem/storage", middleware.RequireAuth(server.cfg.Auth.JWTSecret, http.HandlerFunc(filesystemHandler.Storage)))
	mux.Handle("/api/v1/filesystem/permissions", middleware.RequireAuth(server.cfg.Auth.JWTSecret, http.HandlerFunc(filesystemHandler.Permissions)))

	return middleware.Recover(middleware.CORS(middleware.RequestLog(mux)))
}

func (server *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status":             "ok",
		"service":            server.cfg.AppName,
		"env":                server.cfg.Env,
		"database_connected": server.store.Configured(),
	})
}
