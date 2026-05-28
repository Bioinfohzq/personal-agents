# Personal Agents

基于 LangChain [`create_agent`](https://docs.langchain.com/oss/python/langchain/agents) 的个人智能体服务，使用 LangGraph 运行时与 `uv` 管理依赖。

## 初始化环境

```bash
uv sync
```

复制环境变量文件：

```bash
cp .env.example .env
```

然后填写 `OPENAI_API_KEY` 与 `MODEL_NAME`（例如 `gpt-4o-mini`，或完整 provider 标识如 `openai:gpt-4o-mini`）。

## 本地运行 LangGraph 服务

```bash
uv run langgraph dev
```

默认会读取 `langgraph.json` 中注册的 `personal_agent` 图（由 `create_agent` 编译导出）。

## 运行测试

```bash
uv run pytest
```
