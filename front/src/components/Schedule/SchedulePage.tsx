import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import {
  createSchedule,
  deleteSchedule,
  getSchedule,
  listSchedules,
  updateSchedule,
} from '../../api/schedule';
import { isUnauthorizedError } from '../../api/http';
import type { ScheduleDetail, ScheduleInput, ScheduleSummary } from '../../types/schedule';
import { useAuth } from '../../auth/AuthContext';

// 表单模式:创建或编辑
type FormMode = 'create' | 'edit';

// 空表单初始值
const emptyForm: ScheduleInput = {
  title: '',
  description: '',
  start_time: '',
  end_time: '',
  location: '',
};

// 星期标签(日历表头)
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

// 月份名称
const MONTH_NAMES = [
  '一月', '二月', '三月', '四月', '五月', '六月',
  '七月', '八月', '九月', '十月', '十一月', '十二月',
];

/**
 * SchedulePage 日程页面
 *
 * 功能:
 *   1. 月视图日历:显示当月每天的日程,点击某天可查看/添加当天日程
 *   2. 日程列表:选中某天后,右侧显示当天的日程列表
 *   3. 创建/编辑日程:弹窗表单,填写标题、时间、地点、描述
 *   4. 删除日程
 *
 * 数据流:
 *   进入页面 → listSchedules(当月范围) → 渲染日历
 *   点击某天 → 过滤当天日程 → 右侧列表显示
 *   点击日程 → getSchedule(详情) → 弹窗显示
 *   创建/编辑 → createSchedule/updateSchedule → 刷新列表
 */
export function SchedulePage() {
  // 从 AuthContext 获取认证信息
  const { session, logout } = useAuth();

  // 访客模式拦截:访客没有真实 token,重定向回聊天页
  if (session?.isGuest === true) {
    return <Navigate to="/chat" replace />;
  }

  const token = session!.token;
  const onSessionExpired = logout;

  // 当前展示的月份(默认当月)
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());

  // 日程列表(当月范围)
  const [schedules, setSchedules] = useState<ScheduleSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 选中的日期(日历上点击的那天)
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  // 选中的日程详情(点击日程条目后加载)
  const [selectedSchedule, setSelectedSchedule] = useState<ScheduleSummary | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<ScheduleDetail | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  // 表单状态
  const [formMode, setFormMode] = useState<FormMode | null>(null);
  const [formValues, setFormValues] = useState<ScheduleInput>(emptyForm);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // --- 日历计算 ---

  // 当月日历网格:42 格(6 行 x 7 列),包含上月末尾和下月开头的填充
  const calendarDays = useMemo(() => {
    // 当月第一天
    const firstDay = new Date(viewYear, viewMonth, 1);
    // 第一天是星期几(0=周日)
    const firstWeekday = firstDay.getDay();
    // 当月天数
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    const days: Array<{ date: Date; isCurrentMonth: boolean }> = [];

    // 填充上月末尾
    for (let i = firstWeekday - 1; i >= 0; i--) {
      days.push({
        date: new Date(viewYear, viewMonth, -i),
        isCurrentMonth: false,
      });
    }

    // 当月日期
    for (let day = 1; day <= daysInMonth; day++) {
      days.push({
        date: new Date(viewYear, viewMonth, day),
        isCurrentMonth: true,
      });
    }

    // 填充下月开头,补满 42 格
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      days.push({
        date: new Date(viewYear, viewMonth + 1, i),
        isCurrentMonth: false,
      });
    }

    return days;
  }, [viewYear, viewMonth]);

  // 按日期分组的日程映射(方便日历格子显示)
  const schedulesByDate = useMemo(() => {
    const map = new Map<string, ScheduleSummary[]>();
    for (const schedule of schedules) {
      const dateKey = schedule.start_time.substring(0, 10); // YYYY-MM-DD
      const list = map.get(dateKey) ?? [];
      list.push(schedule);
      map.set(dateKey, list);
    }
    return map;
  }, [schedules]);

  // 选中日期的日程列表
  const selectedDateSchedules = useMemo(() => {
    if (!selectedDate) return [];
    const dateKey = formatDateKey(selectedDate);
    return schedulesByDate.get(dateKey) ?? [];
  }, [selectedDate, schedulesByDate]);

  // --- API 调用 ---

  const handleApiError = useCallback((apiError: unknown, fallback: string) => {
    if (isUnauthorizedError(apiError)) {
      onSessionExpired();
      return;
    }
    setError(apiError instanceof Error ? apiError.message : fallback);
  }, [onSessionExpired]);

  // 加载当月日程
  const loadSchedules = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // 计算当月的起止日期,传给后端做时间范围过滤
      const monthStart = new Date(viewYear, viewMonth, 1);
      const monthEnd = new Date(viewYear, viewMonth + 1, 0);
      const startStr = formatDateKey(monthStart);
      const endStr = formatDateKey(monthEnd);

      const data = await listSchedules(token, startStr, endStr);
      setSchedules(data);
    } catch (loadError) {
      handleApiError(loadError, '加载日程失败');
    } finally {
      setIsLoading(false);
    }
  }, [handleApiError, token, viewYear, viewMonth]);

  useEffect(() => {
    void loadSchedules();
  }, [loadSchedules]);

  // 打开日程详情
  async function openScheduleDetail(schedule: ScheduleSummary) {
    setSelectedSchedule(schedule);
    setSelectedDetail(null);
    setIsLoadingDetail(true);
    setError(null);

    try {
      const detail = await getSchedule(token, schedule.id);
      setSelectedDetail(detail);
    } catch (detailError) {
      handleApiError(detailError, '读取日程详情失败');
    } finally {
      setIsLoadingDetail(false);
    }
  }

  // --- 表单操作 ---

  // 打开创建表单(预填选中日期)
  function openCreateForm(presetDate?: Date) {
    const baseDate = presetDate ?? selectedDate ?? new Date();
    // 默认时间:当天 09:00-10:00
    const startTime = new Date(baseDate);
    startTime.setHours(9, 0, 0, 0);
    const endTime = new Date(baseDate);
    endTime.setHours(10, 0, 0, 0);

    setFormMode('create');
    setFormValues({
      ...emptyForm,
      start_time: toLocalDateTimeString(startTime),
      end_time: toLocalDateTimeString(endTime),
    });
  }

  // 打开编辑表单(预填已有日程数据)
  function openEditForm() {
    if (!selectedDetail) return;

    setFormMode('edit');
    setFormValues({
      title: selectedDetail.title,
      description: selectedDetail.description ?? '',
      start_time: toLocalDateTimeString(new Date(selectedDetail.start_time)),
      end_time: toLocalDateTimeString(new Date(selectedDetail.end_time)),
      location: selectedDetail.location ?? '',
    });
  }

  function closeForm() {
    setFormMode(null);
    setFormValues(emptyForm);
  }

  // 关闭详情侧栏
  function closeDetail() {
    setSelectedSchedule(null);
    setSelectedDetail(null);
  }

  // 提交表单(创建或编辑)
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!formValues.title.trim()) {
      setError('日程标题不能为空');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    // 将本地时间字符串转为 RFC3339 格式(后端要求)
    const payload: ScheduleInput = {
      title: formValues.title.trim(),
      description: formValues.description.trim(),
      start_time: toRFC3339(formValues.start_time),
      end_time: toRFC3339(formValues.end_time),
      location: formValues.location.trim(),
    };

    try {
      if (formMode === 'create') {
        await createSchedule(token, payload);
        closeForm();
        await loadSchedules();
      } else if (formMode === 'edit' && selectedSchedule) {
        await updateSchedule(token, selectedSchedule.id, payload);
        closeForm();
        await loadSchedules();
        // 重新加载详情
        await openScheduleDetail({ ...selectedSchedule, ...payload });
      }
    } catch (submitError) {
      handleApiError(submitError, '保存失败');
    } finally {
      setIsSubmitting(false);
    }
  }

  // 删除日程
  async function handleDelete() {
    if (!selectedSchedule) return;

    const confirmed = window.confirm(`确定删除日程「${selectedSchedule.title}」吗？`);
    if (!confirmed) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await deleteSchedule(token, selectedSchedule.id);
      closeDetail();
      closeForm();
      await loadSchedules();
    } catch (deleteError) {
      handleApiError(deleteError, '删除失败');
    } finally {
      setIsSubmitting(false);
    }
  }

  // --- 月份切换 ---

  function goToPrevMonth() {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function goToNextMonth() {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  function goToToday() {
    const now = new Date();
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
    setSelectedDate(now);
  }

  // --- 渲染 ---

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-gray-50">
      {/* 顶部标题栏 */}
      <div className="px-6 py-5 border-b border-gray-200 bg-white shrink-0">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-blue-600">
              <CalendarDays size={18} />
              <span className="text-sm font-semibold">日程管理</span>
            </div>
            <p className="mt-1 text-sm text-gray-500">管理你的日程安排，点击日历上的日期添加日程。</p>
          </div>

          <div className="flex items-center gap-2">
            {/* 月份切换 */}
            <button
              type="button"
              onClick={goToPrevMonth}
              className="rounded-xl border border-gray-200 bg-white p-2.5 text-gray-600 hover:bg-gray-50"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="min-w-28 text-center text-sm font-semibold text-gray-800">
              {viewYear} 年 {MONTH_NAMES[viewMonth]}
            </span>
            <button
              type="button"
              onClick={goToNextMonth}
              className="rounded-xl border border-gray-200 bg-white p-2.5 text-gray-600 hover:bg-gray-50"
            >
              <ChevronRight size={16} />
            </button>
            <button
              type="button"
              onClick={goToToday}
              className="ml-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              今天
            </button>
            <button
              type="button"
              onClick={() => openCreateForm()}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              <Plus size={16} />
              新建日程
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-6 mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shrink-0">
          {error}
        </div>
      )}

      {/* 主体区:左侧日历 + 右侧详情 */}
      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(320px,400px)] gap-4 p-6">
        {/* 左侧:月视图日历 */}
        <section className="min-h-0 rounded-2xl border border-gray-200 bg-white overflow-hidden flex flex-col">
          {/* 星期表头 */}
          <div className="grid grid-cols-7 border-b border-gray-100">
            {WEEKDAYS.map((day) => (
              <div key={day} className="px-2 py-3 text-center text-xs font-semibold text-gray-500">
                {day}
              </div>
            ))}
          </div>

          {/* 日历格子 */}
          <div className="flex-1 grid grid-cols-7 grid-rows-6">
            {calendarDays.map((dayInfo, index) => {
              const dateKey = formatDateKey(dayInfo.date);
              const daySchedules = schedulesByDate.get(dateKey) ?? [];
              const isToday = isSameDay(dayInfo.date, new Date());
              const isSelected = selectedDate && isSameDay(dayInfo.date, selectedDate);

              return (
                <div
                  key={index}
                  onClick={() => setSelectedDate(dayInfo.date)}
                  className={`border-b border-r border-gray-50 p-1.5 cursor-pointer transition-colors hover:bg-blue-50/40 ${
                    !dayInfo.isCurrentMonth ? 'bg-gray-50/50' : ''
                  } ${isSelected ? 'bg-blue-50' : ''} ${
                    index % 7 === 6 ? 'border-r-0' : ''
                  } ${index >= 35 ? 'border-b-0' : ''}`}
                >
                  {/* 日期数字 */}
                  <div className="flex items-center justify-center w-7 h-7 rounded-full text-xs">
                    <span
                      className={
                        isToday
                          ? 'bg-blue-600 text-white w-7 h-7 flex items-center justify-center rounded-full font-semibold'
                          : dayInfo.isCurrentMonth
                            ? 'text-gray-700'
                            : 'text-gray-400'
                      }
                    >
                      {dayInfo.date.getDate()}
                    </span>
                  </div>

                  {/* 日程标签(最多显示 2 条,超出显示 +N) */}
                  <div className="mt-1 space-y-0.5">
                    {daySchedules.slice(0, 2).map((schedule) => (
                      <div
                        key={schedule.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          void openScheduleDetail(schedule);
                        }}
                        className="truncate rounded px-1.5 py-0.5 text-xs text-white bg-blue-500 hover:bg-blue-600"
                      >
                        {schedule.title}
                      </div>
                    ))}
                    {daySchedules.length > 2 && (
                      <div className="px-1.5 text-xs text-gray-500">
                        +{daySchedules.length - 2} 更多
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 右侧:选中日期的日程列表 */}
        <section className="min-h-0 rounded-2xl border border-gray-200 bg-white overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-800">
              {selectedDate
                ? `${selectedDate.getMonth() + 1} 月 ${selectedDate.getDate()} 日的日程`
                : '请选择日期'}
            </h2>
            {selectedDate && (
              <span className="text-xs text-gray-500">{selectedDateSchedules.length} 项</span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
            {!selectedDate ? (
              <div className="h-full flex items-center justify-center text-sm text-gray-500 text-center px-4">
                点击日历上的日期查看当天日程
              </div>
            ) : isLoading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
                <Loader2 size={16} className="animate-spin" />
                加载中...
              </div>
            ) : selectedDateSchedules.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm text-gray-500">当天没有日程</p>
                <button
                  type="button"
                  onClick={() => openCreateForm()}
                  className="mt-3 inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
                >
                  <Plus size={14} />
                  添加日程
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {selectedDateSchedules.map((schedule) => (
                  <button
                    key={schedule.id}
                    type="button"
                    onClick={() => void openScheduleDetail(schedule)}
                    className={`w-full text-left rounded-xl border p-3 transition-colors hover:border-blue-300 hover:bg-blue-50/40 ${
                      selectedSchedule?.id === schedule.id
                        ? 'border-blue-300 bg-blue-50'
                        : 'border-gray-200'
                    }`}
                  >
                    <p className="font-medium text-gray-900 text-sm truncate">{schedule.title}</p>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
                      <Clock size={12} />
                      <span>{formatTimeRange(schedule.start_time, schedule.end_time)}</span>
                    </div>
                    {schedule.location && (
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
                        <MapPin size={12} />
                        <span className="truncate">{schedule.location}</span>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* 日程详情弹窗 */}
      {selectedSchedule && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-gray-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">日程详情</h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={openEditForm}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  <Pencil size={14} />
                  编辑
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  <Trash2 size={14} />
                  删除
                </button>
                <button
                  type="button"
                  onClick={closeDetail}
                  className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="px-6 py-5 space-y-4">
              {isLoadingDetail ? (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500">
                  <Loader2 size={16} className="animate-spin" />
                  加载中...
                </div>
              ) : selectedDetail ? (
                <>
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">标题</p>
                    <p className="mt-1 text-base font-semibold text-gray-900">{selectedDetail.title}</p>
                  </div>

                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">时间</p>
                    <p className="mt-1 text-sm text-gray-700">
                      {formatTimeRange(selectedDetail.start_time, selectedDetail.end_time)}
                    </p>
                  </div>

                  {selectedDetail.location && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">地点</p>
                      <p className="mt-1 text-sm text-gray-700">{selectedDetail.location}</p>
                    </div>
                  )}

                  {selectedDetail.description && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">描述</p>
                      <p className="mt-1 text-sm text-gray-700 whitespace-pre-wrap">{selectedDetail.description}</p>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* 创建/编辑表单弹窗 */}
      {formMode && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-gray-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">
                {formMode === 'create' ? '新建日程' : '编辑日程'}
              </h3>
              <button
                type="button"
                onClick={closeForm}
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
              >
                <X size={18} />
              </button>
            </div>

            <form className="px-6 py-5 space-y-4" onSubmit={(event) => void handleSubmit(event)}>
              {/* 日程标题 */}
              <label className="block">
                <span className="text-sm font-medium text-gray-700">标题</span>
                <input
                  type="text"
                  className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                  placeholder="例如：团队周会、体检、客户拜访"
                  value={formValues.title}
                  onChange={(event) => setFormValues((current) => ({ ...current, title: event.target.value }))}
                  required
                />
              </label>

              {/* 开始时间 */}
              <label className="block">
                <span className="text-sm font-medium text-gray-700">开始时间</span>
                <input
                  type="datetime-local"
                  className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                  value={formValues.start_time}
                  onChange={(event) => setFormValues((current) => ({ ...current, start_time: event.target.value }))}
                  required
                />
              </label>

              {/* 结束时间 */}
              <label className="block">
                <span className="text-sm font-medium text-gray-700">结束时间</span>
                <input
                  type="datetime-local"
                  className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                  value={formValues.end_time}
                  onChange={(event) => setFormValues((current) => ({ ...current, end_time: event.target.value }))}
                  required
                />
              </label>

              {/* 地点 */}
              <label className="block">
                <span className="text-sm font-medium text-gray-700">地点</span>
                <input
                  type="text"
                  className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                  placeholder="例如：会议室 A、线上腾讯会议"
                  value={formValues.location}
                  onChange={(event) => setFormValues((current) => ({ ...current, location: event.target.value }))}
                />
              </label>

              {/* 描述 */}
              <label className="block">
                <span className="text-sm font-medium text-gray-700">描述</span>
                <textarea
                  className="mt-2 w-full min-h-24 rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                  placeholder="日程备注、议程、参会人员等"
                  value={formValues.description}
                  onChange={(event) => setFormValues((current) => ({ ...current, description: event.target.value }))}
                />
              </label>

              {/* 表单按钮 */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeForm}
                  className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSubmitting && <Loader2 size={16} className="animate-spin" />}
                  {formMode === 'create' ? '创建' : '保存'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// --- 工具函数 ---

// formatDateKey 将 Date 转为 YYYY-MM-DD 格式(用于 Map key 和 API 查询参数)
function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// isSameDay 判断两个 Date 是否为同一天
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// toLocalDateTimeString 将 Date 转为 datetime-local input 需要的格式: YYYY-MM-DDTHH:MM
function toLocalDateTimeString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

// toRFC3339 将 datetime-local 的值(本地时间)转为 RFC3339 格式(带时区)
// 后端要求 RFC3339 格式: 2006-01-02T15:04:05Z07:00
function toRFC3339(localDateTime: string): string {
  if (!localDateTime) return '';
  // datetime-local 的值已经是本地时间,new Date() 会按本地时区解析
  const date = new Date(localDateTime);
  return date.toISOString();
}

// formatTimeRange 格式化时间范围显示: 09:00 - 10:00
function formatTimeRange(startTime: string, endTime: string): string {
  const start = new Date(startTime);
  const end = new Date(endTime);

  const startStr = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
  const endStr = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;

  // 如果跨天,显示日期
  if (!isSameDay(start, end)) {
    const startDate = `${start.getMonth() + 1}/${start.getDate()}`;
    const endDate = `${end.getMonth() + 1}/${end.getDate()}`;
    return `${startDate} ${startStr} - ${endDate} ${endStr}`;
  }

  return `${startStr} - ${endStr}`;
}
