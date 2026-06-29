package user

import "net/http"

type Handler struct{}

func NewHandler() *Handler {
	return &Handler{}
}

func (handler *Handler) Me(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	writeJSON(w, http.StatusNotImplemented, map[string]string{
		"error": "user profile storage is not wired yet",
	})
}
