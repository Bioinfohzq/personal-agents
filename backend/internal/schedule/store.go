package schedule

import (
	"context"
	"database/sql"
	"time"

	"personal-agents/backend/internal/database"
)

// Store 日程数据访问层
type Store struct {
	db *database.Store
}

// NewStore 创建日程存储实例
func NewStore(store *database.Store) *Store {
	return &Store{db: store}
}

// List 查询用户日程,start/end 均为零值时返回全部
func (store *Store) List(ctx context.Context, userID int64, startTime, endTime time.Time) ([]ScheduleSummary, error) {
	var rows *sql.Rows
	var err error

	if !startTime.IsZero() && !endTime.IsZero() {
		// 带时间范围过滤(日历月视图用:只拉当月日程)
		rows, err = store.db.QueryContext(
			ctx,
			`SELECT id, title, start_time, end_time, location, created_at, updated_at
			 FROM schedules
			 WHERE user_id = ? AND start_time >= ? AND start_time <= ?
			 ORDER BY start_time ASC`,
			userID, startTime, endTime,
		)
	} else {
		// 不带过滤,返回全部日程
		rows, err = store.db.QueryContext(
			ctx,
			`SELECT id, title, start_time, end_time, location, created_at, updated_at
			 FROM schedules
			 WHERE user_id = ?
			 ORDER BY start_time ASC`,
			userID,
		)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	schedules := make([]ScheduleSummary, 0)
	for rows.Next() {
		var record scheduleRecord
		if err := rows.Scan(&record.ID, &record.Title, &record.StartTime, &record.EndTime, &record.Location, &record.CreatedAt, &record.UpdatedAt); err != nil {
			return nil, err
		}
		schedules = append(schedules, record.summary())
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return schedules, nil
}

// Create 插入日程,返回新日程 ID
// PG 不支持 LastInsertId,通过 RETURNING 直接拿新记录 id
func (store *Store) Create(ctx context.Context, userID int64, title, description string, startTime, endTime time.Time, location string) (int64, error) {
	var scheduleID int64
	err := store.db.QueryRowContext(
		ctx,
		`INSERT INTO schedules (user_id, title, description, start_time, end_time, location)
		 VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
		userID,
		title,
		nullableString(description),
		startTime,
		endTime,
		nullableString(location),
	).Scan(&scheduleID)
	return scheduleID, err
}

// FindDetail 查询单条日程详情(含描述),不存在时返回 sql.ErrNoRows
func (store *Store) FindDetail(ctx context.Context, userID int64, scheduleID int64) (ScheduleDetail, error) {
	var record scheduleRecord
	row := store.db.QueryRowContext(
		ctx,
		`SELECT id, title, description, start_time, end_time, location, created_at, updated_at
		 FROM schedules
		 WHERE id = ? AND user_id = ?
		 LIMIT 1`,
		scheduleID,
		userID,
	)

	if err := row.Scan(&record.ID, &record.Title, &record.Description, &record.StartTime, &record.EndTime, &record.Location, &record.CreatedAt, &record.UpdatedAt); err != nil {
		return ScheduleDetail{}, err
	}

	return record.detail(), nil
}

// Update 更新日程,返回受影响行数
func (store *Store) Update(ctx context.Context, userID, scheduleID int64, title, description string, startTime, endTime time.Time, location string) (int64, error) {
	result, err := store.db.ExecContext(
		ctx,
		`UPDATE schedules
		 SET title = ?, description = ?, start_time = ?, end_time = ?, location = ?
		 WHERE id = ? AND user_id = ?`,
		title,
		nullableString(description),
		startTime,
		endTime,
		nullableString(location),
		scheduleID,
		userID,
	)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

// Exists 检查日程是否存在(用于 Update 的 0 行更新判断)
func (store *Store) Exists(ctx context.Context, userID int64, scheduleID int64) (bool, error) {
	var count int
	err := store.db.QueryRowContext(
		ctx,
		`SELECT COUNT(*) FROM schedules WHERE id = ? AND user_id = ?`,
		scheduleID,
		userID,
	).Scan(&count)
	return count > 0, err
}

// Delete 删除日程,返回受影响行数
func (store *Store) Delete(ctx context.Context, userID int64, scheduleID int64) (int64, error) {
	result, err := store.db.ExecContext(
		ctx,
		`DELETE FROM schedules WHERE id = ? AND user_id = ?`,
		scheduleID,
		userID,
	)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}
