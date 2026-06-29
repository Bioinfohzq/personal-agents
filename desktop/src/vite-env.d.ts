/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LANGGRAPH_API_URL?: string;
  readonly VITE_LANGGRAPH_ASSISTANT_ID?: string;
  readonly VITE_BUSINESS_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
