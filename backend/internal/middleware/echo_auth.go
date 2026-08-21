package middleware

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"

	"personal-agents/backend/internal/auth"
)

const echoCurrentUserIDKey = "current_user_id"

// RequireAuthEcho 是 echo 版本的 JWT 鉴权中间件
// 把 userID 存入 echo.Context 供后续 handler 读取
func RequireAuthEcho(jwtSecret string) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			if jwtSecret == "" || jwtSecret == "<replace_with_a_long_random_secret>" {
				return echo.NewHTTPError(http.StatusInternalServerError, "auth jwt secret is not configured")
			}

			token := auth.ParseBearerToken(c.Request().Header.Get("Authorization"))
			if token == "" {
				return echo.NewHTTPError(http.StatusUnauthorized, "missing bearer token")
			}

			claims, err := auth.VerifyToken(token, jwtSecret)
			if err != nil {
				return echo.NewHTTPError(http.StatusUnauthorized, "invalid bearer token")
			}

			c.Set(echoCurrentUserIDKey, claims.UserID)
			return next(c)
		}
	}
}

// EchoCurrentUserID 从 echo.Context 获取当前用户 ID
func EchoCurrentUserID(c echo.Context) (int64, bool) {
	userID, ok := c.Get(echoCurrentUserIDKey).(int64)
	return userID, ok && userID > 0
}

// RequestLogEcho echo 版本的请求日志中间件
func RequestLogEcho(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		startedAt := time.Now()
		err := next(c)

		slog.Info("http request",
			"method", c.Request().Method,
			"path", c.Request().URL.Path,
			"status", c.Response().Status,
			"duration_ms", time.Since(startedAt).Milliseconds(),
		)
		return err
	}
}
