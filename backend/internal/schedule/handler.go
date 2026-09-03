package schedule

import (
	"database/sql"
	"errors"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"

	"personal-agents/backend/internal/database"
	"personal-agents/backend/internal/middleware"
)

// Handler 日程 HTTP 处理器
type Handler struct {
	store *Store
}

// NewHandler 创建日程处理器
func NewHandler(store *database.Store) *Handler {
	return &Handler{store: NewStore(store)}
}

// ListSchedules GET /api/v1/schedules
// 支持可选 query 参数 ?start=YYYY-MM-DD&end=YYYY-MM-DD 过滤时间范围
func (handler *Handler) ListSchedules(c echo.Context) error {
	userID, ok := middleware.EchoCurrentUserID(c)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "missing authenticated user")
	}

	// 解析可选的时间范围过滤参数(零值表示不过滤)
	var startTime, endTime time.Time
	startStr := c.QueryParam("start")
	endStr := c.QueryParam("end")
	if startStr != "" && endStr != "" {
		var parseErr error
		startTime, parseErr = time.Parse("2006-01-02", startStr)
		if parseErr != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "invalid start date format, expected YYYY-MM-DD")
		}
		endTime, parseErr = time.Parse("2006-01-02", endStr)
		if parseErr != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "invalid end date format, expected YYYY-MM-DD")
		}
		// endTime 设为当天 23:59:59,包含整天
		endTime = endTime.Add(24*time.Hour - time.Second)
	}

	schedules, err := handler.store.List(c.Request().Context(), userID, startTime, endTime)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to query schedules")
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

	startTime, endTime, err := validateScheduleFields(request.Title, request.StartTime, request.EndTime)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	scheduleID, err := handler.store.Create(c.Request().Context(), userID, request.Title, request.Description, startTime, endTime, request.Location)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to create schedule")
	}

	detail, err := handler.store.FindDetail(c.Request().Context(), userID, scheduleID)
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

	detail, err := handler.store.FindDetail(c.Request().Context(), userID, scheduleID)
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

	startTime, endTime, err := validateScheduleFields(request.Title, request.StartTime, request.EndTime)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	rowsAffected, err := handler.store.Update(c.Request().Context(), userID, scheduleID, request.Title, request.Description, startTime, endTime, request.Location)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to update schedule")
	}

	if rowsAffected == 0 {
		// 没有更新行,检查是日程不存在还是数据没变化
		exists, err := handler.store.Exists(c.Request().Context(), userID, scheduleID)
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "failed to read updated schedule")
		}
		if !exists {
			return echo.NewHTTPError(http.StatusNotFound, "schedule not found")
		}
	}

	detail, err := handler.store.FindDetail(c.Request().Context(), userID, scheduleID)
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

	rowsAffected, err := handler.store.Delete(c.Request().Context(), userID, scheduleID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to delete schedule")
	}
	if rowsAffected == 0 {
		return echo.NewHTTPError(http.StatusNotFound, "schedule not found")
	}

	return c.NoContent(http.StatusNoContent)
}

// validateScheduleFields 校验创建/更新请求的公共字段:必填、时间格式、结束晚于开始
func validateScheduleFields(title, startText, endText string) (time.Time, time.Time, error) {
	if title == "" || startText == "" || endText == "" {
		return time.Time{}, time.Time{}, errors.New("title, start_time and end_time are required")
	}

	startTime, err := time.Parse(time.RFC3339, startText)
	if err != nil {
		return time.Time{}, time.Time{}, errors.New("invalid start_time format, expected RFC3339")
	}

	endTime, err := time.Parse(time.RFC3339, endText)
	if err != nil {
		return time.Time{}, time.Time{}, errors.New("invalid end_time format, expected RFC3339")
	}

	if endTime.Before(startTime) {
		return time.Time{}, time.Time{}, errors.New("end_time must be after start_time")
	}

	return startTime, endTime, nil
}
