package knowledgebook

import (
	"context"
	"errors"
	"time"

	"personal-agents/backend/internal/category"
	"personal-agents/backend/internal/database"
)

// Store 知识库数据访问层
type Store struct {
	db            *database.Store
	categoryStore *category.Store
}

// NewStore 创建知识库存储实例
func NewStore(store *database.Store) *Store {
	return &Store{db: store, categoryStore: category.NewStore(store)}
}

// CategoryStore 暴露分类存储(供 handler 做 AI 解析时的分类校验)
func (store *Store) CategoryStore() *category.Store {
	return store.categoryStore
}

// List 查询知识摘要列表;filterByCategory 为 true 时按分类过滤,keyword 非空时多字段模糊搜索
func (store *Store) List(ctx context.Context, userID int64, filterByCategory bool, categoryID int64, keyword string) ([]KnowledgeSummary, error) {
	likePattern := "%" + keyword + "%"

	rows, err := store.db.QueryContext(
		ctx,
		`SELECT ki.id, ki.title, ki.category_id, c.name, c.slug, ki.sub_category, ki.tags, ki.summary, ki.template_type, ki.created_at, ki.updated_at
		 FROM knowledge_items ki
		 JOIN categories c ON c.id = ki.category_id
		 WHERE ki.user_id = ?
		   AND (? = FALSE OR ki.category_id = ?)
		   AND (? = '' OR ki.title LIKE ? OR ki.summary LIKE ? OR ki.content LIKE ? OR ki.notes LIKE ? OR ki.tags LIKE ?)
		 ORDER BY ki.updated_at DESC`,
		userID,
		filterByCategory, categoryID,
		keyword, likePattern, likePattern, likePattern, likePattern, likePattern,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]KnowledgeSummary, 0)
	for rows.Next() {
		var record knowledgeRecord
		if err := rows.Scan(&record.ID, &record.Title, &record.CategoryID, &record.CategoryName, &record.CategorySlug, &record.SubCategory, &record.Tags, &record.Summary, &record.TemplateType, &record.CreatedAt, &record.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, record.summary())
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return items, nil
}

// Create 插入知识条目,返回新条目 ID
// PG 不支持 LastInsertId,通过 RETURNING 直接拿新记录 id
func (store *Store) Create(ctx context.Context, userID int64, request KnowledgeRequest, stepsJSON, comparisonJSON string) (int64, error) {
	var itemID int64
	err := store.db.QueryRowContext(
		ctx,
		`INSERT INTO knowledge_items (user_id, title, category_id, sub_category, tags, summary, content, notes, reference_url, extra, template_type, steps, comparison)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
		userID,
		request.Title,
		request.CategoryID,
		nullableString(request.SubCategory),
		nullableString(request.Tags),
		nullableString(request.Summary),
		nullableString(request.Content),
		nullableString(request.Notes),
		nullableString(request.ReferenceURL),
		nullableJSON(request.Extra),
		request.TemplateType,
		nullableString(stepsJSON),
		nullableString(comparisonJSON),
	).Scan(&itemID)
	return itemID, err
}

// FindDetail 查询单条知识详情,不存在时返回 sql.ErrNoRows
func (store *Store) FindDetail(ctx context.Context, userID int64, itemID int64) (KnowledgeDetail, error) {
	var record knowledgeRecord
	row := store.db.QueryRowContext(
		ctx,
		`SELECT ki.id, ki.title, ki.category_id, c.name, c.slug, ki.sub_category, ki.tags, ki.summary, ki.content, ki.notes, ki.reference_url, ki.extra, ki.template_type, ki.steps, ki.comparison, ki.created_at, ki.updated_at
		 FROM knowledge_items ki
		 JOIN categories c ON c.id = ki.category_id
		 WHERE ki.id = ? AND ki.user_id = ?
		 LIMIT 1`,
		itemID,
		userID,
	)

	if err := row.Scan(&record.ID, &record.Title, &record.CategoryID, &record.CategoryName, &record.CategorySlug, &record.SubCategory, &record.Tags, &record.Summary, &record.Content, &record.Notes, &record.ReferenceURL, &record.Extra, &record.TemplateType, &record.Steps, &record.Comparison, &record.CreatedAt, &record.UpdatedAt); err != nil {
		return KnowledgeDetail{}, err
	}

	return record.detail(), nil
}

// Update 更新知识条目,返回受影响行数
func (store *Store) Update(ctx context.Context, userID, itemID int64, request KnowledgeRequest, stepsJSON, comparisonJSON string) (int64, error) {
	result, err := store.db.ExecContext(
		ctx,
		`UPDATE knowledge_items
		 SET title = ?, category_id = ?, sub_category = ?, tags = ?, summary = ?, content = ?, notes = ?, reference_url = ?, extra = ?, template_type = ?, steps = ?, comparison = ?
		 WHERE id = ? AND user_id = ?`,
		request.Title,
		request.CategoryID,
		nullableString(request.SubCategory),
		nullableString(request.Tags),
		nullableString(request.Summary),
		nullableString(request.Content),
		nullableString(request.Notes),
		nullableString(request.ReferenceURL),
		nullableJSON(request.Extra),
		request.TemplateType,
		nullableString(stepsJSON),
		nullableString(comparisonJSON),
		itemID,
		userID,
	)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

// Exists 检查知识条目是否存在(用于 Update 的 0 行更新判断)
func (store *Store) Exists(ctx context.Context, userID int64, itemID int64) (bool, error) {
	var count int
	err := store.db.QueryRowContext(
		ctx,
		`SELECT COUNT(*) FROM knowledge_items WHERE id = ? AND user_id = ?`,
		itemID,
		userID,
	).Scan(&count)
	return count > 0, err
}

// Delete 删除知识条目,返回受影响行数
func (store *Store) Delete(ctx context.Context, userID int64, itemID int64) (int64, error) {
	result, err := store.db.ExecContext(
		ctx,
		`DELETE FROM knowledge_items WHERE id = ? AND user_id = ?`,
		itemID,
		userID,
	)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

// MoveCategory 只更新知识条目的分类 ID(专用移动分类接口)
func (store *Store) MoveCategory(ctx context.Context, userID, itemID, categoryID int64) (int64, error) {
	result, err := store.db.ExecContext(
		ctx,
		`UPDATE knowledge_items SET category_id = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
		categoryID,
		time.Now(),
		itemID,
		userID,
	)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

// ValidateCategoryID 校验分类 ID 属于当前用户且为知识库分类
func (store *Store) ValidateCategoryID(ctx context.Context, userID int64, categoryID int64) error {
	cat, err := store.categoryStore.GetByID(ctx, categoryID)
	if err != nil {
		return err
	}
	if cat == nil {
		return errors.New("category not found")
	}
	if cat.Scope != category.ScopeKnowledge {
		return errors.New("invalid category scope")
	}
	if cat.UserID == nil || *cat.UserID != userID {
		return errors.New("category not owned by user")
	}
	return nil
}
