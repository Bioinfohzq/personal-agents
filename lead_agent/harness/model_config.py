import os
from dataclasses import dataclass
from typing import Any

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

load_dotenv()


@dataclass(frozen=True)
class ProviderConfig:
    """OpenAI 兼容 API 提供商配置。"""

    base_url: str
    api_key_env: str
    base_url_env: str | None = None


# 各提供商 base_url；已知地址写死，可通过 base_url_env 在 .env 中覆盖。
PROVIDERS: dict[str, ProviderConfig] = {
    "deepseek": ProviderConfig(
        base_url="https://api.deepseek.com",
        api_key_env="DEEPSEEK_API_KEY",
        base_url_env="DEEPSEEK_BASE_URL",
    ),
    "kimi": ProviderConfig(
        base_url="https://api.moonshot.cn/v1",
        api_key_env="MOONSHOT_API_KEY",
        base_url_env="MOONSHOT_BASE_URL",
    ),
    "openai": ProviderConfig(
        base_url="https://api.openai.com/v1",
        api_key_env="OPENAI_API_KEY",
        base_url_env="OPENAI_BASE_URL",
    ),
    "zhipu": ProviderConfig(
        base_url="",
        api_key_env="ZHIPU_API_KEY",
        base_url_env="ZHIPU_BASE_URL",
    ),
    "doubao": ProviderConfig(
        base_url="",
        api_key_env="DOUBAO_API_KEY",
        base_url_env="DOUBAO_BASE_URL",
    ),
}

# 模型注册表：API 模型名 -> 提供商。
# Kimi 模型列表: https://platform.kimi.com/docs
MODELS: dict[str, str] = {
    # Kimi 多模态模型
    "kimi-k2.7-code": "kimi",
    "kimi-k2.7-code-highspeed": "kimi",
    "kimi-k2.6": "kimi",
    "kimi-k2.5": "kimi",
    # Moonshot V1 生成模型
    "moonshot-v1-8k": "kimi",
    "moonshot-v1-32k": "kimi",
    "moonshot-v1-128k": "kimi",
    "moonshot-v1-8k-vision-preview": "kimi",
    "moonshot-v1-32k-vision-preview": "kimi",
    "moonshot-v1-128k-vision-preview": "kimi",
    # DeepSeek 官方 API 模型
    # https://api.deepseek.com (OpenAI 兼容)
    "deepseek-v4-flash": "deepseek",
    "deepseek-v4-pro": "deepseek",
    # 将于 2026/07/24 弃用
    "deepseek-chat": "deepseek",
    "deepseek-reasoner": "deepseek",
}


def get_default_model_key() -> str:
    model_key = os.getenv("DEFAULT_MODEL") or os.getenv("MODEL_NAME", "")
    if not model_key:
        raise ValueError("DEFAULT_MODEL 或 MODEL_NAME 未配置或为空")
    return model_key


def _resolve_base_url(provider_cfg: ProviderConfig) -> str:
    env_name = provider_cfg.base_url_env
    if env_name:
        override = os.getenv(env_name, "").strip()
        if override:
            return override
    if provider_cfg.base_url:
        return provider_cfg.base_url
    env_hint = env_name or "base_url"
    raise ValueError(
        f"提供商 {provider_cfg.api_key_env} 的 base_url 未配置，"
        f"请设置环境变量 {env_hint}"
    )


def _resolve_api_key(provider_cfg: ProviderConfig) -> str:
    api_key = os.getenv(provider_cfg.api_key_env, "").strip()
    if not api_key:
        raise ValueError(
            f"未找到 API Key，请设置环境变量 {provider_cfg.api_key_env}"
        )
    return api_key


def _lookup_provider(model_name: str) -> ProviderConfig:
    provider = MODELS.get(model_name)
    if provider is None:
        known = ", ".join(sorted(MODELS))
        raise KeyError(f"未知模型 {model_name!r}，已注册模型: {known}")
    provider_cfg = PROVIDERS.get(provider)
    if provider_cfg is None:
        raise KeyError(f"未知提供商 {provider!r}")
    return provider_cfg


def load_model(
    model_key: str = "",
    model_kwargs: dict[str, Any] | None = None,
) -> ChatOpenAI:
    """加载 ChatOpenAI 模型实例（base_url + api_key + model）。"""
    model_name = model_key or get_default_model_key()
    provider_cfg = _lookup_provider(model_name)

    chat_kwargs: dict[str, Any] = {
        "model": model_name,
        "api_key": _resolve_api_key(provider_cfg),
        "base_url": _resolve_base_url(provider_cfg),
    }
    if model_kwargs:
        chat_kwargs.update(model_kwargs)

    return ChatOpenAI(**chat_kwargs)
