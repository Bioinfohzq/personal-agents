#!/bin/bash

# 启动 LangGraph Server (官方 API，默认 2024 端口)
echo "启动后台 LangGraph API 服务..."
uv run langgraph dev &
BACKEND_PID=$!

# 等待几秒钟让 LangGraph 启动完毕
sleep 3

# 启动 Vite 前端服务
echo "启动前端 Vite 服务..."
cd front
pnpm run dev &
FRONTEND_PID=$!

echo "服务已全部启动。"
echo "前端地址: http://localhost:5173"
echo "后端地址: http://localhost:2024"
echo "LangGraph Studio UI: https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:2024"
echo "按 Ctrl+C 停止所有服务..."

# 捕获 Ctrl+C 信号并终止所有子进程
trap "echo '正在停止服务...'; kill $BACKEND_PID $FRONTEND_PID; exit 1" SIGINT

# 保持脚本运行
wait
