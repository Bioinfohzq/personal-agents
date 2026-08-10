#!/bin/bash

# 启动 LangGraph Agent 服务 (默认 2024 端口)
echo "启动 LangGraph Agent 服务..."
uv run langgraph dev &
AGENT_PID=$!

# 等待几秒钟让 LangGraph 启动完毕
sleep 3

# 启动 Go 业务后端 (默认 8080 端口)
echo "启动 Go 业务后端服务..."
cd backend
go run ./cmd/server &
BACKEND_PID=$!
cd ..

# 等待后端启动
sleep 2

# 启动 Vite Web 前端服务
echo "启动 Web 前端 Vite 服务..."
cd web
pnpm run dev &
WEB_PID=$!
cd ..

echo ""
echo "✅ 服务已全部启动。"
echo "  Web 前端:        http://localhost:5173"
echo "  业务后端 API:    http://127.0.0.1:8080/healthz"
echo "  LangGraph API:   http://localhost:2024"
echo "  LangGraph Studio: https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:2024"
echo ""
echo "按 Ctrl+C 停止所有服务..."

# 捕获 Ctrl+C 信号并终止所有子进程
trap "echo '正在停止所有服务...'; kill $AGENT_PID $BACKEND_PID $WEB_PID; exit 1" SIGINT

# 保持脚本运行
wait
