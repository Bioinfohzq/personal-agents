// 日程摘要(列表用,不含描述正文)
export interface ScheduleSummary {
  id: number;
  title: string;
  start_time: string;  // ISO 8601 格式
  end_time: string;
  location?: string;
  created_at: string;
  updated_at: string;
}

// 日程详情(含描述)
export interface ScheduleDetail extends ScheduleSummary {
  description?: string;
}

// 创建/更新日程的请求体
export interface ScheduleInput {
  title: string;
  description: string;
  start_time: string;  // RFC3339 格式
  end_time: string;
  location: string;
}

// 代办级别:日 / 周 / 月 / 年
export type TodoLevel = 'day' | 'week' | 'month' | 'year';

// 代办事项(前端本地存储,不走后端)
export interface Todo {
  id: string;          // 本地生成的唯一 id(时间戳+随机串)
  title: string;       // 代办内容
  level: TodoLevel;    // 所属级别
  done: boolean;       // 是否已完成
  created_at: string;  // ISO 时间
  period_key: string;  // 所属周期标识(日历制):
                       //   day:   "2026-08-24"
                       //   week:  "2026-W34"   (ISO 周,周一为始)
                       //   month: "2026-08"
                       //   year:  "2026"
}
