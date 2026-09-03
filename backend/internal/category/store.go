package category

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"personal-agents/backend/internal/database"
)

// Store 分类数据访问层
type Store struct {
	db *database.Store
}

// NewStore 创建分类存储实例
func NewStore(store *database.Store) *Store {
	return &Store{db: store}
}

// List 查询某用户在指定模块下的所有分类
func (store *Store) List(ctx context.Context, userID int64, scope string) ([]Category, error) {
	rows, err := store.db.QueryContext(ctx, `
		SELECT id, user_id, scope, name, slug, sort_order, created_at, updated_at
		FROM categories
		WHERE scope = ? AND (user_id IS NULL OR user_id = ?)
		ORDER BY sort_order ASC, id ASC
	`, scope, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var categories []Category
	for rows.Next() {
		var c Category
		var userIDNullable sql.NullInt64
		if err := rows.Scan(&c.ID, &userIDNullable, &c.Scope, &c.Name, &c.Slug, &c.SortOrder, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		if userIDNullable.Valid {
			uid := userIDNullable.Int64
			c.UserID = &uid
		}
		categories = append(categories, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return categories, nil
}

// GetByID 根据 ID 查询分类
func (store *Store) GetByID(ctx context.Context, id int64) (*Category, error) {
	row := store.db.QueryRowContext(ctx, `
		SELECT id, user_id, scope, name, slug, sort_order, created_at, updated_at
		FROM categories
		WHERE id = ?
		LIMIT 1
	`, id)
	return store.scanCategory(row)
}

// GetBySlug 根据 slug 查询分类
func (store *Store) GetBySlug(ctx context.Context, userID int64, scope, slug string) (*Category, error) {
	row := store.db.QueryRowContext(ctx, `
		SELECT id, user_id, scope, name, slug, sort_order, created_at, updated_at
		FROM categories
		WHERE scope = ? AND slug = ? AND (user_id IS NULL OR user_id = ?)
		ORDER BY user_id NULLS FIRST
		LIMIT 1
	`, scope, slug, userID)
	return store.scanCategory(row)
}

// Create 创建分类
func (store *Store) Create(ctx context.Context, userID int64, scope, name string) (*Category, error) {
	slug := slugify(name)
	if slug == "" {
		return nil, errors.New("invalid category name")
	}

	// PG 不支持 LastInsertId,通过 RETURNING 直接拿新记录 id
	var id int64
	err := store.db.QueryRowContext(ctx, `
		INSERT INTO categories (user_id, scope, name, slug, sort_order)
		VALUES (?, ?, ?, ?, 50)
		RETURNING id
	`, userID, scope, name, slug).Scan(&id)
	if err != nil {
		return nil, err
	}
	return store.GetByID(ctx, id)
}

// Rename 重命名分类
func (store *Store) Rename(ctx context.Context, id int64, newName string) error {
	result, err := store.db.ExecContext(ctx, `
		UPDATE categories
		SET name = ?, slug = ?, updated_at = ?
		WHERE id = ?
	`, newName, slugify(newName), time.Now(), id)
	if err != nil {
		return err
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return errors.New("category not found")
	}
	return nil
}

// Delete 删除分类,并将该分类下的记录移动到默认分类
func (store *Store) Delete(ctx context.Context, category *Category, userID int64, defaultCategoryID int64) error {
	if category.UserID == nil || *category.UserID != userID {
		return errors.New("category not owned by current user")
	}

	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var table string
	if category.Scope == ScopeKnowledge {
		table = "knowledge_items"
	} else if category.Scope == ScopeCommand {
		table = "commands"
	} else {
		return errors.New("invalid scope")
	}

	if _, err := tx.ExecContext(ctx, "UPDATE "+table+" SET category_id = ? WHERE user_id = ? AND category_id = ?", defaultCategoryID, userID, category.ID); err != nil {
		return err
	}

	result, err := tx.ExecContext(ctx, "DELETE FROM categories WHERE id = ?", category.ID)
	if err != nil {
		return err
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return errors.New("category not found")
	}

	return tx.Commit()
}

// ResolveOrCreate 根据名称解析分类,不存在则创建自定义分类
func (store *Store) ResolveOrCreate(ctx context.Context, userID int64, scope, name string) (*Category, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("category name is required")
	}

	slug := slugify(name)
	if existing, err := store.GetBySlug(ctx, userID, scope, slug); err == nil && existing != nil {
		return existing, nil
	}

	return store.Create(ctx, userID, scope, name)
}

// CountItems 统计某分类下关联的记录数量
// scope 为 knowledge 时查询 knowledge_items,为 command 时查询 commands
func (store *Store) CountItems(ctx context.Context, scope string, categoryID int64) (int, error) {
	var table string
	if scope == ScopeKnowledge {
		table = "knowledge_items"
	} else if scope == ScopeCommand {
		table = "commands"
	} else {
		return 0, errors.New("invalid scope")
	}

	var count int
	query := "SELECT COUNT(*) FROM " + table + " WHERE category_id = ?"
	err := store.db.QueryRowContext(ctx, query, categoryID).Scan(&count)
	return count, err
}

// scanCategory 单行扫描为 Category,无记录时返回 (nil, nil)
func (store *Store) scanCategory(row *sql.Row) (*Category, error) {
	var c Category
	var userIDNullable sql.NullInt64
	if err := row.Scan(&c.ID, &userIDNullable, &c.Scope, &c.Name, &c.Slug, &c.SortOrder, &c.CreatedAt, &c.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	if userIDNullable.Valid {
		uid := userIDNullable.Int64
		c.UserID = &uid
	}
	return &c, nil
}
