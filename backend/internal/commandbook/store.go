package commandbook

import (
	"context"
	"errors"
	"time"

	"personal-agents/backend/internal/category"
	"personal-agents/backend/internal/database"
)

// Store 命令手册数据访问层
type Store struct {
	db            *database.Store
	categoryStore *category.Store
}

// NewStore 创建命令手册存储实例
func NewStore(store *database.Store) *Store {
	return &Store{db: store, categoryStore: category.NewStore(store)}
}

// CategoryStore 暴露分类存储(供 handler 做 AI 解析时的分类校验)
func (store *Store) CategoryStore() *category.Store {
	return store.categoryStore
}

// List 查询命令摘要列表;filterByCategory 为 true 时按分类过滤,keyword 非空时多字段模糊搜索
func (store *Store) List(ctx context.Context, userID int64, filterByCategory bool, categoryID int64, keyword string) ([]CommandSummary, error) {
	likePattern := "%" + keyword + "%"

	rows, err := store.db.QueryContext(
		ctx,
		`SELECT c.id, c.title, c.command_text, c.category_id, cat.name, cat.slug, c.sub_category, c.template_type, c.created_at, c.updated_at
		 FROM commands c
		 JOIN categories cat ON cat.id = c.category_id
		 WHERE c.user_id = ?
		   AND (? = FALSE OR c.category_id = ?)
		   AND (? = '' OR c.title LIKE ? OR c.command_text LIKE ? OR c.introduction LIKE ? OR c.parameters LIKE ? OR c.notes LIKE ?)
		 ORDER BY c.updated_at DESC`,
		userID,
		filterByCategory, categoryID,
		keyword, likePattern, likePattern, likePattern, likePattern, likePattern,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	commands := make([]CommandSummary, 0)
	for rows.Next() {
		var record commandRecord
		if err := rows.Scan(&record.ID, &record.Title, &record.CommandText, &record.CategoryID, &record.CategoryName, &record.CategorySlug, &record.SubCategory, &record.TemplateType, &record.CreatedAt, &record.UpdatedAt); err != nil {
			return nil, err
		}
		commands = append(commands, record.summary())
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return commands, nil
}

// Create 插入命令,返回新命令 ID
// PG 不支持 LastInsertId,通过 RETURNING 直接拿新记录 id
func (store *Store) Create(ctx context.Context, userID int64, request CommandRequest, stepsJSON string) (int64, error) {
	var commandID int64
	err := store.db.QueryRowContext(
		ctx,
		`INSERT INTO commands (user_id, title, command_text, category_id, sub_category, introduction, parameters, scenarios, notes, reference_url, template_type, steps)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
		userID,
		request.Title,
		request.CommandText,
		request.CategoryID,
		nullableString(request.SubCategory),
		nullableString(request.Introduction),
		nullableString(request.Parameters),
		nullableString(request.Scenarios),
		nullableString(request.Notes),
		nullableString(request.ReferenceURL),
		request.TemplateType,
		nullableString(stepsJSON),
	).Scan(&commandID)
	return commandID, err
}

// FindDetail 查询单条命令详情(含 introduction / parameters / notes / steps)
// 不存在时返回 sql.ErrNoRows
func (store *Store) FindDetail(ctx context.Context, userID int64, commandID int64) (CommandDetail, error) {
	var record commandRecord
	row := store.db.QueryRowContext(
		ctx,
		`SELECT c.id, c.title, c.command_text, c.category_id, cat.name, cat.slug, c.sub_category, c.introduction, c.parameters, c.scenarios, c.notes, c.reference_url, c.template_type, c.steps, c.created_at, c.updated_at
		 FROM commands c
		 JOIN categories cat ON cat.id = c.category_id
		 WHERE c.id = ? AND c.user_id = ?
		 LIMIT 1`,
		commandID,
		userID,
	)

	if err := row.Scan(&record.ID, &record.Title, &record.CommandText, &record.CategoryID, &record.CategoryName, &record.CategorySlug, &record.SubCategory, &record.Introduction, &record.Parameters, &record.Scenarios, &record.Notes, &record.ReferenceURL, &record.TemplateType, &record.Steps, &record.CreatedAt, &record.UpdatedAt); err != nil {
		return CommandDetail{}, err
	}

	return record.detail(), nil
}

// Update 更新命令,返回受影响行数
func (store *Store) Update(ctx context.Context, userID, commandID int64, request CommandRequest, stepsJSON string) (int64, error) {
	result, err := store.db.ExecContext(
		ctx,
		`UPDATE commands
		 SET title = ?, command_text = ?, category_id = ?, sub_category = ?, introduction = ?, parameters = ?, scenarios = ?, notes = ?, reference_url = ?, template_type = ?, steps = ?
		 WHERE id = ? AND user_id = ?`,
		request.Title,
		request.CommandText,
		request.CategoryID,
		nullableString(request.SubCategory),
		nullableString(request.Introduction),
		nullableString(request.Parameters),
		nullableString(request.Scenarios),
		nullableString(request.Notes),
		nullableString(request.ReferenceURL),
		request.TemplateType,
		nullableString(stepsJSON),
		commandID,
		userID,
	)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

// Exists 检查命令是否存在(用于 Update 的 0 行更新判断)
func (store *Store) Exists(ctx context.Context, userID int64, commandID int64) (bool, error) {
	var count int
	err := store.db.QueryRowContext(
		ctx,
		`SELECT COUNT(*) FROM commands WHERE id = ? AND user_id = ?`,
		commandID,
		userID,
	).Scan(&count)
	return count > 0, err
}

// Delete 删除命令,返回受影响行数
func (store *Store) Delete(ctx context.Context, userID int64, commandID int64) (int64, error) {
	result, err := store.db.ExecContext(
		ctx,
		`DELETE FROM commands WHERE id = ? AND user_id = ?`,
		commandID,
		userID,
	)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

// MoveCategory 只更新命令的分类 ID(专用移动分类接口)
func (store *Store) MoveCategory(ctx context.Context, userID, commandID, categoryID int64) (int64, error) {
	result, err := store.db.ExecContext(
		ctx,
		`UPDATE commands SET category_id = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
		categoryID,
		time.Now(),
		commandID,
		userID,
	)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

// validateCategoryID 校验分类 ID 属于当前用户且为命令手册分类
func (store *Store) validateCategoryID(ctx context.Context, userID int64, categoryID int64) error {
	cat, err := store.categoryStore.GetByID(ctx, categoryID)
	if err != nil {
		return err
	}
	if cat == nil {
		return errors.New("category not found")
	}
	if cat.Scope != category.ScopeCommand {
		return errors.New("invalid category scope")
	}
	if cat.UserID == nil || *cat.UserID != userID {
		return errors.New("category not owned by user")
	}
	return nil
}

// ValidateCategoryID 校验分类 ID(供 handler 调用)
func (store *Store) ValidateCategoryID(ctx context.Context, userID int64, categoryID int64) error {
	return store.validateCategoryID(ctx, userID, categoryID)
}
