# Personal Agents API

这是 Personal Agents 的 Go 业务后端，用于承载用户、登录、权限、业务配置和数据库访问等非智能体逻辑。

## 目录结构

```text
api/
├── cmd/server/          # HTTP 服务入口
├── configs/             # 本地配置模板
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

首次本地开发可先复制配置模板：

```bash
cp configs/config.example.yaml configs/config.yaml
```

Windows PowerShell：

```powershell
Copy-Item configs/config.example.yaml configs/config.yaml
```

然后编辑 `configs/config.yaml`，填入本地 MySQL 连接地址。

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

服务启动时会默认尝试读取 `configs/config.yaml`。真实环境变量优先级更高；如果需要指定其他配置文件，可设置 `API_CONFIG_FILE`。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `APP_NAME` | `personal-agents-api` | 服务名 |
| `APP_ENV` | `local` | 运行环境 |
| `API_HOST` | `127.0.0.1` | HTTP 监听地址 |
| `API_PORT` | `8080` | HTTP 监听端口 |
| `DATABASE_DSN` | 空 | MySQL 连接字符串，设置后会覆盖结构化数据库配置 |

MySQL 配置示例：

```yaml
database:
  driver: mysql
  host: 127.0.0.1
  port: 3306
  username: "<mysql_user>"
  password: "<mysql_password>"
  name: "<mysql_database>"
  parse_time: true
  loc: Local
```

当前数据库层会在服务启动时连接 MySQL、执行连通性检查，并自动应用 `migrations/*.up.sql` 中尚未执行过的迁移脚本；如果配置缺失或数据库不可用，服务会启动失败。

## 用户注册与登录

服务启动时会自动创建 `schema_migrations` 表并执行 `migrations/000001_create_users_table.up.sql`，因此不需要手动建 `users` 表。

注册接口：

```text
POST /api/v1/auth/register
```

请求体：

```json
{
  "username": "alice",
  "email": "alice@example.com",
  "password": "your-password"
}
```

注册成功后会写入 `users` 表，并返回 token 和用户信息。

登录接口：

```text
POST /api/v1/auth/login
```

请求体：

```json
{
  "account": "username-or-email",
  "password": "plain-password"
}
```

后端会使用 `bcrypt` 保存密码哈希，不会保存明文密码。
