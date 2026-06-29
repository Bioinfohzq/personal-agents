# Personal Agents API

这是 Personal Agents 的 Go 业务后端，用于承载用户、登录、权限、业务配置和数据库访问等非智能体逻辑。

## 目录结构

```text
api/
├── cmd/server/          # HTTP 服务入口
├── internal/
│   ├── auth/            # 登录、注册、密码校验
│   ├── config/          # 环境变量配置
│   ├── database/        # 数据库连接与存储入口
│   ├── middleware/      # HTTP 中间件
│   ├── server/          # 路由和服务装配
│   └── user/            # 用户资料相关接口
└── migrations/          # 数据库迁移脚本
```

## 本地启动

```bash
go run ./cmd/server
```

默认监听：

```text
http://127.0.0.1:8080
```

健康检查：

```bash
curl http://127.0.0.1:8080/healthz
```

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `APP_NAME` | `personal-agents-api` | 服务名 |
| `APP_ENV` | `local` | 运行环境 |
| `API_HOST` | `127.0.0.1` | HTTP 监听地址 |
| `API_PORT` | `8080` | HTTP 监听端口 |
| `DATABASE_DSN` | 空 | 后续 MySQL 连接字符串 |

当前数据库层只预留配置入口，不会强制连接 MySQL。等本地 Docker MySQL 确定后，再接入真实驱动、迁移工具和用户表。
