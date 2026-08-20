import { assertBusinessResponse, businessFetch } from './http';
import type { Category, CategoryScope, CreateCategoryInput, RenameCategoryInput } from '../types/category';

// listCategories 查询当前用户在指定作用域下的分类列表
export async function listCategories(
  token: string,
  scope: CategoryScope,
): Promise<Category[]> {
  const response = await businessFetch(token, `/api/v1/categories?scope=${encodeURIComponent(scope)}`);
  await assertBusinessResponse(response, '加载分类列表失败');

  const data = await response.json() as { categories: Category[] };
  return data.categories ?? [];
}

// createCategory 创建自定义分类
export async function createCategory(
  token: string,
  input: CreateCategoryInput,
): Promise<Category> {
  const response = await businessFetch(token, '/api/v1/categories', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  await assertBusinessResponse(response, '创建分类失败');

  return response.json() as Promise<Category>;
}

// renameCategory 重命名自定义分类
export async function renameCategory(
  token: string,
  categoryId: number,
  input: RenameCategoryInput,
): Promise<Category> {
  const response = await businessFetch(token, `/api/v1/categories/${categoryId}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
  await assertBusinessResponse(response, '重命名分类失败');

  return response.json() as Promise<Category>;
}

// deleteCategory 删除自定义分类,该分类下记录会自动移动到默认分类
export async function deleteCategory(token: string, categoryId: number): Promise<void> {
  const response = await businessFetch(token, `/api/v1/categories/${categoryId}`, {
    method: 'DELETE',
  });
  await assertBusinessResponse(response, '删除分类失败');
}
