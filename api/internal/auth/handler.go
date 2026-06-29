package auth

import (
	"encoding/json"
	"net/http"
)

type Handler struct{}

type LoginRequest struct {
	Account  string `json:"account"`
	Password string `json:"password"`
}

func NewHandler() *Handler {
	return &Handler{}
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

	writeJSON(w, http.StatusNotImplemented, map[string]string{
		"error": "login storage is not wired yet",
	})
}
