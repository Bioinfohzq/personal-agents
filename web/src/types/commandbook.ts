// 命令分类:与后端 validCategories 白名单一一对应
export const COMMAND_CATEGORIES = [
  { value: 'linux', label: 'Linux 命令' },
  { value: 'python', label: 'Python' },
  { value: 'java', label: 'Java' },
  { value: 'git', label: 'Git' },
  { value: 'docker', label: 'Docker' },
  { value: 'sql', label: 'SQL' },
  { value: 'other', label: '其他' },
] as const;

export type CommandCategory = string;

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
  return type === 'procedure' ? '流程模板' : '单条命令';
}

// 自定义分类(用户通过"添加分类"创建)的 localStorage key
const CUSTOM_CATEGORIES_KEY = 'commandbook.custom-categories';

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
  const fixed = COMMAND_CATEGORIES.map((item) => ({ value: item.value as string, label: item.label }));
  const others = fixed.filter((item) => item.value === 'other');
  const nonOthers = fixed.filter((item) => item.value !== 'other');
  return [...nonOthers, ...custom, ...others];
}

// 命令摘要(列表用,不含 introduction / parameters / notes 正文)
export interface CommandSummary {
  id: number;
  title: string;             // 标题(兼一句话含义)
  command_text: string;
  category: string;
  sub_category?: string;
  template_type: TemplateType;
  created_at: string;
  updated_at: string;
}

// 命令详情(含 introduction / parameters / scenarios / notes / steps)
export interface CommandDetail extends CommandSummary {
  introduction?: string;     // 详细介绍
  parameters?: string;       // 多行文本,每行格式 "参数|全称|含义"
  scenarios?: string;        // 使用场景,多行文本,每个场景两行(描述 + 示例命令)
  notes?: string;            // 我的理解(个人笔记)
  reference_url?: string;    // 官方文档/教程资源链接
  steps?: ProcedureStep[];   // 流程模板步骤列表
}

// 创建/更新命令的请求体
//
// title 字段合并了"标题"和"一句话含义",所以没有独立的 description 字段。
// parameters 为三级参数说明,多行文本,每行格式 "参数|全称|含义"(如 "-s|--summarize|只显示总计")。
// introduction 为详细介绍(官方/通用说明),notes 为个人理解(我的笔记)。
// template_type 为模板类型: article=单条命令, procedure=流程模板; steps 为流程模板步骤列表。
export interface CommandInput {
  title: string;
  command_text: string;
  category: string;
  sub_category: string;
  introduction: string;
  parameters: string;
  scenarios: string;
  notes: string;
  reference_url: string;
  template_type: TemplateType;
  steps: ProcedureStep[];
}

// 空表单初始值
export const emptyCommandForm: CommandInput = {
  title: '',
  command_text: '',
  category: 'linux',
  sub_category: '',
  introduction: '',
  parameters: '',
  scenarios: '',
  notes: '',
  reference_url: '',
  template_type: 'article',
  steps: [],
};

// AI 解析请求
export interface ParseAIRequest {
  raw_text: string;
  category: string;
  template_type: TemplateType;
}

// AI 解析结果
export interface ParseAIResponse {
  title: string;
  command_text: string;
  category: string;
  sub_category: string;
  introduction: string;
  parameters: string;
  scenarios: string;
  notes: string;
  reference_url: string;
  template_type: TemplateType;
  steps: ProcedureStep[];
}

// 根据分类值获取中文标签
export function getCategoryLabel(value: string): string {
  return COMMAND_CATEGORIES.find((item) => item.value === value)?.label ?? value;
}

// parseParameters 解析参数说明文本为结构化数组
//
// 支持的输入格式(每行一个):
//   -s|--summarize|只显示总计
//   -s --summarize 只显示总计
//   -s:--summarize:只显示总计
//
// 输出:[{ param: "-s", fullName: "--summarize", desc: "只显示总计" }, ...]
// 空行或字段不足的行会被忽略
export function parseParameters(text: string | undefined): Array<{ param: string; fullName: string; desc: string }> {
  if (!text) return [];

  const result: Array<{ param: string; fullName: string; desc: string }> = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    // 1. 优先按显式分隔符(| 或 :)切分
    const explicitParts = line.split(/[|:]/).map((part) => part.trim()).filter(Boolean);
    if (explicitParts.length >= 2) {
      const param = explicitParts[0];
      const fullName = explicitParts.length >= 3 ? explicitParts[1] : '';
      const desc = explicitParts.length >= 3
        ? explicitParts.slice(2).join(' | ')
        : explicitParts.slice(1).join(' | ');
      if (param && desc) {
        result.push({ param, fullName, desc });
      }
      continue;
    }

    // 2. 没有显式分隔符时,按空白切分,前两个 token 分别是参数和全称,后面是含义
    const tokens = line.split(/\s+/).filter(Boolean);
    if (tokens.length >= 3) {
      const [param, fullName, ...descTokens] = tokens;
      const desc = descTokens.join(' ');
      if (param && desc) {
        result.push({ param, fullName: fullName ?? '', desc });
      }
    } else if (tokens.length === 2) {
      const [param, desc] = tokens;
      if (param && desc) {
        result.push({ param, fullName: '', desc });
      }
    }
  }
  return result;
}
