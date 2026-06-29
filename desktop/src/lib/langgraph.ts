import { Client } from '@langchain/langgraph-sdk';

export const LANGGRAPH_API_URL = import.meta.env.VITE_LANGGRAPH_API_URL ?? 'http://localhost:2024';
export const ASSISTANT_ID = import.meta.env.VITE_LANGGRAPH_ASSISTANT_ID ?? 'lead_agent';

export const langGraphClient = new Client({
  apiUrl: LANGGRAPH_API_URL,
});
