package config

import (
	"errors"
	"os"
	"strings"
)

// ProviderConfig 描述一家 OpenAI 兼容 API 提供商的连接信息。
// BaseURL 写死已知地址,可通过 BaseURLEnv 在 .env 中覆盖。
type ProviderConfig struct {
	BaseURL    string
	APIKeyEnv  string
	BaseURLEnv string
}

// PROVIDERS 各厂商的连接配置,与 agent/harness/model_config.py 保持一致。
var PROVIDERS = map[string]ProviderConfig{
	"deepseek": {
		BaseURL:    "https://api.deepseek.com",
		APIKeyEnv:  "DEEPSEEK_API_KEY",
		BaseURLEnv: "DEEPSEEK_BASE_URL",
	},
	"kimi": {
		BaseURL:    "https://api.moonshot.cn/v1",
		APIKeyEnv:  "MOONSHOT_API_KEY",
		BaseURLEnv: "MOONSHOT_BASE_URL",
	},
	"openai": {
		BaseURL:    "https://api.openai.com/v1",
		APIKeyEnv:  "OPENAI_API_KEY",
		BaseURLEnv: "OPENAI_BASE_URL",
	},
	"zhipu": {
		BaseURL:    "",
		APIKeyEnv:  "ZHIPU_API_KEY",
		BaseURLEnv: "ZHIPU_BASE_URL",
	},
	"doubao": {
		BaseURL:    "https://ark.cn-beijing.volces.com/api/v3",
		APIKeyEnv:  "DOUBAO_API_KEY",
		BaseURLEnv: "DOUBAO_BASE_URL",
	},
}

// MODELS 模型注册表:模型名 -> 提供商。
// 与 agent/harness/model_config.py 的 MODELS 表保持一致。
var MODELS = map[string]string{
	// Kimi
	"kimi-k2.7-code":                "kimi",
	"kimi-k2.7-code-highspeed":      "kimi",
	"kimi-k2.6":                     "kimi",
	"kimi-k2.5":                     "kimi",
	"moonshot-v1-8k":                "kimi",
	"moonshot-v1-32k":               "kimi",
	"moonshot-v1-128k":              "kimi",
	"moonshot-v1-8k-vision-preview": "kimi",
	"moonshot-v1-32k-vision-preview": "kimi",
	"moonshot-v1-128k-vision-preview": "kimi",
	// DeepSeek 官方
	"deepseek-v4-flash": "deepseek",
	"deepseek-v4-pro":   "deepseek",
	// 豆包(Volcengine Ark)托管的 DeepSeek 与 doubao 系列
	"deepseek-v4-pro-260425":      "doubao",
	"deepseek-v4-flash-260425":    "doubao",
	"doubao-seed-2-0-lite-260428": "doubao",
}

// ResolvedLLM 是 resolve 之后给业务层使用的连接信息。
type ResolvedLLM struct {
	Provider string
	APIKey   string
	BaseURL  string
	Model    string
}

// ResolveLLM 根据 DefaultModel 在模型注册表中查找 provider,
// 再从环境变量读取对应的 API Key 与 BaseURL。
// 与 agent/harness/model_config.py 的 load_model() 行为一致。
func ResolveLLM(cfg LLMConfig) (ResolvedLLM, error) {
	model := strings.TrimSpace(cfg.DefaultModel)
	if model == "" {
		// 兼容 MODEL_NAME 与 DEFAULT_MODEL 两个变量名
		if v := strings.TrimSpace(os.Getenv("MODEL_NAME")); v != "" {
			model = v
		}
	}
	if model == "" {
		return ResolvedLLM{}, errors.New("DEFAULT_MODEL 或 MODEL_NAME 未配置或为空")
	}

	providerName, ok := MODELS[model]
	if !ok {
		return ResolvedLLM{}, errors.New("未知模型 " + model + "，未在 MODELS 注册表中登记")
	}

	providerCfg, ok := PROVIDERS[providerName]
	if !ok {
		return ResolvedLLM{}, errors.New("未知提供商 " + providerName)
	}

	apiKey := strings.TrimSpace(os.Getenv(providerCfg.APIKeyEnv))
	if apiKey == "" {
		return ResolvedLLM{}, errors.New("未找到 API Key，请设置环境变量 " + providerCfg.APIKeyEnv)
	}

	baseURL := providerCfg.BaseURL
	if providerCfg.BaseURLEnv != "" {
		if override := strings.TrimSpace(os.Getenv(providerCfg.BaseURLEnv)); override != "" {
			baseURL = override
		}
	}
	if baseURL == "" {
		return ResolvedLLM{}, errors.New("提供商 " + providerName + " 的 base_url 未配置，请设置环境变量 " + providerCfg.BaseURLEnv)
	}

	return ResolvedLLM{
		Provider: providerName,
		APIKey:   apiKey,
		BaseURL:  baseURL,
		Model:    model,
	}, nil
}

// ChatEndpoint 拼接 OpenAI 兼容的 chat completions 地址。
func (r ResolvedLLM) ChatEndpoint() string {
	return strings.TrimRight(r.BaseURL, "/") + "/chat/completions"
}
