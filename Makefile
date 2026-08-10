.PHONY: setup dev backend build clean lint

# 默认目标
all: setup dev

# 1. 环境初始化：安装后端与前端的依赖
setup:
	@echo "=> 安装 agent 依赖 (uv)..."
	uv sync
	@echo "=> 检查 Go backend 依赖..."
	cd backend && go mod download
	@echo "=> 安装前端依赖 (pnpm)..."
	cd web && pnpm install

# 2. 本地开发：一键启动所有服务
dev:
	@echo "=> 启动本地开发服务 (前/后端)..."
	./start_services.sh

# 业务后端：启动 Go 后端服务
backend:
	@echo "=> 启动 Go 业务后端..."
	cd backend && go run ./cmd/server

# 3. 生产构建：为部署做准备，构建前端静态文件
build:
	@echo "=> 构建 Go 业务后端..."
	cd backend && go build -o bin/personal-agents-backend ./cmd/server
	@echo "=> 构建前端静态资源..."
	cd web && pnpm run build
	@echo "前端构建完成，产物位于 web/dist 目录"

# 4. 代码检查
lint:
	@echo "=> 运行代码检查..."
	cd backend && go test ./...
	cd web && pnpm run lint || true
	# 后续可以在此添加 Python 后端的 ruff / black / mypy 检查

# 5. 清理编译产物与缓存
clean:
	@echo "=> 清理前端构建产物及依赖缓存..."
	rm -rf web/dist
	rm -rf web/node_modules
	rm -rf backend/bin
	@echo "=> 清理后端缓存..."
	rm -rf .venv
	rm -rf __pycache__
	rm -rf .pytest_cache
