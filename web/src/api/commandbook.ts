import { assertBusinessResponse, businessFetch } from './http';
import type {
  CommandDetail,
  CommandInput,
  CommandSummary,
  ParseAIRequest,
  ParseAIResponse,
} from '../types/commandbook';

// listCommands 查询命令列表
//   可选参数 category_id: 按分类 ID 过滤
//   可选参数 q: 关键词搜索(title / command_text / description / notes)
export async function listCommands(
  token: string,
  categoryId?: number,
  q?: string,
): Promise<CommandSummary[]> {
  const params = new URLSearchParams();
  if (categoryId) params.set('category_id', String(categoryId));
  if (q) params.set('q', q);
  const query = params.toString();
  const path = query ? `/api/v1/commands?${query}` : '/api/v1/commands';

  const response = await businessFetch(token, path);
  await assertBusinessResponse(response, '加载命令列表失败');

  const data = await response.json() as { commands: CommandSummary[] };
  return data.commands ?? [];
}

// getCommand 获取单条命令详情
export async function getCommand(token: string, commandId: number): Promise<CommandDetail> {
  const response = await businessFetch(token, `/api/v1/commands/${commandId}`);
  await assertBusinessResponse(response, '读取命令详情失败');

  return response.json() as Promise<CommandDetail>;
}

// createCommand 创建命令
export async function createCommand(
  token: string,
  input: CommandInput,
): Promise<CommandDetail> {
  const response = await businessFetch(token, '/api/v1/commands', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  await assertBusinessResponse(response, '创建命令失败');

  return response.json() as Promise<CommandDetail>;
}

// updateCommand 更新命令
export async function updateCommand(
  token: string,
  commandId: number,
  input: CommandInput,
): Promise<CommandDetail> {
  const response = await businessFetch(token, `/api/v1/commands/${commandId}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
  await assertBusinessResponse(response, '更新命令失败');

  return response.json() as Promise<CommandDetail>;
}

// deleteCommand 删除命令
export async function deleteCommand(token: string, commandId: number): Promise<void> {
  const response = await businessFetch(token, `/api/v1/commands/${commandId}`, {
    method: 'DELETE',
  });
  await assertBusinessResponse(response, '删除命令失败');
}

// moveCommandCategory 移动命令条目到指定分类（专用接口）
export async function moveCommandCategory(
  token: string,
  commandId: number,
  categoryId: number,
): Promise<void> {
  const response = await businessFetch(token, `/api/v1/commands/${commandId}/move`, {
    method: 'POST',
    body: JSON.stringify({ category_id: categoryId }),
  });
  await assertBusinessResponse(response, '移动分类失败');
}

// parseCommandAI 智能解析 AI 解释文本并预填命令字段
export async function parseCommandAI(
  token: string,
  request: ParseAIRequest,
): Promise<ParseAIResponse> {
  const response = await businessFetch(token, '/api/v1/commands/parse-ai', {
    method: 'POST',
    body: JSON.stringify(request),
  });
  await assertBusinessResponse(response, 'AI 解析失败');

  return response.json() as Promise<ParseAIResponse>;
}
