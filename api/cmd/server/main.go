package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"personal-agents/api/internal/config"
	"personal-agents/api/internal/database"
	"personal-agents/api/internal/server"
)

func main() {
	cfg := config.Load()
	db := database.New(cfg.Database)
	app := server.New(cfg, db)

	httpServer := &http.Server{
		Addr:         cfg.HTTPAddr(),
		Handler:      app.Handler(),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		slog.Info("api server listening", "addr", cfg.HTTPAddr())

		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("api server failed", "error", err)
			os.Exit(1)
		}
	}()

	shutdownCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	<-shutdownCtx.Done()
	slog.Info("api server shutting down")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := httpServer.Shutdown(ctx); err != nil {
		slog.Error("api server shutdown failed", "error", err)
		os.Exit(1)
	}
}
