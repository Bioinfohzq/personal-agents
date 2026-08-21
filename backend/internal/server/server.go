package server

import (
	"fmt"
	"net/http"

	"github.com/labstack/echo/v4"
	echomw "github.com/labstack/echo/v4/middleware"

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

// Handler 返回 echo 路由引擎
func (server *Server) Handler() *echo.Echo {
	e := echo.New()
	e.HideBanner = true
	e.HidePort = true

	// 自定义错误响应格式，保持和旧接口一致: {"error": "..."}
	e.HTTPErrorHandler = func(err error, c echo.Context) {
		if c.Response().Committed {
			return
		}
		if he, ok := err.(*echo.HTTPError); ok {
			_ = c.JSON(he.Code, map[string]string{
				"error": fmt.Sprintf("%v", he.Message),
			})
			return
		}
		_ = c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "internal server error",
		})
	}

	// 全局中间件: 恢复 panic / CORS / 请求日志
	e.Use(echomw.Recover())
	e.Use(echomw.CORSWithConfig(echomw.CORSConfig{
		AllowOrigins:     []string{"*"},
		AllowMethods:     []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodOptions},
		AllowHeaders:     []string{"Content-Type", "Authorization"},
		AllowCredentials: true,
	}))
	e.Use(middleware.RequestLogEcho)

	// 健康检查（无需鉴权）
	e.GET("/healthz", server.handleHealth)
	e.GET("/api/v1/health", server.handleHealth)

	// 认证接口（无需鉴权）
	authHandler := auth.NewHandler(server.store, server.cfg.Auth)
	e.POST("/api/v1/auth/login", authHandler.Login)
	e.POST("/api/v1/auth/register", authHandler.Register)

	// 需要鉴权的 API 路由组
	api := e.Group("/api/v1", middleware.RequireAuthEcho(server.cfg.Auth.JWTSecret))

	// 用户接口
	userHandler := user.NewHandler()
	api.GET("/users/me", userHandler.Me)

	// 密码本接口
	passwordbookHandler := passwordbook.NewHandler(server.store, server.cfg.Auth.JWTSecret)
	api.GET("/passwordbook/items", passwordbookHandler.ListItems)
	api.POST("/passwordbook/items", passwordbookHandler.CreateItem)
	api.GET("/passwordbook/items/:id", passwordbookHandler.GetItem)
	api.PUT("/passwordbook/items/:id", passwordbookHandler.UpdateItem)
	api.DELETE("/passwordbook/items/:id", passwordbookHandler.DeleteItem)

	// 日程管理
	scheduleHandler := schedule.NewHandler(server.store)
	api.GET("/schedules", scheduleHandler.ListSchedules)
	api.POST("/schedules", scheduleHandler.CreateSchedule)
	api.GET("/schedules/:id", scheduleHandler.GetSchedule)
	api.PUT("/schedules/:id", scheduleHandler.UpdateSchedule)
	api.DELETE("/schedules/:id", scheduleHandler.DeleteSchedule)

	// 命令手册
	commandbookHandler := commandbook.NewHandler(server.store, server.cfg.LLM)
	api.GET("/commands", commandbookHandler.ListCommands)
	api.POST("/commands", commandbookHandler.CreateCommand)
	api.POST("/commands/parse-ai", commandbookHandler.ParseAI)
	api.GET("/commands/:id", commandbookHandler.GetCommand)
	api.PUT("/commands/:id", commandbookHandler.UpdateCommand)
	api.POST("/commands/:id/move", commandbookHandler.MoveCommandCategory)
	api.DELETE("/commands/:id", commandbookHandler.DeleteCommand)

	// 知识库
	knowledgebookHandler := knowledgebook.NewHandler(server.store, server.cfg.LLM)
	api.GET("/knowledge", knowledgebookHandler.ListKnowledgeItems)
	api.POST("/knowledge", knowledgebookHandler.CreateKnowledgeItem)
	api.POST("/knowledge/parse-ai", knowledgebookHandler.ParseAI)
	api.GET("/knowledge/:id", knowledgebookHandler.GetKnowledgeItem)
	api.PUT("/knowledge/:id", knowledgebookHandler.UpdateKnowledgeItem)
	api.POST("/knowledge/:id/move", knowledgebookHandler.MoveKnowledgeCategory)
	api.DELETE("/knowledge/:id", knowledgebookHandler.DeleteKnowledgeItem)

	// 分类管理
	categoryHandler := category.NewHandler(server.store)
	api.GET("/categories", categoryHandler.ListCategories)
	api.POST("/categories", categoryHandler.CreateCategory)
	api.PUT("/categories/:id", categoryHandler.RenameCategory)
	api.DELETE("/categories/:id", categoryHandler.DeleteCategory)
	// 文件系统管理
	filesystemHandler := filesystem.NewHandler()
	api.GET("/filesystem/scan", filesystemHandler.Scan)
	api.GET("/filesystem/storage", filesystemHandler.Storage)
	api.GET("/filesystem/permissions", filesystemHandler.Permissions)

	return e
}

// handleHealth 健康检查（echo 原生风格）
func (server *Server) handleHealth(c echo.Context) error {
	return c.JSON(http.StatusOK, map[string]any{
		"status":             "ok",
		"service":            server.cfg.AppName,
		"env":                server.cfg.Env,
		"database_connected": server.store.Configured(),
	})
}
