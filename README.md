# Personal Agents (AI 助理全栈项目)

这是一个全栈式的个人智能体（AI Assistant）项目。
- **后端**：基于 LangChain `create_agent` 和 LangGraph 构建的 Lead Agent 服务，使用 `uv` 管理 Python 依赖。
- **前端**：基于 React + Vite + Tailwind CSS v4 构建的现代化 Web 交互界面，使用官方 `@langchain/langgraph-sdk` 直连后端，支持打字机流式输出。

## 项目结构

- `/lead_agent`: 核心智能体图结构逻辑（LangGraph）。
- `/front`: React 前端交互项目界面。
- `langgraph.json`: LangGraph 服务的配置文件。
- `Makefile` & `start_services.sh`: 项目脚手架与一键启停管理脚本。

## 快速开始

### 1. 准备工作

确保您的本地开发环境已经安装了：
- `uv` (Python 现代包管理器)
- `pnpm` (Node.js 现代包管理器)

### 2. 环境初始化

执行一键初始化命令（会自动为您安装后端的 Python 依赖和前端的 Node 包）：
```bash
make setup
```

配置环境变量：
```bash
cp .env.example .env
```
然后编辑 `.env` 文件，填写您的 `DEFAULT_MODEL` 以及各提供商的 API Key（如 `DEEPSEEK_API_KEY`、`MOONSHOT_API_KEY` 等）。模型配置及 Base URL 修改见 `lead_agent/model_config.py`。

### 3. 一键启动本地开发环境

执行以下命令，将同时拉起 LangGraph 官方 API 后端服务与 Vite 前端测试服务：
```bash
make dev
```

启动成功后，您可以通过以下地址访问：
- **前端 AI 助理界面**: [http://localhost:5173](http://localhost:5173)
- **后端 LangGraph API**: [http://localhost:2024](http://localhost:2024)
- **LangGraph Studio UI**: [https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:2024](https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:2024)

## 其他开发命令

我们通过项目根目录的 `Makefile` 提供了统一的操作入口：

- `make build`: 构建前端生产环境静态资源 (打包产物输出至 `front/dist` 目录)。
- `make lint`: 运行前端代码检查。
- `make clean`: 一键清理前后端的缓存目录和构建产物（包含 `node_modules`, `.venv`, `__pycache__`, `dist` 等）。