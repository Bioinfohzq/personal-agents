import { assertBusinessResponse, businessFetch } from './http';
import type {
  FileSystemEntry,
  PermissionDetail,
  StorageItem,
} from '../types/filesystem';

// scanDirectory 扫描目录,返回子条目列表
//   path: 要扫描的目录路径,不传则默认 home 目录
//   depth: 扫描深度,默认 1,最大 2
export async function scanDirectory(
  token: string,
  path?: string,
  depth?: number,
): Promise<{ path: string; entries: FileSystemEntry[] }> {
  const params = new URLSearchParams();
  if (path) params.set('path', path);
  if (depth) params.set('depth', String(depth));
  const query = params.toString();
  const url = query
    ? `/api/v1/filesystem/scan?${query}`
    : '/api/v1/filesystem/scan';

  const response = await businessFetch(token, url);
  await assertBusinessResponse(response, '扫描目录失败');

  return response.json() as Promise<{ path: string; entries: FileSystemEntry[] }>;
}

// getStorageAnalysis 分析磁盘占用,返回各子目录大小(降序排列)
export async function getStorageAnalysis(
  token: string,
  path?: string,
): Promise<{ path: string; items: StorageItem[] }> {
  const params = new URLSearchParams();
  if (path) params.set('path', path);
  const query = params.toString();
  const url = query
    ? `/api/v1/filesystem/storage?${query}`
    : '/api/v1/filesystem/storage';

  const response = await businessFetch(token, url);
  await assertBusinessResponse(response, '分析磁盘占用失败');

  return response.json() as Promise<{ path: string; items: StorageItem[] }>;
}

// getPermissions 查看文件/目录详细权限
export async function getPermissions(
  token: string,
  path: string,
): Promise<PermissionDetail> {
  const params = new URLSearchParams({ path });
  const response = await businessFetch(
    token,
    `/api/v1/filesystem/permissions?${params}`,
  );
  await assertBusinessResponse(response, '获取权限信息失败');

  return response.json() as Promise<PermissionDetail>;
}
