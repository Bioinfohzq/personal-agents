package passwordbook

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"personal-agents/api/internal/database"
	"personal-agents/api/internal/middleware"
)

const itemPathPrefix = "/api/v1/passwordbook/items/"

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

func (handler *Handler) Items(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		handler.ListItems(w, r)
	case http.MethodPost:
		handler.CreateItem(w, r)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (handler *Handler) Item(w http.ResponseWriter, r *http.Request) {
	itemID, ok := itemIDFromPath(r.URL.Path)
	if !ok {
		writeError(w, http.StatusNotFound, "passwordbook item not found")
		return
	}

	switch r.Method {
	case http.MethodGet:
		handler.GetItem(w, r, itemID)
	case http.MethodPut:
		handler.UpdateItem(w, r, itemID)
	case http.MethodDelete:
		handler.DeleteItem(w, r, itemID)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (handler *Handler) ListItems(w http.ResponseWriter, r *http.Request) {
	userID, ok := currentUserID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing authenticated user")
		return
	}

	rows, err := handler.store.DB().QueryContext(
		r.Context(),
		`SELECT id, platform, login_account, login_url, notes, created_at, updated_at
		 FROM passwordbook_items
		 WHERE user_id = ?
		 ORDER BY updated_at DESC, id DESC`,
		userID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to query passwordbook items")
		return
	}
	defer rows.Close()

	items := make([]ItemSummary, 0)
	for rows.Next() {
		var record itemRecord
		if err := rows.Scan(&record.ID, &record.Platform, &record.LoginAccount, &record.LoginURL, &record.Notes, &record.CreatedAt, &record.UpdatedAt); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read passwordbook item")
			return
		}

		items = append(items, record.summary())
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read passwordbook items")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"items": items,
	})
}

func (handler *Handler) CreateItem(w http.ResponseWriter, r *http.Request) {
	userID, ok := currentUserID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing authenticated user")
		return
	}

	var request CreateItemRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}

	request.normalize()
	if request.Platform == "" || request.LoginAccount == "" || request.Password == "" {
		writeError(w, http.StatusBadRequest, "platform, login_account and password are required")
		return
	}

	passwordCiphertext, err := encryptSecret(request.Password, handler.encryptionSecret)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to encrypt password")
		return
	}

	result, err := handler.store.DB().ExecContext(
		r.Context(),
		`INSERT INTO passwordbook_items (user_id, platform, login_account, password_ciphertext, login_url, notes)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		userID,
		request.Platform,
		request.LoginAccount,
		passwordCiphertext,
		nullableString(request.LoginURL),
		nullableString(request.Notes),
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create passwordbook item")
		return
	}

	itemID, err := result.LastInsertId()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read created passwordbook item")
		return
	}

	detail, err := handler.findItemDetail(r, userID, itemID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read created passwordbook item")
		return
	}

	writeJSON(w, http.StatusCreated, detail)
}

func (handler *Handler) GetItem(w http.ResponseWriter, r *http.Request, itemID int64) {
	userID, ok := currentUserID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing authenticated user")
		return
	}

	detail, err := handler.findItemDetail(r, userID, itemID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "passwordbook item not found")
			return
		}

		writeError(w, http.StatusInternalServerError, "failed to read passwordbook item")
		return
	}

	writeJSON(w, http.StatusOK, detail)
}

func (handler *Handler) UpdateItem(w http.ResponseWriter, r *http.Request, itemID int64) {
	userID, ok := currentUserID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing authenticated user")
		return
	}

	var request UpdateItemRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}

	request.normalize()
	if request.Platform == "" || request.LoginAccount == "" {
		writeError(w, http.StatusBadRequest, "platform and login_account are required")
		return
	}

	result, err := handler.updateItem(r, userID, itemID, request)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update passwordbook item")
		return
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read updated passwordbook item")
		return
	}
	if rowsAffected == 0 {
		exists, err := handler.itemExists(r, userID, itemID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read updated passwordbook item")
			return
		}
		if !exists {
			writeError(w, http.StatusNotFound, "passwordbook item not found")
			return
		}
	}

	detail, err := handler.findItemDetail(r, userID, itemID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read updated passwordbook item")
		return
	}

	writeJSON(w, http.StatusOK, detail)
}

func (handler *Handler) DeleteItem(w http.ResponseWriter, r *http.Request, itemID int64) {
	userID, ok := currentUserID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing authenticated user")
		return
	}

	result, err := handler.store.DB().ExecContext(
		r.Context(),
		`DELETE FROM passwordbook_items WHERE id = ? AND user_id = ?`,
		itemID,
		userID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete passwordbook item")
		return
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read deleted passwordbook item")
		return
	}
	if rowsAffected == 0 {
		writeError(w, http.StatusNotFound, "passwordbook item not found")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (handler *Handler) updateItem(r *http.Request, userID int64, itemID int64, request UpdateItemRequest) (sql.Result, error) {
	if request.Password == "" {
		return handler.store.DB().ExecContext(
			r.Context(),
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

	return handler.store.DB().ExecContext(
		r.Context(),
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

func (handler *Handler) itemExists(r *http.Request, userID int64, itemID int64) (bool, error) {
	var count int
	err := handler.store.DB().QueryRowContext(
		r.Context(),
		`SELECT COUNT(*) FROM passwordbook_items WHERE id = ? AND user_id = ?`,
		itemID,
		userID,
	).Scan(&count)
	return count > 0, err
}

func (handler *Handler) findItemDetail(r *http.Request, userID int64, itemID int64) (ItemDetail, error) {
	var record itemRecord
	row := handler.store.DB().QueryRowContext(
		r.Context(),
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

func itemIDFromPath(path string) (int64, bool) {
	idText := strings.TrimPrefix(path, itemPathPrefix)
	if idText == "" || strings.Contains(idText, "/") {
		return 0, false
	}

	itemID, err := strconv.ParseInt(idText, 10, 64)
	if err != nil || itemID <= 0 {
		return 0, false
	}

	return itemID, true
}

func currentUserID(r *http.Request) (int64, bool) {
	return middleware.CurrentUserID(r)
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
