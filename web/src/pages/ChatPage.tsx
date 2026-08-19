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

  // 滚动到底部
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // 消息变化时自动滚动到底部
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

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

      // 将 LangGraph 的消息格式转换为前端统一的 Message 格式
      const formattedMessages: Message[] = historyMessages.map((m: any, idx: number) => ({
        id: m.id || idx.toString(),
        role: (m.type === 'human' || m.role === 'user') ? 'user' : 'agent',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      }));

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
      // thread 被 LangGraph 服务端清理(如 dev 模式重启导致内存状态丢失),
      // 自动回退到 /chat,让 initThread 创建新会话
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
   * 发送消息:校验 → 乐观更新 → 流式调用智能体 → 实时渲染响应 → 异常兜底
   *
   * 支持中止:通过 abortControllerRef 持有 AbortController,停止按钮可调 handleStop 中止流式请求
   */
  const handleSend = async () => {
    if (!input.trim() || !threadId) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim()
    };

    const agentMessageId = (Date.now() + 1).toString();

    // 乐观更新:先插入用户消息 + 空 agent 消息占位
    setMessages(prev => [
      ...prev,
      userMessage,
      { id: agentMessageId, role: 'agent', content: '' }
    ]);

    setInput('');
    setIsStreaming(true);

    // 创建本次请求的 AbortController,供停止按钮中止使用
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      // 流式调用 LangGraph 智能体(传入 signal 支持中止)
      const streamResponse = client.runs.stream(
        threadId,
        'lead_agent',
        {
          input: {
            messages: [{ role: 'user', content: userMessage.content }]
          },
          streamMode: 'messages',
          signal: controller.signal,
        }
      );

      let finalContent = '';

      // 消费流式响应:逐块读取并更新占位消息
      for await (const chunk of streamResponse) {
        // 用户已点停止:提前退出循环
        if (controller.signal.aborted) break;

        const c = chunk as any;

        if (c.event === 'messages/partial') {
          if (Array.isArray(c.data) && c.data.length > 0) {
            const msgChunk = c.data[0];
            if (msgChunk && (msgChunk.type === 'AIMessageChunk' || msgChunk.type === 'ai' || msgChunk.role === 'assistant')) {
              const currentText = typeof msgChunk.content === 'string' ? msgChunk.content : '';

              if (currentText && currentText !== finalContent) {
                finalContent = currentText;
                setMessages(prev =>
                  prev.map(m => m.id === agentMessageId ? { ...m, content: finalContent } : m)
                );
              }
            }
          }
        }
      }

      // 用户主动中止:保留已生成的内容,补一句"已停止"提示
      if (controller.signal.aborted) {
        setMessages(prev =>
          prev.map(m => m.id === agentMessageId
            ? { ...m, content: finalContent || '（已停止生成）' }
            : m
          )
        );
        // 刷新侧边栏(中止后消息已写入 thread state)
        await fetchThreads();
        return;
      }

      // 空响应兜底
      if (!finalContent) {
        setMessages(prev =>
          prev.map(m => m.id === agentMessageId ? { ...m, content: '抱歉，没有收到回复。' } : m)
        );
      }

      // 刷新侧边栏会话列表
      await fetchThreads();

    } catch (error: any) {
      // AbortError 是用户主动停止,不算异常
      if (error?.name === 'AbortError') {
        console.log('流式请求已被用户中止');
        return;
      }
      // thread 在发送过程中被服务端清理(如 dev 模式重启),自动回退创建新会话
      if (error?.status === 404 || error?.message?.includes('404')) {
        console.warn('当前会话已失效,自动创建新会话');
        navigate('/chat', { replace: true });
        setMessages(prev =>
          prev.map(m => m.id === agentMessageId ? { ...m, content: '当前会话已失效,已为您创建新会话,请重新发送。' } : m)
        );
        return;
      }
      console.error('发送消息失败:', error);
      setMessages(prev =>
        prev.map(m => m.id === agentMessageId ? { ...m, content: '抱歉，服务似乎出现了一些问题，请稍后再试。' } : m)
      );
    } finally {
      // 清理 controller 引用,避免泄漏
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setIsStreaming(false);
    }
  };

  /**
   * 停止生成:中止当前流式请求
   * 由 InputArea 的停止按钮调用
   */
  const handleStop = () => {
    abortControllerRef.current?.abort();
  };

  /**
   * 键盘事件:Enter 发送、Shift+Enter 换行
   */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
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
        onInputChange={setInput}
        onSend={handleSend}
        onStop={handleStop}
        onKeyDown={handleKeyDown}
      />
    </>
  );
}
