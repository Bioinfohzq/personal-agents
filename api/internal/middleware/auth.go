package middleware

import (
	"context"
	"encoding/json"
	"net/http"

	"personal-agents/api/internal/auth"
)

type contextKey string

const currentUserIDKey contextKey = "current_user_id"

func RequireAuth(jwtSecret string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if jwtSecret == "" || jwtSecret == "<replace_with_a_long_random_secret>" {
			writeMiddlewareError(w, http.StatusInternalServerError, "auth jwt secret is not configured")
			return
		}

		token := auth.ParseBearerToken(r.Header.Get("Authorization"))
		if token == "" {
			writeMiddlewareError(w, http.StatusUnauthorized, "missing bearer token")
			return
		}

		claims, err := auth.VerifyToken(token, jwtSecret)
		if err != nil {
			writeMiddlewareError(w, http.StatusUnauthorized, "invalid bearer token")
			return
		}

		ctx := context.WithValue(r.Context(), currentUserIDKey, claims.UserID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func CurrentUserID(r *http.Request) (int64, bool) {
	userID, ok := r.Context().Value(currentUserIDKey).(int64)
	return userID, ok && userID > 0
}

func writeMiddlewareError(w http.ResponseWriter, statusCode int, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(statusCode)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error": message,
	})
}
