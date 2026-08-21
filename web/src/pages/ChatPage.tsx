import { useEffect, useRef, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { client } from '../api/client';
import type { Message } from '../types/chat';
import { MessageList } from '../components/Chat/MessageList';
import { InputArea } from '../components/Chat/InputArea';
import type { MainLayoutContext } from '../layouts/MainLayout';

/**
 * 停止按钮 abort 控制：流式请求期间持有 controller,停止时 abort()
 * 用于中止 LangGraph 流式响应,让用户能主动结束等待
 */

/**
 * ChatPage:聊天页面
 *
 * 职责:管理单个聊天会话的消息列表和输入交互
 *
 * 路由:
 *   /chat           → 无 threadId,自动重定向到最近会话或创建新会话
 *   /chat/:threadId → 加载指定会话的历史消息
 *
 * 数据来源:
 *   - threadId:从 URL 参数获取(useParams),不再用 state 管理
 *   - fetchThreads / setIsLoading:从 MainLayout 的 Outlet context 获取
 *   - messages / input:页面局部 state
 *
 * 响应 URL 变化:
 *   当用户在 Sidebar 点击不同会话时,URL 变化 → useParams 返回新 threadId
 *   → useEffect 检测到 threadId 变化 → 自动加载该会话的消息
 */
export function ChatPage() {
  // useParams:从 URL 路径参数提取 threadId
  //   路由定义 /chat/:threadId → useParams() 返回 { threadId: "xxx" }
  //   访问 /chat(无参数)→ useParams() 返回 { threadId: undefined }
  const { threadId } = useParams<{ threadId: string }>();

  // useNavigate:编程式导航(不通过 <Link> 也能跳转)
  //   用于"访问 /chat 时自动重定向到最近会话"
  const navigate = useNavigate();

  // useOutletContext:接收 MainLayout 通过 <Outlet context={...}> 传下来的共享数据
  //   泛型指定为 MainLayoutContext,获得类型提示
  const { fetchThreads, isLoading, setIsLoading } = useOutletContext<MainLayoutContext>();

  // 页面局部状态:只和当前聊天页面相关,不需要共享给其他页面
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');

  // 流式输出状态:控制输入框停止按钮和消息骨架屏
  // 与 isLoading 区分:加载历史消息时不应显示停止按钮
  const [isStreaming, setIsStreaming] = useState(false);

  // 消息列表底部引用,用于自动滚动到底部
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 流式请求 abort controller:停止按钮通过它中止当前请求
  const abortControllerRef = useRef<AbortController | null>(null);

  // 当前流式请求的 runId,用于停止时调用服务端 cancel API
  const currentRunIdRef = useRef<string | null>(null);

  // 发送锁:防止发送瞬间输入残留(IME compositionend 等异步事件在 setInput('') 后写回脏值)
  const isSendingRef = useRef(false);

  // 中文输入法合成状态:合成中不响应 Enter 发送
  const isComposingRef = useRef(false);

  // 滚动到底部
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // 消息变化时自动滚动到底部
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // ========== 工具函数:LangGraph 消息格式转换 ==========

  /**
   * 从消息 chunk 中提取文本内容(兼容 string 和 content-block 数组格式)
   */
  const extractText = (content: any): string => {
    if (!content) return '';
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((block: any) => {
          if (typeof block === 'string') return block;
          if (block?.type === 'text') return block.text || '';
          return '';
        })
        .join('');
    }
    return String(content);
  };

  /**
   * 判断 LangGraph 消息角色并映射为前端 role
   */
  const getRole = (msg: any): 'user' | 'agent' | 'tool' | null => {
    if (!msg) return null;
    if (msg.type === 'human' || msg.role === 'user') return 'user';
    if (msg.type === 'tool' || msg.role === 'tool') return 'tool';
    if (msg.type === 'AIMessageChunk' || msg.type === 'ai' || msg.type === 'AIMessage' || msg.role === 'assistant') return 'agent';
    return null;
  };

  /**
   * 从消息中提取工具名称
   */
  const getToolName = (msg: any): string | undefined => {
    if (msg.name) return msg.name;
    if (msg.tool_call_id) {
      // ToolMessage 可能没有 name,从 tool_calls 上下文推断
      return msg.name || undefined;
    }
    return undefined;
  };

  /**
   * 从 AI 消息中提取工具调用描述(用于在 agent 气泡中显示"正在调用工具")
   */
  const getToolCallText = (msg: any): string => {
    if (!msg.tool_calls || !Array.isArray(msg.tool_calls) || msg.tool_calls.length === 0) return '';
    return msg.tool_calls.map((tc: any) => {
      const name = tc.name || 'unknown';
      const args = tc.args ? JSON.stringify(tc.args) : '';
      return `[调用工具: ${name}${args ? `(${args.length > 100 ? args.slice(0, 100) + '...' : args})` : ''}]`;
    }).join('\n');
  };

  /**
   * 将单条 LangGraph 消息转换为前端 Message
   */
  const convertLgMsg = (msg: any, fallbackId: string, streaming = false): Message | null => {
    const role = getRole(msg);
    if (!role || role === 'user') return null; // user 消息由我们自己管理

    const text = extractText(msg.content);
    const toolCallText = role === 'agent' ? getToolCallText(msg) : '';
    const fullContent = text + (text && toolCallText ? '\n' : '') + toolCallText;

    return {
      id: msg.id || fallbackId,
      role,
      content: fullContent,
      toolName: role === 'tool' ? getToolName(msg) : undefined,
      isStreaming: streaming,
    };
  };

  // ========== 加载历史会话 ==========

  /**
   * 加载指定会话的历史消息
   * 从 LangGraph 获取 thread 的 checkpoint 状态(包含完整消息历史)
   */
  const loadThread = async (id: string) => {
    setIsLoading(true);
    try {
      const state = await client.threads.getState(id);
      const stateValues = state.values as any;
      const historyMessages = stateValues?.messages || [];

      const formattedMessages: Message[] = [];
      for (let i = 0; i < historyMessages.length; i++) {
        const m = historyMessages[i];
        const role = getRole(m);
        if (!role) continue;
        const text = extractText(m.content);
        const toolCallText = role === 'agent' ? getToolCallText(m) : '';
        const content = text + (text && toolCallText ? '\n' : '') + toolCallText;
        if (role === 'user' && !content.trim()) continue;
        if (role === 'agent' && !content.trim()) continue;
        formattedMessages.push({
          id: m.id || `hist-${i}`,
          role,
          content,
          toolName: role === 'tool' ? getToolName(m) : undefined,
        });
      }

      if (formattedMessages.length === 0) {
        setMessages([{
          id: Date.now().toString(),
          role: 'agent',
          content: '你好！我是你的AI助理。这是一个空白的历史会话，请问有什么可以帮您？',
        }]);
      } else {
        setMessages(formattedMessages);
      }
    } catch (err: any) {
      console.error('Failed to load thread state:', err);
      if (err?.status === 404 || err?.message?.includes('404')) {
        navigate('/chat', { replace: true });
        return;
      }
      setMessages([{
        id: Date.now().toString(),
        role: 'agent',
        content: '你好！我是你的AI助理。开启了一个新的会话，今天我能为您做些什么？',
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * 响应 URL 参数变化:threadId 变化时自动加载会话
   *
   * 场景:
   *   1. 用户在 Sidebar 点击会话 → URL 变成 /chat/xxx → threadId 变化 → 加载
   *   2. 用户访问 /chat(无 threadId)→ 拉取最近会话列表 → 重定向到第一条
   *   3. 没有任何会话 → 创建新会话 → 重定向到新会话
   */
  useEffect(() => {
    if (threadId) {
      // 有 threadId:直接加载该会话
      void loadThread(threadId);
      return;
    }

    // 无 threadId(访问 /chat):自动选择最近会话或创建新会话
    const initThread = async () => {
      setIsLoading(true);
      try {
        const results = await client.threads.search({ limit: 50 });
        if (results.length > 0) {
          // 有历史会话:重定向到最近一条
          navigate(`/chat/${results[0].thread_id}`, { replace: true });
        } else {
          // 无历史会话:创建新会话并重定向
          const thread = await client.threads.create();
          await fetchThreads();
          navigate(`/chat/${thread.thread_id}`, { replace: true });
        }
      } catch (err) {
        console.error('Failed to init thread:', err);
      } finally {
        setIsLoading(false);
      }
    };
    void initThread();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  /**
   * 发送消息:校验 → 乐观更新 → 流式调用智能体 → 多消息动态渲染 → 最终同步
   *
   * 核心机制:
   *   - 不再只维护单个 agent 占位消息,而是根据 LangGraph 返回的每条消息的 id 动态追踪
   *   - 新 id 的消息 → 新增气泡;已有 id → 更新内容
   *   - 支持 AI 文本流、ToolCall 调用提示、ToolResult 返回,都实时显示
   *   - 支持中止:abort 客户端 + cancel 服务端
   */
  const handleSend = async () => {
    if (!input.trim() || !threadId || isStreaming) return;

    // 加发送锁:防止 setInput('') 后 IME compositionend 等事件将脏值写回输入框
    isSendingRef.current = true;
    const sentContent = input.trim();

    const userMsgId = `user-${Date.now()}`;
    const placeholderId = `thinking-${Date.now()}`;

    // 乐观更新:先插入用户消息 + "正在思考"占位
    setMessages(prev => [
      ...prev,
      { id: userMsgId, role: 'user', content: sentContent },
      { id: placeholderId, role: 'agent', content: '', isStreaming: true }
    ]);

    setInput('');
    setIsStreaming(true);
    currentRunIdRef.current = null;

    // 跟踪本次流中已绑定 LangGraph id 的消息:lgId → localId
    const streamedMsgIds = new Map<string, string>();
    // 当前"正在流式输出"的气泡 localId(partial chunk 无 lgId,都更新这个气泡)
    let currentStreamLocalId: string | null = null;
    // 移除思考占位标记
    let placeholderRemoved = false;

    // 创建本次请求的 AbortController
    const controller = new AbortController();
    abortControllerRef.current = controller;

    /**
     * 辅助:在 UI 中更新或新增一条非 user 消息
     *
     * 关键逻辑:
     *   - partial chunk 通常不带 lgId → 用 currentStreamLocalId 追踪"正在流式的气泡"
     *   - complete chunk 会带 lgId → 把 lgId 绑定到当前气泡,然后将 currentStreamLocalId 置空
     *     后续如果又来了新的 partial(说明 agent 在 tool call 后继续输出),
     *     会创建新的 currentStreamLocalId 气泡
     */
    const upsertStreamingMsg = (lgMsg: any, event: string) => {
      const role = getRole(lgMsg);
      if (!role || role === 'user') return;

      const lgId: string = lgMsg.id || '';
      const isComplete = event === 'messages/complete';
      const text = extractText(lgMsg.content);
      const toolCallText = role === 'agent' ? getToolCallText(lgMsg) : '';
      const content = text + (text && toolCallText ? '\n' : '') + toolCallText;
      const toolName = role === 'tool' ? getToolName(lgMsg) : undefined;

      // 对 ToolMessage 的处理:complete 才到达(工具结果),作为独立消息插入
      if (role === 'tool') {
        setMessages(prev => {
          let next = [...prev];
          if (!placeholderRemoved) {
            next = next.filter(m => m.id !== placeholderId);
            placeholderRemoved = true;
          }
          // tool 消息通常有 id,检查是否已存在
          if (lgId && streamedMsgIds.has(lgId)) {
            const localId = streamedMsgIds.get(lgId)!;
            next = next.map(m => m.id === localId ? { ...m, content, toolName, isStreaming: false } : m);
          } else {
            const localId = lgId || `tool-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            if (lgId) streamedMsgIds.set(lgId, localId);
            next.push({ id: localId, role: 'tool', content: content || '(工具无输出)', toolName, isStreaming: false });
          }
          // tool 消息结束后,下一个 AI partial 应该创建新气泡
          currentStreamLocalId = null;
          return next;
        });
        return;
      }

      // AI 消息(agent)
      setMessages(prev => {
        let next = [...prev];

        // 情况1:该 lgId 已绑定到某个本地气泡 → 更新它
        if (lgId && streamedMsgIds.has(lgId)) {
          const localId = streamedMsgIds.get(lgId)!;
          next = next.map(m => m.id === localId ? { ...m, content, toolName, isStreaming: !isComplete } : m);
          if (isComplete) {
            currentStreamLocalId = null;
          } else {
            currentStreamLocalId = localId;
          }
          return next;
        }

        // 情况2:有 currentStreamLocalId → 同一条 AI 消息的流式增量,更新当前气泡
        if (currentStreamLocalId && !isComplete) {
          next = next.map(m =>
            m.id === currentStreamLocalId ? { ...m, content, toolName, isStreaming: true } : m
          );
          if (lgId) streamedMsgIds.set(lgId, currentStreamLocalId);
          return next;
        }

        // 情况3:需要新建 AI 气泡
        //  - partial 开始但内容为空 → 不替换思考占位,等有内容再建(保持思考动画)
        //  - partial 有内容 / complete 单独到达 → 创建新气泡并移除思考占位
        const hasContent = content.trim().length > 0;
        if (!isComplete && !hasContent) {
          // 流式刚开始,还没内容,保留思考占位
          return next;
        }

        // 需要创建实际气泡了,先移除思考占位
        if (!placeholderRemoved) {
          next = next.filter(m => m.id !== placeholderId);
          placeholderRemoved = true;
        }

        const localId = lgId || `stream-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        if (lgId) streamedMsgIds.set(lgId, localId);
        next.push({ id: localId, role: 'agent', content, toolName, isStreaming: !isComplete });
        if (!isComplete) {
          currentStreamLocalId = localId;
        } else {
          currentStreamLocalId = null;
        }
        return next;
      });
    };

    try {
      // 流式调用 LangGraph 智能体
      const streamResponse = client.runs.stream(
        threadId,
        'lead_agent',
        {
          input: {
            messages: [{ role: 'user', content: sentContent }]
          },
          streamMode: 'messages',
          signal: controller.signal,
          onRunCreated: ({ run_id }) => {
            currentRunIdRef.current = run_id;
          },
        }
      );

      // 消费流式响应
      for await (const chunk of streamResponse) {
        if (controller.signal.aborted) break;

        const c = chunk as any;

        // 兼容所有可能的消息事件:
        //   - "messages/partial" / "messages/complete" :标准 messages 模式
        //   - "messages"                              :messages-tuple 模式(data 为 [msg, metadata])
        if (c.event === 'messages/partial' || c.event === 'messages/complete' || c.event === 'messages') {
          // 统一提取消息列表
          let rawChunks: any[];
          if (c.event === 'messages' && Array.isArray(c.data) && c.data.length === 2) {
            // tuple 模式:[message, metadata],第一个元素是消息
            const [first, second] = c.data;
            const firstIsMsg = first && typeof first === 'object' && (first.type || first.role);
            const secondIsMeta = second && typeof second === 'object' && !second.type && !second.role;
            rawChunks = firstIsMsg ? (secondIsMeta ? [first] : c.data) : c.data;
          } else {
            rawChunks = Array.isArray(c.data) ? c.data : [c.data];
          }

          for (const msgChunk of rawChunks) {
            if (msgChunk && getRole(msgChunk) && getRole(msgChunk) !== 'user') {
              // "messages" 事件无法区分 partial/complete,按 partial 处理(流结束 final sync 会修正)
              const evt = c.event === 'messages/complete' ? 'messages/complete' : 'messages/partial';
              upsertStreamingMsg(msgChunk, evt);
            }
          }
        }
      }

      // 流结束/中止后,从服务端拉取最终状态做"补充同步"(不覆盖已渲染内容,只补缺失)
      try {
        const state = await client.threads.getState(threadId);
        const stateValues = state.values as any;
        const historyMessages: any[] = stateValues?.messages || [];

        setMessages(prev => {
          // 收集本地已有的 LangGraph id(流式期间已绑定的)和内容指纹
          const localLgIds = new Set<string>();
          const localContentKeys = new Set<string>();
          const localUserContents = new Set<string>();
          for (const m of prev) {
            if (m.role === 'user') localUserContents.add(m.content.trim());
            // 通过 streamedMsgIds 已知哪些 lgId 已被渲染;另外用内容+角色去重
            localContentKeys.add(`${m.role}:${m.content.trim()}`);
          }
          for (const lgId of streamedMsgIds.keys()) localLgIds.add(lgId);

          const merged: Message[] = [...prev];
          // 清除思考占位和所有 isStreaming 标记
          const cleaned = merged
            .filter(m => m.id !== placeholderId)
            .map(m => ({ ...m, isStreaming: false }));

          // 追加服务端有但本地没有的消息(按服务端顺序插入到最后)
          const newMsgs: Message[] = [];
          for (const m of historyMessages) {
            const role = getRole(m);
            if (!role) continue;
            const text = extractText(m.content);
            const toolCallText = role === 'agent' ? getToolCallText(m) : '';
            const content = text + (text && toolCallText ? '\n' : '') + toolCallText;
            if (!content.trim()) continue;

            // 跳过已在本地的 user 消息
            if (role === 'user') {
              if (localUserContents.has(content.trim())) continue;
              // 也跳过本次发送的内容(可能有 server 分配的不同 id)
              if (sentContent && content.trim() === sentContent.trim()) continue;
            }

            // 跳过已通过 lgId 或内容指纹匹配的消息
            if (m.id && localLgIds.has(m.id)) continue;
            const key = `${role}:${content.trim()}`;
            if (localContentKeys.has(key)) continue;

            newMsgs.push({
              id: m.id || `server-${Date.now()}-${newMsgs.length}`,
              role,
              content,
              toolName: role === 'tool' ? getToolName(m) : undefined,
              isStreaming: false,
            });
            localContentKeys.add(key);
          }

          return [...cleaned, ...newMsgs];
        });
      } catch (syncErr) {
        console.warn('同步最终消息状态失败:', syncErr);
        // 同步失败时,至少清除所有 isStreaming 标记和思考占位
        setMessages(prev =>
          prev
            .filter(m => m.id !== placeholderId)
            .map(m => ({ ...m, isStreaming: false }))
        );
      }

      // 中止场景:标记停止提示
      if (controller.signal.aborted) {
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'agent' && !last.content.trim()) {
            return [...prev.slice(0, -1), { ...last, content: '（已停止生成）', isStreaming: false }];
          }
          return prev.map(m => ({ ...m, isStreaming: false }));
        });
      }

      // 刷新侧边栏会话列表
      await fetchThreads();

    } catch (error: any) {
      if (error?.name === 'AbortError') {
        console.log('流式请求已被用户中止');
        // 中止后做补充同步(与主流程一致,不覆盖已渲染内容)
        try {
          const state = await client.threads.getState(threadId);
          const stateValues = state.values as any;
          const historyMessages: any[] = stateValues?.messages || [];
          setMessages(prev => {
            const localLgIds = new Set<string>();
            const localContentKeys = new Set<string>();
            const localUserContents = new Set<string>();
            for (const m of prev) {
              if (m.role === 'user') localUserContents.add(m.content.trim());
              localContentKeys.add(`${m.role}:${m.content.trim()}`);
            }
            for (const lgId of streamedMsgIds.keys()) localLgIds.add(lgId);
            const cleaned = prev.filter(m => m.id !== placeholderId).map(m => ({ ...m, isStreaming: false }));
            const newMsgs: Message[] = [];
            for (const m of historyMessages) {
              const role = getRole(m);
              if (!role) continue;
              const text = extractText(m.content);
              const toolCallText = role === 'agent' ? getToolCallText(m) : '';
              const content = text + (text && toolCallText ? '\n' : '') + toolCallText;
              if (!content.trim()) continue;
              if (role === 'user') {
                if (localUserContents.has(content.trim())) continue;
                if (sentContent && content.trim() === sentContent.trim()) continue;
              }
              if (m.id && localLgIds.has(m.id)) continue;
              const key = `${role}:${content.trim()}`;
              if (localContentKeys.has(key)) continue;
              newMsgs.push({
                id: m.id || `server-${Date.now()}-${newMsgs.length}`,
                role, content,
                toolName: role === 'tool' ? getToolName(m) : undefined,
                isStreaming: false,
              });
              localContentKeys.add(key);
            }
            return [...cleaned, ...newMsgs];
          });
        } catch {
          setMessages(prev =>
            prev.filter(m => m.id !== placeholderId).map(m => ({ ...m, isStreaming: false }))
          );
        }
        await fetchThreads();
        return;
      }
      if (error?.status === 404 || error?.message?.includes('404')) {
        console.warn('当前会话已失效,自动创建新会话');
        navigate('/chat', { replace: true });
        setMessages(prev => [
          ...prev.filter(m => m.id !== placeholderId),
          { id: Date.now().toString(), role: 'agent', content: '当前会话已失效,已为您创建新会话,请重新发送。' }
        ]);
        return;
      }
      console.error('发送消息失败:', error);
      setMessages(prev => [
        ...prev.filter(m => m.id !== placeholderId),
        { id: Date.now().toString(), role: 'agent', content: '抱歉，服务似乎出现了一些问题，请稍后再试。' }
      ]);
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      currentRunIdRef.current = null;
      setIsStreaming(false);
      setTimeout(() => { isSendingRef.current = false; }, 0);
    }
  };

  /**
   * 停止生成:中止客户端流 + 通知服务端取消 run
   * 由 InputArea 的停止按钮调用
   */
  const handleStop = () => {
    // 1. 客户端中止 HTTP 流(立即停止接收)
    abortControllerRef.current?.abort();
    // 2. 通知服务端取消 run(阻止模型继续推理和输出)
    const runId = currentRunIdRef.current;
    if (runId && threadId) {
      client.runs.cancel(threadId, runId, false, 'interrupt').catch(err => {
        console.warn('取消服务端 run 失败:', err);
      });
    }
  };

  /**
   * 键盘事件:Enter 发送、Shift+Enter 换行
   * 注意:中文输入法合成期间(isComposing)不触发发送,避免候选词上屏时误发送
   */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !isComposingRef.current) {
      e.preventDefault();
      void handleSend();
    }
  };

  /**
   * 安全的输入变更处理:发送锁定期间忽略写入,防止发送后脏值弹回
   */
  const handleInputChange = (value: string) => {
    if (isSendingRef.current) return;
    setInput(value);
  };

  /** IME 合成开始 */
  const handleCompositionStart = () => {
    isComposingRef.current = true;
  };

  /** IME 合成结束 */
  const handleCompositionEnd = (e: React.CompositionEvent<HTMLTextAreaElement>) => {
    isComposingRef.current = false;
    // compositionend 时 React 可能尚未同步最新值到 state,这里手动同步
    if (isSendingRef.current) return;
    setInput((e.target as HTMLTextAreaElement).value);
  };

  return (
    <>
      <MessageList
        messages={messages}
        isLoading={isStreaming}
        messagesEndRef={messagesEndRef}
      />
      <InputArea
        input={input}
        isLoading={isStreaming}
        onInputChange={handleInputChange}
        onSend={handleSend}
        onStop={handleStop}
        onKeyDown={handleKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
      />
    </>
  );
}
