package schedule

import (
	"database/sql"
	"strconv"
	"strings"
	"time"
)

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
		return 0, strconv.ErrSyntax
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
