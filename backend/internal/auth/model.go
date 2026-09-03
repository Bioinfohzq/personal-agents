package auth

import (
	"regexp"
	"strings"
)

// 手机号正则：1 开头，第二位 3-9，共 11 位数字
var phoneRegexp = regexp.MustCompile(`^1[3-9]\d{9}$`)

// 邮箱正则：简单校验 xxx@xxx.xxx 格式
var emailRegexp = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

type LoginRequest struct {
	Account  string `json:"account"`
	Password string `json:"password"`
}

// RegisterRequest 注册请求：账号（用户名/手机号/邮箱三选一）+ 密码
type RegisterRequest struct {
	Account  string `json:"account"` // 账号：可以是用户名、手机号或邮箱
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
	Phone    string `json:"phone"`
	Email    string `json:"email"`
}

// userRecord 用户表记录（内部使用，含密码哈希）
type userRecord struct {
	ID           int64
	Username     string
	Phone        string
	Email        string
	PasswordHash string
}

// splitAccount 根据账号格式自动判断类型：手机号 / 邮箱 / 用户名
// 返回值只有一个非空，分别对应 phone / email / username 列
func splitAccount(account string) (username, phone, email string) {
	switch {
	case phoneRegexp.MatchString(account):
		phone = account
	case emailRegexp.MatchString(account):
		email = account
	default:
		// 既不是手机号也不是邮箱，按用户名处理
		username = account
	}
	return
}

// nilOrString 将空字符串转为 nil（用于 SQL 插入 NULL），
// 非空字符串原样返回。Go 的 database/sql 会把 nil 作为 NULL 传递给驱动。
func nilOrString(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// trimAccount 去除账号两端空白
func trimAccount(s string) string {
	return strings.TrimSpace(s)
}
