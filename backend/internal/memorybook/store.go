package memorybook

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/pgvector/pgvector-go"

	"personal-agents/backend/internal/database"
	"personal-agents/backend/internal/embed"
)

const sourceTypeMemory = "memory"

// Store 记忆数据访问层
type Store struct {
	db          *database.Store
	embedClient *embed.Client
}

// NewStore 创建记忆存储实例
func NewStore(db *database.Store, embedClient *embed.Client) *Store {
	return &Store{db: db, embedClient: embedClient}
}

// buildEmbeddingText 拼接用于向量化的文本(标题+内容+主题)
func buildEmbeddingText(topic, title, content string) string {
	var parts []string
	for _, s := range []string{title, content} {
		s = strings.TrimSpace(s)
		if s != "" {
			parts = append(parts, s)
		}
	}
	return strings.Join(parts, "\n")
}

// saveEmbedding 事务内插入/更新记忆向量
func (s *Store) saveEmbedding(ctx context.Context, tx *database.Tx, userID, memID int64, text string) error {
	if s.embedClient == nil {
		slog.Warn("embed client not configured, skipping embedding generation for memory")
		return nil
	}
	vec, err := s.embedClient.Embed(ctx, text)
	if err != nil {
		return fmt.Errorf("generate embedding: %w", err)
	}
	_, err = tx.ExecContext(ctx,
		`INSERT INTO embeddings (user_id, source_type, source_id, chunk_index, chunk_text, embedding, embedding_model)
		 VALUES (?, ?, ?, 0, ?, ?, ?)
		 ON CONFLICT (source_type, source_id, chunk_index)
		 DO UPDATE SET chunk_text = EXCLUDED.chunk_text, embedding = EXCLUDED.embedding, embedding_model = EXCLUDED.embedding_model, updated_at = now()`,
		userID, sourceTypeMemory, memID, text, pgvector.NewVector(vec), s.embedClient.Model(),
	)
	return err
}

// deleteEmbeddings 事务内删除记忆向量
func (s *Store) deleteEmbeddings(ctx context.Context, tx *database.Tx, memID int64) error {
	_, err := tx.ExecContext(ctx,
		`DELETE FROM embeddings WHERE source_type = ? AND source_id = ?`,
		sourceTypeMemory, memID,
	)
	return err
}

// List 查询用户记忆列表(B8管理页),可选topic过滤
func (s *Store) List(ctx context.Context, userID int64, topic string, activeOnly bool) ([]MemorySummary, error) {
	var (
		sb      strings.Builder
		args    []any
		argsIdx int
	)
	sb.WriteString(`SELECT id, topic, title, content, importance, is_active, created_at, updated_at
	               FROM memories WHERE user_id = ?`)
	args = append(args, userID)
	argsIdx++

	if topic != "" {
		argsIdx++
		sb.WriteString(fmt.Sprintf(" AND topic = ?"))
		args = append(args, topic)
	}
	if activeOnly {
		sb.WriteString(" AND is_active = TRUE")
	}
	sb.WriteString(" ORDER BY importance DESC, updated_at DESC")

	rows, err := s.db.QueryContext(ctx, sb.String(), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []MemorySummary
	for rows.Next() {
		var rec memoryRecord
		if err := rows.Scan(&rec.ID, &rec.Topic, &rec.Title, &rec.Content, &rec.Importance, &rec.IsActive, &rec.CreatedAt, &rec.UpdatedAt); err != nil {
			return nil, err
		}
		result = append(result, rec.toSummary())
	}
	return result, rows.Err()
}

// FindDetail 查询单条记忆详情
func (s *Store) FindDetail(ctx context.Context, userID, memID int64) (MemoryDetail, error) {
	var rec memoryRecord
	err := s.db.QueryRowContext(ctx,
		`SELECT id, topic, title, content, importance, is_active, created_at, updated_at
		 FROM memories WHERE id = ? AND user_id = ?`,
		memID, userID,
	).Scan(&rec.ID, &rec.Topic, &rec.Title, &rec.Content, &rec.Importance, &rec.IsActive, &rec.CreatedAt, &rec.UpdatedAt)
	if err != nil {
		return MemoryDetail{}, err
	}
	return rec.toSummary(), nil
}

// Create 创建记忆并生成向量(事务内),返回新记忆ID
func (s *Store) Create(ctx context.Context, userID int64, req MemoryRequest) (int64, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	var id int64
	err = tx.QueryRowContext(ctx,
		`INSERT INTO memories (user_id, topic, title, content, importance, is_active)
		 VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
		userID, req.Topic, req.Title, req.Content, req.Importance, req.IsActive,
	).Scan(&id)
	if err != nil {
		return 0, err
	}

	text := buildEmbeddingText(req.Topic, req.Title, req.Content)
	if text != "" {
		if err := s.saveEmbedding(ctx, tx, userID, id, text); err != nil {
			slog.Error("failed to generate embedding for new memory", "id", id, "error", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return id, nil
}

// Update 更新记忆并重生成向量(事务内双删)
func (s *Store) Update(ctx context.Context, userID, memID int64, req MemoryRequest) (int64, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	result, err := tx.ExecContext(ctx,
		`UPDATE memories SET topic = ?, title = ?, content = ?, importance = ?, is_active = ?, updated_at = now()
		 WHERE id = ? AND user_id = ?`,
		req.Topic, req.Title, req.Content, req.Importance, req.IsActive, memID, userID,
	)
	if err != nil {
		return 0, err
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}
	if rowsAffected > 0 {
		if err := s.deleteEmbeddings(ctx, tx, memID); err != nil {
			slog.Error("failed to delete old memory embeddings", "id", memID, "error", err)
		}
		text := buildEmbeddingText(req.Topic, req.Title, req.Content)
		if text != "" {
			if err := s.saveEmbedding(ctx, tx, userID, memID, text); err != nil {
				slog.Error("failed to regenerate embedding for memory", "id", memID, "error", err)
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return rowsAffected, nil
}

// Delete 删除记忆及其向量(事务双删)
func (s *Store) Delete(ctx context.Context, userID, memID int64) (int64, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	if err := s.deleteEmbeddings(ctx, tx, memID); err != nil {
		return 0, err
	}
	result, err := tx.ExecContext(ctx,
		`DELETE FROM memories WHERE id = ? AND user_id = ?`,
		memID, userID,
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

// RecallResult 语义检索返回的单条记忆
type RecallResult struct {
	MemorySummary
	Similarity float64 `json:"similarity"`
}

// Recall 语义检索记忆(recall_memory工具用)
func (s *Store) Recall(ctx context.Context, userID int64, query string, limit int) ([]RecallResult, error) {
	if limit <= 0 {
		limit = 5
	}
	if limit > 20 {
		limit = 20
	}

	var queryVec []float32
	if s.embedClient != nil {
		vec, err := s.embedClient.Embed(ctx, query)
		if err != nil {
			return nil, fmt.Errorf("embed query: %w", err)
		}
		queryVec = vec
	} else {
		// embed不可用时降级:按title/content关键词LIKE匹配
		return s.recallByKeyword(ctx, userID, query, limit)
	}

	const similarityThreshold = 0.2
	rows, err := s.db.QueryContext(ctx, `
		SELECT m.id, m.topic, m.title, m.content, m.importance, m.is_active, m.created_at, m.updated_at,
		       1 - (e.embedding <=> ?) AS similarity
		FROM embeddings e
		JOIN memories m ON m.id = e.source_id
		WHERE e.user_id = ? AND e.source_type = 'memory' AND m.is_active = TRUE
		  AND 1 - (e.embedding <=> ?) > ?
		ORDER BY e.embedding <=> ?
		LIMIT ?
	`, pgvector.NewVector(queryVec), userID, pgvector.NewVector(queryVec), similarityThreshold, pgvector.NewVector(queryVec), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []RecallResult
	for rows.Next() {
		var rec memoryRecord
		var sim float64
		if err := rows.Scan(&rec.ID, &rec.Topic, &rec.Title, &rec.Content, &rec.Importance, &rec.IsActive, &rec.CreatedAt, &rec.UpdatedAt, &sim); err != nil {
			return nil, err
		}
		results = append(results, RecallResult{MemorySummary: rec.toSummary(), Similarity: sim})
	}
	return results, rows.Err()
}

// recallByKeyword embed不可用时的关键词降级检索
func (s *Store) recallByKeyword(ctx context.Context, userID int64, query string, limit int) ([]RecallResult, error) {
	pattern := "%" + query + "%"
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, topic, title, content, importance, is_active, created_at, updated_at
		FROM memories
		WHERE user_id = ? AND is_active = TRUE
		  AND (title ILIKE ? OR content ILIKE ?)
		ORDER BY importance DESC, updated_at DESC
		LIMIT ?
	`, userID, pattern, pattern, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []RecallResult
	for rows.Next() {
		var rec memoryRecord
		if err := rows.Scan(&rec.ID, &rec.Topic, &rec.Title, &rec.Content, &rec.Importance, &rec.IsActive, &rec.CreatedAt, &rec.UpdatedAt); err != nil {
			return nil, err
		}
		results = append(results, RecallResult{MemorySummary: rec.toSummary(), Similarity: 0})
	}
	return results, rows.Err()
}

// CoreMemories 获取用户的核心记忆(importance>=minImportance,默认4),用于对话启动时预注入
func (s *Store) CoreMemories(ctx context.Context, userID int64, minImportance int) ([]MemorySummary, error) {
	if minImportance <= 0 {
		minImportance = 4
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, topic, title, content, importance, is_active, created_at, updated_at
		FROM memories
		WHERE user_id = ? AND is_active = TRUE AND importance >= ?
		ORDER BY importance DESC, updated_at DESC
		LIMIT 20
	`, userID, minImportance)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []MemorySummary
	for rows.Next() {
		var rec memoryRecord
		if err := rows.Scan(&rec.ID, &rec.Topic, &rec.Title, &rec.Content, &rec.Importance, &rec.IsActive, &rec.CreatedAt, &rec.UpdatedAt); err != nil {
			return nil, err
		}
		results = append(results, rec.toSummary())
	}
	return results, rows.Err()
}

// FindDuplicate 查找与指定内容同主题且语义相似的记忆(用于AI写入时自动合并)
// 返回最相似的记忆ID和相似度;没有则返回 sql.ErrNoRows
func (s *Store) FindDuplicate(ctx context.Context, userID int64, topic, title, content string) (int64, float64, error) {
	if s.embedClient == nil {
		return 0, 0, sql.ErrNoRows
	}
	text := buildEmbeddingText(topic, title, content)
	vec, err := s.embedClient.Embed(ctx, text)
	if err != nil {
		return 0, 0, err
	}
	const dupThreshold = 0.75
	var (
		id     int64
		maxSim float64
	)
	err = s.db.QueryRowContext(ctx, `
		SELECT m.id, 1 - (e.embedding <=> ?) AS sim
		FROM embeddings e
		JOIN memories m ON m.id = e.source_id
		WHERE e.user_id = ? AND e.source_type = 'memory' AND m.topic = ? AND m.is_active = TRUE
		  AND 1 - (e.embedding <=> ?) > ?
		ORDER BY e.embedding <=> ?
		LIMIT 1
	`, pgvector.NewVector(vec), userID, topic, pgvector.NewVector(vec), dupThreshold, pgvector.NewVector(vec)).Scan(&id, &maxSim)
	if err != nil {
		return 0, 0, err
	}
	return id, maxSim, nil
}

// SaveWithDedup AI保存记忆:先查同主题相似记忆,有则更新内容(合并),无则新建
// 返回(记忆ID, 是否新建, 错误)
func (s *Store) SaveWithDedup(ctx context.Context, userID int64, req InternalSaveRequest) (int64, bool, error) {
	req.normalize()
	if req.Content == "" {
		return 0, false, errors.New("content is required")
	}
	if !validTopics[req.Topic] {
		return 0, false, errors.New("invalid topic")
	}
	title := req.Title
	if title == "" {
		// 无标题时取内容首行
		firstLine := strings.SplitN(strings.TrimSpace(req.Content), "\n", 2)[0]
		if len(firstLine) > 40 {
			firstLine = firstLine[:40] + "…"
		}
		title = firstLine
	}

	// 查重复
	dupID, _, err := s.FindDuplicate(ctx, userID, req.Topic, title, req.Content)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return 0, false, err
	}

	if dupID > 0 {
		// 合并:追加新内容到已有记忆末尾,取较高的importance
		existing, err := s.FindDetail(ctx, userID, dupID)
		if err != nil {
			return 0, false, err
		}
		merged := MemoryRequest{
			Topic:      req.Topic,
			Title:      existing.Title,
			Content:    existing.Content + "\n" + req.Content,
			Importance: existing.Importance,
			IsActive:   true,
		}
		if req.Importance > merged.Importance {
			merged.Importance = req.Importance
		}
		merged.normalize()
		if _, err := s.Update(ctx, userID, dupID, merged); err != nil {
			return 0, false, err
		}
		return dupID, false, nil
	}

	// 新建
	createReq := MemoryRequest{
		Topic:      req.Topic,
		Title:      title,
		Content:    req.Content,
		Importance: req.Importance,
		IsActive:   true,
	}
	createReq.normalize()
	id, err := s.Create(ctx, userID, createReq)
	if err != nil {
		return 0, false, err
	}
	return id, true, nil
}
