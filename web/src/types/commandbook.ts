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

export type CommandCategory = (typeof COMMAND_CATEGORIES)[number]['value'];

// 命令摘要(列表用,不含 introduction / parameters / notes 正文)
export interface CommandSummary {
  id: number;
  title: string;             // 标题(兼一句话含义)
  command_text: string;
  category: string;
  sub_category?: string;
  created_at: string;
  updated_at: string;
}

// 命令详情(含 introduction / parameters / notes)
export interface CommandDetail extends CommandSummary {
  introduction?: string;     // 详细介绍
  parameters?: string;       // 多行文本,每行格式 "参数|全称|含义"
  notes?: string;            // 我的理解(个人笔记)
  reference_url?: string;    // 官方文档/教程资源链接
}

// 创建/更新命令的请求体
//
// title 字段合并了"标题"和"一句话含义",所以没有独立的 description 字段。
// parameters 为三级参数说明,多行文本,每行格式 "参数|全称|含义"(如 "-s|--summarize|只显示总计")。
// introduction 为详细介绍(官方/通用说明),notes 为个人理解(我的笔记)。
export interface CommandInput {
  title: string;
  command_text: string;
  category: string;
  sub_category: string;
  introduction: string;
  parameters: string;
  notes: string;
  reference_url: string;
}

// 空表单初始值
export const emptyCommandForm: CommandInput = {
  title: '',
  command_text: '',
  category: 'linux',
  sub_category: '',
  introduction: '',
  parameters: '',
  notes: '',
  reference_url: '',
};

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
