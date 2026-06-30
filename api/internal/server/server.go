package server

import (
	"net/http"

	"personal-agents/api/internal/auth"
	"personal-agents/api/internal/config"
	"personal-agents/api/internal/database"
	"personal-agents/api/internal/middleware"
	"personal-agents/api/internal/passwordbook"
	"personal-agents/api/internal/user"
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
	userHandler := user.NewHandler()

	mux.HandleFunc("/healthz", server.handleHealth)
	mux.HandleFunc("/api/v1/health", server.handleHealth)
	mux.HandleFunc("/api/v1/auth/login", authHandler.Login)
	mux.HandleFunc("/api/v1/auth/register", authHandler.Register)
	mux.Handle("/api/v1/users/me", middleware.RequireAuth(server.cfg.Auth.JWTSecret, http.HandlerFunc(userHandler.Me)))
	mux.Handle("/api/v1/passwordbook/items", middleware.RequireAuth(server.cfg.Auth.JWTSecret, http.HandlerFunc(passwordbookHandler.Items)))
	mux.Handle("/api/v1/passwordbook/items/", middleware.RequireAuth(server.cfg.Auth.JWTSecret, http.HandlerFunc(passwordbookHandler.Item)))

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
