import { assertBusinessResponse, businessFetch } from './http';
import type {
  KnowledgeDetail,
  KnowledgeInput,
  KnowledgeSummary,
  ParseAIRequest,
  ParseAIResponse,
} from '../types/knowledgebook';

// listKnowledgeItems 查询知识库列表
//   可选参数 category_id: 按分类 ID 过滤
//   可选参数 q: 关键词搜索(title / summary / content / notes / tags)
export async function listKnowledgeItems(
  token: string,
  categoryId?: number,
  q?: string,
): Promise<KnowledgeSummary[]> {
  const params = new URLSearchParams();
  if (categoryId) params.set('category_id', String(categoryId));
  if (q) params.set('q', q);
  const query = params.toString();
  const path = query ? `/api/v1/knowledge?${query}` : '/api/v1/knowledge';

  const response = await businessFetch(token, path);
  await assertBusinessResponse(response, '加载知识库列表失败');

  const data = await response.json() as { items: KnowledgeSummary[] };
  return data.items ?? [];
}

// getKnowledgeItem 获取单条知识详情
export async function getKnowledgeItem(token: string, itemId: number): Promise<KnowledgeDetail> {
  const response = await businessFetch(token, `/api/v1/knowledge/${itemId}`);
  await assertBusinessResponse(response, '读取知识详情失败');

  return response.json() as Promise<KnowledgeDetail>;
}

// createKnowledgeItem 创建知识条目
export async function createKnowledgeItem(
  token: string,
  input: KnowledgeInput,
): Promise<KnowledgeDetail> {
  const response = await businessFetch(token, '/api/v1/knowledge', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  await assertBusinessResponse(response, '创建知识失败');

  return response.json() as Promise<KnowledgeDetail>;
}

// updateKnowledgeItem 更新知识条目
export async function updateKnowledgeItem(
  token: string,
  itemId: number,
  input: KnowledgeInput,
): Promise<KnowledgeDetail> {
  const response = await businessFetch(token, `/api/v1/knowledge/${itemId}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
  await assertBusinessResponse(response, '更新知识失败');

  return response.json() as Promise<KnowledgeDetail>;
}

// deleteKnowledgeItem 删除知识条目
export async function deleteKnowledgeItem(token: string, itemId: number): Promise<void> {
  const response = await businessFetch(token, `/api/v1/knowledge/${itemId}`, {
    method: 'DELETE',
  });
  await assertBusinessResponse(response, '删除知识失败');
}

// moveKnowledgeCategory 移动知识条目到指定分类（专用接口）
export async function moveKnowledgeCategory(
  token: string,
  itemId: number,
  categoryId: number,
): Promise<void> {
  const response = await businessFetch(token, `/api/v1/knowledge/${itemId}/move`, {
    method: 'POST',
    body: JSON.stringify({ category_id: categoryId }),
  });
  await assertBusinessResponse(response, '移动分类失败');
}

// parseKnowledgeAI 智能解析 AI 解释文本并预填知识字段
export async function parseKnowledgeAI(
  token: string,
  request: ParseAIRequest,
): Promise<ParseAIResponse> {
  const response = await businessFetch(token, '/api/v1/knowledge/parse-ai', {
    method: 'POST',
    body: JSON.stringify(request),
  });
  await assertBusinessResponse(response, 'AI 解析失败');

  return response.json() as Promise<ParseAIResponse>;
}
