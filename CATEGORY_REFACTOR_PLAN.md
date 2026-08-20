# 分类系统重构技术方案

## 1. 核心目标

将 knowledge_items 和 commands 表中的 `category` 字符串字段，重构为独立的 `categories` 表，通过 `category_id` 外键关联。

**原因：**
- 原设计：分类名直接存储在记录中（字符串），重命名需要批量迁移所有记录
- 新设计：分类独立成表，重命名只需更新一条记录

## 2. 数据库表结构

### categories 表

```sql
CREATE TABLE categories (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NULL,              -- NULL = 系统固定分类, NOT NULL = 用户自定义
  scope VARCHAR(32) NOT NULL,       -- 'knowledge' | 'command'
  name VARCHAR(64) NOT NULL,        -- 显示名称: "系统文件层级"
  slug VARCHAR(64) NOT NULL,        -- 标识符: "system-path"
  is_fixed BOOLEAN DEFAULT FALSE,   -- 固定分类不可删除/重命名
  sort_order INT DEFAULT 0,         -- 排序权重
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  UNIQUE KEY (scope, user_id, slug)
);
```

### 固定分类数据

**knowledge 作用域：**
| name | slug | sort_order |
|------|------|------------|
| 系统文件层级 | system-path | 1 |
| URL 资源 | url-resource | 2 |
| 硬件知识 | hardware | 3 |
| 算法学习 | algorithm | 4 |
| 其他 | other | 99 |

**command 作用域：**
| name | slug | sort_order |
|------|------|------------|
| Linux 命令 | linux | 1 |
| Python | python | 2 |
| Java | java | 3 |
| Git | git | 4 |
| Docker | docker | 5 |
| SQL | sql | 6 |
| 其他 | other | 99 |

## 3. 关联关系变更

### Before (旧结构)

```
knowledge_items:
  - id, user_id, title, **category (VARCHAR)**, sub_category, ...

commands:
  - id, user_id, title, command_text, **category (VARCHAR)**, sub_category, ...
```

### After (新结构)

```
categories:
  - id, user_id, scope, name, slug, is_fixed, sort_order ...

knowledge_items:
  - id, user_id, title, **category_id (BIGINT FK)**, sub_category, ...
  - FOREIGN KEY (category_id) REFERENCES categories(id)

commands:
  - id, user_id, title, command_text, **category_id (BIGINT FK)**, sub_category, ...
  - FOREIGN KEY (category_id) REFERENCES categories(id)
```

## 4. 迁移步骤（幂等）

```sql
-- Step 1: 创建 categories 表 (IF NOT EXISTS)
-- Step 2: 插入固定分类 (INSERT IGNORE)
-- Step 3: 检测旧 category 列是否存在
-- Step 4: 如果存在，添加 category_id 列
-- Step 5: 迁移自定义分类到 categories 表 (按 user_id 分组)
-- Step 6: 回填 category_id (优先匹配用户自定义，再匹配固定分类)
-- Step 7: 设置 category_id NOT NULL
-- Step 8: 处理索引和外键约束顺序问题：
--         先删 fk_*_user_id → 删旧索引 → 建新索引 → 重建 fk_*_user_id
-- Step 9: 添加新的 category 外键约束
-- Step 10: 删除旧的 category 字符串列
```

## 5. 后端改动

### 新增文件
- `backend/internal/category/category.go` — 数据访问层 (CRUD)
- `backend/internal/category/handler.go` — HTTP API handlers

### API 接口

```
GET    /api/v1/categories?scope={knowledge|command}  — 列出分类
POST   /api/v1/categories                             — 创建自定义分类
PUT    /api/v1/categories/:id/rename                  — 重命名 (仅自定义)
DELETE /api/v1/categories/:id                         — 删除 (迁移记录到"其他")
```

### 修改文件
- `backend/internal/knowledgebook/handler.go` — 使用 category_id，JOIN categories 获取名称
- `backend/internal/commandbook/handler.go` — 同上
- `backend/internal/knowledgebook/parse_ai.go` — AI 解析使用 category_id
- `backend/internal/commandbook/parse_ai.go` — 同上
- `backend/internal/server/server.go` — 注册路由
- `backend/internal/migration/migration.go` — 支持 DELIMITER 存储过程
- `backend/internal/config/config.go` — DSN 添加 multiStatements=true

## 6. 前端改动

### 类型定义 (`web/src/types/category.ts`)
```typescript
interface Category {
  id: number;
  user_id?: number;
  scope: 'knowledge' | 'command';
  name: string;
  slug: string;
  is_fixed: boolean;
  sort_order: number;
}
```

### API 客户端 (`web/src/api/category.ts`)
- `listCategories(token, scope)` — 加载分类列表
- `createCategory(token, input)` — 创建自定义分类
- `renameCategory(token, id, name)` — 重命名
- `deleteCategory(token, id)` — 删除

### 组件改造
- `KnowledgebookPage.tsx` — 从 localStorage 改为后端加载，支持 CRUD
- `CommandbookPage.tsx` — 同上
- 表单 select 下拉框使用 category_id
- 分类标签显示 category.name

## 7. 已知问题（待修复）

### 问题 1: 迁移脚本重复插入分类
**现象：** 分类列表出现大量重复（系统文件层级 x N）
**原因：** INSERT INTO ... SELECT DISTINCT 的 LEFT JOIN 条件只匹配了 `c.user_id IS NULL`（固定分类），但未排除已存在的用户自定义分类
**修复方向：** 调整 JOIN 条件，同时检查 `(scope, user_id, slug)` 唯一键

### 问题 2: 迁移框架分号解析
**原因：** 原框架用 `strings.Split(content, ";")` 分割 SQL
**已修复：** 支持 DELIMITER 指令和存储过程执行

### 问题 3: 索引与外键依赖顺序
**原因：** MySQL 不允许删除被外键引用的索引
**已修复：** 先删除依赖的外键 → 删索引 → 建新索引 → 重建外键

## 8. 验证清单

- [ ] 数据库迁移成功，无报错
- [ ] 固定分类正确创建（5 + 7 个）
- [ ] 自定义分类迁移无重复
- [ ] knowledge_items.category_id 正确回填
- [ ] commands.category_id 正确回填
- [ ] 旧 category 列已删除
- [ ] 后端编译通过 (`go build ./...`)
- [ ] 前端编译通过 (`npx tsc --noEmit`)
- [ ] API 接口正常响应
- [ ] 前端分类列表加载正确
- [ ] 创建/重命名/删除分类功能正常
