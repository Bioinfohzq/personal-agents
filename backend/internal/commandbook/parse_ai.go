package commandbook

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
	CommandText  string `json:"command_text"`
	Category     string `json:"category"`
	SubCategory  string `json:"sub_category"`
	Introduction string `json:"introduction"`
	Parameters   string `json:"parameters"`
	Scenarios    string `json:"scenarios"`
	Notes        string `json:"notes"`
	ReferenceURL string `json:"reference_url"`
}

const parseAIPrompt = `你是一位命令手册整理助手。请根据用户提供的 AI 解释文本,提取并整理成结构化的命令记录。

要求:
1. title: 命令 + 一句话含义,例如 "tmux - 终端会话复用工具"或 "du - 查看目录/文件磁盘使用情况"。
2. command_text: 给出最典型或最完整的命令示例。
3. sub_category: 命令所属的二级分类,如"文件管理"、"磁盘管理"、"会话管理"、"进程管理"、"网络工具"、"包管理"等,只能是一个短语。
4. introduction: 命令的通用/官方详细介绍,100-300 字。
5. parameters: 参数说明,每行格式"参数|全称|含义"。只提取解释文本中明确提到的参数,没有就不填。例如:
-s|--summarize|只显示每个目标的总大小,不展开子目录明细
-h|--human-readable|人类可读格式(KB/MB/GB)
6. scenarios: 使用场景,多行文本。每个场景占两行:第一行是场景描述(以"场景一：""场景二："等开头),第二行是对应的示例命令。例如:
场景一：查看当前目录总大小
 du -sh .
场景二：查看指定目录多层深度
 du -h --max-depth=1 /var/log
7. notes: 个人理解或记忆要点,从解释文本中提炼最实用的信息。如果没有,可以留空。
8. reference_url: 如果文本中包含官方文档链接,提取出来;否则留空。

只能输出 JSON,不要任何 Markdown 代码块标记,不要额外说明。JSON 字段如下:
{
  "title": "",
  "command_text": "",
  "sub_category": "",
  "introduction": "",
  "parameters": "",
  "scenarios": "",
  "notes": "",
  "reference_url": ""
}

以下是用户提供的 AI 解释文本:`

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

// ParseAI 处理 POST /api/v1/commands/parse-ai
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

	result, err := handler.parseWithLLM(r.Context(), req.RawText)
	if err != nil {
		slog.Error("parse command with llm failed", "error", err)
		writeError(w, http.StatusInternalServerError, "parse failed")
		return
	}

	// 如果用户传了 category,以用户选择为准
	if req.Category != "" {
		if isValidCategory(req.Category) {
			result.Category = req.Category
		}
	}

	writeJSON(w, http.StatusOK, result)
}

func (handler *Handler) parseWithLLM(ctx context.Context, rawText string) (*ParseAIResponse, error) {
	provider, apiKey, model, err := handler.resolveLLM()
	if err != nil {
		return nil, err
	}

	endpoint := "https://api.moonshot.cn/v1/chat/completions"
	if provider == "deepseek" {
		endpoint = "https://api.deepseek.com/chat/completions"
	}

	payload := chatRequest{
		Model: model,
		Messages: []chatMessage{
			{Role: "system", Content: parseAIPrompt},
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

	var result ParseAIResponse
	if err := json.Unmarshal([]byte(content), &result); err != nil {
		return nil, fmt.Errorf("failed to parse llm response: %w, content: %s", err, content)
	}

	result.Title = strings.TrimSpace(result.Title)
	result.CommandText = strings.TrimSpace(result.CommandText)
	result.SubCategory = strings.TrimSpace(result.SubCategory)
	result.Introduction = strings.TrimSpace(result.Introduction)
	result.Parameters = strings.TrimSpace(result.Parameters)
	result.Scenarios = strings.TrimSpace(result.Scenarios)
	result.Notes = strings.TrimSpace(result.Notes)
	result.ReferenceURL = strings.TrimSpace(result.ReferenceURL)

	return &result, nil
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
