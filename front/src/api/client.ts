import { Client } from '@langchain/langgraph-sdk';

// 初始化 LangGraph 官方 SDK 客户端，指向 langgraph dev 默认端口 2024
export const client = new Client({ apiUrl: 'http://localhost:2024' });
