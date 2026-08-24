import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  ListChecks,
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
import type { ScheduleDetail, ScheduleInput, ScheduleSummary, Todo, TodoLevel } from '../../types/schedule';
import { useAuth } from '../../auth/AuthContext';

// ========== 常量 ==========

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

// 星期标签(迷你日历表头)
const WEEKDAYS_SHORT = ['日', '一', '二', '三', '四', '五', '六'];

// 月份名称
const MONTH_NAMES = [
  '一月', '二月', '三月', '四月', '五月', '六月',
  '七月', '八月', '九月', '十月', '十一月', '十二月',
];

// 代办级别配置:显示名、颜色、图标色
const TODO_LEVELS: Array<{
  key: TodoLevel;
  label: string;
  accent: string;      // 左侧竖线颜色
  badge: string;       // 标签背景色
  dot: string;         // 圆点颜色
  desc: string;        // 说明文字
}> = [
  {
    key: 'day',
    label: '日代办',
    accent: 'border-l-red-400',
    badge: 'bg-red-50 text-red-600',
    dot: 'bg-red-400',
    desc: '今天要做的事',
  },
  {
    key: 'week',
    label: '周代办',
    accent: 'border-l-amber-400',
    badge: 'bg-amber-50 text-amber-600',
    dot: 'bg-amber-400',
    desc: '本周计划',
  },
  {
    key: 'month',
    label: '月代办',
    accent: 'border-l-blue-400',
    badge: 'bg-blue-50 text-blue-600',
    dot: 'bg-blue-400',
    desc: '本月目标',
  },
  {
    key: 'year',
    label: '年代办',
    accent: 'border-l-purple-400',
    badge: 'bg-purple-50 text-purple-600',
    dot: 'bg-purple-400',
    desc: '年度规划',
  },
];

// localStorage key
const TODOS_STORAGE_KEY = 'personal-agents:todos';

// ========== 代办本地存储工具 ==========

function loadTodos(): Todo[] {
  try {
    const raw = localStorage.getItem(TODOS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as any[];
    if (!Array.isArray(parsed)) return [];
    const now = new Date();
    return parsed.map(t => {
      // 旧数据兼容:没有 period_key 的代办,按 created_at 补全;若 created_at 也缺失则用当前周期
      const created = t.created_at ? new Date(t.created_at) : now;
      const level: TodoLevel = (t.level as TodoLevel) || 'day';
      return {
        id: t.id || genTodoId(),
        title: t.title || '',
        level,
        done: !!t.done,
        created_at: t.created_at || now.toISOString(),
        period_key: t.period_key || getPeriodKey(created, level),
      } as Todo;
    });
  } catch {
    return [];
  }
}

function saveTodos(todos: Todo[]): void {
  localStorage.setItem(TODOS_STORAGE_KEY, JSON.stringify(todos));
}

function genTodoId(): string {
  return `todo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ========== 周期计算工具(日历制) ==========

/** 获取指定日期的 ISO 周编号(ISO 8601:周一为一周起始,周一是1月4日所在周为第1周) */
function getISOWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

/** 获取某日期所在周期的 key */
function getPeriodKey(date: Date, level: TodoLevel): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  switch (level) {
    case 'day':   return `${y}-${m}-${d}`;
    case 'week':  { const w = getISOWeek(date); return `${w.year}-W${String(w.week).padStart(2, '0')}`; }
    case 'month': return `${y}-${m}`;
    case 'year':  return `${y}`;
  }
}

/** 获取某日期所在周期的起止日期 */
function getPeriodRange(date: Date, level: TodoLevel): { start: Date; end: Date } {
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();
  switch (level) {
    case 'day': {
      const start = new Date(y, m, d);
      const end = new Date(y, m, d, 23, 59, 59, 999);
      return { start, end };
    }
    case 'week': {
      // ISO 周:周一为第一天
      const day = date.getDay(); // 0=周日,1=周一...
      const mondayOffset = day === 0 ? -6 : 1 - day;
      const monday = new Date(y, m, d + mondayOffset);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      sunday.setHours(23, 59, 59, 999);
      return { start: monday, end: sunday };
    }
    case 'month': {
      const start = new Date(y, m, 1);
      const end = new Date(y, m + 1, 0, 23, 59, 59, 999);
      return { start, end };
    }
    case 'year': {
      const start = new Date(y, 0, 1);
      const end = new Date(y, 11, 31, 23, 59, 59, 999);
      return { start, end };
    }
  }
}

/** 格式化周期时间跨度显示,如 "8月24日(今天)" / "8月18日 - 8月24日" / "2026年8月" / "2026年" */
function formatPeriodRange(date: Date, level: TodoLevel): string {
  const { start, end } = getPeriodRange(date, level);
  const fmtMd = (dt: Date) => `${dt.getMonth() + 1}月${dt.getDate()}日`;
  const today = new Date();
  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  switch (level) {
    case 'day':
      return isSameDay(start, today) ? `${fmtMd(start)}(今天)` : fmtMd(start);
    case 'week': {
      const prefix = isSameDay(start, new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() || 7) - 1))) ? '本周' : '';
      return `${prefix}${fmtMd(start)} - ${fmtMd(end)}`;
    }
    case 'month':
      return `${start.getFullYear()}年${start.getMonth() + 1}月`;
    case 'year':
      return `${start.getFullYear()}年`;
  }
}

// ========== 主组件 ==========

/**
 * SchedulePage 日程 & 代办页面
 *
 * 布局:
 *   ┌─────────────────────────────────────────────────┐
 *   │ 顶部标题栏(日程+代办)                              │
 *   ├──────────────┬──────────────────────────────────┤
 *   │  迷你月历     │  代办面板(日/周/月/年 4 个分区)      │
 *   │  ~340px      │  弹性宽度                          │
 *   │              │                                    │
 *   │  当天日程列表  │                                    │
 *   └──────────────┴──────────────────────────────────┘
 *
 * 功能:
 *   - 左侧迷你月历:点击日期查看/添加当天日程(与旧版一致,但紧凑化)
 *   - 左侧下方:选中日期的日程列表(紧凑卡片)
 *   - 右侧代办面板:4 个级别可折叠分区,支持增删改勾选
 *   - 日程详情/创建/编辑弹窗保持不变
 */
export function SchedulePage() {
  const { session, logout } = useAuth();

  // 访客模式拦截
  if (session?.isGuest === true) {
    return <Navigate to="/chat" replace />;
  }

  const token = session!.token;
  const onSessionExpired = logout;

  // ========== 日历/日程状态 ==========

  // 当前展示月份
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());
  // 日程列表(当月范围)
  const [schedules, setSchedules] = useState<ScheduleSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 选中日期
  const [selectedDate, setSelectedDate] = useState<Date | null>(() => new Date());
  // 日程详情
  const [selectedSchedule, setSelectedSchedule] = useState<ScheduleSummary | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<ScheduleDetail | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  // 表单
  const [formMode, setFormMode] = useState<FormMode | null>(null);
  const [formValues, setFormValues] = useState<ScheduleInput>(emptyForm);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ========== 代办状态 ==========

  const [todos, setTodos] = useState<Todo[]>(() => loadTodos());
  // 各分区折叠状态(默认全部展开)
  const [collapsed, setCollapsed] = useState<Record<TodoLevel, boolean>>({
    day: false, week: false, month: false, year: false,
  });
  // 各分区输入框值
  const [todoInputs, setTodoInputs] = useState<Record<TodoLevel, string>>({
    day: '', week: '', month: '', year: '',
  });
  // IME 中文输入法合成状态:合成中 Enter 只确认候选词,不添加代办
  const isTodoComposingRef = useRef(false);

  // 代办变更时持久化到 localStorage
  useEffect(() => {
    saveTodos(todos);
  }, [todos]);

  // ========== 日历计算 ==========

  // 当月日历网格 42 格
  const calendarDays = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1);
    const firstWeekday = firstDay.getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    const days: Array<{ date: Date; isCurrentMonth: boolean }> = [];
    for (let i = firstWeekday - 1; i >= 0; i--) {
      days.push({ date: new Date(viewYear, viewMonth, -i), isCurrentMonth: false });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      days.push({ date: new Date(viewYear, viewMonth, day), isCurrentMonth: true });
    }
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      days.push({ date: new Date(viewYear, viewMonth + 1, i), isCurrentMonth: false });
    }
    return days;
  }, [viewYear, viewMonth]);

  // 按日期分组的日程映射
  const schedulesByDate = useMemo(() => {
    const map = new Map<string, ScheduleSummary[]>();
    for (const schedule of schedules) {
      const dateKey = schedule.start_time.substring(0, 10);
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

  // ========== 代办计算 ==========

  // 各分区当前周期的 key(日代办跟随选中日期,周/月/年跟随今天)
  const currentPeriodKeys = useMemo(() => {
    const today = new Date();
    return {
      day:   getPeriodKey(selectedDate, 'day'),
      week:  getPeriodKey(today, 'week'),
      month: getPeriodKey(today, 'month'),
      year:  getPeriodKey(today, 'year'),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate()]);

  const todosByLevel = useMemo(() => {
    const grouped: Record<TodoLevel, Todo[]> = { day: [], week: [], month: [], year: [] };
    // 只保留当前周期内的代办;未完成在前,按创建时间倒序
    const current = todos.filter(t => t.period_key === currentPeriodKeys[t.level]);
    const sorted = [...current].sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return b.created_at.localeCompare(a.created_at);
    });
    for (const t of sorted) {
      grouped[t.level].push(t);
    }
    return grouped;
  }, [todos, currentPeriodKeys]);

  // 各分区当前周期未完成数(用于徽标)
  const pendingCounts = useMemo(() => {
    const counts: Record<TodoLevel, number> = { day: 0, week: 0, month: 0, year: 0 };
    for (const t of todos) {
      if (!t.done && t.period_key === currentPeriodKeys[t.level]) counts[t.level]++;
    }
    return counts;
  }, [todos, currentPeriodKeys]);

  // ========== API 调用 ==========

  const handleApiError = useCallback((apiError: unknown, fallback: string) => {
    if (isUnauthorizedError(apiError)) {
      onSessionExpired();
      return;
    }
    setError(apiError instanceof Error ? apiError.message : fallback);
  }, [onSessionExpired]);

  const loadSchedules = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const monthStart = new Date(viewYear, viewMonth, 1);
      const monthEnd = new Date(viewYear, viewMonth + 1, 0);
      const data = await listSchedules(token, formatDateKey(monthStart), formatDateKey(monthEnd));
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

  // ========== 表单操作 ==========

  function openCreateForm(presetDate?: Date) {
    const baseDate = presetDate ?? selectedDate ?? new Date();
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

  function closeDetail() {
    setSelectedSchedule(null);
    setSelectedDetail(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formValues.title.trim()) {
      setError('日程标题不能为空');
      return;
    }
    setIsSubmitting(true);
    setError(null);
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
        await openScheduleDetail({ ...selectedSchedule, ...payload });
      }
    } catch (submitError) {
      handleApiError(submitError, '保存失败');
    } finally {
      setIsSubmitting(false);
    }
  }

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

  // ========== 月份切换 ==========

  function goToPrevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else { setViewMonth(m => m - 1); }
  }
  function goToNextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else { setViewMonth(m => m + 1); }
  }
  function goToToday() {
    const now = new Date();
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
    setSelectedDate(now);
  }

  // ========== 代办操作 ==========

  function addTodo(level: TodoLevel) {
    const text = todoInputs[level].trim();
    if (!text) return;
    // 日代办绑定到选中日期,周/月/年代办绑定到今天
    const targetDate = level === 'day' ? selectedDate : new Date();
    const newTodo: Todo = {
      id: genTodoId(),
      title: text,
      level,
      done: false,
      created_at: new Date().toISOString(),
      period_key: getPeriodKey(targetDate, level),
    };
    setTodos(prev => [newTodo, ...prev]);
    setTodoInputs(prev => ({ ...prev, [level]: '' }));
  }

  function toggleTodo(id: string) {
    setTodos(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t));
  }

  function deleteTodo(id: string) {
    setTodos(prev => prev.filter(t => t.id !== id));
  }

  function handleTodoKeyDown(e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>, level: TodoLevel) {
    // Enter 添加代办,Shift+Enter 换行
    // 三重判断防止 IME 中文输入时 Enter 确认候选词误触发添加:
    // 1. isTodoComposingRef — compositionstart/end 维护的合成状态
    // 2. e.nativeEvent.isComposing — 浏览器原生标记
    // 3. e.keyCode === 229 — 输入法合成中的 keyCode 标识
    const isComposing =
      isTodoComposingRef.current ||
      (e.nativeEvent as any).isComposing ||
      e.keyCode === 229;
    if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
      e.preventDefault();
      addTodo(level);
    }
  }

  /** IME 合成开始 */
  const handleTodoCompositionStart = () => {
    isTodoComposingRef.current = true;
  };

  /** IME 合成结束 */
  const handleTodoCompositionEnd = () => {
    isTodoComposingRef.current = false;
  };

  // ========== 渲染 ==========

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-gray-50">
      {/* 顶部标题栏 */}
      <div className="px-6 py-4 border-b border-gray-200 bg-white shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-blue-600">
              <CalendarDays size={18} />
              <span className="text-sm font-semibold">日程与代办</span>
            </div>
            <span className="text-sm text-gray-400">|</span>
            <div className="flex items-center gap-2 text-gray-500">
              <ListChecks size={16} />
              <span className="text-sm">日 / 周 / 月 / 年 四级代办</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={goToPrevMonth}
              className="rounded-lg border border-gray-200 bg-white p-2 text-gray-600 hover:bg-gray-50"
              title="上个月"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="min-w-28 text-center text-sm font-semibold text-gray-800">
              {viewYear} 年 {MONTH_NAMES[viewMonth]}
            </span>
            <button
              type="button"
              onClick={goToNextMonth}
              className="rounded-lg border border-gray-200 bg-white p-2 text-gray-600 hover:bg-gray-50"
              title="下个月"
            >
              <ChevronRight size={14} />
            </button>
            <button
              type="button"
              onClick={goToToday}
              className="ml-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              今天
            </button>
            <button
              type="button"
              onClick={() => openCreateForm()}
              className="ml-2 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              <Plus size={14} />
              新建日程
            </button>
          </div>
        </div>
        {error && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
            {error}
          </div>
        )}
      </div>

      {/* 主体区:左30%日历区+日代办 | 右70%周/月/年代办 (flex比例分配,自动处理gap) */}
      <div className="flex-1 min-h-0 flex gap-4 p-4 overflow-hidden">
        {/* ===== 左侧:迷你日历 + 当天日程 + 日代办 (30%) ===== */}
        <aside className="flex-[30] min-w-0 flex flex-col gap-4 min-h-0">
          {/* 迷你月历 */}
          <section className="rounded-xl border border-gray-200 bg-white overflow-hidden w-full">
            {/* 星期表头 */}
            <div className="grid grid-cols-7 border-b border-gray-100">
              {WEEKDAYS_SHORT.map((d) => (
                <div key={d} className="py-2 text-center text-[11px] font-semibold text-gray-400">
                  {d}
                </div>
              ))}
            </div>
            {/* 日历格子 */}
            <div className="grid grid-cols-7">
              {calendarDays.map((dayInfo, idx) => {
                const dateKey = formatDateKey(dayInfo.date);
                const dayScheds = schedulesByDate.get(dateKey) ?? [];
                const isToday = isSameDay(dayInfo.date, new Date());
                const isSelected = selectedDate && isSameDay(dayInfo.date, selectedDate);
                const hasSched = dayScheds.length > 0;

                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setSelectedDate(dayInfo.date)}
                    className={`relative aspect-square flex flex-col items-center justify-center text-[12px] transition-colors
                      ${!dayInfo.isCurrentMonth ? 'text-gray-300' : isSelected ? 'text-white' : 'text-gray-700'}
                      ${isSelected ? 'bg-blue-600' : isToday ? 'bg-blue-50' : 'hover:bg-gray-50'}
                    `}
                  >
                    <span className={`
                      ${isToday && !isSelected ? 'w-6 h-6 flex items-center justify-center rounded-full bg-blue-600 text-white font-semibold' : ''}
                      ${isSelected ? 'font-semibold' : ''}
                    `}>
                      {dayInfo.date.getDate()}
                    </span>
                    {/* 日程指示点 */}
                    {hasSched && !isSelected && (
                      <span className="absolute bottom-1 w-1 h-1 rounded-full bg-blue-500" />
                    )}
                    {hasSched && isSelected && (
                      <span className="absolute bottom-1 w-1 h-1 rounded-full bg-white" />
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          {/* 选中日期的日程列表 */}
          <section className="rounded-xl border border-gray-200 bg-white flex flex-col overflow-hidden w-full">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between shrink-0">
              <h3 className="text-xs font-semibold text-gray-700">
                {selectedDate
                  ? `${selectedDate.getMonth() + 1}月${selectedDate.getDate()}日 日程`
                  : '请选择日期'}
              </h3>
              {selectedDate && (
                <button
                  type="button"
                  onClick={() => openCreateForm()}
                  className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700"
                >
                  <Plus size={12} />
                  添加
                </button>
              )}
            </div>

            <div className="overflow-y-auto custom-scrollbar p-3 max-h-[200px]">
              {!selectedDate ? (
                <div className="flex items-center justify-center text-xs text-gray-400 py-2">
                  点击日历日期
                </div>
              ) : isLoading ? (
                <div className="flex items-center justify-center py-4 text-xs text-gray-400">
                  <Loader2 size={12} className="animate-spin mr-1.5" />加载中...
                </div>
              ) : selectedDateSchedules.length === 0 ? (
                <div className="py-3 text-center text-xs text-gray-400">
                  当天无日程
                </div>
              ) : (
                <div className="space-y-1.5">
                  {selectedDateSchedules.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => void openScheduleDetail(s)}
                      className={`w-full text-left rounded-lg border px-3 py-2 transition-colors hover:border-blue-300 hover:bg-blue-50/30
                        ${selectedSchedule?.id === s.id ? 'border-blue-300 bg-blue-50' : 'border-gray-100 bg-gray-50/50'}
                      `}
                    >
                      <p className="text-xs font-medium text-gray-800 truncate">{s.title}</p>
                      <div className="mt-0.5 flex items-center gap-1 text-[10px] text-gray-500">
                        <Clock size={10} />
                        <span>{formatTimeRange(s.start_time, s.end_time)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* 日代办(放在左侧,和当天日程一起) */}
          <section className="flex-1 min-h-0 rounded-xl border-l-4 border-l-red-400 border border-gray-100 bg-white overflow-hidden flex flex-col w-full shadow-sm">
            <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-400" />
                <span className="text-sm font-semibold text-gray-800">日代办</span>
                <span className="text-xs text-gray-400">{formatPeriodRange(selectedDate, 'day')}</span>
              </div>
              {pendingCounts.day > 0 && (
                <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600">
                  {pendingCounts.day}
                </span>
              )}
            </div>
            <div className="px-3 py-2 border-b border-gray-50 shrink-0">
              <div className="flex items-start gap-2">
                <textarea
                  value={todoInputs.day}
                  onChange={(e) => setTodoInputs(prev => ({ ...prev, day: e.target.value }))}
                  onKeyDown={(e) => handleTodoKeyDown(e, 'day')}
                  onCompositionStart={handleTodoCompositionStart}
                  onCompositionEnd={handleTodoCompositionEnd}
                  placeholder="添加日代办(Enter添加,Shift+Enter换行)..."
                  rows={1}
                  className="flex-1 resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100"
                  style={{ minHeight: '36px' }}
                />
                <button
                  type="button"
                  onClick={() => addTodo('day')}
                  className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-200"
                >
                  <Plus size={14} />添加
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
              {todosByLevel.day.length === 0 ? (
                <p className="py-4 text-center text-sm text-gray-300">暂无日代办</p>
              ) : (
                <ul className="space-y-1.5">
                  {todosByLevel.day.map((todo) => (
                    <li
                      key={todo.id}
                      className={`group flex items-start gap-2.5 rounded-md px-2.5 py-2 hover:bg-gray-50 transition-colors
                        ${todo.done ? 'opacity-50' : ''}
                      `}
                    >
                      <button
                        type="button"
                        onClick={() => toggleTodo(todo.id)}
                        className={`mt-0.5 shrink-0 w-4.5 h-4.5 rounded border-2 flex items-center justify-center transition-colors
                          ${todo.done ? 'bg-red-500 border-red-500 text-white' : 'border-gray-300 hover:border-red-400'}
                        `}
                      >
                        {todo.done && (
                          <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M2 6l3 3 5-5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>
                      <span className={`flex-1 text-sm leading-relaxed whitespace-pre-wrap break-words ${todo.done ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                        {todo.title}
                      </span>
                      <button
                        type="button"
                        onClick={() => deleteTodo(todo.id)}
                        className="shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all"
                        title="删除"
                      >
                        <Trash2 size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </aside>

        {/* ===== 右侧:周/月/年代办面板 (70%) ===== */}
        <main className="flex-[70] min-w-0 rounded-xl border border-gray-200 bg-white flex flex-col overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 shrink-0">
            <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
              <ListChecks size={16} className="text-blue-600" />
              中长期待办
            </h2>
            <p className="mt-0.5 text-xs text-gray-400">周/月/年 三级任务管理</p>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">
            {TODO_LEVELS.filter(l => l.key !== 'day').map((levelCfg) => {
              const levelTodos = todosByLevel[levelCfg.key];
              const pending = pendingCounts[levelCfg.key];
              const isCollapsed = collapsed[levelCfg.key];

              return (
                <div
                  key={levelCfg.key}
                  className={`rounded-xl border-l-4 ${levelCfg.accent} bg-white border border-gray-100 shadow-sm`}
                >
                  {/* 分区标题栏(可折叠) */}
                  <button
                    type="button"
                    onClick={() => setCollapsed(prev => ({ ...prev, [levelCfg.key]: !prev[levelCfg.key] }))}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50/50 transition-colors rounded-r-xl"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className={`w-2 h-2 rounded-full ${levelCfg.dot}`} />
                      <span className="text-sm font-semibold text-gray-800">{levelCfg.label}</span>
                      <span className="text-xs text-gray-400">{formatPeriodRange(new Date(), levelCfg.key)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {pending > 0 && (
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${levelCfg.badge}`}>
                          {pending}
                        </span>
                      )}
                      <ChevronDown
                        size={14}
                        className={`text-gray-400 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                      />
                    </div>
                  </button>

                  {/* 折叠内容:输入框 + 列表 */}
                  {!isCollapsed && (
                    <div className="px-4 pb-3">
                      {/* 添加输入框 */}
                      <div className="flex items-start gap-2 mb-2">
                        <textarea
                          value={todoInputs[levelCfg.key]}
                          onChange={(e) => setTodoInputs(prev => ({ ...prev, [levelCfg.key]: e.target.value }))}
                          onKeyDown={(e) => handleTodoKeyDown(e, levelCfg.key)}
                          onCompositionStart={handleTodoCompositionStart}
                          onCompositionEnd={handleTodoCompositionEnd}
                          placeholder={`添加${levelCfg.label}(Enter添加,Shift+Enter换行)...`}
                          rows={1}
                          className="flex-1 resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                          style={{ minHeight: '36px' }}
                        />
                        <button
                          type="button"
                          onClick={() => addTodo(levelCfg.key)}
                          className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-200"
                        >
                          <Plus size={14} />
                          添加
                        </button>
                      </div>

                      {/* 代办列表 */}
                      {levelTodos.length === 0 ? (
                        <p className="py-3 text-center text-sm text-gray-300">暂无代办</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {levelTodos.map((todo) => {
                            const checkBg = todo.done
                              ? levelCfg.key === 'week' ? 'bg-amber-500 border-amber-500 text-white'
                              : levelCfg.key === 'month' ? 'bg-blue-500 border-blue-500 text-white'
                              : 'bg-purple-500 border-purple-500 text-white'
                              : 'border-gray-300 hover:border-gray-400';
                            return (
                              <li
                                key={todo.id}
                                className={`group flex items-start gap-2.5 rounded-lg px-3 py-2 hover:bg-gray-50 transition-colors
                                  ${todo.done ? 'opacity-50' : ''}
                                `}
                              >
                                {/* 复选框 */}
                                <button
                                  type="button"
                                  onClick={() => toggleTodo(todo.id)}
                                  className={`mt-0.5 shrink-0 w-[18px] h-[18px] rounded border-2 flex items-center justify-center transition-colors
                                    ${checkBg}
                                  `}
                                >
                                  {todo.done && (
                                    <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5">
                                      <path d="M2 6l3 3 5-5" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                  )}
                                </button>
                                {/* 标题(支持多行换行) */}
                                <span className={`flex-1 text-sm leading-relaxed whitespace-pre-wrap break-words ${todo.done ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                                  {todo.title}
                                </span>
                                {/* 删除按钮(hover 显示) */}
                                <button
                                  type="button"
                                  onClick={() => deleteTodo(todo.id)}
                                  className="shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all"
                                  title="删除"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </main>
      </div>

      {/* ========== 日程详情弹窗 ========== */}
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
                <button type="button" onClick={closeDetail} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100">
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="px-6 py-5 space-y-4">
              {isLoadingDetail ? (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500">
                  <Loader2 size={16} className="animate-spin" />加载中...
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
                      <p className="mt-1 text-sm text-gray-700 flex items-center gap-1">
                        <MapPin size={12} />{selectedDetail.location}
                      </p>
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

      {/* ========== 创建/编辑日程弹窗 ========== */}
      {formMode && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-gray-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">
                {formMode === 'create' ? '新建日程' : '编辑日程'}
              </h3>
              <button type="button" onClick={closeForm} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100">
                <X size={18} />
              </button>
            </div>
            <form className="px-6 py-5 space-y-4" onSubmit={(event) => void handleSubmit(event)}>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">标题</span>
                <input
                  type="text"
                  className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                  placeholder="例如：团队周会、体检"
                  value={formValues.title}
                  onChange={(e) => setFormValues((c) => ({ ...c, title: e.target.value }))}
                  required
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">开始时间</span>
                  <input
                    type="datetime-local"
                    className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                    value={formValues.start_time}
                    onChange={(e) => setFormValues((c) => ({ ...c, start_time: e.target.value }))}
                    required
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">结束时间</span>
                  <input
                    type="datetime-local"
                    className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                    value={formValues.end_time}
                    onChange={(e) => setFormValues((c) => ({ ...c, end_time: e.target.value }))}
                    required
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">地点</span>
                <input
                  type="text"
                  className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                  placeholder="例如：会议室 A"
                  value={formValues.location}
                  onChange={(e) => setFormValues((c) => ({ ...c, location: e.target.value }))}
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">描述</span>
                <textarea
                  className="mt-2 w-full min-h-20 rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                  placeholder="备注、议程等"
                  value={formValues.description}
                  onChange={(e) => setFormValues((c) => ({ ...c, description: e.target.value }))}
                />
              </label>
              <div className="flex items-center justify-end gap-3 pt-2">
                <button type="button" onClick={closeForm} className="rounded-xl border border-gray-200 px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSubmitting && <Loader2 size={14} className="animate-spin" />}
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

// ========== 工具函数 ==========

function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function toLocalDateTimeString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${h}:${min}`;
}

function toRFC3339(localDateTime: string): string {
  if (!localDateTime) return '';
  return new Date(localDateTime).toISOString();
}

function formatTimeRange(startTime: string, endTime: string): string {
  const start = new Date(startTime);
  const end = new Date(endTime);
  const s = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
  const e = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
  if (!isSameDay(start, end)) {
    return `${start.getMonth() + 1}/${start.getDate()} ${s} - ${end.getMonth() + 1}/${end.getDate()} ${e}`;
  }
  return `${s} - ${e}`;
}
