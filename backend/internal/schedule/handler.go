package schedule

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"

	"personal-agents/backend/internal/database"
	"personal-agents/backend/internal/middleware"
)

// Handler 日程 HTTP 处理器
type Handler struct {
	store *database.Store
}

// CreateScheduleRequest 创建日程请求体
type CreateScheduleRequest struct {
	Title       string `json:"title"`       // 日程标题,必填
	Description string `json:"description"` // 日程描述,可选
	StartTime   string `json:"start_time"`  // 开始时间,必填,格式: 2006-01-02T15:04:05Z07:00
	EndTime     string `json:"end_time"`    // 结束时间,必填,格式: 2006-01-02T15:04:05Z07:00
	Location    string `json:"location"`    // 地点,可选
}

// UpdateScheduleRequest 更新日程请求体(字段同创建,全部覆盖)
type UpdateScheduleRequest struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	StartTime   string `json:"start_time"`
	EndTime     string `json:"end_time"`
	Location    string `json:"location"`
}

// ScheduleSummary 日程摘要(列表用,不含描述正文)
type ScheduleSummary struct {
	ID        int64     `json:"id"`
	Title     string    `json:"title"`
	StartTime time.Time `json:"start_time"`
	EndTime   time.Time `json:"end_time"`
	Location  string    `json:"location,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// ScheduleDetail 日程详情(含描述)
type ScheduleDetail struct {
	ID          int64     `json:"id"`
	Title       string    `json:"title"`
	Description string    `json:"description,omitempty"`
	StartTime   time.Time `json:"start_time"`
	EndTime     time.Time `json:"end_time"`
	Location    string    `json:"location,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// scheduleRecord 数据库行映射结构体
type scheduleRecord struct {
	ID          int64
	Title       string
	Description sql.NullString
	StartTime   time.Time
	EndTime     time.Time
	Location    sql.NullString
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// NewHandler 创建日程处理器
func NewHandler(store *database.Store) *Handler {
	return &Handler{store: store}
}

// ListSchedules GET /api/v1/schedules
// 支持可选 query 参数 ?start=YYYY-MM-DD&end=YYYY-MM-DD 过滤时间范围
func (handler *Handler) ListSchedules(c echo.Context) error {
	userID, ok := middleware.EchoCurrentUserID(c)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "missing authenticated user")
	}

	// 解析可选的时间范围过滤参数
	startStr := c.QueryParam("start")
	endStr := c.QueryParam("end")

	var rows *sql.Rows
	var err error

	if startStr != "" && endStr != "" {
		// 带时间范围过滤(日历月视图用:只拉当月日程)
		startTime, parseErr := time.Parse("2006-01-02", startStr)
		if parseErr != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "invalid start date format, expected YYYY-MM-DD")
		}
		endTime, parseErr := time.Parse("2006-01-02", endStr)
		if parseErr != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "invalid end date format, expected YYYY-MM-DD")
		}
		// endTime 设为当天 23:59:59,包含整天
		endTime = endTime.Add(24*time.Hour - time.Second)

		rows, err = handler.store.DB().QueryContext(
			c.Request().Context(),
			`SELECT id, title, start_time, end_time, location, created_at, updated_at
			 FROM schedules
			 WHERE user_id = ? AND start_time >= ? AND start_time <= ?
			 ORDER BY start_time ASC`,
			userID, startTime, endTime,
		)
	} else {
		// 不带过滤,返回全部日程
		rows, err = handler.store.DB().QueryContext(
			c.Request().Context(),
			`SELECT id, title, start_time, end_time, location, created_at, updated_at
			 FROM schedules
			 WHERE user_id = ?
			 ORDER BY start_time ASC`,
			userID,
		)
	}

	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to query schedules")
	}
	defer rows.Close()

	schedules := make([]ScheduleSummary, 0)
	for rows.Next() {
		var record scheduleRecord
		if err := rows.Scan(&record.ID, &record.Title, &record.StartTime, &record.EndTime, &record.Location, &record.CreatedAt, &record.UpdatedAt); err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "failed to read schedule")
		}
		schedules = append(schedules, record.summary())
	}
	if err := rows.Err(); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read schedules")
	}

	return c.JSON(http.StatusOK, map[string]any{
		"schedules": schedules,
	})
}

// CreateSchedule POST /api/v1/schedules
func (handler *Handler) CreateSchedule(c echo.Context) error {
	userID, ok := middleware.EchoCurrentUserID(c)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "missing authenticated user")
	}

	var request CreateScheduleRequest
	if err := c.Bind(&request); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid json body")
	}

	request.normalize()
	if request.Title == "" || request.StartTime == "" || request.EndTime == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "title, start_time and end_time are required")
	}

	startTime, err := time.Parse(time.RFC3339, request.StartTime)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid start_time format, expected RFC3339")
	}

	endTime, err := time.Parse(time.RFC3339, request.EndTime)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid end_time format, expected RFC3339")
	}

	if endTime.Before(startTime) {
		return echo.NewHTTPError(http.StatusBadRequest, "end_time must be after start_time")
	}

	result, err := handler.store.DB().ExecContext(
		c.Request().Context(),
		`INSERT INTO schedules (user_id, title, description, start_time, end_time, location)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		userID,
		request.Title,
		nullableString(request.Description),
		startTime,
		endTime,
		nullableString(request.Location),
	)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to create schedule")
	}

	scheduleID, err := result.LastInsertId()
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read created schedule")
	}

	detail, err := handler.findScheduleDetail(c.Request().Context(), userID, scheduleID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read created schedule")
	}

	return c.JSON(http.StatusCreated, detail)
}

// GetSchedule GET /api/v1/schedules/:id
func (handler *Handler) GetSchedule(c echo.Context) error {
	userID, ok := middleware.EchoCurrentUserID(c)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "missing authenticated user")
	}

	scheduleID, err := parseScheduleID(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "schedule not found")
	}

	detail, err := handler.findScheduleDetail(c.Request().Context(), userID, scheduleID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return echo.NewHTTPError(http.StatusNotFound, "schedule not found")
		}
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read schedule")
	}

	return c.JSON(http.StatusOK, detail)
}

// UpdateSchedule PUT /api/v1/schedules/:id
func (handler *Handler) UpdateSchedule(c echo.Context) error {
	userID, ok := middleware.EchoCurrentUserID(c)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "missing authenticated user")
	}

	scheduleID, err := parseScheduleID(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "schedule not found")
	}

	var request UpdateScheduleRequest
	if err := c.Bind(&request); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid json body")
	}

	request.normalize()
	if request.Title == "" || request.StartTime == "" || request.EndTime == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "title, start_time and end_time are required")
	}

	startTime, err := time.Parse(time.RFC3339, request.StartTime)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid start_time format, expected RFC3339")
	}

	endTime, err := time.Parse(time.RFC3339, request.EndTime)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid end_time format, expected RFC3339")
	}

	if endTime.Before(startTime) {
		return echo.NewHTTPError(http.StatusBadRequest, "end_time must be after start_time")
	}

	result, err := handler.store.DB().ExecContext(
		c.Request().Context(),
		`UPDATE schedules
		 SET title = ?, description = ?, start_time = ?, end_time = ?, location = ?
		 WHERE id = ? AND user_id = ?`,
		request.Title,
		nullableString(request.Description),
		startTime,
		endTime,
		nullableString(request.Location),
		scheduleID,
		userID,
	)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to update schedule")
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read updated schedule")
	}
	if rowsAffected == 0 {
		// 没有更新行,检查是日程不存在还是数据没变化
		exists, err := handler.scheduleExists(c.Request().Context(), userID, scheduleID)
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "failed to read updated schedule")
		}
		if !exists {
			return echo.NewHTTPError(http.StatusNotFound, "schedule not found")
		}
	}

	detail, err := handler.findScheduleDetail(c.Request().Context(), userID, scheduleID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read updated schedule")
	}

	return c.JSON(http.StatusOK, detail)
}

// DeleteSchedule DELETE /api/v1/schedules/:id
func (handler *Handler) DeleteSchedule(c echo.Context) error {
	userID, ok := middleware.EchoCurrentUserID(c)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "missing authenticated user")
	}

	scheduleID, err := parseScheduleID(c.Param("id"))
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "schedule not found")
	}

	result, err := handler.store.DB().ExecContext(
		c.Request().Context(),
		`DELETE FROM schedules WHERE id = ? AND user_id = ?`,
		scheduleID,
		userID,
	)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to delete schedule")
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read deleted schedule")
	}
	if rowsAffected == 0 {
		return echo.NewHTTPError(http.StatusNotFound, "schedule not found")
	}

	return c.NoContent(http.StatusNoContent)
}

// findScheduleDetail 查询单条日程详情(含描述)
func (handler *Handler) findScheduleDetail(ctx context.Context, userID int64, scheduleID int64) (ScheduleDetail, error) {
	var record scheduleRecord
	row := handler.store.DB().QueryRowContext(
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

// scheduleExists 检查日程是否存在(用于 UpdateSchedule 的 0 行更新判断)
func (handler *Handler) scheduleExists(ctx context.Context, userID int64, scheduleID int64) (bool, error) {
	var count int
	err := handler.store.DB().QueryRowContext(
		ctx,
		`SELECT COUNT(*) FROM schedules WHERE id = ? AND user_id = ?`,
		scheduleID,
		userID,
	).Scan(&count)
	return count > 0, err
}

// normalize 去除请求字段的首尾空白
func (request *CreateScheduleRequest) normalize() {
	request.Title = strings.TrimSpace(request.Title)
	request.Description = strings.TrimSpace(request.Description)
	request.StartTime = strings.TrimSpace(request.StartTime)
	request.EndTime = strings.TrimSpace(request.EndTime)
	request.Location = strings.TrimSpace(request.Location)
}

func (request *UpdateScheduleRequest) normalize() {
	request.Title = strings.TrimSpace(request.Title)
	request.Description = strings.TrimSpace(request.Description)
	request.StartTime = strings.TrimSpace(request.StartTime)
	request.EndTime = strings.TrimSpace(request.EndTime)
	request.Location = strings.TrimSpace(request.Location)
}

// summary 将数据库记录转换为列表摘要
func (record scheduleRecord) summary() ScheduleSummary {
	return ScheduleSummary{
		ID:        record.ID,
		Title:     record.Title,
		StartTime: record.StartTime,
		EndTime:   record.EndTime,
		Location:  nullStringValue(record.Location),
		CreatedAt: record.CreatedAt,
		UpdatedAt: record.UpdatedAt,
	}
}

// detail 将数据库记录转换为详情
func (record scheduleRecord) detail() ScheduleDetail {
	return ScheduleDetail{
		ID:          record.ID,
		Title:       record.Title,
		Description: nullStringValue(record.Description),
		StartTime:   record.StartTime,
		EndTime:     record.EndTime,
		Location:    nullStringValue(record.Location),
		CreatedAt:   record.CreatedAt,
		UpdatedAt:   record.UpdatedAt,
	}
}

// parseScheduleID 从路径参数解析日程 ID
func parseScheduleID(idText string) (int64, error) {
	scheduleID, err := strconv.ParseInt(idText, 10, 64)
	if err != nil || scheduleID <= 0 {
		return 0, errors.New("invalid schedule id")
	}
	return scheduleID, nil
}

// nullableString 将字符串转为 sql.NullString(空字符串 → NULL)
func nullableString(value string) sql.NullString {
	return sql.NullString{
		String: value,
		Valid:  value != "",
	}
}

// nullStringValue 将 sql.NullString 转为字符串(NULL → 空字符串)
func nullStringValue(value sql.NullString) string {
	if !value.Valid {
		return ""
	}
	return value.String
}
