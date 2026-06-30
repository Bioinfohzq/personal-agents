package passwordbook

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
)

func encryptSecret(plainText string, secret string) (string, error) {
	if secret == "" || secret == "<replace_with_a_long_random_secret>" {
		return "", errors.New("encryption secret is not configured")
	}

	block, err := aes.NewCipher(encryptionKey(secret))
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}

	cipherText := gcm.Seal(nonce, nonce, []byte(plainText), nil)
	return base64.RawStdEncoding.EncodeToString(cipherText), nil
}

func decryptSecret(encodedCipherText string, secret string) (string, error) {
	if secret == "" || secret == "<replace_with_a_long_random_secret>" {
		return "", errors.New("encryption secret is not configured")
	}

	cipherText, err := base64.RawStdEncoding.DecodeString(encodedCipherText)
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher(encryptionKey(secret))
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonceSize := gcm.NonceSize()
	if len(cipherText) <= nonceSize {
		return "", errors.New("ciphertext is too short")
	}

	nonce := cipherText[:nonceSize]
	encryptedPayload := cipherText[nonceSize:]
	plainText, err := gcm.Open(nil, nonce, encryptedPayload, nil)
	if err != nil {
		return "", err
	}

	return string(plainText), nil
}

func encryptionKey(secret string) []byte {
	sum := sha256.Sum256([]byte(secret))
	return sum[:]
}
