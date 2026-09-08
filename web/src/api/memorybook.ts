import { assertBusinessResponse, businessFetch } from './http';
import type { MemoryDetail, MemoryInput, MemorySummary, MemoryTopic } from '../types/memorybook';

// listMemories 查询记忆列表
//   可选参数 topic: 按主题分类过滤
//   可选参数 activeOnly: 只返回激活的记忆(默认false,返回全部含归档)
export async function listMemories(
  token: string,
  topic?: MemoryTopic,
  activeOnly?: boolean,
): Promise<MemorySummary[]> {
  const params = new URLSearchParams();
  if (topic) params.set('topic', topic);
  if (activeOnly) params.set('active', '1');
  const query = params.toString();
  const path = query ? `/api/v1/memories?${query}` : '/api/v1/memories';

  const response = await businessFetch(token, path);
  await assertBusinessResponse(response, '加载记忆列表失败');

  const data = await response.json() as { items: MemorySummary[] };
  return data.items ?? [];
}

// getMemory 获取单条记忆详情
export async function getMemory(token: string, id: number): Promise<MemoryDetail> {
  const response = await businessFetch(token, `/api/v1/memories/${id}`);
  await assertBusinessResponse(response, '读取记忆详情失败');
  return response.json() as Promise<MemoryDetail>;
}

// createMemory 创建记忆
export async function createMemory(
  token: string,
  input: MemoryInput,
): Promise<MemoryDetail> {
  const response = await businessFetch(token, '/api/v1/memories', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  await assertBusinessResponse(response, '创建记忆失败');
  return response.json() as Promise<MemoryDetail>;
}

// updateMemory 更新记忆
export async function updateMemory(
  token: string,
  id: number,
  input: MemoryInput,
): Promise<MemoryDetail> {
  const response = await businessFetch(token, `/api/v1/memories/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
  await assertBusinessResponse(response, '更新记忆失败');
  return response.json() as Promise<MemoryDetail>;
}

// deleteMemory 删除记忆
export async function deleteMemory(token: string, id: number): Promise<void> {
  const response = await businessFetch(token, `/api/v1/memories/${id}`, {
    method: 'DELETE',
  });
  await assertBusinessResponse(response, '删除记忆失败');
}
