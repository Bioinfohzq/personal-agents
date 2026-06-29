package auth

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
	"golang.org/x/crypto/bcrypt"

	"personal-agents/api/internal/config"
	"personal-agents/api/internal/database"
)

type Handler struct {
	store *database.Store
	auth  config.AuthConfig
}

type LoginRequest struct {
	Account  string `json:"account"`
	Password string `json:"password"`
}

type RegisterRequest struct {
	Username string `json:"username"`
	Email    string `json:"email"`
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
	Email    string `json:"email"`
}

type userRecord struct {
	ID           int64
	Username     string
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

		writeError(w, http.StatusInternalServerError, "failed to query user")
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(request.Password)); err != nil {
		writeError(w, http.StatusUnauthorized, "invalid account or password")
		return
	}

	ttl := handler.auth.TokenTTL()
	token, err := SignToken(TokenClaims{
		UserID:    user.ID,
		Username:  user.Username,
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

	request.Username = strings.TrimSpace(request.Username)
	request.Email = strings.TrimSpace(request.Email)

	if request.Username == "" || request.Email == "" || request.Password == "" {
		writeError(w, http.StatusBadRequest, "username, email and password are required")
		return
	}

	if len(request.Password) < 8 {
		writeError(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
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

	result, err := handler.store.DB().ExecContext(
		r.Context(),
		`INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)`,
		request.Username,
		request.Email,
		string(passwordHash),
	)
	if err != nil {
		if isDuplicateEntry(err) {
			writeError(w, http.StatusConflict, "username or email already exists")
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

	user := userRecord{
		ID:       userID,
		Username: request.Username,
		Email:    request.Email,
	}

	response, err := handler.buildLoginResponse(user)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to sign token")
		return
	}

	writeJSON(w, http.StatusCreated, response)
}

func (handler *Handler) findUserByAccount(ctx context.Context, account string) (userRecord, error) {
	var user userRecord
	row := handler.store.DB().QueryRowContext(
		ctx,
		`SELECT id, username, email, password_hash FROM users WHERE username = ? OR email = ? LIMIT 1`,
		account,
		account,
	)

	err := row.Scan(&user.ID, &user.Username, &user.Email, &user.PasswordHash)
	return user, err
}

func (handler *Handler) buildLoginResponse(user userRecord) (LoginResponse, error) {
	ttl := handler.auth.TokenTTL()
	token, err := SignToken(TokenClaims{
		UserID:    user.ID,
		Username:  user.Username,
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
			Email:    user.Email,
		},
		TTL: int64(ttl.Seconds()),
	}, nil
}

func isDuplicateEntry(err error) bool {
	var mysqlErr *mysql.MySQLError
	return errors.As(err, &mysqlErr) && mysqlErr.Number == 1062
}
