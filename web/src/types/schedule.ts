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
