import { assertBusinessResponse, businessFetch } from './http';
import type {
  ScheduleDetail,
  ScheduleInput,
  ScheduleSummary,
} from '../types/schedule';

// listSchedules 查询日程列表
//   可选参数 start/end: 格式 YYYY-MM-DD,用于过滤时间范围(日历月视图用)
//   不传 start/end 则返回全部日程
export async function listSchedules(
  token: string,
  start?: string,
  end?: string,
): Promise<ScheduleSummary[]> {
  // 拼接可选的查询参数
  const params = new URLSearchParams();
  if (start) params.set('start', start);
  if (end) params.set('end', end);
  const query = params.toString();
  const path = query ? `/api/v1/schedules?${query}` : '/api/v1/schedules';

  const response = await businessFetch(token, path);

  await assertBusinessResponse(response, '加载日程失败');

  const data = await response.json() as { schedules: ScheduleSummary[] };
  return data.schedules ?? [];
}

// getSchedule 获取单条日程详情
export async function getSchedule(token: string, scheduleId: number): Promise<ScheduleDetail> {
  const response = await businessFetch(token, `/api/v1/schedules/${scheduleId}`);

  await assertBusinessResponse(response, '读取日程详情失败');

  return response.json() as Promise<ScheduleDetail>;
}

// createSchedule 创建日程
export async function createSchedule(
  token: string,
  input: ScheduleInput,
): Promise<ScheduleDetail> {
  const response = await businessFetch(token, '/api/v1/schedules', {
    method: 'POST',
    body: JSON.stringify(input),
  });

  await assertBusinessResponse(response, '创建日程失败');

  return response.json() as Promise<ScheduleDetail>;
}

// updateSchedule 更新日程
export async function updateSchedule(
  token: string,
  scheduleId: number,
  input: ScheduleInput,
): Promise<ScheduleDetail> {
  const response = await businessFetch(token, `/api/v1/schedules/${scheduleId}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });

  await assertBusinessResponse(response, '更新日程失败');

  return response.json() as Promise<ScheduleDetail>;
}

// deleteSchedule 删除日程
export async function deleteSchedule(token: string, scheduleId: number): Promise<void> {
  const response = await businessFetch(token, `/api/v1/schedules/${scheduleId}`, {
    method: 'DELETE',
  });

  await assertBusinessResponse(response, '删除日程失败');
}
