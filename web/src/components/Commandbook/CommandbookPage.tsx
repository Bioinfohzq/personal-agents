import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import {
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import {
  createCommand,
  deleteCommand,
  getCommand,
  listCommands,
  parseCommandAI,
  updateCommand,
} from '../../api/commandbook';
import {
  createCategory,
  deleteCategory,
  listCategories,
  renameCategory,
} from '../../api/category';
import { isUnauthorizedError } from '../../api/http';
import {
  emptyCommandForm,
  getTemplateTypeLabel,
  parseParameters,
} from '../../types/commandbook';
import type { Category } from '../../types/category';
import { sortCategories } from '../../types/category';
import type {
  CommandDetail,
  CommandInput,
  CommandSummary,
  ProcedureStep,
  TemplateType,
} from '../../types/commandbook';
import { useAuth } from '../../auth/AuthContext';

// 表单模式:create 新建 / edit 编辑 / view 只读详情
type DrawerMode = 'create' | 'edit' | 'view';

// 使用场景结构化项
interface Scenario {
  description: string;
  command: string;
}

// 阿拉伯数字转中文序号(最多支持到 99)
function toChineseNumber(num: number): string {
  const digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const tens = ['', '十', '二十', '三十', '四十', '五十', '六十', '七十', '八十', '九十'];
  if (num <= 0) return '';
  if (num < 10) return digits[num];
  if (num === 10) return '十';
  if (num < 20) return '十' + digits[num % 10];
  if (num % 10 === 0) return tens[Math.floor(num / 10)];
  return tens[Math.floor(num / 10)] + digits[num % 10];
}

// 将存储字符串解析为结构化场景列表
function parseScenarios(text: string): Scenario[] {
  const lines = text.split('\n');
  const scenarios: Scenario[] = [];
  let current: Scenario | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const scenarioMatch = line.match(/^场景[一二三四五六七八九十百]+[：:]\s*(.*)$/);
    if (scenarioMatch) {
      if (current && (current.description.trim() || current.command.trim())) {
        scenarios.push(current);
      }
      current = { description: scenarioMatch[1] ?? '', command: '' };
    } else if (current) {
      current.command += (current.command ? '\n' : '') + rawLine;
    } else {
      // 没有场景标题时,作为命令兜底
      current = { description: '', command: rawLine };
    }
  }

  if (current && (current.description.trim() || current.command.trim())) {
    scenarios.push(current);
  }

  if (scenarios.length === 0) {
    scenarios.push({ description: '', command: '' });
  }

  return scenarios;
}

// 将结构化场景列表序列化为存储字符串
function serializeScenarios(scenarios: Scenario[]): string {
  return scenarios
    .filter((s) => s.description.trim() || s.command.trim())
    .map((s, idx) => {
      const prefix = `场景${toChineseNumber(idx + 1)}：${s.description.trim()}`;
      const command = s.command.trim();
      return command ? `${prefix}\n${command}` : prefix;
    })
    .join('\n\n');
}

/**
 * CommandbookPage 命令手册页面
 *
 * 三栏布局:
 *   左:分类树(全部 / 各固定分类)
 *   中:命令列表卡片(按选中分类 + 搜索关键词过滤)
 *   右:抽屉(只读详情 / 编辑表单共用同一区域)
 *
 * 数据流:
 *   进入页面 → listCommands(全部) → 渲染列表
 *   输入搜索框(300ms 防抖) → listCommands(category, q) → 刷新列表
 *   点分类 → 切换 category,重新拉列表
 *   点列表卡片 → getCommand(id) → 右侧抽屉显示详情
 *   点详情顶部"编辑" → 同一抽屉切换为表单
 *   点顶部"+ 新建命令" → 右侧抽屉打开空白表单
 */
export interface CommandbookPageProps {
  hideHeader?: boolean;
  searchKeyword?: string;
  onSearchKeywordChange?: (value: string) => void;
}

export interface CommandbookPageRef {
  openCreateForm: () => void;
}

export const CommandbookPage = forwardRef<CommandbookPageRef, CommandbookPageProps>(
  function CommandbookPage(props, ref) {
    const { hideHeader = false, searchKeyword: externalSearchKeyword, onSearchKeywordChange } = props;
    const { session, logout } = useAuth();

    // 访客模式拦截:访客没有真实 token,重定向回聊天页
    const isGuest = session?.isGuest === true;

    const token = session!.token;
    const onSessionExpired = logout;

    // 搜索关键词支持受控/非受控两种模式
    const isSearchControlled = externalSearchKeyword !== undefined;
    const [internalSearchKeyword, setInternalSearchKeyword] = useState('');
    const searchKeyword = isSearchControlled ? externalSearchKeyword : internalSearchKeyword;
    const setSearchKeyword = useCallback(
      (value: string) => {
        if (isSearchControlled) {
          onSearchKeywordChange?.(value);
        } else {
          setInternalSearchKeyword(value);
        }
      },
      [isSearchControlled, onSearchKeywordChange],
    );

    // --- 分类状态(从后端加载,支持增删改查) ---
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoadingCategories, setIsLoadingCategories] = useState(false);
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');

  // --- 列表状态 ---
  const [selectedCategoryId, setSelectedCategoryId] = useState<number>(0);  // 0 = 全部
  const [commands, setCommands] = useState<CommandSummary[]>([]);
  const [allCommands, setAllCommands] = useState<CommandSummary[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // --- 右侧抽屉状态 ---
  const [drawerMode, setDrawerMode] = useState<DrawerMode | null>(null);
  const [selectedSummary, setSelectedSummary] = useState<CommandSummary | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<CommandDetail | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [formValues, setFormValues] = useState<CommandInput>(emptyCommandForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  // --- AI 智能预填状态 ---
  const [aiRawText, setAiRawText] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // --- 搜索防抖 ---
  // 输入时 300ms 防抖触发后端搜索,避免每键一次请求
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchInput = useCallback((value: string) => {
    setSearchKeyword(value);
  }, [setSearchKeyword]);

  // --- API 调用 ---

  const handleApiError = useCallback((apiError: unknown, fallback: string, setter: (msg: string | null) => void) => {
    if (isUnauthorizedError(apiError)) {
      onSessionExpired();
      return;
    }
    setter(apiError instanceof Error ? apiError.message : fallback);
  }, [onSessionExpired]);

  // 加载命令列表(中间区域,受分类/搜索影响)
  const loadCommands = useCallback(async (categoryId: number, q: string) => {
    setIsLoadingList(true);
    setListError(null);
    try {
      const data = await listCommands(token, categoryId || undefined, q || undefined);
      setCommands(data);
    } catch (loadError) {
      handleApiError(loadError, '加载命令列表失败', setListError);
    } finally {
      setIsLoadingList(false);
    }
  }, [token, handleApiError]);

  // 加载全部命令,用于左侧分类计数(与当前筛选无关)
  const loadCategoryCounts = useCallback(async () => {
    try {
      const data = await listCommands(token, undefined, undefined);
      setAllCommands(data);
    } catch (loadError) {
      handleApiError(loadError, '加载分类计数失败', setListError);
    }
  }, [token, handleApiError]);

  // 分类或搜索词变化时 300ms 防抖加载列表(同时负责首次加载)
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      void loadCommands(selectedCategoryId, searchKeyword);
    }, 300);
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [selectedCategoryId, searchKeyword, loadCommands]);

  // --- API 调用:分类管理 ---
  const loadCategories = useCallback(async () => {
    setIsLoadingCategories(true);
    try {
      const data = await listCategories(token, 'command');
      setCategories(sortCategories(data));
    } catch (err) {
      handleApiError(err, '加载分类列表失败', setListError);
    } finally {
      setIsLoadingCategories(false);
    }
  }, [token, handleApiError]);

  // 首次进入加载分类和分类计数
  useEffect(() => {
    void loadCategories();
    void loadCategoryCounts();
  }, [loadCategories, loadCategoryCounts]);

  // 点分类:切换 categoryId 后关闭右侧抽屉避免显示旧分类的命令
  function handleSelectCategory(categoryId: number) {
    setSelectedCategoryId(categoryId);
    setDrawerMode(null);
    setSelectedSummary(null);
    setSelectedDetail(null);
    setDrawerError(null);
    void loadCommands(categoryId, searchKeyword);
  }

  // 添加自定义分类:同名视为重复
  async function handleAddCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    if (categories.some((item) => item.name === name)) {
      setIsAddingCategory(false);
      setNewCategoryName('');
      return;
    }
    try {
      await createCategory(token, { scope: 'command', name });
      await loadCategories();
    } catch (err) {
      handleApiError(err, '创建分类失败', setListError);
    }
    setIsAddingCategory(false);
    setNewCategoryName('');
  }

  async function handleRenameCategory(category: Category) {
    const name = editingCategoryName.trim();
    if (!name) {
      setEditingCategoryId(null);
      return;
    }
    try {
      await renameCategory(token, category.id, { name });
      await loadCategories();
      await loadCommands(selectedCategoryId, searchKeyword);
      await loadCategoryCounts();
    } catch (err) {
      handleApiError(err, '重命名分类失败', setListError);
    }
    setEditingCategoryId(null);
    setEditingCategoryName('');
  }

  async function handleRenameCategoryDirect(category: Category, newName: string) {
    const name = newName.trim();
    if (!name || name === category.name) return;
    try {
      await renameCategory(token, category.id, { name });
      await loadCategories();
      await loadCommands(selectedCategoryId, searchKeyword);
      await loadCategoryCounts();
    } catch (err) {
      handleApiError(err, '重命名分类失败', setListError);
    }
  }

  function startRenameCategory(category: Category) {
    setEditingCategoryId(category.id);
    setEditingCategoryName(category.name);
  }

  // 打开命令详情(只读模式)
  async function openCommandDetail(summary: CommandSummary) {
    setSelectedSummary(summary);
    setSelectedDetail(null);
    setDrawerMode('view');
    setDrawerError(null);
    setIsLoadingDetail(true);

    try {
      const detail = await getCommand(token, summary.id);
      setSelectedDetail(detail);
    } catch (detailError) {
      handleApiError(detailError, '读取命令详情失败', setDrawerError);
    } finally {
      setIsLoadingDetail(false);
    }
  }

  // 打开新建表单(空白)
  const defaultCategoryId = useMemo(() => {
    return categories.find((c) => c.slug === 'linux')?.id ?? (categories[0]?.id || 0);
  }, [categories]);

  function openCreateForm() {
    setSelectedSummary(null);
    setSelectedDetail(null);
    setFormValues({ ...emptyCommandForm, category_id: selectedCategoryId || defaultCategoryId });
    setDrawerError(null);
    resetAIState();
    setDrawerMode('create');
  }

  // 向父组件暴露 openCreateForm,便于知识中枢统一顶栏新建入口
  useImperativeHandle(ref, () => ({
    openCreateForm,
  }));

  // 打开编辑表单(预填已有命令数据)
  function openEditForm() {
    if (!selectedDetail) return;
    setFormValues({
      title: selectedDetail.title,
      command_text: selectedDetail.command_text,
      category_id: selectedDetail.category_id,
      sub_category: selectedDetail.sub_category ?? '',
      introduction: selectedDetail.introduction ?? '',
      parameters: selectedDetail.parameters ?? '',
      scenarios: selectedDetail.scenarios ?? '',
      notes: selectedDetail.notes ?? '',
      reference_url: selectedDetail.reference_url ?? '',
      template_type: selectedDetail.template_type ?? 'article',
      steps: selectedDetail.steps ?? [],
    });
    setDrawerError(null);
    resetAIState();
    setDrawerMode('edit');
  }

  // 关闭抽屉
  function closeDrawer() {
    setDrawerMode(null);
    setSelectedSummary(null);
    setSelectedDetail(null);
    setFormValues(emptyCommandForm);
    setDrawerError(null);
    resetAIState();
  }

  function resetAIState() {
    setAiRawText('');
    setIsParsing(false);
    setAiError(null);
  }

  // AI 智能解析 AI 解释文本并回填表单
  async function handleParseAI() {
    const rawText = aiRawText.trim();
    if (!rawText) {
      setAiError('请先粘贴 AI 解释文本');
      return;
    }

    setIsParsing(true);
    setAiError(null);
    try {
      const result = await parseCommandAI(token, {
        raw_text: rawText,
        category_id: formValues.category_id,
        template_type: formValues.template_type,
      });

      setFormValues((prev) => ({
        ...prev,
        title: result.title || prev.title,
        command_text: result.command_text || prev.command_text,
        category_id: result.category_id || prev.category_id,
        sub_category: result.sub_category || prev.sub_category,
        introduction: result.introduction || prev.introduction,
        parameters: result.parameters || prev.parameters,
        scenarios: result.scenarios || prev.scenarios,
        notes: result.notes || prev.notes,
        reference_url: result.reference_url || prev.reference_url,
        template_type: result.template_type || prev.template_type,
        steps: result.steps && result.steps.length > 0 ? result.steps : prev.steps,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI 解析失败';
      setAiError(message);
    } finally {
      setIsParsing(false);
    }
  }

  // 提交表单(创建或编辑)
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!formValues.title.trim() || !formValues.category_id) {
      setDrawerError('标题/含义和分类是必填项');
      return;
    }
    if (formValues.template_type === 'article' && !formValues.command_text.trim()) {
      setDrawerError('单条命令模板下,完整命令是必填项');
      return;
    }
    if (formValues.template_type === 'procedure' && formValues.steps.length === 0) {
      setDrawerError('流程模板下,至少需要添加一个步骤');
      return;
    }

    setIsSubmitting(true);
    setDrawerError(null);

    const payload: CommandInput = {
      title: formValues.title.trim(),
      command_text: formValues.command_text.trim(),
      category_id: formValues.category_id,
      sub_category: formValues.sub_category.trim(),
      introduction: formValues.introduction.trim(),
      parameters: formValues.parameters.trim(),
      scenarios: formValues.scenarios.trim(),
      notes: formValues.notes.trim(),
      reference_url: formValues.reference_url.trim(),
      template_type: formValues.template_type,
      steps: formValues.steps,
    };

    try {
      if (drawerMode === 'create') {
        await createCommand(token, payload);
        closeDrawer();
        await loadCommands(selectedCategoryId, searchKeyword);
        await loadCategoryCounts();
      } else if (drawerMode === 'edit' && selectedSummary) {
        const updated = await updateCommand(token, selectedSummary.id, payload);
        setSelectedDetail(updated);
        // 刷新当前列表并同步分类计数(命令分类可能变化)
        await loadCommands(selectedCategoryId, searchKeyword);
        await loadCategoryCounts();
        setDrawerMode('view');
      }
    } catch (submitError) {
      handleApiError(submitError, '保存失败', setDrawerError);
    } finally {
      setIsSubmitting(false);
    }
  }

  // 删除命令
  async function handleDelete() {
    if (!selectedSummary) return;

    const confirmed = window.confirm(`确定删除命令「${selectedSummary.title}」吗？`);
    if (!confirmed) return;

    setIsSubmitting(true);
    setDrawerError(null);

    try {
      await deleteCommand(token, selectedSummary.id);
      const newList = commands.filter((item) => item.id !== selectedSummary.id);
      setCommands(newList);
      await loadCategoryCounts();
      closeDrawer();
    } catch (deleteError) {
      handleApiError(deleteError, '删除失败', setDrawerError);
    } finally {
      setIsSubmitting(false);
    }
  }

  // 从列表卡片删除命令
  async function handleDeleteCommandFromList(cmd: CommandSummary, event: React.MouseEvent) {
    event.stopPropagation();
    const confirmed = window.confirm(`确定删除命令「${cmd.title}」吗？`);
    if (!confirmed) return;

    try {
      await deleteCommand(token, cmd.id);
      await loadCommands(selectedCategoryId, searchKeyword);
      await loadCategoryCounts();
      if (selectedSummary?.id === cmd.id) {
        closeDrawer();
      }
    } catch (deleteError) {
      handleApiError(deleteError, '删除失败', setListError);
    }
  }

  // 删除自定义分类:将其下命令移动到"其他"(后端事务处理)
  async function handleDeleteCategory(category: Category, event: React.MouseEvent) {
    event.stopPropagation();
    const count = categoryCounts.get(category.id) ?? 0;
    const confirmed = window.confirm(
      `确定删除分类「${category.name}」吗？该分类下的 ${count} 条命令将移动到「其他」分类。`,
    );
    if (!confirmed) return;

    try {
      await deleteCategory(token, category.id);
      if (selectedCategoryId === category.id) {
        setSelectedCategoryId(0);
        setDrawerMode(null);
        setSelectedSummary(null);
        setSelectedDetail(null);
      }
      await loadCategories();
      await loadCommands(selectedCategoryId === category.id ? 0 : selectedCategoryId, searchKeyword);
      await loadCategoryCounts();
    } catch (deleteError) {
      handleApiError(deleteError, '删除分类失败', setListError);
    }
  }

  // 复制命令到剪贴板
  // 优先使用 navigator.clipboard,不支持时回退到 document.execCommand('copy')
  async function handleCopyCommand(text: string) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (!ok) throw new Error('execCommand copy failed');
      }
      setCopyFeedback('已复制到剪贴板');
      setTimeout(() => setCopyFeedback(null), 1500);
    } catch {
      setCopyFeedback('复制失败,请手动复制');
      setTimeout(() => setCopyFeedback(null), 2000);
    }
  }

  // 按分类统计数量(左侧分类树显示数字)
  // 基于全部命令 allCommands 计算,不受当前筛选/搜索影响
  const categoryCounts = useMemo(() => {
    const map = new Map<number, number>();
    for (const cmd of allCommands) {
      map.set(cmd.category_id, (map.get(cmd.category_id) ?? 0) + 1);
    }
    return map;
  }, [allCommands]);

  const categoryMap = useMemo(() => {
    const map = new Map<number, Category>();
    for (const category of categories) {
      map.set(category.id, category);
    }
    return map;
  }, [categories]);

  const selectedCategoryName = useMemo(() => {
    return categoryMap.get(selectedCategoryId)?.name ?? '全部命令';
  }, [categoryMap, selectedCategoryId]);

  return (
    <>
      {isGuest && <Navigate to="/chat" replace />}
      <div className={hideHeader ? 'h-full bg-gray-50' : 'flex h-full flex-col bg-gray-50'}>
        {/* 顶部操作栏:搜索 + 新建 */}
        {!hideHeader && (
          <div className="border-b border-gray-200 bg-white px-6 py-3 shrink-0 flex items-center justify-end gap-3">
            {/* 搜索框:输入时 300ms 防抖触发后端搜索 */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                value={searchKeyword}
                onChange={(e) => handleSearchInput(e.target.value)}
                placeholder="搜索命令/关键词..."
                className="w-64 rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <button
            type="button"
            onClick={openCreateForm}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus size={16} />
            新建命令
          </button>
        </div>
      )}

      {/* 主体三栏布局:左侧分类树最窄,中间列表固定宽度,右侧详情/编辑占剩余空间 */}
      <div className={hideHeader ? 'h-full grid grid-cols-1 lg:grid-cols-[160px_340px_1fr] gap-4 p-6' : 'flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[160px_340px_1fr] gap-4 p-6'}>
        {/* 左侧:分类树 */}
        <aside className="hidden lg:flex flex-col rounded-2xl border border-gray-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              分类
            </span>
            <button
              type="button"
              onClick={() => { setIsAddingCategory((v) => !v); setNewCategoryName(''); }}
              title="添加分类"
              className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-indigo-600"
            >
              <Plus size={14} />
            </button>
          </div>
          {isAddingCategory && (
            <form
              onSubmit={(e) => { e.preventDefault(); handleAddCategory(); }}
              className="px-2 pt-2 flex items-center gap-1"
            >
              <input
                autoFocus
                type="text"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="分类名称"
                className="flex-1 min-w-0 rounded-lg border border-gray-300 px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none"
              />
              <button type="submit" title="确认" className="rounded p-1 text-indigo-600 hover:bg-indigo-50">
                <Check size={14} />
              </button>
              <button type="button" onClick={() => setIsAddingCategory(false)} title="取消" className="rounded p-1 text-gray-400 hover:bg-gray-100">
                <X size={14} />
              </button>
            </form>
          )}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-0.5">
            {/* 全部分类 */}
            <CategoryItem
              label="全部"
              count={allCommands.length}
              active={selectedCategoryId === 0}
              onClick={() => handleSelectCategory(0)}
            />
            {/* 从后端加载的分类 */}
            {categories.map((item) => (
              <CategoryItem
                key={item.id}
                category={item}
                count={categoryCounts.get(item.id) ?? 0}
                active={selectedCategoryId === item.id}
                deletable={true}
                onClick={() => handleSelectCategory(item.id)}
                onRenameConfirm={(newName) => void handleRenameCategoryDirect(item, newName)}
                onDelete={(event) => void handleDeleteCategory(item, event)}
              />
            ))}
          </div>
        </aside>

        {/* 中间:命令列表 */}
        <section className="min-h-0 rounded-2xl border border-gray-200 bg-white overflow-hidden flex flex-col">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-800">
              {selectedCategoryId ? selectedCategoryName : '全部命令'}
              <span className="ml-2 text-xs text-gray-500">{commands.length} 项</span>
            </h2>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
            {listError ? (
              <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                {listError}
              </div>
            ) : isLoadingList ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
                <Loader2 size={16} className="animate-spin" />
                加载中...
              </div>
            ) : commands.length === 0 ? (
              <div className="py-16 text-center">
                <p className="text-sm text-gray-500">
                  {searchKeyword ? '没有匹配的命令' : '暂无命令,点击右上角"新建命令"开始记录'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {commands.map((cmd) => (
                  <button
                    key={cmd.id}
                    type="button"
                    onClick={() => void openCommandDetail(cmd)}
                    className={`group relative w-full text-left rounded-xl border p-3 transition-colors hover:border-indigo-300 hover:bg-indigo-50/40 ${
                      selectedSummary?.id === cmd.id
                        ? 'border-indigo-300 bg-indigo-50'
                        : 'border-gray-200'
                    }`}
                  >
                    {/* 删除按钮:悬停显示 */}
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(event) => void handleDeleteCommandFromList(cmd, event)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          void handleDeleteCommandFromList(cmd, event as unknown as React.MouseEvent);
                        }
                      }}
                      title="删除命令"
                      className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 focus:opacity-100 rounded p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-opacity"
                    >
                      <Trash2 size={14} />
                    </span>
                    {/* 第一行:标题(兼含义) + 分类标签 */}
                    <div className="flex items-center justify-between gap-2 pr-7">
                      <span className="text-sm font-semibold text-gray-900 truncate">
                        {cmd.title}
                      </span>
                      <CategoryBadge category={categoryMap.get(cmd.category_id)} />
                    </div>
                    {/* 第二行:命令文本 / 模板类型 */}
                    <div className="mt-1.5 flex items-center gap-2">
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          cmd.template_type === 'procedure'
                            ? 'bg-purple-50 text-purple-600'
                            : 'bg-blue-50 text-blue-600'
                        }`}
                      >
                        {getTemplateTypeLabel(cmd.template_type)}
                      </span>
                      <span className="flex-1 font-mono text-xs text-gray-600 bg-gray-50 rounded px-2 py-1 truncate">
                        {cmd.command_text}
                      </span>
                    </div>
                    {/* 第三行:子分类(二级) */}
                    {cmd.sub_category && (
                      <div className="mt-1.5 flex items-center gap-2 text-xs text-gray-500">
                        <span className="rounded bg-gray-100 px-1.5 py-0.5">{cmd.sub_category}</span>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* 右侧:抽屉(详情/编辑共用) */}
        {drawerMode && (
          <aside className="min-h-0 rounded-2xl border border-gray-200 bg-white overflow-hidden flex flex-col">
            {/* 抽屉顶部:标题 + 操作按钮 */}
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800">
                {drawerMode === 'create' && '新建命令'}
                {drawerMode === 'edit' && '编辑命令'}
                {drawerMode === 'view' && '命令详情'}
              </h2>
              <div className="flex items-center gap-2">
                {drawerMode === 'view' && (
                  <>
                    <button
                      type="button"
                      onClick={openEditForm}
                      className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      <Pencil size={12} />
                      编辑
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete()}
                      disabled={isSubmitting}
                      className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      <Trash2 size={12} />
                      删除
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={closeDrawer}
                  className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {drawerError && (
                <div className="mx-5 mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                  {drawerError}
                </div>
              )}

              {/* 只读详情模式 */}
              {drawerMode === 'view' && (
                isLoadingDetail ? (
                  <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
                    <Loader2 size={16} className="animate-spin" />
                    加载中...
                  </div>
                ) : selectedDetail ? (
                  <CommandDetailView
                    detail={selectedDetail}
                    onCopy={handleCopyCommand}
                    copyFeedback={copyFeedback}
                  />
                ) : (
                  <div className="py-16 text-center text-sm text-gray-500">
                    无法加载命令详情
                  </div>
                )
              )}

              {/* 编辑/新建表单 */}
              {(drawerMode === 'create' || drawerMode === 'edit') && (
                <CommandForm
                  values={formValues}
                  onChange={setFormValues}
                  onSubmit={handleSubmit}
                  onCancel={closeDrawer}
                  isSubmitting={isSubmitting}
                  submitLabel={drawerMode === 'create' ? '创建' : '保存'}
                  aiRawText={aiRawText}
                  onAiRawTextChange={setAiRawText}
                  isParsing={isParsing}
                  aiError={aiError}
                  onParseAI={handleParseAI}
                  categories={categories}
                />
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  </>
  );
});

/** 使用场景结构化编辑器 */
function ScenarioEditor(props: { value: string; onChange: (value: string) => void }) {
  const { value, onChange } = props;
  const [scenarios, setScenarios] = useState<Scenario[]>(() => parseScenarios(value));

  // 外部 value 变化时(AI 预填/编辑切换)同步内部状态
  useEffect(() => {
    setScenarios(parseScenarios(value));
  }, [value]);

  function updateScenarios(next: Scenario[]) {
    setScenarios(next);
    onChange(serializeScenarios(next));
  }

  function updateScenario(index: number, patch: Partial<Scenario>) {
    const next = scenarios.map((s, idx) => (idx === index ? { ...s, ...patch } : s));
    updateScenarios(next);
  }

  function addScenario() {
    updateScenarios([...scenarios, { description: '', command: '' }]);
  }

  function removeScenario(index: number) {
    const next = scenarios.filter((_, idx) => idx !== index);
    updateScenarios(next.length > 0 ? next : [{ description: '', command: '' }]);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">使用场景</span>
        <button
          type="button"
          onClick={addScenario}
          className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
        >
          <Plus size={12} />
          添加场景
        </button>
      </div>

      {scenarios.map((scenario, index) => (
        <div
          key={index}
          className="rounded-lg border border-gray-200 bg-white p-3 space-y-2"
        >
          <div className="flex items-start gap-2">
            <span className="shrink-0 pt-2 text-xs font-medium text-indigo-700">
              场景{toChineseNumber(index + 1)}：
            </span>
            <input
              type="text"
              value={scenario.description}
              onChange={(e) => updateScenario(index, { description: e.target.value })}
              placeholder="描述这个使用场景..."
              className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            {scenarios.length > 1 && (
              <button
                type="button"
                onClick={() => removeScenario(index)}
                className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                title="删除场景"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
          <textarea
            value={scenario.command}
            onChange={(e) => updateScenario(index, { command: e.target.value })}
            placeholder="在此输入命令和细节..."
            rows={3}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      ))}
    </div>
  );
}

/** 流程步骤编辑器 */
function ProcedureStepEditor(props: {
  value: ProcedureStep[];
  onChange: (value: ProcedureStep[]) => void;
}) {
  const { value, onChange } = props;
  const [steps, setSteps] = useState<ProcedureStep[]>(() => value);

  useEffect(() => {
    setSteps(value);
  }, [value]);

  function updateSteps(next: ProcedureStep[]) {
    setSteps(next);
    onChange(next);
  }

  function updateStep(index: number, patch: Partial<ProcedureStep>) {
    const next = steps.map((s, idx) => (idx === index ? { ...s, ...patch } : s));
    updateSteps(next);
  }

  function addStep() {
    updateSteps([...steps, { title: '', code: '', note: '' }]);
  }

  function removeStep(index: number) {
    const next = steps.filter((_, idx) => idx !== index);
    updateSteps(next.length > 0 ? next : [{ title: '', code: '', note: '' }]);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">流程步骤</span>
        <button
          type="button"
          onClick={addStep}
          className="inline-flex items-center gap-1 rounded-lg border border-purple-200 px-2 py-1 text-xs font-medium text-purple-600 hover:bg-purple-50"
        >
          <Plus size={12} />
          添加步骤
        </button>
      </div>

      {steps.map((step, index) => (
        <div
          key={index}
          className="rounded-lg border border-gray-200 bg-white p-3 space-y-2"
        >
          <div className="flex items-start gap-2">
            <span className="shrink-0 pt-2 text-xs font-medium text-purple-700">
              步骤{index + 1}：
            </span>
            <input
              type="text"
              value={step.title}
              onChange={(e) => updateStep(index, { title: e.target.value })}
              placeholder="步骤标题"
              className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            {steps.length > 1 && (
              <button
                type="button"
                onClick={() => removeStep(index)}
                className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                title="删除步骤"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
          <textarea
            value={step.code}
            onChange={(e) => updateStep(index, { code: e.target.value })}
            placeholder="该步骤要执行的命令或代码(可选)"
            rows={3}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <textarea
            value={step.note}
            onChange={(e) => updateStep(index, { note: e.target.value })}
            placeholder="补充说明或注意事项(可选)"
            rows={2}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      ))}
    </div>
  );
}

// --- 子组件 ---

/** 分类树条目 */
function CategoryItem(props: {
  label?: string;
  category?: Category;
  count: number;
  active: boolean;
  deletable?: boolean;
  onClick: () => void;
  onRenameConfirm?: (newName: string) => void;
  onDelete?: (event: React.MouseEvent) => void;
}) {
  const label = props.category ? props.category.name : (props.label ?? '');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(label);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 编辑时自动聚焦
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // 点击外部关闭菜单或取消编辑
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (contextMenu && menuRef.current && !menuRef.current.contains(target)) {
        setContextMenu(null);
      }
      // 编辑模式：只在点击真正的外部区域时取消，排除提交按钮
      if (isEditing && inputRef.current) {
        const isSubmitButton = target.closest('button[type="submit"]');
        const isInsideInput = inputRef.current.contains(target);
        if (!isInsideInput && !isSubmitButton) {
          setIsEditing(false);
          setEditName(label);
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [contextMenu, isEditing, label]);

  // ESC 键取消编辑
  useEffect(() => {
    if (!isEditing) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setIsEditing(false);
        setEditName(label);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isEditing, label]);

  function handleContextMenu(e: React.MouseEvent) {
    if (props.onRenameConfirm || props.onDelete) {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY });
    }
  }

  function handleStartRename() {
    setContextMenu(null);
    setEditName(label);
    setIsEditing(true);
  }

  function handleConfirmRename() {
    const name = editName.trim();
    if (name && name !== label) {
      props.onRenameConfirm?.(name);
    }
    setIsEditing(false);
  }

  // 编辑模式
  if (isEditing) {
    return (
      <form
        onSubmit={(e) => { e.preventDefault(); handleConfirmRename(); }}
        className="flex items-center gap-1 rounded-lg px-2 py-1.5 bg-indigo-50"
      >
        <input
          ref={inputRef}
          type="text"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 min-w-0 rounded border border-indigo-300 px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none"
        />
        <button type="submit" title="确认" className="rounded p-1 text-indigo-600 hover:bg-indigo-100">
          <Check size={12} />
        </button>
      </form>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={props.onClick}
        onContextMenu={handleContextMenu}
        className={`group w-full flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
          props.active
            ? 'bg-indigo-50 text-indigo-700 font-medium'
            : 'text-gray-700 hover:bg-gray-50'
        }`}
      >
        <span className="truncate">{label}</span>
        <span className="flex items-center gap-1.5">
          <span className={`text-xs ${props.active ? 'text-indigo-500' : 'text-gray-400'}`}>
            {props.count}
          </span>
        </span>
      </button>

      {/* 右键上下文菜单 */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[120px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {props.onRenameConfirm && (
            <button
              type="button"
              onClick={handleStartRename}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100"
            >
              <Pencil size={14} />
              重命名
            </button>
          )}
          {props.deletable && props.onDelete && (
            <button
              type="button"
              onClick={() => { setContextMenu(null); props.onDelete?.(undefined as unknown as React.MouseEvent); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50"
            >
              <Trash2 size={14} />
              删除分类
            </button>
          )}
        </div>
      )}
    </>
  );
}

/** 分类标签徽章 */
function CategoryBadge(props: { category?: Category; value?: string }) {
  const displayName = props.category?.name ?? props.value ?? '其他';
  return (
    <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">
      {displayName}
    </span>
  );
}

/** 命令详情只读视图 */
function CommandDetailView(props: {
  detail: CommandDetail;
  onCopy: (text: string) => void;
  copyFeedback?: string | null;
}) {
  const { detail, onCopy, copyFeedback } = props;

  // 解析参数说明为表格数据(三级:具体参数含义)
  const parameters = useMemo(() => parseParameters(detail.parameters), [detail.parameters]);

  return (
    <div className="px-5 py-4 pb-20 space-y-4">
      {/* 标题(兼一句话含义) + 分类标签 */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <CategoryBadge value={detail.category} />
          {detail.sub_category && (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
              {detail.sub_category}
            </span>
          )}
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
              detail.template_type === 'procedure'
                ? 'bg-purple-50 text-purple-600'
                : 'bg-blue-50 text-blue-600'
            }`}
          >
            {getTemplateTypeLabel(detail.template_type)}
          </span>
        </div>
        <h3 className="text-lg font-semibold text-gray-900 break-all">
          {detail.title}
        </h3>
      </div>

      {detail.template_type === 'procedure' ? (
        <>
          {/* 流程步骤 */}
          {detail.steps && detail.steps.length > 0 && (
            <div>
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">流程步骤</div>
              <div className="space-y-3">
                {detail.steps.map((step, idx) => (
                  <div key={idx} className="rounded-lg border border-purple-100 bg-purple-50/50 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 rounded bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                        步骤{idx + 1}
                      </span>
                      <span className="text-sm font-medium text-gray-900">{step.title}</span>
                    </div>
                    {step.code && (
                      <div className="flex items-center justify-between gap-2">
                        <pre className="flex-1 font-mono text-xs text-gray-800 bg-white rounded px-2 py-1.5 whitespace-pre-wrap break-all">
                          {step.code}
                        </pre>
                        <button
                          type="button"
                          onClick={() => onCopy(step.code!)}
                          className="shrink-0 inline-flex items-center gap-1 text-xs text-purple-600 hover:text-purple-700"
                        >
                          <Copy size={12} />
                          复制
                        </button>
                      </div>
                    )}
                    {step.note && (
                      <div className="text-sm text-gray-700 whitespace-pre-wrap break-words">
                        {step.note}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          {/* 完整命令(带复制按钮) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">命令</span>
              <div className="flex items-center gap-2">
                {copyFeedback && (
                  <span className="text-xs text-green-600 animate-pulse">{copyFeedback}</span>
                )}
                <button
                  type="button"
                  onClick={() => onCopy(detail.command_text)}
                  className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700"
                >
                  <Copy size={12} />
                  复制
                </button>
              </div>
            </div>
            <pre className="font-mono text-sm text-gray-800 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap break-all">
              {detail.command_text}
            </pre>
          </div>

          {/* 参数说明表格(三级:每个参数的含义) */}
          {parameters.length > 0 && (
            <div>
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">参数说明</div>
              <div className="overflow-hidden rounded-lg border border-gray-200">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                    <tr>
                      <th className="px-3 py-2 font-medium w-20">参数</th>
                      <th className="px-3 py-2 font-medium w-32">全称</th>
                      <th className="px-3 py-2 font-medium">含义</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {parameters.map((item, idx) => (
                      <tr key={idx}>
                        <td className="px-3 py-2 font-mono text-indigo-700 align-top">
                          {item.param}
                        </td>
                        <td className="px-3 py-2 font-mono text-gray-600 align-top">
                          {item.fullName || '-'}
                        </td>
                        <td className="px-3 py-2 text-gray-800 break-words align-top">
                          {item.desc}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 使用场景 */}
          {detail.scenarios && (
            <div>
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">使用场景</div>
              <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-3 space-y-2">
                {detail.scenarios.split('\n').reduce<string[][]>((groups, line) => {
                  const trimmed = line.trim();
                  if (!trimmed) return groups;
                  if (trimmed.startsWith('场景')) {
                    groups.push([trimmed]);
                  } else if (groups.length > 0) {
                    groups[groups.length - 1].push(trimmed);
                  } else {
                    groups.push([trimmed]);
                  }
                  return groups;
                }, []).map((group, idx) => (
                  <div key={idx} className="space-y-1">
                    {group.map((line, lineIdx) =>
                      line.startsWith('场景') ? (
                        <div key={lineIdx} className="text-sm font-medium text-indigo-700">
                          {line}
                        </div>
                      ) : (
                        <pre
                          key={lineIdx}
                          className="font-mono text-xs text-gray-800 bg-white rounded px-2 py-1.5 whitespace-pre-wrap break-all"
                        >
                          {line}
                        </pre>
                      )
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* 详细介绍 */}
      {detail.introduction && (
        <div>
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">详细介绍</div>
          <div className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap break-words">
            {detail.introduction}
          </div>
        </div>
      )}

      {/* 我的理解 */}
      {detail.notes && (
        <div>
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">我的理解</div>
          <pre className="text-sm text-gray-800 bg-amber-50 rounded-lg p-3 whitespace-pre-wrap break-words border border-amber-100">
            {detail.notes}
          </pre>
        </div>
      )}

      {/* 资源链接 */}
      {detail.reference_url && (
        <div>
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">参考资源</div>
          <a
            href={detail.reference_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700 hover:underline break-all"
          >
            <ExternalLink size={14} />
            {detail.reference_url}
          </a>
        </div>
      )}

      {/* 元数据 */}
      <div className="pt-3 border-t border-gray-100 text-xs text-gray-400 space-y-0.5">
        <div>创建: {new Date(detail.created_at).toLocaleString('zh-CN')}</div>
        <div>更新: {new Date(detail.updated_at).toLocaleString('zh-CN')}</div>
      </div>
    </div>
  );
}

/** 命令新建/编辑表单 */
function CommandForm(props: {
  values: CommandInput;
  onChange: (values: CommandInput) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  isSubmitting: boolean;
  submitLabel: string;
  aiRawText: string;
  onAiRawTextChange: (value: string) => void;
  isParsing: boolean;
  aiError: string | null;
  onParseAI: () => void;
  categories: Category[];
}) {
  const {
    values,
    onChange,
    onSubmit,
    onCancel,
    isSubmitting,
    submitLabel,
    aiRawText,
    onAiRawTextChange,
    isParsing,
    aiError,
    onParseAI,
    categories,
  } = props;

  function updateField<K extends keyof CommandInput>(key: K, value: CommandInput[K]) {
    onChange({ ...values, [key]: value });
  }

  return (
    <form onSubmit={onSubmit} className="px-5 py-4 pb-20 space-y-4">
      {/* AI 智能预填 */}
      <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-3 space-y-2">
        <div className="flex items-center gap-1.5 text-sm font-medium text-indigo-700">
          <Wand2 size={16} />
          AI 智能预填
        </div>
        <textarea
          value={aiRawText}
          onChange={(e) => onAiRawTextChange(e.target.value)}
          placeholder="把 AI 对命令的解释全文粘贴到这里,点击解析后会自动预填下方字段..."
          rows={4}
          className="w-full rounded-lg border border-indigo-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
        />
        {aiError && (
          <div className="text-xs text-red-600">{aiError}</div>
        )}
        <button
          type="button"
          onClick={onParseAI}
          disabled={isParsing}
          className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {isParsing ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
          {isParsing ? '解析中...' : '一键解析'}
        </button>
      </div>

      {/* 模板类型 */}
      <label className="block">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">模板类型</span>
        <select
          value={values.template_type}
          onChange={(e) => updateField('template_type', e.target.value as TemplateType)}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="article">单条命令</option>
          <option value="procedure">流程模板</option>
        </select>
      </label>

      {/* 标题/一句话含义(合并字段) */}
      <label className="block">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">标题 / 一句话含义</span>
        <input
          type="text"
          value={values.title}
          onChange={(e) => updateField('title', e.target.value)}
          placeholder={`du - 查看磁盘占用空间`}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          required
        />
      </label>

      {/* 一级分类 + 二级子分类 */}
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">一级分类</span>
          <select
            value={values.category_id}
            onChange={(e) => updateField('category_id', Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            required
          >
            {categories.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">二级分类</span>
          <input
            type="text"
            value={values.sub_category}
            onChange={(e) => updateField('sub_category', e.target.value)}
            placeholder="如:磁盘管理"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </label>
      </div>

      {values.template_type === 'article' ? (
        <>
          {/* 完整命令 */}
          <label className="block">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">完整命令</span>
            <textarea
              value={values.command_text}
              onChange={(e) => updateField('command_text', e.target.value)}
              placeholder={`du -sh /var/log`}
              rows={3}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              required
            />
          </label>

          {/* 参数说明表格(三级,每行: 参数 | 全称 | 含义) */}
          <label className="block">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">参数说明(三级)</span>
            <span className="text-xs text-gray-400 ml-1">每行一个,格式:参数 | 全称 | 含义</span>
            <textarea
              value={values.parameters}
              onChange={(e) => updateField('parameters', e.target.value)}
              placeholder={`-s|--summarize|只显示每个目标的总大小,不展开子目录明细
-h|--human-readable|人类可读格式(KB/MB/GB)
-d 1|--max-depth=1|只显示一层子目录深度`}
              rows={5}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </label>

          {/* 使用场景 */}
          <ScenarioEditor value={values.scenarios} onChange={(v) => updateField('scenarios', v)} />
        </>
      ) : (
        <ProcedureStepEditor
          value={values.steps}
          onChange={(v) => updateField('steps', v)}
        />
      )}

      {/* 详细介绍 */}
      <label className="block">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">详细介绍</span>
        <textarea
          value={values.introduction}
          onChange={(e) => updateField('introduction', e.target.value)}
          placeholder="命令的完整说明、使用场景、注意事项..."
          rows={5}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </label>

      {/* 我的理解 */}
      <label className="block">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">我的理解</span>
        <textarea
          value={values.notes}
          onChange={(e) => updateField('notes', e.target.value)}
          placeholder="个人笔记:坑点、组合用法、示例..."
          rows={4}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </label>

      {/* 资源链接 */}
      <label className="block">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">参考资源链接</span>
        <input
          type="url"
          value={values.reference_url}
          onChange={(e) => updateField('reference_url', e.target.value)}
          placeholder="https://man7.org/linux/man-pages/man1/du.1.html"
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </label>

      {/* 操作按钮 */}
      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : null}
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
