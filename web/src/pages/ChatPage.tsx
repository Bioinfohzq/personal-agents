import { useEffect, useRef, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { client } from '../api/client';
import type { Message } from '../types/chat';
import { MessageList } from '../components/Chat/MessageList';
import { InputArea } from '../components/Chat/InputArea';
import type { MainLayoutContext } from '../layouts/MainLayout';

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

  // 消息列表底部引用,用于自动滚动到底部
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
    } catch (err) {
      console.error('Failed to load thread state:', err);
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
    setIsLoading(true);

    try {
      // 流式调用 LangGraph 智能体
      const streamResponse = client.runs.stream(
        threadId,
        'lead_agent',
        {
          input: {
            messages: [{ role: 'user', content: userMessage.content }]
          },
          streamMode: 'messages',
        }
      );

      let finalContent = '';

      // 消费流式响应:逐块读取并更新占位消息
      for await (const chunk of streamResponse) {
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

      // 空响应兜底
      if (!finalContent) {
        setMessages(prev =>
          prev.map(m => m.id === agentMessageId ? { ...m, content: '抱歉，没有收到回复。' } : m)
        );
      }

      // 刷新侧边栏会话列表
      await fetchThreads();

    } catch (error) {
      console.error('发送消息失败:', error);
      setMessages(prev =>
        prev.map(m => m.id === agentMessageId ? { ...m, content: '抱歉，服务似乎出现了一些问题，请稍后再试。' } : m)
      );
    } finally {
      setIsLoading(false);
    }
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
        isLoading={isLoading}
        messagesEndRef={messagesEndRef}
      />
      <InputArea
        input={input}
        isLoading={isLoading}
        onInputChange={setInput}
        onSend={handleSend}
        onKeyDown={handleKeyDown}
      />
    </>
  );
}
