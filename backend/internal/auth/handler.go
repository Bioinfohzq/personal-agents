package auth

import (
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/bcrypt"

	"personal-agents/backend/internal/config"
	"personal-agents/backend/internal/database"
)

// Handler 认证 HTTP 处理器（登录 / 注册）
type Handler struct {
	store *Store
	auth  config.AuthConfig
}

// NewHandler 创建认证处理器
func NewHandler(store *database.Store, auth config.AuthConfig) *Handler {
	return &Handler{
		store: NewStore(store),
		auth:  auth,
	}
}

// Login POST /api/v1/auth/login
func (handler *Handler) Login(c echo.Context) error {
	var request LoginRequest
	if err := c.Bind(&request); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid json body")
	}

	if request.Account == "" || request.Password == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "account and password are required")
	}

	if handler.auth.JWTSecret == "" || handler.auth.JWTSecret == "<replace_with_a_long_random_secret>" {
		return echo.NewHTTPError(http.StatusInternalServerError, "auth jwt secret is not configured")
	}

	user, err := handler.store.FindByAccount(c.Request().Context(), request.Account)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return echo.NewHTTPError(http.StatusUnauthorized, "invalid account or password")
		}

		slog.Error("login findUserByAccount failed", "account", request.Account, "error", err)
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to query user")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(request.Password)); err != nil {
		return echo.NewHTTPError(http.StatusUnauthorized, "invalid account or password")
	}

	response, err := handler.buildLoginResponse(user)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to sign token")
	}

	return c.JSON(http.StatusOK, response)
}

// Register POST /api/v1/auth/register
func (handler *Handler) Register(c echo.Context) error {
	var request RegisterRequest
	if err := c.Bind(&request); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid json body")
	}

	// 去空格后校验：账号和密码都必填
	account := trimAccount(request.Account)
	if account == "" || request.Password == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "account and password are required")
	}

	if len(request.Password) < 8 {
		return echo.NewHTTPError(http.StatusBadRequest, "password must be at least 8 characters")
	}

	if handler.auth.JWTSecret == "" || handler.auth.JWTSecret == "<replace_with_a_long_random_secret>" {
		return echo.NewHTTPError(http.StatusInternalServerError, "auth jwt secret is not configured")
	}

	// 根据账号类型拆列：手机号 / 邮箱 / 用户名
	username, phone, email := splitAccount(account)

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(request.Password), bcrypt.DefaultCost)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to hash password")
	}

	userID, err := handler.store.CreateUser(c.Request().Context(), username, phone, email, string(passwordHash))
	if err != nil {
		if isDuplicateEntry(err) {
			return echo.NewHTTPError(http.StatusConflict, "account already exists")
		}

		return echo.NewHTTPError(http.StatusInternalServerError, "failed to create user")
	}

	// 构造 userRecord 用于签发 token
	user := userRecord{
		ID:       userID,
		Username: username,
		Phone:    phone,
		Email:    email,
	}

	response, err := handler.buildLoginResponse(user)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to sign token")
	}

	return c.JSON(http.StatusCreated, response)
}

// buildLoginResponse 构造登录成功响应（签发 JWT + 用户信息）
func (handler *Handler) buildLoginResponse(user userRecord) (LoginResponse, error) {
	// SignToken 签发 JWT，包含用户 ID、用户名、手机号、邮箱
	ttl := handler.auth.TokenTTL()
	token, err := SignToken(TokenClaims{
		UserID:    user.ID,
		Username:  user.Username,
		Phone:     user.Phone,
		Email:     user.Email,
		ExpiresAt: time.Now().Add(ttl).Unix(),
	}, handler.auth.JWTSecret)
	if err != nil {
		return LoginResponse{}, err
	}

	return LoginResponse{
		Token: token,
		User: UserProfile{
			ID:       user.ID,
			Username: user.Username,
			Phone:    user.Phone,
			Email:    user.Email,
		},
		TTL: int64(ttl.Seconds()),
	}, nil
}
