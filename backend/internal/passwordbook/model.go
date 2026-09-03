package passwordbook

import (
	"database/sql"
	"strconv"
	"strings"
	"time"
)

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

// itemRecord 数据库行映射结构体(密码列为密文)
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

// normalize 去除请求字段的首尾空白
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

// summary 将数据库记录转换为列表摘要(不含密码)
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

// detail 将数据库记录转换为详情(密码由调用方解密后传入)
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

// parseItemID 从路径参数解析条目 ID
func parseItemID(idText string) (int64, error) {
	itemID, err := strconv.ParseInt(idText, 10, 64)
	if err != nil || itemID <= 0 {
		return 0, strconv.ErrSyntax
	}
	return itemID, nil
}

// nullableString 将字符串转为 sql.NullString(空字符串 → NULL)
func nullableString(value string) sql.NullString {
	return sql.NullString{
		String: value,
		Valid:  value != "",
	}
}

// nullStringValue 将 sql.NullString 转为字符串(NULL → 空字符串)
func nullStringValue(value sql.NullString) string {
	if !value.Valid {
		return ""
	}

	return value.String
}
