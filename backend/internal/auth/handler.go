package auth

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
	"golang.org/x/crypto/bcrypt"

	"personal-agents/backend/internal/config"
	"personal-agents/backend/internal/database"
)

// 手机号正则：1 开头，第二位 3-9，共 11 位数字
var phoneRegexp = regexp.MustCompile(`^1[3-9]\d{9}$`)

// 邮箱正则：简单校验 xxx@xxx.xxx 格式
var emailRegexp = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

type Handler struct {
	store *database.Store
	auth  config.AuthConfig
}

type LoginRequest struct {
	Account  string `json:"account"`
	Password string `json:"password"`
}

// RegisterRequest 注册请求：账号（用户名/手机号/邮箱三选一）+ 密码
type RegisterRequest struct {
	Account  string `json:"account"` // 账号：可以是用户名、手机号或邮箱
	Password string `json:"password"`
}

type LoginResponse struct {
	Token string      `json:"token"`
	User  UserProfile `json:"user"`
	TTL   int64       `json:"ttl_seconds"`
}

type UserProfile struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
	Phone    string `json:"phone"`
	Email    string `json:"email"`
}

type userRecord struct {
	ID           int64
	Username     string
	Phone        string
	Email        string
	PasswordHash string
}

func NewHandler(store *database.Store, auth config.AuthConfig) *Handler {
	return &Handler{
		store: store,
		auth:  auth,
	}
}

func (handler *Handler) Login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var request LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}

	if request.Account == "" || request.Password == "" {
		writeError(w, http.StatusBadRequest, "account and password are required")
		return
	}

	if handler.auth.JWTSecret == "" || handler.auth.JWTSecret == "<replace_with_a_long_random_secret>" {
		writeError(w, http.StatusInternalServerError, "auth jwt secret is not configured")
		return
	}

	user, err := handler.findUserByAccount(r.Context(), request.Account)
	if err != nil {
		if err == sql.ErrNoRows {
			writeError(w, http.StatusUnauthorized, "invalid account or password")
			return
		}

		slog.Error("login findUserByAccount failed", "account", request.Account, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to query user")
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(request.Password)); err != nil {
		writeError(w, http.StatusUnauthorized, "invalid account or password")
		return
	}

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
		writeError(w, http.StatusInternalServerError, "failed to sign token")
		return
	}

	writeJSON(w, http.StatusOK, LoginResponse{
		Token: token,
		User: UserProfile{
			ID:       user.ID,
			Username: user.Username,
			Phone:    user.Phone,
			Email:    user.Email,
		},
		TTL: int64(ttl.Seconds()),
	})
}

func (handler *Handler) Register(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var request RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}

	// 去空格后校验：账号和密码都必填
	account := strings.TrimSpace(request.Account)
	if account == "" || request.Password == "" {
		writeError(w, http.StatusBadRequest, "account and password are required")
		return
	}

	if len(request.Password) < 8 {
		writeError(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}

	// 根据账号格式自动判断类型：手机号 / 邮箱 / 用户名
	// 三种类型分别写入 phone / email / username 列，其余列为 NULL
	var username, phone, email string
	switch {
	case phoneRegexp.MatchString(account):
		phone = account
	case emailRegexp.MatchString(account):
		email = account
	default:
		// 既不是手机号也不是邮箱，按用户名处理
		username = account
	}

	if handler.auth.JWTSecret == "" || handler.auth.JWTSecret == "<replace_with_a_long_random_secret>" {
		writeError(w, http.StatusInternalServerError, "auth jwt secret is not configured")
		return
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(request.Password), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to hash password")
		return
	}

	// 插入用户记录：只填充对应类型的列，其余为 NULL
	result, err := handler.store.DB().ExecContext(
		r.Context(),
		`INSERT INTO users (username, phone, email, password_hash) VALUES (?, ?, ?, ?)`,
		nilOrString(username),
		nilOrString(phone),
		nilOrString(email),
		string(passwordHash),
	)
	if err != nil {
		if isDuplicateEntry(err) {
			writeError(w, http.StatusConflict, "account already exists")
			return
		}

		writeError(w, http.StatusInternalServerError, "failed to create user")
		return
	}

	userID, err := result.LastInsertId()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read created user")
		return
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
		writeError(w, http.StatusInternalServerError, "failed to sign token")
		return
	}

	writeJSON(w, http.StatusCreated, response)
}

// findUserByAccount 按账号查询用户，支持用户名 / 手机号 / 邮箱三种类型
func (handler *Handler) findUserByAccount(ctx context.Context, account string) (userRecord, error) {
	var user userRecord
	// 三个字段任一匹配即可，兼容用户用任意类型注册的账号登录
	// COALESCE 把 NULL 转成空字符串，避免 database/sql 把 NULL 扫描到 string 时报错
	// （username / phone / email 三列均允许 NULL，取决于用户注册时用的账号类型）
	row := handler.store.DB().QueryRowContext(
		ctx,
		`SELECT id, COALESCE(username, ''), COALESCE(phone, ''), COALESCE(email, ''), password_hash FROM users WHERE username = ? OR phone = ? OR email = ? LIMIT 1`,
		account,
		account,
		account,
	)

	err := row.Scan(&user.ID, &user.Username, &user.Phone, &user.Email, &user.PasswordHash)
	return user, err
}

// buildLoginResponse 构造登录成功响应（签发 JWT + 用户信息）
func (handler *Handler) buildLoginResponse(user userRecord) (LoginResponse, error) {
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

// nilOrString 将空字符串转为 nil（用于 SQL 插入 NULL），
// 非空字符串原样返回。Go 的 database/sql 会把 nil 作为 NULL 传递给驱动。
func nilOrString(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func isDuplicateEntry(err error) bool {
	var mysqlErr *mysql.MySQLError
	return errors.As(err, &mysqlErr) && mysqlErr.Number == 1062
}
