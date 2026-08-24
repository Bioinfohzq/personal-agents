# Personal Agents - Web 前端

基于 **React 19 + TypeScript + Vite** 构建的个人中台前端应用，使用 React Router v7 进行路由管理，Tailwind CSS v4 进行样式开发。

## 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | React 19 |
| 语言 | TypeScript |
| 构建工具 | Vite 8 |
| 路由 | react-router-dom v7 (createBrowserRouter) |
| 样式 | Tailwind CSS v4 |
| 图标 | lucide-react |
| AI SDK | @langchain/langgraph-sdk |
| Lint | Oxlint |
| 包管理 | pnpm |

## 启动方式

```bash
pnpm install
pnpm dev       # 开发模式
pnpm build     # 生产构建 (tsc 类型检查 + vite build)
pnpm preview   # 预览生产构建产物
pnpm lint      # Oxlint 代码检查
```

## 目录结构

```
src/
├── main.tsx                # 应用入口:挂载 React 根节点,包裹 AuthProvider + RouterProvider
├── index.css               # 全局样式(Tailwind 入口)
├── assets/                 # 静态资源(图片、SVG)
├── auth/                   # 认证模块
│   ├── AuthContext.tsx     # 全局认证状态 Context(localStorage 持久化 session)
│   └── ProtectedRoute.tsx  # 路由守卫:未登录重定向到 /login,已登录渲染子路由
├── router/
│   └── index.tsx           # 路由配置(createBrowserRouter 定义所有路由)
├── layouts/
│   └── MainLayout.tsx      # 主布局:Sidebar + Header + Outlet(子路由出口)
├── components/             # UI 组件
│   ├── Auth/
│   │   └── LoginPage.tsx   # 登录页(公开路由)
│   ├── Sidebar/
│   │   └── Sidebar.tsx     # 左侧深色侧边栏(导航菜单 + 聊天会话列表)
│   ├── Header/
│   │   └── Header.tsx      # 顶部白色导航栏(折叠按钮/页面标题/用户信息/退出按钮)
│   ├── Chat/               # 聊天模块子组件(MessageList/MessageBubble/InputArea)
│   ├── Passwordbook/       # 密码本页面
│   ├── Schedule/           # 日程页面(月视图日历)
│   ├── Knowledgebook/      # 知识库页面(含命令手册视图)
│   ├── FileSystem/         # 文件系统页面(目录扫描/存储分析)
│   └── Commandbook/        # 命令手册页面(已合并到 Knowledgebook)
├── pages/
│   └── ChatPage.tsx        # AI 聊天主页面(消息列表 + 输入框,通过 threadId 加载会话)
├── api/                    # API 层(封装后端 HTTP 调用)
│   ├── http.ts             # Axios/fetch 基础封装,统一处理请求/响应/错误
│   ├── client.ts           # LangGraph SDK 客户端初始化(线程/消息/流式输出)
│   ├── auth.ts             # 登录/注册/访客模式相关接口
│   ├── passwordbook.ts     # 密码本 CRUD 接口
│   ├── schedule.ts         # 日程管理接口
│   ├── knowledgebook.ts    # 知识库 CRUD 接口
│   ├── commandbook.ts      # 命令手册接口
│   ├── category.ts         # 分类管理接口
│   └── filesystem.ts       # 文件系统扫描接口
├── types/                  # TypeScript 类型定义(按业务模块拆分)
│   ├── chat.ts             # Thread/Message 等聊天相关类型
│   ├── passwordbook.ts
│   ├── schedule.ts
│   ├── knowledgebook.ts
│   ├── commandbook.ts
│   ├── filesystem.ts
│   └── category.ts
└── utils/
    └── format.ts           # 工具函数(日期格式化等)
```

## 应用架构

### 组件嵌套层级

```
<AuthProvider>                          # 全局认证 Context,提供 session/logout
└── <RouterProvider>                    # React Router 路由提供者
    └── 路由树:
        ├── /login → <LoginPage>        # 公开路由,无需登录
        └── / → <ProtectedRoute>        # 认证守卫
            └── <MainLayout>            # 主布局骨架
                ├── <Sidebar>           # 左侧导航栏(深色)
                ├── <Header>            # 顶部导航栏(白色)
                └── <Outlet>            # 子路由渲染位置 ↓
                    ├── /chat           → <ChatPage>
                    ├── /chat/:threadId → <ChatPage>(加载指定会话)
                    ├── /passwordbook   → <PasswordbookPage>
                    ├── /schedule       → <SchedulePage>
                    ├── /knowledgebook  → <KnowledgebookPage>
                    └── /filesystem     → <FileSystemPage>
```

### 页面布局示意

```
┌────────────┬──────────────────────────────────────────────┐
│            │  Header(高68px)                               │
│            │  [≡折叠] [📘图标] 页面标题    用户名 [新建会话][退出] │
│  Sidebar   ├──────────────────────────────────────────────┤
│  (w=256px) │                                              │
│  深色背景    │                                              │
│            │  Outlet(子路由内容区域)                         │
│  ┌──────┐  │                                              │
│  │AI助理 │  │  ChatPage:  消息列表 + 输入框                 │
│  │密码本 │  │  PasswordbookPage: 账号列表 + CRUD            │
│  │日程   │  │  SchedulePage: 月视图日历                    │
│  │知识库 │  │  KnowledgebookPage: 知识条目管理              │
│  │文件系统│  │  FileSystemPage: 目录扫描结果                │
│  └──────┘  │                                              │
│  最近会话    │                                              │
│  ┌──────┐  │                                              │
│  │会话1  │  │                                              │
│  │会话2  │  │                                              │
│  └──────┘  │                                              │
└────────────┴──────────────────────────────────────────────┘
```

### 状态管理与数据流转

- **认证状态**：通过 `AuthContext` (React Context) 全局管理，session 持久化到 localStorage，所有组件通过 `useAuth()` 获取。
- **布局共享状态**：`MainLayout` 管理 threads 列表、isLoading、侧边栏开关等跨页面状态，通过 `<Outlet context={outletContext}>` 传给子路由，子路由用 `useOutletContext<MainLayoutContext>()` 接收。
- **页面内部状态**：各页面（ChatPage、PasswordbookPage 等）用 `useState`/`useEffect` 管理自身状态，通过 `api/` 层调用后端接口获取数据。

### 路由与导航

路由配置集中在 `src/router/index.tsx`，使用 `createBrowserRouter`（React Router v7 推荐写法）。

| 路径 | 页面 | 说明 |
|------|------|------|
| `/login` | LoginPage | 登录页（公开） |
| `/` | - | 自动重定向到 `/chat` |
| `/chat` | ChatPage | AI 助理（无指定会话时自动选择最近会话） |
| `/chat/:threadId` | ChatPage | AI 助理（加载指定会话） |
| `/passwordbook` | PasswordbookPage | 密码本 |
| `/schedule` | SchedulePage | 日程管理 |
| `/knowledgebook` | KnowledgebookPage | 知识中枢（加 `?view=commands` 切换命令视图） |
| `/commandbook` | - | 旧路径，重定向到 `/knowledgebook?view=commands` |
| `/filesystem` | FileSystemPage | 文件系统分析 |
| `*` | - | 未知路径兜底，重定向到 `/chat` |

导航在 Sidebar 中使用 `<NavLink>` 实现，React Router 会自动根据当前 URL 高亮对应导航项并切换页面内容，无需手动管理 active 状态。

### 访客模式

登录页支持访客模式（无需注册直接进入），访客的 session 中 `isGuest=true`，Sidebar 会过滤掉需要后端 JWT 鉴权的导航项（密码本、日程、文件系统），仅保留 AI 助理和知识库。
