package user

import (
	"net/http"

	"github.com/labstack/echo/v4"
)

type Handler struct{}

func NewHandler() *Handler {
	return &Handler{}
}

// Me 返回当前登录用户信息（占位实现，用户存储尚未接入）
func (handler *Handler) Me(c echo.Context) error {
	return echo.NewHTTPError(http.StatusNotImplemented, "user profile storage is not wired yet")
}
