import { Client } from '@langchain/langgraph-sdk';

// 初始化 LangGraph 官方 SDK 客户端，指向 langgraph dev 默认端口 2024
// streamProtocol: "legacy" → 使用传统 SSE（HTTP 长连接）流式传输，避免 WebSocket 在本地开发环境下握手失败
export const client = new Client({
  apiUrl: 'http://localhost:2024',
  streamProtocol: 'legacy',
});
