// 知识库分类:与后端 validCategories 白名单一一对应
export const KNOWLEDGE_CATEGORIES = [
  { value: 'system-path', label: '系统文件层级' },
  { value: 'url-resource', label: 'URL 资源' },
  { value: 'hardware', label: '硬件知识' },
  { value: 'algorithm', label: '算法学习' },
  { value: 'other', label: '其他' },
] as const;

export type KnowledgeCategory = string;

// 模板类型
export type TemplateType = 'article' | 'procedure';

// 流程模板单步骤
export interface ProcedureStep {
  title: string;
  code?: string;
  note?: string;
}

// 模板类型中文标签
export function getTemplateTypeLabel(type: TemplateType): string {
  return type === 'procedure' ? '流程模板' : '文章模板';
}

// 自定义分类(用户通过"添加分类"创建)的 localStorage key
const CUSTOM_CATEGORIES_KEY = 'knowledgebook.custom-categories';

export interface CustomCategory {
  value: string;
  label: string;
}

// 读取用户自定义分类列表
export function loadCustomCategories(): CustomCategory[] {
  try {
    const raw = localStorage.getItem(CUSTOM_CATEGORIES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CustomCategory[];
    return Array.isArray(parsed) ? parsed.filter((item) => item && item.value && item.label) : [];
  } catch {
    return [];
  }
}

// 保存用户自定义分类列表
export function saveCustomCategories(list: CustomCategory[]): void {
  try {
    localStorage.setItem(CUSTOM_CATEGORIES_KEY, JSON.stringify(list));
  } catch {
    // localStorage 不可用时静默忽略
  }
}

// 将用户输入的分类名转换为存储用的 slug(如 "前端" → "custom-前端")
export function slugifyCategory(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return '';
  if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(trimmed)) return trimmed;
  return `custom-${trimmed}`;
}

// 固定分类 + 自定义分类合并后的完整列表
// "其他"始终排在最下面
export function getAllCategories(custom: CustomCategory[]): Array<{ value: string; label: string }> {
  const fixed = KNOWLEDGE_CATEGORIES.map((item) => ({ value: item.value as string, label: item.label }));
  const others = fixed.filter((item) => item.value === 'other');
  const nonOthers = fixed.filter((item) => item.value !== 'other');
  return [...nonOthers, ...custom, ...others];
}

// 系统文件层级专属字段
export interface SystemPathExtra {
  path?: string;
  parent_path?: string;
  risk_level?: 'safe' | 'caution' | 'danger';
  can_cleanup?: boolean;
  cleanup_command?: string;
  related_paths?: string[];
}

// URL 资源专属字段
export interface UrlResourceExtra {
  url?: string;
  site_name?: string;
  resource_type?: '文档' | '教程' | '社区' | '工具' | '视频' | '博客';
  language?: string;
}

// 硬件知识专属字段
export interface HardwareExtra {
  hardware_type?: string;
  brand_model?: string;
  key_specs?: string[];
  use_case?: string;
}

// 算法学习专属字段
export interface AlgorithmExtra {
  difficulty?: '入门' | '中等' | '进阶';
  algorithm_type?: string;
  language?: string;
  code_example?: string;
  time_complexity?: string;
  space_complexity?: string;
}

export type KnowledgeExtra = SystemPathExtra | UrlResourceExtra | HardwareExtra | AlgorithmExtra | Record<string, unknown>;

// 知识摘要(列表用)
export interface KnowledgeSummary {
  id: number;
  title: string;
  category: KnowledgeCategory;
  sub_category?: string;
  tags?: string;
  summary?: string;
  template_type: TemplateType;
  created_at: string;
  updated_at: string;
}

// 知识详情
export interface KnowledgeDetail extends KnowledgeSummary {
  content?: string;
  notes?: string;
  reference_url?: string;
  extra?: string;
  steps?: ProcedureStep[];
}

// 创建/更新知识的请求体
export interface KnowledgeInput {
  title: string;
  category: KnowledgeCategory;
  sub_category: string;
  tags: string;
  summary: string;
  content: string;
  notes: string;
  reference_url: string;
  extra: string;
  template_type: TemplateType;
  steps: ProcedureStep[];
}

// 空表单初始值
export const emptyKnowledgeForm: KnowledgeInput = {
  title: '',
  category: 'system-path',
  sub_category: '',
  tags: '',
  summary: '',
  content: '',
  notes: '',
  reference_url: '',
  extra: '',
  template_type: 'article',
  steps: [],
};

// AI 解析请求
export interface ParseAIRequest {
  raw_text: string;
  category: KnowledgeCategory;
  template_type: TemplateType;
}

// AI 解析结果
export interface ParseAIResponse {
  title: string;
  category: string;
  sub_category: string;
  tags: string;
  summary: string;
  content: string;
  notes: string;
  reference_url: string;
  extra: string;
  template_type: TemplateType;
  steps: ProcedureStep[];
}

// 根据分类值获取中文标签
export function getCategoryLabel(value: string): string {
  return KNOWLEDGE_CATEGORIES.find((item) => item.value === value)?.label ?? value;
}

// 将 extra JSON 字符串解析为对象
export function parseExtra<T extends KnowledgeExtra = Record<string, unknown>>(extra: string | undefined): T {
  if (!extra) return {} as T;
  try {
    return JSON.parse(extra) as T;
  } catch {
    return {} as T;
  }
}

// 将 extra 对象序列化为 JSON 字符串
export function stringifyExtra(extra: KnowledgeExtra | undefined): string {
  if (!extra || Object.keys(extra).length === 0) return '';
  try {
    return JSON.stringify(extra, null, 2);
  } catch {
    return '';
  }
}

// 将 tags 字符串解析为标签数组
export function parseTags(tags: string | undefined): string[] {
  if (!tags) return [];
  return tags.split(',').map((tag) => tag.trim()).filter(Boolean);
}

// 将数组格式规格(如 ["核心数|12"])解析为对象数组
export function parseKeySpecs(specs: string[] | undefined): Array<{ key: string; value: string }> {
  if (!specs || specs.length === 0) return [];
  return specs.map((spec) => {
    const parts = spec.split('|').map((part) => part.trim());
    return { key: parts[0] ?? '', value: parts[1] ?? '' };
  }).filter((item) => item.key && item.value);
}

// 风险等级中文标签
export function getRiskLabel(level: string | undefined): string {
  switch (level) {
    case 'safe': return '安全';
    case 'caution': return '谨慎';
    case 'danger': return '危险';
    default: return level ?? '未知';
  }
}

// 风险等级对应颜色
export function getRiskColor(level: string | undefined): string {
  switch (level) {
    case 'safe': return 'text-green-600 bg-green-50 border-green-200';
    case 'caution': return 'text-amber-600 bg-amber-50 border-amber-200';
    case 'danger': return 'text-red-600 bg-red-50 border-red-200';
    default: return 'text-gray-600 bg-gray-50 border-gray-200';
  }
}
