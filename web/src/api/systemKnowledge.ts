import { businessFetch, assertBusinessResponse } from './http';

// 节点类型
export type SkNodeType = 'dir' | 'file';

// 系统知识分类
export const SK_CATEGORIES = {
  linuxFHS: 'linux-fhs',
  syscall: 'syscall',
  process: 'process',
  memory: 'memory',
  driver: 'driver',
  cpu: 'cpu',
} as const;

export type SkCategory = typeof SK_CATEGORIES[keyof typeof SK_CATEGORIES];

// 系统知识节点
export interface SkNode {
  id: number;
  user_id: number;
  category: SkCategory;
  parent_path: string;
  path: string;
  name: string;
  node_type: SkNodeType;
  description: string;
  contents: string;
  examples: string[];
  sort_order: number;
  is_builtin: boolean;
  is_custom: boolean;
  created_at: string;
  updated_at: string;
}

// 获取分类下所有节点
export async function listSystemKnowledgeNodes(token: string, category: SkCategory): Promise<SkNode[]> {
  const res = await businessFetch(token, `/system-knowledge/nodes?category=${encodeURIComponent(category)}`);
  await assertBusinessResponse(res, '获取知识节点失败');
  const data = await res.json() as { nodes: SkNode[] };
  return data.nodes;
}

// 创建节点
export interface CreateSkNodeParams {
  category: SkCategory;
  parent_path: string;
  name: string;
  node_type?: SkNodeType;
  description?: string;
  contents?: string;
  examples?: string[];
}

export async function createSystemKnowledgeNode(token: string, params: CreateSkNodeParams): Promise<SkNode> {
  const res = await businessFetch(token, '/system-knowledge/nodes', {
    method: 'POST',
    body: JSON.stringify({
      node_type: 'dir',
      description: '',
      contents: '',
      examples: [],
      ...params,
    }),
  });
  await assertBusinessResponse(res, '创建节点失败');
  return res.json() as Promise<SkNode>;
}

// 更新节点内容
export interface UpdateSkNodeParams {
  category: SkCategory;
  path: string;
  description?: string;
  contents?: string;
  examples?: string[];
}

export async function updateSystemKnowledgeNode(token: string, params: UpdateSkNodeParams): Promise<SkNode> {
  const res = await businessFetch(token, '/system-knowledge/nodes', {
    method: 'PUT',
    body: JSON.stringify(params),
  });
  await assertBusinessResponse(res, '更新节点失败');
  return res.json() as Promise<SkNode>;
}

// 删除节点
export async function deleteSystemKnowledgeNode(token: string, category: SkCategory, path: string): Promise<{ restored_builtin: boolean }> {
  const res = await businessFetch(
    token,
    `/system-knowledge/nodes?category=${encodeURIComponent(category)}&path=${encodeURIComponent(path)}`,
    { method: 'DELETE' },
  );
  await assertBusinessResponse(res, '删除节点失败');
  return res.json() as Promise<{ restored_builtin: boolean }>;
}

// 重置分类(清空用户所有自定义内容)
export async function resetSystemKnowledgeCategory(token: string, category: SkCategory): Promise<SkNode[]> {
  const res = await businessFetch(
    token,
    `/system-knowledge/reset?category=${encodeURIComponent(category)}`,
    { method: 'POST' },
  );
  await assertBusinessResponse(res, '重置失败');
  const data = await res.json() as { nodes: SkNode[] };
  return data.nodes;
}
