import { Bot, Loader2, Search, Brain, Database, Cog, Smartphone, FileSearch } from 'lucide-react';
import type { Message } from '../../types/chat';
import { MessageBubble } from './MessageBubble';

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
  pendingTool: string | null;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  onSaveToKnowledge?: (message: Message) => void;
}

/**
 * 根据工具状态文字选择对应的图标组件
 */
function getToolIcon(text: string) {
  const iconCls = 'w-4 h-4 text-gray-400';
  if (text.includes('知识') || text.includes('检索') || text.includes('搜索')) {
    return <Search className={iconCls} />;
  }
  if (text.includes('记忆') || text.includes('回忆')) {
    return <Brain className={iconCls} />;
  }
  if (text.includes('保存') || text.includes('写入')) {
    return <Database className={iconCls} />;
  }
  if (text.includes('设备') || text.includes('屏幕') || text.includes('界面')) {
    return <Smartphone className={iconCls} />;
  }
  if (text.includes('文件')) {
    return <FileSearch className={iconCls} />;
  }
  return <Cog className={iconCls} />;
}

/** 三点加载动画 */
function Dots() {
  return (
    <span className="flex gap-0.5">
      <span className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
      <span className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
      <span className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
    </span>
  );
}

/**
 * 流式等待状态气泡（初始思考/工具调用中）
 * 复用于空isStreaming agent占位气泡
 */
function ThinkingBubble({ pendingTool }: { pendingTool: string | null }) {
  return (
    <div className="flex items-start space-x-4">
      <div className="w-10 h-10 rounded-full bg-gray-800 text-gray-100 flex items-center justify-center shrink-0">
        <Bot size={20} />
      </div>
      <div className="bg-white border border-gray-100 text-gray-800 rounded-2xl rounded-tl-none px-5 py-3 shadow-sm flex items-center space-x-2">
        {pendingTool ? (
          <>
            {getToolIcon(pendingTool)}
            <span className="text-gray-500 text-sm">{pendingTool}...</span>
            <Dots />
          </>
        ) : (
          <>
            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            <span className="text-gray-500 text-sm">正在思考...</span>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * 工具调用后的"正在整理"迷你指示器
 * 用于tool消息已展示、AI正在基于工具结果生成回复的间隙
 * 样式比ThinkingBubble更轻量（更小padding、更淡颜色），隐式不打扰
 */
function ProcessingBubble({ pendingTool }: { pendingTool: string | null }) {
  return (
    <div className="flex items-start space-x-4">
      <div className="w-10 h-10 rounded-full bg-gray-800 text-gray-100 flex items-center justify-center shrink-0">
        <Bot size={20} />
      </div>
      <div className="bg-white/60 border border-gray-100 text-gray-400 rounded-2xl rounded-tl-none px-4 py-2 shadow-sm flex items-center space-x-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />
        <span className="text-xs text-gray-400">
          {pendingTool ? `${pendingTool}...` : '正在整理回复...'}
        </span>
        <Dots />
      </div>
    </div>
  );
}

export function MessageList({ messages, isLoading, pendingTool, messagesEndRef, onSaveToKnowledge }: MessageListProps) {
  // 是否存在正在流式输出的空agent气泡（ThinkingBubble位置）
  const hasStreamingPlaceholder = messages.some(
    m => m.role === 'agent' && m.content === '' && m.isStreaming
  );

  // 是否需要追加tool后的"正在整理"指示器：
  // 流式中 且 没有空占位气泡（已被tool消息替换） 且 最后一条不是有内容的agent流式消息
  const lastMsg = messages[messages.length - 1];
  const isAgentStreamingContent = lastMsg?.role === 'agent' && lastMsg.isStreaming && lastMsg.content.trim().length > 0;
  const showProcessingBubble = isLoading && !hasStreamingPlaceholder && !isAgentStreamingContent;

  return (
    <main className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 bg-gray-50/50">
      <div className="max-w-4xl mx-auto space-y-6">
        {messages.map((message) => {
          // 如果是正在流式输出的 agent 消息且内容为空,展示等待状态气泡
          if (message.role === 'agent' && message.content === '' && message.isStreaming) {
            return <ThinkingBubble key={message.id} pendingTool={pendingTool} />;
          }

          // 正常消息气泡(包含 agent / user / tool)
          return (
            <MessageBubble
              key={message.id}
              message={message}
              onSaveToKnowledge={onSaveToKnowledge}
            />
          );
        })}

        {/* 工具结果返回后、AI开始生成最终回复前的轻量等待指示器 */}
        {showProcessingBubble && <ProcessingBubble pendingTool={pendingTool} />}

        <div ref={messagesEndRef as React.RefObject<HTMLDivElement>} />
      </div>
    </main>
  );
}
