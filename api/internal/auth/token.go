package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
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

func VerifyToken(token string, secret string) (TokenClaims, error) {
	if secret == "" {
		return TokenClaims{}, errors.New("jwt secret is required")
	}

	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return TokenClaims{}, errors.New("invalid token format")
	}

	signingInput := parts[0] + "." + parts[1]
	expectedSignature := signHS256(signingInput, secret)
	if !hmac.Equal([]byte(parts[2]), []byte(expectedSignature)) {
		return TokenClaims{}, errors.New("invalid token signature")
	}

	headerJSON, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return TokenClaims{}, err
	}

	var header struct {
		Algorithm string `json:"alg"`
		Type      string `json:"typ"`
	}
	if err := json.Unmarshal(headerJSON, &header); err != nil {
		return TokenClaims{}, err
	}
	if header.Algorithm != "HS256" || header.Type != "JWT" {
		return TokenClaims{}, errors.New("unsupported token header")
	}

	claimsJSON, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return TokenClaims{}, err
	}

	var claims TokenClaims
	if err := json.Unmarshal(claimsJSON, &claims); err != nil {
		return TokenClaims{}, err
	}
	if claims.UserID <= 0 || claims.ExpiresAt <= time.Now().Unix() {
		return TokenClaims{}, errors.New("token expired or missing user")
	}

	return claims, nil
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
