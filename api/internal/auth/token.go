package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
)

type TokenClaims struct {
	UserID    int64  `json:"user_id"`
	Username  string `json:"username"`
	Email     string `json:"email"`
	ExpiresAt int64  `json:"exp"`
}

func SignToken(claims TokenClaims, secret string) (string, error) {
	if secret == "" {
		return "", errors.New("jwt secret is required")
	}

	header := map[string]string{
		"alg": "HS256",
		"typ": "JWT",
	}

	headerJSON, err := json.Marshal(header)
	if err != nil {
		return "", err
	}

	claimsJSON, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}

	encodedHeader := base64.RawURLEncoding.EncodeToString(headerJSON)
	encodedClaims := base64.RawURLEncoding.EncodeToString(claimsJSON)
	signingInput := encodedHeader + "." + encodedClaims
	signature := signHS256(signingInput, secret)

	return signingInput + "." + signature, nil
}

func signHS256(input string, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(input))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func ParseBearerToken(authHeader string) string {
	token, ok := strings.CutPrefix(authHeader, "Bearer ")
	if !ok {
		return ""
	}

	return strings.TrimSpace(token)
}
