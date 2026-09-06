package knowledgebook

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/pgvector/pgvector-go"

	"personal-agents/backend/internal/category"
	"personal-agents/backend/internal/database"
	"personal-agents/backend/internal/embed"
)

const (
	sourceTypeKnowledge = "knowledge"
	searchTopK          = 5
	similarityThreshold = 0.3
)

// Store 知识库数据访问层
type Store struct {
	db            *database.Store
	categoryStore *category.Store
	embedClient   *embed.Client
}

// NewStore 创建知识库存储实例
func NewStore(store *database.Store, embedClient *embed.Client) *Store {
	return &Store{db: store, categoryStore: category.NewStore(store), embedClient: embedClient}
}

// CategoryStore 暴露分类存储(供 handler 做 AI 解析时的分类校验)
func (store *Store) CategoryStore() *category.Store {
	return store.categoryStore
}

// buildEmbeddingText 拼接用于向量化的文本(标题+摘要+正文+标签)
func buildEmbeddingText(title, summary, content, tags, notes string) string {
	var parts []string
	for _, s := range []string{title, summary, content, tags, notes} {
		s = strings.TrimSpace(s)
		if s != "" {
			parts = append(parts, s)
		}
	}
	return strings.Join(parts, "\n")
}

// saveEmbedding 在事务中插入/更新向量记录
func (store *Store) saveEmbedding(ctx context.Context, tx *database.Tx, userID, sourceID int64, text string) error {
	if store.embedClient == nil {
		slog.Warn("embed client not configured, skipping embedding generation")
		return nil
	}

	vec, err := store.embedClient.Embed(ctx, text)
	if err != nil {
		return fmt.Errorf("generate embedding: %w", err)
	}

	_, err = tx.ExecContext(ctx,
		`INSERT INTO embeddings (user_id, source_type, source_id, chunk_index, chunk_text, embedding, embedding_model)
		 VALUES (?, ?, ?, 0, ?, ?, ?)
		 ON CONFLICT (source_type, source_id, chunk_index)
		 DO UPDATE SET chunk_text = EXCLUDED.chunk_text, embedding = EXCLUDED.embedding, embedding_model = EXCLUDED.embedding_model, updated_at = now()`,
		userID, sourceTypeKnowledge, sourceID, text, pgvector.NewVector(vec), store.embedClient.Model(),
	)
	return err
}

// deleteEmbeddings 在事务中删除源记录的所有向量
func (store *Store) deleteEmbeddings(ctx context.Context, tx *database.Tx, sourceID int64) error {
	_, err := tx.ExecContext(ctx,
		`DELETE FROM embeddings WHERE source_type = ? AND source_id = ?`,
		sourceTypeKnowledge, sourceID,
	)
	return err
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

// Create 插入知识条目并同步生成向量(事务内)
func (store *Store) Create(ctx context.Context, userID int64, request KnowledgeRequest, stepsJSON, comparisonJSON string) (int64, error) {
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	var itemID int64
	err = tx.QueryRowContext(
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
	if err != nil {
		return 0, err
	}

	embedText := buildEmbeddingText(request.Title, request.Summary, request.Content, request.Tags, request.Notes)
	if embedText != "" {
		if err := store.saveEmbedding(ctx, tx, userID, itemID, embedText); err != nil {
			slog.Error("failed to generate embedding for new knowledge item", "id", itemID, "error", err)
			// 向量生成失败不影响知识创建主流程
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return itemID, nil
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

// Update 更新知识条目并同步重新生成向量(事务内双删)
func (store *Store) Update(ctx context.Context, userID, itemID int64, request KnowledgeRequest, stepsJSON, comparisonJSON string) (int64, error) {
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	result, err := tx.ExecContext(
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
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}
	if rowsAffected > 0 {
		// 先删旧向量再插新向量
		if err := store.deleteEmbeddings(ctx, tx, itemID); err != nil {
			slog.Error("failed to delete old embeddings", "id", itemID, "error", err)
		}
		embedText := buildEmbeddingText(request.Title, request.Summary, request.Content, request.Tags, request.Notes)
		if embedText != "" {
			if err := store.saveEmbedding(ctx, tx, userID, itemID, embedText); err != nil {
				slog.Error("failed to regenerate embedding for updated knowledge item", "id", itemID, "error", err)
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return rowsAffected, nil
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

// Delete 删除知识条目并同步删除向量(事务双删)
func (store *Store) Delete(ctx context.Context, userID int64, itemID int64) (int64, error) {
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	// 先删向量(事务双删)
	if err := store.deleteEmbeddings(ctx, tx, itemID); err != nil {
		return 0, err
	}

	result, err := tx.ExecContext(
		ctx,
		`DELETE FROM knowledge_items WHERE id = ? AND user_id = ?`,
		itemID,
		userID,
	)
	if err != nil {
		return 0, err
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}

	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return rowsAffected, nil
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

// SearchResult 语义搜索结果
type SearchResult struct {
	KnowledgeSummary
	Similarity float64 `json:"similarity"`
	ChunkText  string  `json:"chunk_text,omitempty"`
}

// SemanticSearch 基于向量相似度搜索知识条目
func (store *Store) SemanticSearch(ctx context.Context, userID int64, query string, limit int) ([]SearchResult, error) {
	if store.embedClient == nil {
		return nil, errors.New("embedding service not configured")
	}
	if limit <= 0 {
		limit = searchTopK
	}

	vec, err := store.embedClient.Embed(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("generate query embedding: %w", err)
	}

	rows, err := store.db.QueryContext(
		ctx,
		`SELECT ki.id, ki.title, ki.category_id, c.name, c.slug, ki.sub_category, ki.tags, ki.summary, ki.template_type,
		        ki.created_at, ki.updated_at,
		        1 - (e.embedding <=> ?) AS similarity, e.chunk_text
		 FROM embeddings e
		 JOIN knowledge_items ki ON ki.id = e.source_id
		 JOIN categories c ON c.id = ki.category_id
		 WHERE e.user_id = ? AND e.source_type = ?
		   AND 1 - (e.embedding <=> ?) > ?
		 ORDER BY e.embedding <=> ?
		 LIMIT ?`,
		pgvector.NewVector(vec), userID, sourceTypeKnowledge,
		pgvector.NewVector(vec), similarityThreshold,
		pgvector.NewVector(vec), limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []SearchResult
	for rows.Next() {
		var record knowledgeRecord
		var similarity float64
		var chunkText sql.NullString
		if err := rows.Scan(
			&record.ID, &record.Title, &record.CategoryID, &record.CategoryName, &record.CategorySlug,
			&record.SubCategory, &record.Tags, &record.Summary, &record.TemplateType,
			&record.CreatedAt, &record.UpdatedAt,
			&similarity, &chunkText,
		); err != nil {
			return nil, err
		}
		results = append(results, SearchResult{
			KnowledgeSummary: record.summary(),
			Similarity:       similarity,
			ChunkText:        nullStringValue(chunkText),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return results, nil
}
