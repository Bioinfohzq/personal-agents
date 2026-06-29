# Personal Agents (AI 助理全栈项目)

这是一个全栈式的个人智能体（AI Assistant）项目。
- **后端**：基于 LangChain `create_agent` 和 LangGraph 构建的 Lead Agent 服务，使用 `uv` 管理 Python 依赖。
- **前端**：基于 React + Vite + Tailwind CSS v4 构建的现代化 Web 交互界面，使用官方 `@langchain/langgraph-sdk` 直连后端，支持打字机流式输出。

## 项目结构

- `/lead_agent`: 核心智能体图结构逻辑（LangGraph）。
- `/front`: React 前端交互项目界面。
- `/desktop`: 基于 React + TypeScript + Tauri 2 的桌面客户端，默认连接本机 LangGraph API。
- `langgraph.json`: LangGraph 服务的配置文件。
- `Makefile` & `start_services.sh`: macOS/Linux 下的项目脚手架与一键启停管理脚本。
- `.vscode/launch.json`: VS Code 调试配置，包含 Windows 下启动 LangGraph 后端的配置。

## 快速开始

### 1. 准备工作

确保您的本地开发环境已经安装了：
- `uv` (Python 现代包管理器)
- `pnpm` (Node.js 现代包管理器)

### 2. 环境初始化

macOS/Linux 可执行一键初始化命令（会自动为您安装后端的 Python 依赖和前端的 Node 包）：
```bash
make setup
```

Windows PowerShell 可分别执行：
```powershell
uv sync
cd front
pnpm install
cd ..
```

配置环境变量：
```bash
cp .env.example .env
```
Windows PowerShell 可执行：
```powershell
Copy-Item .env.example .env
```
然后编辑 `.env` 文件，填写您的 `DEFAULT_MODEL` 以及各提供商的 API Key（如 `DEEPSEEK_API_KEY`、`MOONSHOT_API_KEY` 等）。模型配置及 Base URL 修改见 `lead_agent/model_config.py`。

### 3. 启动本地开发环境

#### macOS/Linux

执行以下命令，将同时拉起 LangGraph 官方 API 后端服务与 Vite 前端测试服务：
```bash
make dev
```
该命令会调用 Bash 脚本 `start_services.sh`。原生 Windows PowerShell 通常不能直接执行该脚本；如需在 Windows 执行 Bash 脚本，请使用 Git Bash 或 WSL。

#### Windows PowerShell / VS Code

在 VS Code 的“运行和调试”中选择 `LangGraph: dev server (Windows)` 启动后端服务。

然后新开一个 PowerShell 终端启动前端：
```powershell
cd front
pnpm run dev
```

启动成功后，您可以通过以下地址访问：
- **前端 AI 助理界面**: [http://localhost:5173](http://localhost:5173)
- **后端 LangGraph API**: [http://localhost:2024](http://localhost:2024)
- **LangGraph Studio UI**: [https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:2024](https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:2024)

## 其他开发命令

macOS/Linux 可通过项目根目录的 `Makefile` 使用统一操作入口：

- `make build`: 构建前端生产环境静态资源 (打包产物输出至 `front/dist` 目录)。
- `make lint`: 运行前端代码检查。
- `make clean`: 一键清理前后端的缓存目录和构建产物（包含 `node_modules`, `.venv`, `__pycache__`, `dist` 等）。

Windows PowerShell 下可直接执行对应命令：
```powershell
cd front
pnpm run build
pnpm run lint
```

## 桌面客户端

桌面端位于 `desktop/`，是一个独立的 React + Vite + Tauri 2 应用。第一版默认连接 `http://localhost:2024` 的 LangGraph 服务，并使用 `lead_agent` 作为 assistant id。依赖管理统一使用 `pnpm`，不要在 `desktop/` 下混用 `npm install` 或 `yarn`。

### 桌面端环境要求

桌面客户端基于 Tauri 2，因此**开发、调试和打包桌面应用时，本机必须安装 Rust/Cargo 环境**。只运行 Web 前端不需要 Rust；执行 `pnpm run tauri:dev` 或 `pnpm run tauri:build` 时需要 Rust。

macOS 可先安装 Xcode Command Line Tools：
```bash
xcode-select --install
```

然后安装 Rust：
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

安装后重新打开终端，确认 Cargo 可用：
```bash
cargo --version
```

macOS 自带 WebKit/WebView 能力，通常不需要额外安装 WebView 运行时。打包 `.dmg` 或签名、公证时，还需要根据 Apple 分发方式配置证书和开发者账号。

Windows 可先安装 Rust：
```powershell
winget install Rustlang.Rustup
```

安装后新开一个终端，确认 Cargo 可用：
```powershell
cargo --version
```

Windows 打包 Tauri 应用还需要 Visual Studio Build Tools，并勾选“使用 C++ 的桌面开发”。Windows 10/11 通常已内置 WebView2 Runtime，如缺失需从微软官方安装。

首次安装依赖：
```powershell
cd desktop
pnpm install
```

开发时先启动 LangGraph 后端，再启动桌面客户端：
```powershell
# 在项目根目录启动 LangGraph 服务
uv run langgraph dev

# 新开终端启动桌面客户端
cd desktop
pnpm run tauri:dev
```

如果需要覆盖服务地址或 assistant id，可在启动前设置环境变量：
```powershell
$env:VITE_LANGGRAPH_API_URL = "http://localhost:2024"
$env:VITE_LANGGRAPH_ASSISTANT_ID = "lead_agent"
pnpm run tauri:dev
```

生产构建：
```powershell
cd desktop
pnpm run tauri:build
```