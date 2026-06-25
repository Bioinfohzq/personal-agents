# Lead Agent

基于 LangChain [`create_agent`](https://docs.langchain.com/oss/python/langchain/agents) 的 Lead Agent 服务，使用 LangGraph 运行时与 `uv` 管理依赖。

## 初始化环境

```bash
uv sync
```

复制环境变量文件：

```bash
cp .env.example .env
```

然后填写 `DEFAULT_MODEL` 与各提供商的 API Key（如 `DEEPSEEK_API_KEY`、`MOONSHOT_API_KEY`）。模型注册与 base_url 见 `lead_agent/model_config.py`。

## 本地运行 LangGraph 服务

```bash
uv run langgraph dev
```

默认会读取 `langgraph.json` 中注册的 `lead_agent` 图（由 `create_agent` 编译导出）。
