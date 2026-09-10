package systemknowledge

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"sort"

	"personal-agents/backend/internal/database"
)

// Store 系统知识节点数据访问层
type Store struct {
	db *database.Store
}

// NewStore 创建 Store
func NewStore(db *database.Store) *Store {
	return &Store{db: db}
}

// EnsureSeed 检查内置节点是否已写入;未写入则批量插入(幂等)
func (s *Store) EnsureSeed(ctx context.Context) error {
	var count int
	err := s.db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM system_knowledge_nodes WHERE user_id = 0 AND category = ?",
		CategoryLinuxFHS,
	).Scan(&count)
	if err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	seeds := seedNodes()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, s0 := range seeds {
		examplesJSON, _ := json.Marshal(s0.examples)
		_, err := tx.ExecContext(ctx, `
			INSERT INTO system_knowledge_nodes
				(user_id, category, parent_path, path, name, node_type, description, contents, examples, sort_order, is_builtin)
			VALUES (0, ?, ?, ?, ?, ?, ?, ?, ?::JSONB, ?, TRUE)
			ON CONFLICT (user_id, category, path) DO NOTHING`,
			CategoryLinuxFHS,
			s0.parentPath,
			s0.path,
			s0.name,
			s0.nodeType,
			s0.description,
			s0.contents,
			string(examplesJSON),
			s0.sortOrder,
		)
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ListByCategory 获取用户在某分类下的节点列表(合并内置+用户自定义)
// 合并规则:同path优先用户版本(覆盖内置)
func (s *Store) ListByCategory(ctx context.Context, userID int64, category string) ([]Node, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, user_id, category, parent_path, path, name, node_type,
		       description, contents, examples, sort_order, is_builtin,
		       created_at, updated_at
		FROM system_knowledge_nodes
		WHERE category = ? AND (user_id = 0 OR user_id = ?)
		ORDER BY user_id ASC, sort_order ASC, id ASC`,
		category, userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	nodeMap := make(map[string]nodeRecord)
	var order []string
	for rows.Next() {
		var rec nodeRecord
		var examplesRaw []byte
		if err := rows.Scan(
			&rec.ID, &rec.UserID, &rec.Category, &rec.ParentPath, &rec.Path, &rec.Name, &rec.NodeType,
			&rec.Description, &rec.Contents, &examplesRaw, &rec.SortOrder, &rec.IsBuiltin,
			&rec.CreatedAt, &rec.UpdatedAt,
		); err != nil {
			return nil, err
		}
		rec.ExamplesRaw = examplesRaw
		if _, exists := nodeMap[rec.Path]; !exists {
			order = append(order, rec.Path)
		}
		nodeMap[rec.Path] = rec
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	result := make([]Node, 0, len(order))
	for _, p := range order {
		node, err := nodeMap[p].toNode()
		if err != nil {
			return nil, err
		}
		result = append(result, node)
	}

	// 稳定排序:先按parent_path分组,同parent_path内内置按sort_order,用户节点按id追加
	sort.SliceStable(result, func(i, j int) bool {
		a, b := result[i], result[j]
		if a.ParentPath != b.ParentPath {
			return a.ParentPath < b.ParentPath
		}
		if a.IsBuiltin != b.IsBuiltin {
			return a.IsBuiltin // 内置(true)排前面
		}
		if a.SortOrder != b.SortOrder {
			return a.SortOrder < b.SortOrder
		}
		return a.ID < b.ID
	})

	return result, nil
}

// FindByPath 按路径查找节点(优先用户版本,fallback内置)
func (s *Store) FindByPath(ctx context.Context, userID int64, category, path string) (*Node, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, user_id, category, parent_path, path, name, node_type,
		       description, contents, examples, sort_order, is_builtin,
		       created_at, updated_at
		FROM system_knowledge_nodes
		WHERE category = ? AND path = ? AND (user_id = 0 OR user_id = ?)
		ORDER BY user_id DESC
		LIMIT 1`,
		category, path, userID,
	)
	var rec nodeRecord
	var examplesRaw []byte
	err := row.Scan(
		&rec.ID, &rec.UserID, &rec.Category, &rec.ParentPath, &rec.Path, &rec.Name, &rec.NodeType,
		&rec.Description, &rec.Contents, &examplesRaw, &rec.SortOrder, &rec.IsBuiltin,
		&rec.CreatedAt, &rec.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, sql.ErrNoRows
		}
		return nil, err
	}
	rec.ExamplesRaw = examplesRaw
	node, err := rec.toNode()
	if err != nil {
		return nil, err
	}
	return &node, nil
}

// Create 创建用户自定义节点
func (s *Store) Create(ctx context.Context, userID int64, category, parentPath, name, nodeType, description, contents string, examples []string) (*Node, error) {
	fullPath := computeChildPath(parentPath, name)

	existing, err := s.FindByPath(ctx, userID, category, fullPath)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if existing != nil {
		return nil, errors.New("node already exists at this path")
	}

	examplesJSON, _ := json.Marshal(examples)
	if examples == nil {
		examplesJSON = []byte("[]")
	}

	// 用户自定义节点sort_order从10000开始追加
	var maxSort sql.NullInt64
	s.db.QueryRowContext(ctx,
		"SELECT MAX(sort_order) FROM system_knowledge_nodes WHERE category = ? AND parent_path = ? AND user_id = ?",
		category, parentPath, userID,
	).Scan(&maxSort)
	sortOrder := 10000
	if maxSort.Valid {
		sortOrder = int(maxSort.Int64) + 1
	}

	var id int64
	err = s.db.QueryRowContext(ctx, `
		INSERT INTO system_knowledge_nodes
			(user_id, category, parent_path, path, name, node_type, description, contents, examples, sort_order, is_builtin)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?::JSONB, ?, FALSE)
		RETURNING id`,
		userID, category, parentPath, fullPath, name, nodeType, description, contents, string(examplesJSON), sortOrder,
	).Scan(&id)
	if err != nil {
		return nil, err
	}
	return s.FindByPath(ctx, userID, category, fullPath)
}

// Update 更新节点内容(仅description/contents/examples;不支持重命名)
// - 内置节点:UPSERT用户覆盖记录
// - 用户节点:直接UPDATE
func (s *Store) Update(ctx context.Context, userID int64, category, path string, req UpdateRequest) (*Node, error) {
	req.normalize()

	current, err := s.FindByPath(ctx, userID, category, path)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, sql.ErrNoRows
		}
		return nil, err
	}

	newDesc := current.Description
	if req.Description != nil {
		newDesc = *req.Description
	}
	newCont := current.Contents
	if req.Contents != nil {
		newCont = *req.Contents
	}
	newExamples := current.Examples
	if req.Examples != nil {
		newExamples = req.Examples
	}
	examplesJSON, _ := json.Marshal(newExamples)

	if current.IsCustom {
		// 用户节点:直接更新
		_, err = s.db.ExecContext(ctx, `
			UPDATE system_knowledge_nodes
			SET description = ?, contents = ?, examples = ?::JSONB, updated_at = now()
			WHERE user_id = ? AND category = ? AND path = ?`,
			newDesc, newCont, string(examplesJSON),
			userID, category, path,
		)
		if err != nil {
			return nil, err
		}
	} else {
		// 内置节点:UPSERT用户覆盖记录
		_, err = s.db.ExecContext(ctx, `
			INSERT INTO system_knowledge_nodes
				(user_id, category, parent_path, path, name, node_type, description, contents, examples, sort_order, is_builtin)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?::JSONB, 0, FALSE)
			ON CONFLICT (user_id, category, path) DO UPDATE
				SET description = EXCLUDED.description,
				    contents = EXCLUDED.contents,
				    examples = EXCLUDED.examples,
				    updated_at = now()`,
			userID, category, current.ParentPath, path, current.Name, current.NodeType,
			newDesc, newCont, string(examplesJSON),
		)
		if err != nil {
			return nil, err
		}
	}

	return s.FindByPath(ctx, userID, category, path)
}

// Delete 删除用户自定义节点
// 返回 (builtinRestored, error):
//   - builtinRestored=true: 删的是内置节点的用户覆盖,内置版本自动恢复
//   - builtinRestored=false: 删的是用户自创节点
func (s *Store) Delete(ctx context.Context, userID int64, category, path string) (bool, error) {
	var id int64
	var isBuiltin bool
	err := s.db.QueryRowContext(ctx,
		"SELECT id, is_builtin FROM system_knowledge_nodes WHERE user_id = ? AND category = ? AND path = ?",
		userID, category, path,
	).Scan(&id, &isBuiltin)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	if isBuiltin {
		return false, errors.New("cannot delete builtin node")
	}

	// 检查删除后是否会露出内置版本
	var builtinExists bool
	s.db.QueryRowContext(ctx,
		"SELECT EXISTS(SELECT 1 FROM system_knowledge_nodes WHERE user_id = 0 AND category = ? AND path = ?)",
		category, path,
	).Scan(&builtinExists)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()

	// 删除节点自身
	_, err = tx.ExecContext(ctx,
		"DELETE FROM system_knowledge_nodes WHERE user_id = ? AND category = ? AND path = ?",
		userID, category, path,
	)
	if err != nil {
		return false, err
	}

	// 递归删除该路径下所有用户子节点
	_, err = tx.ExecContext(ctx,
		"DELETE FROM system_knowledge_nodes WHERE user_id = ? AND category = ? AND path LIKE ?",
		userID, category, path+"/%",
	)
	if err != nil {
		return false, err
	}

	if err := tx.Commit(); err != nil {
		return false, err
	}
	return builtinExists, nil
}

// ResetUserCategory 重置用户在某分类下所有自定义数据
func (s *Store) ResetUserCategory(ctx context.Context, userID int64, category string) error {
	_, err := s.db.ExecContext(ctx,
		"DELETE FROM system_knowledge_nodes WHERE user_id = ? AND category = ?",
		userID, category,
	)
	return err
}

// computeChildPath 计算子节点完整路径
func computeChildPath(parentPath, name string) string {
	if parentPath == "" || parentPath == "/" {
		return "/" + name
	}
	return parentPath + "/" + name
}
