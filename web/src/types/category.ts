// 分类作用域
export type CategoryScope = 'knowledge' | 'command';

// 分类实体,对应后端 categories 表
export interface Category {
  id: number;
  user_id?: number;
  scope: CategoryScope;
  name: string;
  slug: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// 创建分类请求
export interface CreateCategoryInput {
  scope: CategoryScope;
  name: string;
}

// 重命名分类请求
export interface RenameCategoryInput {
  name: string;
}

// 知识库初始分类（用于新建用户时的参考,实际从数据库加载）
export const INITIAL_KNOWLEDGE_CATEGORIES = [
  { name: '系统文件层级', slug: 'system-path', sort_order: 1 },
  { name: 'URL 资源', slug: 'url-resource', sort_order: 2 },
  { name: '硬件知识', slug: 'hardware', sort_order: 3 },
  { name: '算法学习', slug: 'algorithm', sort_order: 4 },
  { name: '其他', slug: 'other', sort_order: 99 },
];

// 命令手册初始分类
export const INITIAL_COMMAND_CATEGORIES = [
  { name: 'Linux 命令', slug: 'linux', sort_order: 1 },
  { name: 'Python', slug: 'python', sort_order: 2 },
  { name: 'Java', slug: 'java', sort_order: 3 },
  { name: 'Git', slug: 'git', sort_order: 4 },
  { name: 'Docker', slug: 'docker', sort_order: 5 },
  { name: 'SQL', slug: 'sql', sort_order: 6 },
  { name: '其他', slug: 'other', sort_order: 99 },
];

// 将用户输入的分类名转换为 slug(仅允许小写字母、数字和连字符)
export function slugifyCategory(name: string): string {
  const trimmed = name.trim().toLowerCase();
  if (!trimmed) return '';
  const slug = trimmed
    .replace(/[^a-z0-9\-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) return `category-${Date.now()}`;
  return slug;
}

// 按 sort_order 排序分类,"其他"始终排在最后
export function sortCategories(categories: Category[]): Category[] {
  return [...categories].sort((a, b) => {
    if (a.slug === 'other') return 1;
    if (b.slug === 'other') return -1;
    return a.sort_order - b.sort_order;
  });
}
