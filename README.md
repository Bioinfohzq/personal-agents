# Personal Agents

基于 LangGraph 的最小智能体服务骨架，使用 `uv` 管理 Python 环境和依赖。

## 初始化环境

```bash
uv sync
```

复制环境变量文件：

```bash
cp .env.example .env
```

然后填写 `OPENAI_API_KEY`。

## 本地运行 LangGraph 服务

```bash
uv run langgraph dev
```

默认会读取 `langgraph.json` 中注册的 `personal_agent` 图。

## 运行测试

```bash
uv run pytest
```
