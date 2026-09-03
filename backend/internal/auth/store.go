package auth

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5/pgconn"

	"personal-agents/backend/internal/database"
)

// Store 用户数据访问层
type Store struct {
	db *database.Store
}

// NewStore 创建用户存储实例
func NewStore(store *database.Store) *Store {
	return &Store{db: store}
}

// FindByAccount 按账号查询用户，支持用户名 / 手机号 / 邮箱三种类型
func (store *Store) FindByAccount(ctx context.Context, account string) (userRecord, error) {
	var user userRecord
	// 三个字段任一匹配即可，兼容用户用任意类型注册的账号登录
	// COALESCE 把 NULL 转成空字符串，避免 database/sql 把 NULL 扫描到 string 时报错
	// （username / phone / email 三列均允许 NULL，取决于用户注册时用的账号类型）
	row := store.db.QueryRowContext(
		ctx,
		`SELECT id, COALESCE(username, ''), COALESCE(phone, ''), COALESCE(email, ''), password_hash FROM users WHERE username = ? OR phone = ? OR email = ? LIMIT 1`,
		account,
		account,
		account,
	)

	err := row.Scan(&user.ID, &user.Username, &user.Phone, &user.Email, &user.PasswordHash)
	return user, err
}

// CreateUser 插入新用户，返回新用户 ID
// username / phone / email 只有一个非空（由账号类型决定），其余列插 NULL
func (store *Store) CreateUser(ctx context.Context, username, phone, email, passwordHash string) (int64, error) {
	// PG 不支持 LastInsertId,通过 RETURNING 直接拿新用户 id
	var userID int64
	err := store.db.QueryRowContext(
		ctx,
		`INSERT INTO users (username, phone, email, password_hash) VALUES (?, ?, ?, ?) RETURNING id`,
		nilOrString(username),
		nilOrString(phone),
		nilOrString(email),
		passwordHash,
	).Scan(&userID)
	return userID, err
}

// isDuplicateEntry 判断是否为 PG 唯一约束冲突(unique_violation, SQLSTATE 23505)
func isDuplicateEntry(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
