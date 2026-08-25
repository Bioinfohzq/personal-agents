# Debug Session: chat-stream-not-live
- **Status**: [VERIFIED - 已修复并经用户复现验证]
- **Issue**: 对话页面输入提示词后，AI 会话过程（工具调用、中间消息）不实时显示，只显示一个气泡；会话结束后从历史会话重新打开才能看到全部过程
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: .dbg/trae-debug-log-chat-stream-not-live.ndjson

## Reproduction Steps
1. 打开 web 前端对话页面（http://localhost:5173 或 desktop）
2. 输入一句会触发工具调用的提示词（如"现在几点了"）
3. 观察：AI 中间会话过程（tool 调用气泡、中间 AI 消息）不出现，只有一个气泡
4. 等会话结束，切换到其他会话再切回来（触发 loadThread），才能看到完整过程

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | 服务端事件名不匹配，前端 for-await 中 event 判断漏掉实际事件类型 | Low | Low | curl 实测：服务端发 `messages/partial` + `messages/complete`，前端已处理这两种事件名 |
| B | getRole() 对流式 chunk 判断失败，消息在入口被过滤 | Low | Low | 服务端消息带 type/role 字段（curl 确认），待探针 B 最终确认 |
| C | **upsertStreamingMsg 的 setMessages updater 非纯函数 + React StrictMode double-invoke/updater 副作用污染 → tool 消息和新 AI 气泡静默丢失** | **High** | Med | React 源码级证据已确认（见下），待运行时日志验证 |
| D | 流结束补充同步把中间消息错误去重跳过 | Medium | Med | 与 C 联动：C 丢失消息后，lgId 已在 localLgIds → 全部 skip:lgId-bound，一条都不补 |
| E | LangGraph 服务端（create_agent）根本没发中间消息事件 | Low | Low | curl 实测：中间消息（tool_calls/tool 结果）均以 messages/partial、messages/complete 发出 |

## 静态分析证据（React 19.2.7 源码，react-dom-client.development.js）

1. **L8048-8053** render 阶段处理每个 update：
   ```
   shouldDoubleInvokeUserFnsInHooksDEV && reducer(prev, action);   // StrictMode 先额外调用一次,结果丢弃
   pendingQueue = update.hasEagerState
     ? update.eagerState      // 有 eagerState 直接复用,不调用
     : reducer(pendingQueue, action);  // 正式计算(第2次调用)
   ```
2. **L7660** `shouldDoubleInvokeUserFnsInHooksDEV = (workInProgress.mode & StrictLegacyMode) !== NoMode` — main.tsx 启用了 `<StrictMode>`，dev 构建下生效。
3. **L9136-9155** dispatchSetState eager evaluation：队列空时先调用一次 updater（副作用已执行），hasEagerState=true。

## 根因推理（假设 C 精确机制）

`upsertStreamingMsg` 传给 `setMessages` 的 updater 修改闭包变量 `streamedMsgIds.set(lgId, localId)` / `currentStreamLocalId`，非纯函数：

- 当 update 在队列非空时 dispatch（SSE 高频 chunk 常态）→ 无 eager → render 时 double-invoke：
  - 第1次（丢弃）：lgId 不在 map → INSERT-NEW/情况3 → `set(lgId, localId)` + push 新气泡
  - 第2次（正式）：**lgId 已在 map（第1次污染）** → UPDATE-EXISTING/情况1 → `next.map()` 在 prev 找不到 localId（气泡从未提交）→ no-op → **气泡丢失**
- 后续同 lgId 的 partial 全走情况1 no-op → 最终 AI 回复整段不显示
- final sync：lgId 全在 localLgIds → 全部 skip:lgId-bound → 不补
- 重新打开会话：loadThread 全量渲染 → 全部显示 ✓ 吻合症状
- 占位气泡保留第一轮 AI 的"[调用工具: xxx]"文本 → 用户看到"只有一个气泡" ✓ 吻合症状

## Instrumentation (已完成)
- 探针 A：for-await 每个 chunk 的事件名/消息结构 → hypothesis A/B/E
- 探针 B：getRole 过滤记录 → hypothesis B
- 探针 C：upsertStreamingMsg 全分支（updater CALL/RETURN、tool INSERT-NEW/UPDATE-EXISTING、ai branch1/2/3、foundInPrev）→ **核心：double-invoke 直接可见（同一 chunk 两条 CALL 日志+分支翻转）**
- 探针 D：final sync 每条 history 的决策（skip 原因/APPEND）→ hypothesis D
- 探针 E：流结束状态
- 探针位置均以 `#region debug-point X:名称` 标记，事后统一移除

## Log Evidence（2026-08-25 用户复现，1911 条日志）

| 探针证据 | 数值 | 结论 |
|---|---|---|
| tool-updater CALL | 12 次 / 6 条 tool 消息 | 每条恰好 2 次 = **StrictMode double-invoke 实锤** |
| tool 分支 | 6× INSERT-NEW + 6× UPDATE-EXISTING | 第1次 INSERT(丢弃)+副作用污染 → 第2次 UPDATE no-op → **6 个 tool 气泡全丢** |
| ai branch3-NEW-BUBBLE | 6 次(全被丢弃) | tool 后 6 轮新 AI 气泡全丢 |
| ai branch1 foundInPrev=false | 206 次 | 后续 partial 全在更新"不存在的气泡"(no-op) |
| ai branch2-BIND | 仅 1 次 | 第一个 AI partial 绑定占位气泡 = 用户看到的唯一气泡 |
| final sync | 26× skip:lgId-bound, 0× APPEND | lgId 全在污染 map → 中间消息一条不补 |
| streamedIds | 13 个 | 7 agent + 6 tool 全被"绑定"但气泡从未提交 |

注：第一个 AI partial 未丢失是因为它到达时 update 队列为空，走了 dispatchSetState 的 eager evaluation（hasEagerState → render 直接复用第一次结果）。后续 chunk 在队列非空时 dispatch → 无 eager → double-invoke 污染生效 → 丢失。

## Verification Conclusion

**根因（假设 C 确认）**：`upsertStreamingMsg` 传给 `setMessages` 的 updater 非纯函数——内部执行 `streamedMsgIds.set(lgId, localId)` 和 `currentStreamLocalId` 赋值。React 19.2.7 StrictMode（dev 构建启用，main.tsx）在 render 阶段 double-invoke 每个 updater（react-dom-client.development.js L8048-8053, L7660）：第1次调用的副作用污染 `streamedMsgIds`，第2次（正式）调用因此走"UPDATE-EXISTING/情况1"分支，`next.map()` 在 prev 中找不到 localId（气泡从未提交）→ no-op → tool 气泡与后续新 AI 气泡静默丢失。final sync 又因 lgId 已在 `localLgIds` 全部 skip。生产构建无 double-invoke 故不出现——dev 必现、prod 正常，导致问题"反复解决不掉"。

**修复**：重构 `upsertStreamingMsg`（ChatPage.tsx）——所有对闭包变量（`streamedMsgIds`/`currentStreamLocalId`）的写入移到 `setMessages` 调用之前完成，绑定决策（boundLocalId/targetLocalId/createNew）在 updater 外计算；updater 只做纯计算，并对"目标气泡不在 prev"的异常时序走新建兜底（不再静默丢弃）。

**验证方式**：dev 模式（http://localhost:5173）新建会话发送会触发工具调用的提示词，观察 tool 调用气泡与中间 AI 消息是否实时逐个出现。
