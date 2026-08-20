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

// 命令摘要(列表用,不含 introduction / parameters / notes 正文)
export interface CommandSummary {
  id: number;
  title: string;             // 标题(兼一句话含义)
  command_text: string;
  category_id: number;
  category: string;
  category_slug: string;
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
  category_id: number;
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
  category_id: 0,
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
  category_id: number;
  template_type: TemplateType;
}

// AI 解析结果
export interface ParseAIResponse {
  title: string;
  command_text: string;
  category_id: number;
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
