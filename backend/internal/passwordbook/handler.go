package passwordbook

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"

	"personal-agents/backend/internal/database"
	"personal-agents/backend/internal/middleware"
)

type Handler struct {
	store            *database.Store
	encryptionSecret string
}

type CreateItemRequest struct {
	Platform     string `json:"platform"`
	LoginAccount string `json:"login_account"`
	Password     string `json:"password"`
	LoginURL     string `json:"login_url"`
	Notes        string `json:"notes"`
}

type UpdateItemRequest struct {
	Platform     string `json:"platform"`
	LoginAccount string `json:"login_account"`
	Password     string `json:"password"`
	LoginURL     string `json:"login_url"`
	Notes        string `json:"notes"`
}

type ItemSummary struct {
	ID           int64     `json:"id"`
	Platform     string    `json:"platform"`
	LoginAccount string    `json:"login_account"`
	LoginURL     string    `json:"login_url,omitempty"`
	Notes        string    `json:"notes,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type ItemDetail struct {
	ID           int64     `json:"id"`
	Platform     string    `json:"platform"`
	LoginAccount string    `json:"login_account"`
	Password     string    `json:"password"`
	LoginURL     string    `json:"login_url,omitempty"`
	Notes        string    `json:"notes,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type itemRecord struct {
	ID                 int64
	Platform           string
	LoginAccount       string
	PasswordCiphertext string
	LoginURL           sql.NullString
	Notes              sql.NullString
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

func NewHandler(store *database.Store, encryptionSecret string) *Handler {
	return &Handler{
		store:            store,
		encryptionSecret: encryptionSecret,
	}
}

// ListItems GET /api/v1/passwordbook/items
func (handler *Handler) ListItems(c echo.Context) error {
	userID, ok := middleware.EchoCurrentUserID(c)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "missing authenticated user")
	}

	rows, err := handler.store.QueryContext(
		c.Request().Context(),
		`SELECT id, platform, login_account, login_url, notes, created_at, updated_at
		 FROM passwordbook_items
		 WHERE user_id = ?
		 ORDER BY updated_at DESC, id DESC`,
		userID,
	)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to query passwordbook items")
	}
	defer rows.Close()

	items := make([]ItemSummary, 0)
	for rows.Next() {
		var record itemRecord
		if err := rows.Scan(&record.ID, &record.Platform, &record.LoginAccount, &record.LoginURL, &record.Notes, &record.CreatedAt, &record.UpdatedAt); err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "failed to read passwordbook item")
		}

		items = append(items, record.summary())
	}
	if err := rows.Err(); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read passwordbook items")
	}

	return c.JSON(http.StatusOK, map[string]any{
		"items": items,
	})
}

// CreateItem POST /api/v1/passwordbook/items
func (handler *Handler) CreateItem(c echo.Context) error {
	userID, ok := middleware.EchoCurrentUserID(c)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "missing authenticated user")
	}

	var request CreateItemRequest
	if err := c.Bind(&request); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid json body")
	}

	request.normalize()
	if request.Platform == "" || request.LoginAccount == "" || request.Password == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "platform, login_account and password are required")
	}

	passwordCiphertext, err := encryptSecret(request.Password, handler.encryptionSecret)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to encrypt password")
	}

	// PG 不支持 LastInsertId,通过 RETURNING 直接拿新记录 id
	var itemID int64
	err = handler.store.QueryRowContext(
		c.Request().Context(),
		`INSERT INTO passwordbook_items (user_id, platform, login_account, password_ciphertext, login_url, notes)
		 VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
		userID,
		request.Platform,
		request.LoginAccount,
		passwordCiphertext,
		nullableString(request.LoginURL),
		nullableString(request.Notes),
	).Scan(&itemID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to create passwordbook item")
	}

	detail, err := handler.findItemDetail(c.Request().Context(), userID, itemID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read created passwordbook item")
	}

	return c.JSON(http.StatusCreated, detail)
}

// GetItem GET /api/v1/passwordbook/items/:id
func (handler *Handler) GetItem(c echo.Context) error {
	userID, ok := middleware.EchoCurrentUserID(c)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "missing authenticated user")
	}

	itemID, err := parseItemID(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "passwordbook item not found")
	}

	detail, err := handler.findItemDetail(c.Request().Context(), userID, itemID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return echo.NewHTTPError(http.StatusNotFound, "passwordbook item not found")
		}

		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read passwordbook item")
	}

	return c.JSON(http.StatusOK, detail)
}

// UpdateItem PUT /api/v1/passwordbook/items/:id
func (handler *Handler) UpdateItem(c echo.Context) error {
	userID, ok := middleware.EchoCurrentUserID(c)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "missing authenticated user")
	}

	itemID, err := parseItemID(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "passwordbook item not found")
	}

	var request UpdateItemRequest
	if err := c.Bind(&request); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid json body")
	}

	request.normalize()
	if request.Platform == "" || request.LoginAccount == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "platform and login_account are required")
	}

	result, err := handler.updateItem(c.Request().Context(), userID, itemID, request)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to update passwordbook item")
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read updated passwordbook item")
	}
	if rowsAffected == 0 {
		exists, err := handler.itemExists(c.Request().Context(), userID, itemID)
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "failed to read updated passwordbook item")
		}
		if !exists {
			return echo.NewHTTPError(http.StatusNotFound, "passwordbook item not found")
		}
	}

	detail, err := handler.findItemDetail(c.Request().Context(), userID, itemID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read updated passwordbook item")
	}

	return c.JSON(http.StatusOK, detail)
}

// DeleteItem DELETE /api/v1/passwordbook/items/:id
func (handler *Handler) DeleteItem(c echo.Context) error {
	userID, ok := middleware.EchoCurrentUserID(c)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "missing authenticated user")
	}

	itemID, err := parseItemID(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "passwordbook item not found")
	}

	result, err := handler.store.ExecContext(
		c.Request().Context(),
		`DELETE FROM passwordbook_items WHERE id = ? AND user_id = ?`,
		itemID,
		userID,
	)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to delete passwordbook item")
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read deleted passwordbook item")
	}
	if rowsAffected == 0 {
		return echo.NewHTTPError(http.StatusNotFound, "passwordbook item not found")
	}

	return c.NoContent(http.StatusNoContent)
}

func (handler *Handler) updateItem(ctx context.Context, userID int64, itemID int64, request UpdateItemRequest) (sql.Result, error) {
	if request.Password == "" {
		return handler.store.ExecContext(
			ctx,
			`UPDATE passwordbook_items
			 SET platform = ?, login_account = ?, login_url = ?, notes = ?
			 WHERE id = ? AND user_id = ?`,
			request.Platform,
			request.LoginAccount,
			nullableString(request.LoginURL),
			nullableString(request.Notes),
			itemID,
			userID,
		)
	}

	passwordCiphertext, err := encryptSecret(request.Password, handler.encryptionSecret)
	if err != nil {
		return nil, err
	}

	return handler.store.ExecContext(
		ctx,
		`UPDATE passwordbook_items
		 SET platform = ?, login_account = ?, password_ciphertext = ?, login_url = ?, notes = ?
		 WHERE id = ? AND user_id = ?`,
		request.Platform,
		request.LoginAccount,
		passwordCiphertext,
		nullableString(request.LoginURL),
		nullableString(request.Notes),
		itemID,
		userID,
	)
}

func (handler *Handler) itemExists(ctx context.Context, userID int64, itemID int64) (bool, error) {
	var count int
	err := handler.store.QueryRowContext(
		ctx,
		`SELECT COUNT(*) FROM passwordbook_items WHERE id = ? AND user_id = ?`,
		itemID,
		userID,
	).Scan(&count)
	return count > 0, err
}

func (handler *Handler) findItemDetail(ctx context.Context, userID int64, itemID int64) (ItemDetail, error) {
	var record itemRecord
	row := handler.store.QueryRowContext(
		ctx,
		`SELECT id, platform, login_account, password_ciphertext, login_url, notes, created_at, updated_at
		 FROM passwordbook_items
		 WHERE id = ? AND user_id = ?
		 LIMIT 1`,
		itemID,
		userID,
	)

	if err := row.Scan(&record.ID, &record.Platform, &record.LoginAccount, &record.PasswordCiphertext, &record.LoginURL, &record.Notes, &record.CreatedAt, &record.UpdatedAt); err != nil {
		return ItemDetail{}, err
	}

	password, err := decryptSecret(record.PasswordCiphertext, handler.encryptionSecret)
	if err != nil {
		return ItemDetail{}, err
	}

	return record.detail(password), nil
}

func (request *CreateItemRequest) normalize() {
	request.Platform = strings.TrimSpace(request.Platform)
	request.LoginAccount = strings.TrimSpace(request.LoginAccount)
	request.LoginURL = strings.TrimSpace(request.LoginURL)
	request.Notes = strings.TrimSpace(request.Notes)
}

func (request *UpdateItemRequest) normalize() {
	request.Platform = strings.TrimSpace(request.Platform)
	request.LoginAccount = strings.TrimSpace(request.LoginAccount)
	request.LoginURL = strings.TrimSpace(request.LoginURL)
	request.Notes = strings.TrimSpace(request.Notes)
}

func (record itemRecord) summary() ItemSummary {
	return ItemSummary{
		ID:           record.ID,
		Platform:     record.Platform,
		LoginAccount: record.LoginAccount,
		LoginURL:     nullStringValue(record.LoginURL),
		Notes:        nullStringValue(record.Notes),
		CreatedAt:    record.CreatedAt,
		UpdatedAt:    record.UpdatedAt,
	}
}

func (record itemRecord) detail(password string) ItemDetail {
	return ItemDetail{
		ID:           record.ID,
		Platform:     record.Platform,
		LoginAccount: record.LoginAccount,
		Password:     password,
		LoginURL:     nullStringValue(record.LoginURL),
		Notes:        nullStringValue(record.Notes),
		CreatedAt:    record.CreatedAt,
		UpdatedAt:    record.UpdatedAt,
	}
}

func parseItemID(idText string) (int64, error) {
	itemID, err := strconv.ParseInt(idText, 10, 64)
	if err != nil || itemID <= 0 {
		return 0, errors.New("invalid item id")
	}
	return itemID, nil
}

func nullableString(value string) sql.NullString {
	return sql.NullString{
		String: value,
		Valid:  value != "",
	}
}

func nullStringValue(value sql.NullString) string {
	if !value.Valid {
		return ""
	}

	return value.String
}
