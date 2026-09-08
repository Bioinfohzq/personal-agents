// 记忆主题分类
export type MemoryTopic =
  | 'personal_fact'
  | 'tech_preference'
  | 'project_convention'
  | 'lesson_learned'
  | 'communication_style';

// Topic 中文标签映射
export const TOPIC_LABELS: Record<MemoryTopic, string> = {
  personal_fact: '个人事实',
  tech_preference: '技术偏好',
  project_convention: '项目约定',
  lesson_learned: '经验教训',
  communication_style: '沟通偏好',
};

// Topic 选项列表(用于下拉选择)
export const TOPIC_OPTIONS: Array<{ value: MemoryTopic; label: string }> = [
  { value: 'personal_fact', label: '个人事实' },
  { value: 'tech_preference', label: '技术偏好' },
  { value: 'project_convention', label: '项目约定' },
  { value: 'lesson_learned', label: '经验教训' },
  { value: 'communication_style', label: '沟通偏好' },
];

// 重要度中文标签
export function getImportanceLabel(importance: number): string {
  switch (importance) {
    case 5: return '核心(每次必注入)';
    case 4: return '重要(核心记忆)';
    case 3: return '一般';
    case 2: return '较低';
    case 1: return '仅归档';
    default: return `未知(${importance})`;
  }
}

// 重要度对应颜色样式
export function getImportanceColor(importance: number): string {
  switch (importance) {
    case 5: return 'text-red-700 bg-red-50 border-red-200';
    case 4: return 'text-orange-700 bg-orange-50 border-orange-200';
    case 3: return 'text-blue-700 bg-blue-50 border-blue-200';
    case 2: return 'text-gray-600 bg-gray-50 border-gray-200';
    case 1: return 'text-gray-500 bg-gray-50 border-gray-200';
    default: return 'text-gray-600 bg-gray-50 border-gray-200';
  }
}

// 记忆摘要(列表用)
export interface MemorySummary {
  id: number;
  topic: MemoryTopic;
  title: string;
  content: string;
  importance: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// 记忆详情(目前和Summary一致)
export type MemoryDetail = MemorySummary;

// 创建/更新记忆请求体
export interface MemoryInput {
  topic: MemoryTopic;
  title: string;
  content: string;
  importance: number;
  is_active: boolean;
}

// 空表单初始值
export const emptyMemoryForm: MemoryInput = {
  topic: 'tech_preference',
  title: '',
  content: '',
  importance: 3,
  is_active: true,
};
