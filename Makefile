.PHONY: setup dev build clean lint

# 默认目标
all: setup dev

# 1. 环境初始化：安装后端与前端的依赖
setup:
	@echo "=> 安装后端依赖 (uv)..."
	uv sync
	@echo "=> 安装前端依赖 (pnpm)..."
	cd front && pnpm install

# 2. 本地开发：一键启动所有服务
dev:
	@echo "=> 启动本地开发服务 (前/后端)..."
	./start_services.sh

# 3. 生产构建：为部署做准备，构建前端静态文件
build:
	@echo "=> 构建前端静态资源..."
	cd front && pnpm run build
	@echo "前端构建完成，产物位于 front/dist 目录"

# 4. 代码检查
lint:
	@echo "=> 运行前端代码检查..."
	cd front && pnpm run lint || true
	# 后续可以在此添加后端的 ruff / black / mypy 检查

# 5. 清理编译产物与缓存
clean:
	@echo "=> 清理前端构建产物及依赖缓存..."
	rm -rf front/dist
	rm -rf front/node_modules
	@echo "=> 清理后端缓存..."
	rm -rf .venv
	rm -rf __pycache__
	rm -rf .pytest_cache
