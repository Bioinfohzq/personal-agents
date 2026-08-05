package schedule

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"personal-agents/api/internal/database"
	"personal-agents/api/internal/middleware"
)

// schedulePathPrefix 日程单条记录的路由前缀
const schedulePathPrefix = "/api/v1/schedules/"

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

// Schedules 处理 /api/v1/schedules 路由(GET 列表 / POST 创建)
func (handler *Handler) Schedules(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		handler.ListSchedules(w, r)
	case http.MethodPost:
		handler.CreateSchedule(w, r)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// Schedule 处理 /api/v1/schedules/{id} 路由(GET / PUT / DELETE)
func (handler *Handler) Schedule(w http.ResponseWriter, r *http.Request) {
	scheduleID, ok := scheduleIDFromPath(r.URL.Path)
	if !ok {
		writeError(w, http.StatusNotFound, "schedule not found")
		return
	}

	switch r.Method {
	case http.MethodGet:
		handler.GetSchedule(w, r, scheduleID)
	case http.MethodPut:
		handler.UpdateSchedule(w, r, scheduleID)
	case http.MethodDelete:
		handler.DeleteSchedule(w, r, scheduleID)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// ListSchedules 查询当前用户的日程列表
// 支持可选 query 参数 ?start=YYYY-MM-DD&end=YYYY-MM-DD 过滤时间范围
func (handler *Handler) ListSchedules(w http.ResponseWriter, r *http.Request) {
	userID, ok := currentUserID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing authenticated user")
		return
	}

	// 解析可选的时间范围过滤参数
	startStr := r.URL.Query().Get("start")
	endStr := r.URL.Query().Get("end")

	var rows *sql.Rows
	var err error

	if startStr != "" && endStr != "" {
		// 带时间范围过滤(日历月视图用:只拉当月日程)
		startTime, parseErr := time.Parse("2006-01-02", startStr)
		if parseErr != nil {
			writeError(w, http.StatusBadRequest, "invalid start date format, expected YYYY-MM-DD")
			return
		}
		endTime, parseErr := time.Parse("2006-01-02", endStr)
		if parseErr != nil {
			writeError(w, http.StatusBadRequest, "invalid end date format, expected YYYY-MM-DD")
			return
		}
		// endTime 设为当天 23:59:59,包含整天
		endTime = endTime.Add(24*time.Hour - time.Second)

		rows, err = handler.store.DB().QueryContext(
			r.Context(),
			`SELECT id, title, start_time, end_time, location, created_at, updated_at
			 FROM schedules
			 WHERE user_id = ? AND start_time >= ? AND start_time <= ?
			 ORDER BY start_time ASC`,
			userID, startTime, endTime,
		)
	} else {
		// 不带过滤,返回全部日程
		rows, err = handler.store.DB().QueryContext(
			r.Context(),
			`SELECT id, title, start_time, end_time, location, created_at, updated_at
			 FROM schedules
			 WHERE user_id = ?
			 ORDER BY start_time ASC`,
			userID,
		)
	}

	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to query schedules")
		return
	}
	defer rows.Close()

	schedules := make([]ScheduleSummary, 0)
	for rows.Next() {
		var record scheduleRecord
		if err := rows.Scan(&record.ID, &record.Title, &record.StartTime, &record.EndTime, &record.Location, &record.CreatedAt, &record.UpdatedAt); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read schedule")
			return
		}
		schedules = append(schedules, record.summary())
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read schedules")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"schedules": schedules,
	})
}

// CreateSchedule 创建日程
func (handler *Handler) CreateSchedule(w http.ResponseWriter, r *http.Request) {
	userID, ok := currentUserID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing authenticated user")
		return
	}

	var request CreateScheduleRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}

	request.normalize()
	if request.Title == "" || request.StartTime == "" || request.EndTime == "" {
		writeError(w, http.StatusBadRequest, "title, start_time and end_time are required")
		return
	}

	startTime, err := time.Parse(time.RFC3339, request.StartTime)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid start_time format, expected RFC3339")
		return
	}

	endTime, err := time.Parse(time.RFC3339, request.EndTime)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid end_time format, expected RFC3339")
		return
	}

	if endTime.Before(startTime) {
		writeError(w, http.StatusBadRequest, "end_time must be after start_time")
		return
	}

	result, err := handler.store.DB().ExecContext(
		r.Context(),
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
		writeError(w, http.StatusInternalServerError, "failed to create schedule")
		return
	}

	scheduleID, err := result.LastInsertId()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read created schedule")
		return
	}

	detail, err := handler.findScheduleDetail(r, userID, scheduleID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read created schedule")
		return
	}

	writeJSON(w, http.StatusCreated, detail)
}

// GetSchedule 获取单条日程详情
func (handler *Handler) GetSchedule(w http.ResponseWriter, r *http.Request, scheduleID int64) {
	userID, ok := currentUserID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing authenticated user")
		return
	}

	detail, err := handler.findScheduleDetail(r, userID, scheduleID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "schedule not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to read schedule")
		return
	}

	writeJSON(w, http.StatusOK, detail)
}

// UpdateSchedule 更新日程
func (handler *Handler) UpdateSchedule(w http.ResponseWriter, r *http.Request, scheduleID int64) {
	userID, ok := currentUserID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing authenticated user")
		return
	}

	var request UpdateScheduleRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}

	request.normalize()
	if request.Title == "" || request.StartTime == "" || request.EndTime == "" {
		writeError(w, http.StatusBadRequest, "title, start_time and end_time are required")
		return
	}

	startTime, err := time.Parse(time.RFC3339, request.StartTime)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid start_time format, expected RFC3339")
		return
	}

	endTime, err := time.Parse(time.RFC3339, request.EndTime)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid end_time format, expected RFC3339")
		return
	}

	if endTime.Before(startTime) {
		writeError(w, http.StatusBadRequest, "end_time must be after start_time")
		return
	}

	result, err := handler.store.DB().ExecContext(
		r.Context(),
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
		writeError(w, http.StatusInternalServerError, "failed to update schedule")
		return
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read updated schedule")
		return
	}
	if rowsAffected == 0 {
		// 没有更新行,检查是日程不存在还是数据没变化
		exists, err := handler.scheduleExists(r, userID, scheduleID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read updated schedule")
			return
		}
		if !exists {
			writeError(w, http.StatusNotFound, "schedule not found")
			return
		}
	}

	detail, err := handler.findScheduleDetail(r, userID, scheduleID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read updated schedule")
		return
	}

	writeJSON(w, http.StatusOK, detail)
}

// DeleteSchedule 删除日程
func (handler *Handler) DeleteSchedule(w http.ResponseWriter, r *http.Request, scheduleID int64) {
	userID, ok := currentUserID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing authenticated user")
		return
	}

	result, err := handler.store.DB().ExecContext(
		r.Context(),
		`DELETE FROM schedules WHERE id = ? AND user_id = ?`,
		scheduleID,
		userID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete schedule")
		return
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read deleted schedule")
		return
	}
	if rowsAffected == 0 {
		writeError(w, http.StatusNotFound, "schedule not found")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// findScheduleDetail 查询单条日程详情(含描述)
func (handler *Handler) findScheduleDetail(r *http.Request, userID int64, scheduleID int64) (ScheduleDetail, error) {
	var record scheduleRecord
	row := handler.store.DB().QueryRowContext(
		r.Context(),
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
func (handler *Handler) scheduleExists(r *http.Request, userID int64, scheduleID int64) (bool, error) {
	var count int
	err := handler.store.DB().QueryRowContext(
		r.Context(),
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

// scheduleIDFromPath 从 URL 路径中解析日程 ID
func scheduleIDFromPath(path string) (int64, bool) {
	idText := strings.TrimPrefix(path, schedulePathPrefix)
	if idText == "" || strings.Contains(idText, "/") {
		return 0, false
	}

	scheduleID, err := strconv.ParseInt(idText, 10, 64)
	if err != nil || scheduleID <= 0 {
		return 0, false
	}

	return scheduleID, true
}

// currentUserID 从请求上下文获取当前用户 ID(由 JWT 中间件注入)
func currentUserID(r *http.Request) (int64, bool) {
	return middleware.CurrentUserID(r)
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
