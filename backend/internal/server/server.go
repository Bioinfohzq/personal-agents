package server

import (
	"net/http"

	"personal-agents/backend/internal/auth"
	"personal-agents/backend/internal/config"
	"personal-agents/backend/internal/database"
	"personal-agents/backend/internal/filesystem"
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
