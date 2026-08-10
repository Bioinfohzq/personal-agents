import { assertBusinessResponse, businessFetch } from './http';
import type {
  PasswordbookItemDetail,
  PasswordbookItemInput,
  PasswordbookItemSummary,
} from '../types/passwordbook';

export async function listPasswordbookItems(token: string): Promise<PasswordbookItemSummary[]> {
  const response = await businessFetch(token, '/api/v1/passwordbook/items');

  await assertBusinessResponse(response, '加载密码本失败');

  const data = await response.json() as { items: PasswordbookItemSummary[] };
  return data.items ?? [];
}

export async function getPasswordbookItem(token: string, itemId: number): Promise<PasswordbookItemDetail> {
  const response = await businessFetch(token, `/api/v1/passwordbook/items/${itemId}`);

  await assertBusinessResponse(response, '读取账号详情失败');

  return response.json() as Promise<PasswordbookItemDetail>;
}

export async function createPasswordbookItem(
  token: string,
  input: PasswordbookItemInput,
): Promise<PasswordbookItemDetail> {
  const response = await businessFetch(token, '/api/v1/passwordbook/items', {
    method: 'POST',
    body: JSON.stringify(input),
  });

  await assertBusinessResponse(response, '创建账号失败');

  return response.json() as Promise<PasswordbookItemDetail>;
}

export async function updatePasswordbookItem(
  token: string,
  itemId: number,
  input: PasswordbookItemInput,
): Promise<PasswordbookItemDetail> {
  const response = await businessFetch(token, `/api/v1/passwordbook/items/${itemId}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });

  await assertBusinessResponse(response, '更新账号失败');

  return response.json() as Promise<PasswordbookItemDetail>;
}

export async function deletePasswordbookItem(token: string, itemId: number): Promise<void> {
  const response = await businessFetch(token, `/api/v1/passwordbook/items/${itemId}`, {
    method: 'DELETE',
  });

  await assertBusinessResponse(response, '删除账号失败');
}
