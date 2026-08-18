package knowledgebook

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// ParseAIRequest AI 解释文本解析请求
type ParseAIRequest struct {
	RawText  string `json:"raw_text"`
	Category string `json:"category"`
}

// ParseAIResponse AI 解析结果
type ParseAIResponse struct {
	Title        string `json:"title"`
	Category     string `json:"category"`
	SubCategory  string `json:"sub_category"`
	Tags         string `json:"tags"`
	Summary      string `json:"summary"`
	Content      string `json:"content"`
	Notes        string `json:"notes"`
	ReferenceURL string `json:"reference_url"`
	Extra        string `json:"extra"`
}

const baseParseAIPrompt = `你是一位知识库整理助手。请根据用户提供的 AI 解释文本,提取并整理成结构化的知识记录。

通用字段要求:
1. title: 标题 + 一句话说明,如 "~/Library/Caches - macOS 应用临时缓存目录"。
2. sub_category: 二级分类,只能是一个短语。如 "macOS"、"Linux"、"CPU"、"排序算法"。
3. tags: 标签,多个标签用逗号分隔,如 "缓存,清理,系统目录"。
4. summary: 50 字以内的核心要点。
5. content: 详细介绍,100-400 字。
6. notes: 个人理解或记忆要点,从解释文本中提炼最实用的信息。如果没有,可以留空。
7. reference_url: 如果文本中包含官方文档/教程链接,提取出来;否则留空。
8. extra: JSON 对象,内容根据 category 类型决定(见下方)。

只能输出 JSON,不要任何 Markdown 代码块标记,不要额外说明。JSON 字段如下:
{
  "title": "",
  "sub_category": "",
  "tags": "",
  "summary": "",
  "content": "",
  "notes": "",
  "reference_url": "",
  "extra": {}
}`

const systemPathExtraPrompt = `
当前 category 为 "system-path"(系统文件层级)。extra 字段要求:
- path: 完整路径,如 "~/Library/Caches"
- parent_path: 父级路径,如 "~/Library"
- risk_level: 清理风险等级,只能是 "safe"(安全)/"caution"(谨慎)/"danger"(危险) 之一
- can_cleanup: true/false,表示是否可以清理
- cleanup_command: 安全清理方式或命令,不能清理则留空
- related_paths: 相关路径数组,如 ["~/Library/Application Support", "/var/log"]

示例 extra:
{
  "path": "~/Library/Caches",
  "parent_path": "~/Library",
  "risk_level": "safe",
  "can_cleanup": true,
  "cleanup_command": "rm -rf ~/Library/Caches/*",
  "related_paths": ["~/Library/Application Support"]
}`

const urlResourceExtraPrompt = `
当前 category 为 "url-resource"(URL 资源)。extra 字段要求:
- url: 资源地址(如果 raw_text 里没有,可留空)
- site_name: 网站/平台名称,如 "MDN Web Docs"
- resource_type: 资源类型,只能是 "文档"/"教程"/"社区"/"工具"/"视频"/"博客" 之一
- language: 语言,如 "中文"/"英文"

示例 extra:
{
  "url": "https://developer.mozilla.org",
  "site_name": "MDN Web Docs",
  "resource_type": "文档",
  "language": "英文"
}`

const hardwareExtraPrompt = `
当前 category 为 "hardware"(硬件知识)。extra 字段要求:
- hardware_type: 硬件类型,如 "CPU"/"GPU"/"内存"/"硬盘"/"主板"/"显示器"
- brand_model: 品牌型号,如 "Apple M3 Pro"
- key_specs: 关键规格数组,每项是 "指标|数值" 格式,如 ["核心数|12", "制程|3nm"]
- use_case: 适用场景,如 "日常办公"/"深度学习"/"游戏"

示例 extra:
{
  "hardware_type": "CPU",
  "brand_model": "Apple M3 Pro",
  "key_specs": ["核心数|12", "制程|3nm", "内存带宽|150 GB/s"],
  "use_case": "日常开发"
}`

const algorithmExtraPrompt = `
当前 category 为 "algorithm"(算法学习)。extra 字段要求:
- difficulty: 难度,只能是 "入门"/"中等"/"进阶" 之一
- algorithm_type: 算法类型,如 "排序"/"搜索"/"动态规划"/"图论"/"贪心"/"回溯"
- language: 示例代码语言,如 "Python"/"Go"/"JavaScript"
- code_example: 代码示例字符串
- time_complexity: 时间复杂度,如 "O(n log n)"
- space_complexity: 空间复杂度,如 "O(n)"

示例 extra:
{
  "difficulty": "入门",
  "algorithm_type": "排序",
  "language": "Python",
  "code_example": "def bubble_sort(arr):\n    for i in range(len(arr)):\n        for j in range(len(arr)-1-i):\n            if arr[j] > arr[j+1]:\n                arr[j], arr[j+1] = arr[j+1], arr[j]\n    return arr",
  "time_complexity": "O(n^2)",
  "space_complexity": "O(1)"
}`

const otherExtraPrompt = `
当前 category 为 "other"(其他)。extra 字段可为空对象 {},也可以根据文本内容自由补充有意义的键值对。`

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Model    string        `json:"model"`
	Messages []chatMessage `json:"messages"`
	Stream   bool          `json:"stream"`
}

type chatChoice struct {
	Message chatMessage `json:"message"`
}

type chatResponse struct {
	Choices []chatChoice `json:"choices"`
}

// ParseAI 处理 POST /api/v1/knowledge/parse-ai
func (handler *Handler) ParseAI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req ParseAIRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	req.RawText = strings.TrimSpace(req.RawText)
	if req.RawText == "" {
		writeError(w, http.StatusBadRequest, "raw_text is required")
		return
	}

	category := strings.TrimSpace(req.Category)
	if category != "" && !validCategories[category] {
		writeError(w, http.StatusBadRequest, "invalid category")
		return
	}

	result, err := handler.parseWithLLM(r.Context(), req.RawText, category)
	if err != nil {
		slog.Error("parse knowledge with llm failed", "error", err)
		writeError(w, http.StatusInternalServerError, "parse failed")
		return
	}

	// 如果用户传了 category,以用户选择为准
	if category != "" {
		result.Category = category
	}

	writeJSON(w, http.StatusOK, result)
}

func (handler *Handler) parseWithLLM(ctx context.Context, rawText string, category string) (*ParseAIResponse, error) {
	provider, apiKey, model, err := handler.resolveLLM()
	if err != nil {
		return nil, err
	}

	endpoint := "https://api.moonshot.cn/v1/chat/completions"
	if provider == "deepseek" {
		endpoint = "https://api.deepseek.com/chat/completions"
	}

	prompt := buildParsePrompt(category)

	payload := chatRequest{
		Model: model,
		Messages: []chatMessage{
			{Role: "system", Content: prompt},
			{Role: "user", Content: rawText},
		},
		Stream: false,
	}

	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("llm api returned %d: %s", resp.StatusCode, string(respBody))
	}

	var chatResp chatResponse
	if err := json.Unmarshal(respBody, &chatResp); err != nil {
		return nil, err
	}

	if len(chatResp.Choices) == 0 {
		return nil, errors.New("llm api returned no choices")
	}

	content := chatResp.Choices[0].Message.Content
	content = strings.TrimSpace(content)
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimPrefix(content, "```")
	content = strings.TrimSuffix(content, "```")
	content = strings.TrimSpace(content)

	// LLM 返回的 extra 是 JSON object，先用 RawMessage 接收再转成字符串
	var rawResult struct {
		Title        string          `json:"title"`
		Category     string          `json:"category"`
		SubCategory  string          `json:"sub_category"`
		Tags         string          `json:"tags"`
		Summary      string          `json:"summary"`
		Content      string          `json:"content"`
		Notes        string          `json:"notes"`
		ReferenceURL string          `json:"reference_url"`
		Extra        json.RawMessage `json:"extra"`
	}
	if err := json.Unmarshal([]byte(content), &rawResult); err != nil {
		return nil, fmt.Errorf("failed to parse llm response: %w, content: %s", err, content)
	}

	result := &ParseAIResponse{
		Title:        strings.TrimSpace(rawResult.Title),
		Category:     strings.TrimSpace(rawResult.Category),
		SubCategory:  strings.TrimSpace(rawResult.SubCategory),
		Tags:         strings.TrimSpace(rawResult.Tags),
		Summary:      strings.TrimSpace(rawResult.Summary),
		Content:      strings.TrimSpace(rawResult.Content),
		Notes:        strings.TrimSpace(rawResult.Notes),
		ReferenceURL: strings.TrimSpace(rawResult.ReferenceURL),
		Extra:        strings.TrimSpace(string(rawResult.Extra)),
	}

	// 如果 LLM 没返回 category,默认用用户选择的 category,否则 other
	if result.Category == "" {
		if validCategories[category] {
			result.Category = category
		} else {
			result.Category = "other"
		}
	}

	// 如果 extra 是空对象 {},直接置空字符串,减少存储噪音
	if result.Extra == "{}" {
		result.Extra = ""
	}

	return result, nil
}

func buildParsePrompt(category string) string {
	var extraPrompt string
	switch category {
	case "system-path":
		extraPrompt = systemPathExtraPrompt
	case "url-resource":
		extraPrompt = urlResourceExtraPrompt
	case "hardware":
		extraPrompt = hardwareExtraPrompt
	case "algorithm":
		extraPrompt = algorithmExtraPrompt
	default:
		extraPrompt = otherExtraPrompt
	}

	return baseParseAIPrompt + extraPrompt
}

func (handler *Handler) resolveLLM() (provider string, apiKey string, model string, err error) {
	model = strings.ToLower(strings.TrimSpace(handler.llm.DefaultModel))

	switch {
	case strings.Contains(model, "kimi") || strings.Contains(model, "moonshot"):
		if handler.llm.MoonshotAPIKey == "" {
			return "", "", "", errors.New("moonshot api key not configured")
		}
		return "moonshot", handler.llm.MoonshotAPIKey, mapMoonshotModel(model), nil

	case strings.Contains(model, "deepseek"):
		if handler.llm.DeepseekAPIKey == "" {
			return "", "", "", errors.New("deepseek api key not configured")
		}
		return "deepseek", handler.llm.DeepseekAPIKey, "deepseek-chat", nil

	default:
		if handler.llm.MoonshotAPIKey != "" {
			return "moonshot", handler.llm.MoonshotAPIKey, "kimi-k2-5-latest", nil
		}
		if handler.llm.DeepseekAPIKey != "" {
			return "deepseek", handler.llm.DeepseekAPIKey, "deepseek-chat", nil
		}
		return "", "", "", errors.New("no llm api key configured")
	}
}

func mapMoonshotModel(model string) string {
	if model == "" {
		return "kimi-k2-5-latest"
	}

	switch model {
	case "kimi-k2.5":
		return "kimi-k2-5-latest"
	case "kimi-k2.6":
		return "kimi-k2-6-latest"
	case "kimi-k2.7-code":
		return "kimi-k2-7-code-latest"
	case "kimi-k2.7-code-highspeed":
		return "kimi-k2-7-code-high-speed-latest"
	case "moonshot-v1-8k":
		return "moonshot-v1-8k"
	case "moonshot-v1-32k":
		return "moonshot-v1-32k"
	case "moonshot-v1-128k":
		return "moonshot-v1-128k"
	case "moonshot-v1-8k-vision-preview":
		return "moonshot-v1-8k-vision-preview"
	case "moonshot-v1-32k-vision-preview":
		return "moonshot-v1-32k-vision-preview"
	case "moonshot-v1-128k-vision-preview":
		return "moonshot-v1-128k-vision-preview"
	default:
		return model
	}
}
