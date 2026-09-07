package search

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"
	"github.com/pgvector/pgvector-go"

	"personal-agents/backend/internal/database"
	"personal-agents/backend/internal/embed"
	"personal-agents/backend/internal/middleware"
)

// Result 统一搜索结果
type Result struct {
	Type       string  `json:"type"`       // knowledge / memory / message / command
	ID         int64   `json:"id"`         // 源记录ID
	Title      string  `json:"title"`      // 标题(知识条目标题/记忆分类等)
	Content    string  `json:"content"`    // 内容摘要(截断后)
	Similarity float64 `json:"similarity"` // 相似度 0~1
}

// Handler 全局搜索处理器
type Handler struct {
	store       *database.Store
	embedClient *embed.Client
	internalKey string
}

func NewHandler(store *database.Store, embedClient *embed.Client, internalKey string) *Handler {
	return &Handler{store: store, embedClient: embedClient, internalKey: internalKey}
}

// Search GET /api/v1/search (JWT鉴权,前端调用)
// 参数:
//
//	?q=xxx     搜索query(必填)
//	?limit=5   返回条数,默认5,最大20
func (h *Handler) Search(c echo.Context) error {
	userID, ok := middleware.EchoCurrentUserID(c)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "missing authenticated user")
	}

	query := strings.TrimSpace(c.QueryParam("q"))
	if query == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "q parameter is required")
	}

	limit := parseLimit(c.QueryParam("limit"))

	results, err := h.searchAll(c.Request().Context(), userID, query, limit)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "search failed: "+err.Error())
	}

	return c.JSON(http.StatusOK, map[string]any{
		"query":   query,
		"results": results,
	})
}

// InternalSearch GET /api/v1/internal/search (X-Internal-Key鉴权,Agent调用)
// 参数:
//
//	?q=xxx       搜索query(必填)
//	?user_id=1   用户ID(必填)
//	?limit=5     返回条数,默认5,最大20
func (h *Handler) InternalSearch(c echo.Context) error {
	// 校验internal key
	if c.Request().Header.Get("X-Internal-Key") != h.internalKey {
		return echo.NewHTTPError(http.StatusUnauthorized, "invalid internal key")
	}

	query := strings.TrimSpace(c.QueryParam("q"))
	if query == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "q parameter is required")
	}

	userIDStr := strings.TrimSpace(c.QueryParam("user_id"))
	if userIDStr == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "user_id parameter is required")
	}
	userID, err := strconv.ParseInt(userIDStr, 10, 64)
	if err != nil || userID <= 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid user_id")
	}

	limit := parseLimit(c.QueryParam("limit"))

	results, err := h.searchAll(c.Request().Context(), userID, query, limit)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "search failed: "+err.Error())
	}

	return c.JSON(http.StatusOK, map[string]any{
		"query":   query,
		"results": results,
	})
}

func parseLimit(s string) int {
	limit := 5
	if ls := strings.TrimSpace(s); ls != "" {
		if n, err := strconv.Atoi(ls); err == nil && n > 0 && n <= 20 {
			limit = n
		}
	}
	return limit
}

// searchAll 跨类型搜索,当前只查知识条目,后续扩展记忆/消息时加UNION分支即可
func (h *Handler) searchAll(ctx context.Context, userID int64, query string, limit int) ([]Result, error) {
	// 1. 生成query向量
	emb, err := h.embedClient.Embed(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("embed query: %w", err)
	}
	queryVec := pgvector.NewVector(emb)

	// 2. 查向量表, JOIN对应源表拿内容
	//    当前只支持knowledge类型;以后加memory/message时在下面加UNION ALL分支即可
	const similarityThreshold = 0.2
	rows, err := h.store.QueryContext(ctx, `
		SELECT 
			'knowledge' AS type,
			k.id,
			k.title,
			LEFT(COALESCE(k.summary, '') || E'\n' || COALESCE(k.content, ''), 500) AS content,
			1 - (e.embedding <=> ?) AS similarity
		FROM embeddings e
		JOIN knowledge_items k ON k.id = e.source_id
		WHERE e.user_id = ? AND e.source_type = 'knowledge'
		  AND 1 - (e.embedding <=> ?) > ?
		ORDER BY e.embedding <=> ?
		LIMIT ?
	`, queryVec, userID, queryVec, similarityThreshold, queryVec, limit)
	if err != nil {
		return nil, fmt.Errorf("query embeddings: %w", err)
	}
	defer rows.Close()

	var results []Result
	for rows.Next() {
		var r Result
		if err := rows.Scan(&r.Type, &r.ID, &r.Title, &r.Content, &r.Similarity); err != nil {
			return nil, fmt.Errorf("scan row: %w", err)
		}
		r.Similarity = math.Round(r.Similarity*1000) / 1000
		results = append(results, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return results, nil
}
