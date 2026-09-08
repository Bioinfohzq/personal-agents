# Personal Agents 产品蓝图

> 这不是一个普通的聊天机器人,也不是单纯的笔记应用。
> 这是**个人中台**——你工作生涯所有知识、经验、对话、决策的统一入口与长期记忆层。
> 对标的是豆包/通义等通用助手的"记忆能力"短板:它们只有对话历史,没有结构化的个人知识沉淀;我们的目标是让 AI 真正**认识你**、**记住你**、**基于你的积累来回答你**。
>
> **术语约定**:本项目中的"**知识库**"指所有个人数据构成的统一池子(包含知识条目、对话沉淀、长期记忆、命令手册等),是产品的核心概念;前端"知识"Tab 页面对应的数据类型叫"**知识条目**"(knowledge_items 表),只是知识库中的一种数据类型,不能单独称为"库"。

---

## 一、产品愿景

一句话:**"我的所有工作记录、知识、经验,全部集中在这里;我和 AI 的每一次有价值对话,都能一键沉淀为知识条目;我问任何问题时,AI 首先检索我的知识库,结合我过往经验再回答。"**

### 核心能力支柱

```
┌─────────────────────────────────────────────────────────────┐
│                      全局搜索(入口)                          │
│     关键词/语义混合检索 → 知识条目 + 长期记忆 + 命令 + 对话     │
└──────────────┬──────────────────────────┬───────────────────┘
               │                          │
     ┌─────────▼─────────┐    ┌───────────▼──────────┐
     │    知识条目        │    │    对话(智能体)        │
     │  - 手动录入         │◄──►│  - 聊天输出一键存为条目│
     │  - Markdown 文档    │    │  - A+B长期记忆        │
     │  - 分类/标签/摘要   │    │  - RAG 检索增强        │
     └─────────┬─────────┘    └───────────┬──────────┘
               │                          │
     ┌─────────▼──────────────────────────▼───────────┐
     │              向量层(Embedding)                   │
     │  bge-m3(1024维) + pgvector HNSW → 余弦相似度检索  │
     └──────────┬──────────────┬──────────────┬────────┘
                │              │              │
     ┌──────────▼──┐    ┌──────▼──────┐    ┌──▼───────────┐
     │  命令手册    │    │  长期记忆    │    │  辅助模块      │
     │  (已实现)    │    │  (B7已实现)  │    │ 密码/文件/日程 │
     └─────────────┘    └─────────────┘    └──────────────┘
```

---

## 二、用户故事(必须满足的使用场景)

### 场景 1:知识沉淀(手动)
我有一份技术方案的 Markdown 文档,直接在「知识」页面上传,选择分类保存为知识条目。之后我问相关问题,AI 能直接引用这份文档的内容。

### 场景 2:对话中沉淀(一键保存)
我和 AI 讨论一个架构问题,AI 给出了一段很有价值的总结。我点那条消息旁边的「📥 存入」按钮,选择分类,这段对话就自动成为一条知识条目,带上对话上下文链接。

### 场景 3:全局搜索
我在页面顶部搜索框输入"缓存一致性",搜索结果同时返回:
- 我手动保存的 3 条相关知识条目
- 之前和 AI 讨论过这个话题的 2 段对话片段(高亮命中位置)
- 相关的命令手册条目

### 场景 4:RAG 增强问答
我提问时,AI 自动检索我的知识库(知识条目+记忆+历史对话等),把相关内容塞进上下文,回答时会引用"根据你在《XX 笔记》中的记录..."而不是空口胡说。

### 场景 5:长期记忆自动归档
对话过程中 AI 自动识别值得长期记住的信息(我的偏好、项目约定、踩过的坑),在我确认后写入"长期记忆",未来所有对话都能调用。

### 场景 6:全端可用
Web 端日常使用,桌面客户端(Tauri)本地深度集成(文件系统、本地 embedding),移动端(远期)随时查阅。

---

## 三、能力缺口清单

状态说明:✅ 已实现 | 🔧 部分实现 | ❌ 未实现 | 🚧 进行中

### A. 知识条目层

| # | 能力 | 状态 | 说明 | 相关模块 |
|---|------|------|------|---------|
| A1 | 知识条目 CRUD(增删改查) | ✅ | 完整的 REST API + 前端表单 | backend/internal/knowledgebook, web/.../KnowledgebookPage |
| A2 | 分类树管理 | ✅ | 多级分类、重命名、删除 | backend/internal/category |
| A3 | 标签系统 | ✅ | 逗号分隔标签,搜索过滤 | knowledgebook |
| A4 | 文章模板(正文+摘要+我的理解) | ✅ | 结构化字段 | knowledgebook |
| A5 | 流程模板(步骤+代码+注意) | ✅ | 步骤列表编辑器 | knowledgebook |
| A6 | 对比模板(多维表格) | ✅ | ComparisonTable | knowledgebook |
| A7 | 文档模板(Markdown 上传+预览) | ✅ | react-markdown 渲染,编辑/预览切换 | knowledgebook |
| A8 | AI 一键解析预填 | ✅ | 标题/标签/摘要 AI 生成 | backend/internal/knowledgebook/parse_ai.go |
| A9 | 关键词全文搜索 | ✅ | `?q=` 参数,LIKE 匹配 title/content/tags | knowledgebook/handler.go |
| A10 | **语义向量检索** | ✅ | 基于 bge-m3 + pgvector HNSW 余弦相似度,支持 `GET /api/v1/knowledge/search?q=xxx` 接口 | backend/internal/embed, knowledgebook/store.go |
| A11 | **知识条目关联/反向链接** | ❌ | 条目间互相引用、"相关知识"推荐 | 待建 |
| A12 | **Markdown 图片/附件** | ❌ | 当前只支持纯文本 Markdown,图片需转 base64 或对象存储 | 待建 |

### B. 对话与记忆层

| # | 能力 | 状态 | 说明 | 相关模块 |
|---|------|------|------|---------|
| B1 | 基础对话 UI(流式输出) | ✅ | LangGraph SDK + SSE | web/.../Chat, agent/graph.py |
| B2 | 多会话管理 | ✅ | 会话列表、切换、删除 | web/.../ChatPage |
| B3 | 智能体工具调用(文件/Shell/搜索/计算器等) | ✅ | MCP + builtin tools | agent/tools/ |
| B4 | **对话消息一键存为知识条目** | ✅ | 消息气泡悬浮时显示「📥 存入知识库」按钮(仅user/agent消息,tool消息不显示),弹出Modal选择分类+编辑标题/标签/摘要/内容,提交后创建知识条目并自动生成向量;知识条目标记source_thread_id/source_msg_id/source_role记录来源;保存成功顶部toast提示 | web/src/components/Chat/MessageBubble.tsx, web/src/components/Chat/SaveToKnowledgeModal.tsx, backend/internal/knowledgebook/ |
| B5 | **对话片段全局检索** | ❌ | 历史消息全文+语义搜索,点击跳转到对话位置 | 待建:messages 表 + 搜索接口 |
| B6 | **RAG 注入(回答前检索知识库/记忆)** | ✅ | Agent 通过 `search_knowledge_base`(知识+命令) 和 `recall_memory`(记忆) 工具自主判断是否检索,命中内容会引用来源标题;后端提供 `/api/v1/internal/search`(internal key鉴权)供Agent调用,`/api/v1/search`(JWT鉴权)供前端调用;全局搜索已支持知识条目+命令+记忆三类语义检索(UNION ALL合并) | agent/tools/builtin/knowledge.py, agent/tools/builtin/memory.py, agent/harness/prompts/system.py, backend/internal/search/handler.go |
| B7 | **长期记忆自动归档(A+B混合方案)** | ✅ | **存储层**:memories表(000018迁移)+CRUD接口+向量事务双删+语义去重合并;**Agent工具**:`save_memory`(存记忆,自动去重)/`recall_memory`(语义检索)/`core_memories`(取核心记忆);**A预注入**:`CoreMemoryMiddleware`在对话启动时将importance≥4的核心记忆注入系统消息;**B按需检索**:非核心记忆通过recall_memory工具检索;识别范围/topic枚举/importance分级/确认流程均已写入系统提示词 | backend/internal/memorybook/, agent/tools/builtin/memory.py, agent/harness/memory_middleware.py, agent/harness/prompts/system.py |
| B8 | **记忆管理界面** | ❌ | 查看/编辑/删除/启用停用长期记忆条目 | 待建(后端接口已就绪:JWT鉴权的CRUD) |

**B7 长期记忆 A+B 混合方案(已实现):**
- **存储层**:memories表(000018迁移)支持topic分类(personal_fact/tech_preference/project_convention/lesson_learned/communication_style)、importance分级(1-5)、is_active软删除;向量复用统一embeddings表(source_type='memory'),事务双删;语义去重:相似度≥0.75时自动合并而非新建
- **A预注入(核心记忆)**:CoreMemoryMiddleware在对话启动时将importance≥4的记忆作为SystemMessage注入,AI直接可见无需检索
- **B按需检索**:非核心记忆通过recall_memory工具语义检索
- **识别规则(已写入系统提示词)**:① 用户明确要求记住的信息;② 技术偏好与习惯;③ 项目约定与规范;④ 踩过的坑/教训/结论;⑤ 个人事实
- **不要记**:临时问题、一次性任务、闲聊问候;情绪表达、不确定的猜测;可通过工具实时查到的信息;知识库已有正式笔记内容
- **触发流程**:AI识别候选 → 向用户确认[topic+importance] → 用户明确确认后调用save_memory写入;存储层自动语义去重合并
- **更新策略**:新事实矛盾时UPDATE旧记录(不保留历史版本),向量跟随源记录事务双删

### C. 全局搜索层

| # | 能力 | 状态 | 说明 | 相关模块 |
|---|------|------|------|---------|
| C1 | 模块内搜索(知识/命令各自有搜索框) | ✅ | 各页面独立搜索 | 各 Page 组件 |
| C2 | **顶部全局搜索框** | ❌ | Header 中的统一搜索入口,跨模块聚合结果(知识条目+对话+命令+记忆) | 待建:Header + 统一 search 接口 |
| C3 | **混合检索(关键词 + 语义)** | ❌ | 全文检索 + 向量相似度融合排序 | 待建 |
| C4 | **搜索结果类型分组(知识/对话/命令/文件)** | ❌ | 结果按类型 Tab 分组展示 | 待建 |
| C5 | **搜索热词/最近搜索** | ❌ | 体验优化 | 待建 |

### D. 向量与 Embedding 层

| # | 能力 | 状态 | 说明 | 相关模块 |
|---|------|------|------|---------|
| D1 | **embedding 模型接入** | ✅ | 本地 Ollama 服务 + bge-m3(1024维,多语言,中文效果好),通过 Go HTTP 客户端调用 `/api/embed` 接口 | backend/internal/embed/embed.go |
| D2 | **向量存储** | ✅ | PostgreSQL + pgvector 扩展,统一 embeddings 表多态关联(source_type/source_id/chunk_index),HNSW余弦距离索引;所有数据类型共用同一张向量表 | backend/migrations/000016_create_embeddings.up.sql |
| D3 | **知识条目自动向量化** | ✅ | 知识条目创建/更新时在事务内自动计算并存储embedding,更新时ON CONFLICT幂等覆盖,删除时同事务删向量(事务双删);向量生成失败不阻塞主流程 | backend/internal/knowledgebook/store.go |
| D3b | **命令条目自动向量化** | ✅ | 与D3对称:命令(commands表)Create/Update/Delete时同样在事务内自动处理向量,复用embeddings表(source_type='command');全局搜索通过UNION ALL合并知识+命令结果 | backend/internal/commandbook/store.go, backend/internal/search/handler.go |
| D4 | **消息向量化** | ❌ 不自动做 | **采用方案B**:对话消息本身不自动向量化(避免噪音);只有用户点击「📥存入知识」(B4)后,消息内容才会作为知识条目入库并生成向量。近期上下文检索依赖会话历史本身(滑动窗口),不走向量库 | — |
| D5 | **记忆向量化** | ✅ | 长期记忆(memories表)Create/Update/Delete时自动在事务内处理embedding,复用embeddings表(source_type='memory');核心记忆(importance≥4)通过CoreMemoryMiddleware在对话启动时预注入;非核心记忆通过recall_memory工具语义检索;全局搜索已支持memory类型 | backend/internal/memorybook/store.go, agent/harness/memory_middleware.py, agent/tools/builtin/memory.py, backend/internal/search/handler.go |
| D6 | **统一向量重建工具** | ❌ 待定 | 所有数据源都接入后,提供一次性CLI命令(非HTTP接口)按source_type批量重建缺失/过期向量;放在 backend/cmd/rebuild-embeddings/。旧数据量小时可手动编辑保存触发,不强制做 | 待建 |

### E. 平台与交付

| # | 能力 | 状态 | 说明 | 相关模块 |
|---|------|------|------|---------|
| E1 | Web 端 | ✅ | React + Vite + Tailwind | web/ |
| E2 | 后端 API | ✅ | Go + Echo + PostgreSQL(pgvector) + 自研迁移器 | backend/ |
| E3 | 智能体服务 | ✅ | LangGraph + Python uv | agent/ |
| E4 | 用户认证(JWT) | ✅ | 注册/登录/bcrypt | backend/internal/auth |
| E5 | 桌面客户端(Tauri) | 🔧 | 骨架已存在,默认连 localhost:2024,待完善 UI 与深度集成 | desktop/ |
| E6 | **桌面端本地 embedding** | ❌ | 桌面端可跑本地模型,Web 端走在线 API | 待建:desktop |
| E7 | **数据导入/导出(Markdown/JSON)** | ❌ | 知识库数据备份与迁移(知识条目+记忆+命令) | 待建 |
| E8 | **移动端** | ❌ | 远期 | - |

### F. 辅助模块(已实现,供参考)

| # | 能力 | 状态 | 说明 |
|---|------|------|------|
| F1 | 命令手册 | ✅ | 命令分类、参数模板、AI 解析 |
| F2 | 密码本 | ✅ | 加密存储 |
| F3 | 文件系统浏览 | ✅ | 本地文件浏览 |
| F4 | 日程管理 | ✅ | 简单日程 CRUD |

### G. AI 回复规范

| # | 能力 | 状态 | 说明 | 相关模块 |
|---|------|------|------|---------|
| G1 | 名词解释格式规范 | 🔧 | 所有技术名词首次出现时必须使用「中文全称（英文全称，缩写）」格式(例:运营商级网络地址转换(Carrier-Grade Network Address Translation，CGNAT)),当前通过系统提示词强制约束,长期记忆功能(B7)上线后迁移为长期记忆 | agent/harness/prompts/system.py |

---

## 四、推荐实现路径(分阶段)

### 阶段 1:对话沉淀闭环(最小可用的"个人中台")
- B4 对话消息一键存为知识条目 → C2 顶部全局搜索框(关键词) → B5 对话片段搜索
- **效果**:聊天里有价值的内容能存下来,全局能搜到,这就已经比豆包强了

### 阶段 2:RAG 增强问答 ✅ 已完成
- D1/D2/D3 embedding + 向量存储 → A10 知识条目语义检索 → B6 RAG 注入 agent
- **效果**:提问时 AI 会自主判断是否需要检索知识库,命中内容时引用你的知识条目回答

### 阶段 3:长期记忆 ✅ 已完成
- B7 长期记忆自动归档(A+B混合方案,存储层+工具+中间件) → D5 记忆向量化 → B6/D5 记忆检索接入全局搜索
- **效果**:AI 记住你的偏好、坑点、项目约定,越用越懂你;核心记忆每次对话自动注入,非核心记忆按需语义检索

### 阶段 4:体验打磨与桌面端(下一阶段)
- B8 记忆管理界面(CRUD页面) → C2 顶部全局搜索框(前端) → C3/C4 混合检索与结果分组 → A11/A12 知识关联与附件 → E5/E6 桌面端本地 embedding
- **效果**:从能用变好用,桌面端成为本地主力入口

### 阶段 5(远期):移动端、多人共享、协作等

---

## 五、核心数据模型演进方向

知识库是统一的数据池子,所有可检索数据通过 `source_type` 多态关联到统一的 embeddings 向量表。当前已实现和规划的数据类型:

| source_type | 对应表 | 说明 | 向量状态 |
|-------------|--------|------|---------|
| `knowledge` | knowledge_items | 知识条目(手动录入/对话沉淀/文档上传) | ✅ 已实现自动向量化 |
| `command` | commands | 命令手册条目 | ✅ 已实现自动向量化 |
| `memory` | memories | 长期记忆(偏好/教训/约定/事实/沟通风格) | ✅ 已实现自动向量化 |
| `message` | messages(待建) | 对话消息片段 | ❌ 待建(不自动做,B4一键存知识已满足需求) |

演进要点:

1. ~~**新增 `memories` 表**(长期记忆)~~ ✅ 已实现:memories表字段为id/user_id/topic/title/content/importance/is_active/created_at/updated_at;topic枚举:personal_fact/tech_preference/project_convention/lesson_learned/communication_style;向量复用embeddings表,事务双删
2. **`knowledge_items` 加 `source_type` 字段**:`manual`(手动)/`from_chat`(从对话),加 `source_msg_id` 反向链接到对话
3. **新增 `messages` 相关表**存储对话历史(当前由 LangGraph checkpointer 管理,语义检索需要独立表;近期不做,B4一键存知识已覆盖主要场景)
4. **全局搜索接口已支持**:knowledge + command + memory 三类 UNION ALL 聚合,返回type字段区分;后续加message类型只需加UNION分支
5. **embeddings 表的 source_type 枚举值**必须在代码层注册全局唯一,新增数据类型时同步添加(当前已注册:knowledge/command/memory)

---

## 六、维护规则

- **每次实现完一个新能力,必须更新本文件对应条目的状态**(❌→🔧→✅,并补充实现位置)
- **目录结构发生变化时,必须同步更新 AGENTS.md 和 README.md**
- **新增核心模块时,在本文件对应分层里补充条目**
- **阶段目标调整时,更新"推荐实现路径"章节**
- **新增可检索数据类型时,同步更新第五节的 source_type 枚举表**
