package passwordbook

import (
	"context"
	"database/sql"

	"personal-agents/backend/internal/database"
)

// Store 密码本数据访问层(负责 SQL 与密码加解密)
type Store struct {
	db               *database.Store
	encryptionSecret string
}

// NewStore 创建密码本存储实例
func NewStore(store *database.Store, encryptionSecret string) *Store {
	return &Store{db: store, encryptionSecret: encryptionSecret}
}

// List 查询用户密码本条目摘要列表(不含密码)
func (store *Store) List(ctx context.Context, userID int64) ([]ItemSummary, error) {
	rows, err := store.db.QueryContext(
		ctx,
		`SELECT id, platform, login_account, login_url, notes, created_at, updated_at
		 FROM passwordbook_items
		 WHERE user_id = ?
		 ORDER BY updated_at DESC, id DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]ItemSummary, 0)
	for rows.Next() {
		var record itemRecord
		if err := rows.Scan(&record.ID, &record.Platform, &record.LoginAccount, &record.LoginURL, &record.Notes, &record.CreatedAt, &record.UpdatedAt); err != nil {
			return nil, err
		}

		items = append(items, record.summary())
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return items, nil
}

// Create 插入密码本条目(密码加密后入库),返回新条目 ID
// PG 不支持 LastInsertId,通过 RETURNING 直接拿新记录 id
func (store *Store) Create(ctx context.Context, userID int64, request CreateItemRequest) (int64, error) {
	passwordCiphertext, err := encryptSecret(request.Password, store.encryptionSecret)
	if err != nil {
		return 0, err
	}

	var itemID int64
	err = store.db.QueryRowContext(
		ctx,
		`INSERT INTO passwordbook_items (user_id, platform, login_account, password_ciphertext, login_url, notes)
		 VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
		userID,
		request.Platform,
		request.LoginAccount,
		passwordCiphertext,
		nullableString(request.LoginURL),
		nullableString(request.Notes),
	).Scan(&itemID)
	return itemID, err
}

// FindDetail 查询单条详情并解密密码,不存在时返回 sql.ErrNoRows
func (store *Store) FindDetail(ctx context.Context, userID int64, itemID int64) (ItemDetail, error) {
	var record itemRecord
	row := store.db.QueryRowContext(
		ctx,
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

	password, err := decryptSecret(record.PasswordCiphertext, store.encryptionSecret)
	if err != nil {
		return ItemDetail{}, err
	}

	return record.detail(password), nil
}

// Update 更新条目;password 为空则不更新密码列,非空则加密后更新。返回受影响行数
func (store *Store) Update(ctx context.Context, userID int64, itemID int64, request UpdateItemRequest) (int64, error) {
	var (
		result sql.Result
		err    error
	)

	if request.Password == "" {
		result, err = store.db.ExecContext(
			ctx,
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
	} else {
		passwordCiphertext, encryptErr := encryptSecret(request.Password, store.encryptionSecret)
		if encryptErr != nil {
			return 0, encryptErr
		}

		result, err = store.db.ExecContext(
			ctx,
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
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

// Exists 检查条目是否存在(用于 Update 的 0 行更新判断)
func (store *Store) Exists(ctx context.Context, userID int64, itemID int64) (bool, error) {
	var count int
	err := store.db.QueryRowContext(
		ctx,
		`SELECT COUNT(*) FROM passwordbook_items WHERE id = ? AND user_id = ?`,
		itemID,
		userID,
	).Scan(&count)
	return count > 0, err
}

// Delete 删除条目,返回受影响行数
func (store *Store) Delete(ctx context.Context, userID int64, itemID int64) (int64, error) {
	result, err := store.db.ExecContext(
		ctx,
		`DELETE FROM passwordbook_items WHERE id = ? AND user_id = ?`,
		itemID,
		userID,
	)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}
