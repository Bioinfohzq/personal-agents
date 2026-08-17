import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import {
  Book,
  Copy,
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  createCommand,
  deleteCommand,
  getCommand,
  listCommands,
  updateCommand,
} from '../../api/commandbook';
import { isUnauthorizedError } from '../../api/http';
import {
  COMMAND_CATEGORIES,
  emptyCommandForm,
  getCategoryLabel,
  parseParameters,
} from '../../types/commandbook';
import type {
  CommandDetail,
  CommandInput,
  CommandSummary,
} from '../../types/commandbook';
import { useAuth } from '../../auth/AuthContext';

// 表单模式:create 新建 / edit 编辑 / view 只读详情
type DrawerMode = 'create' | 'edit' | 'view';

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
export function CommandbookPage() {
  const { session, logout } = useAuth();

  // 访客模式拦截:访客没有真实 token,重定向回聊天页
  if (session?.isGuest === true) {
    return <Navigate to="/chat" replace />;
  }

  const token = session!.token;
  const onSessionExpired = logout;

  // --- 列表状态 ---
  const [selectedCategory, setSelectedCategory] = useState<string>('');  // 空字符串 = 全部
  const [searchKeyword, setSearchKeyword] = useState('');
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

  // --- 搜索防抖 ---
  // 输入时 300ms 防抖触发后端搜索,避免每键一次请求
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchInput = useCallback((value: string) => {
    setSearchKeyword(value);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      void loadCommands(selectedCategory, value);
    }, 300);
  }, [selectedCategory]);

  // 清理防抖定时器
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // --- API 调用 ---

  const handleApiError = useCallback((apiError: unknown, fallback: string, setter: (msg: string | null) => void) => {
    if (isUnauthorizedError(apiError)) {
      onSessionExpired();
      return;
    }
    setter(apiError instanceof Error ? apiError.message : fallback);
  }, [onSessionExpired]);

  // 加载命令列表(中间区域,受分类/搜索影响)
  const loadCommands = useCallback(async (category: string, q: string) => {
    setIsLoadingList(true);
    setListError(null);
    try {
      const data = await listCommands(token, category || undefined, q || undefined);
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

  // 首次进入加载全部命令(列表 + 分类计数)
  useEffect(() => {
    void loadCommands('', '');
    void loadCategoryCounts();
  }, [loadCommands, loadCategoryCounts]);

  // 点分类:切换 category 后重新拉列表,并关闭右侧抽屉避免显示旧分类的命令
  function handleSelectCategory(category: string) {
    setSelectedCategory(category);
    setDrawerMode(null);
    setSelectedSummary(null);
    setSelectedDetail(null);
    setDrawerError(null);
    void loadCommands(category, searchKeyword);
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
  function openCreateForm() {
    setSelectedSummary(null);
    setSelectedDetail(null);
    setFormValues({ ...emptyCommandForm, category: selectedCategory || 'linux' });
    setDrawerError(null);
    setDrawerMode('create');
  }

  // 打开编辑表单(预填已有命令数据)
  function openEditForm() {
    if (!selectedDetail) return;
    setFormValues({
      title: selectedDetail.title,
      command_text: selectedDetail.command_text,
      category: selectedDetail.category,
      sub_category: selectedDetail.sub_category ?? '',
      introduction: selectedDetail.introduction ?? '',
      parameters: selectedDetail.parameters ?? '',
      notes: selectedDetail.notes ?? '',
      reference_url: selectedDetail.reference_url ?? '',
    });
    setDrawerError(null);
    setDrawerMode('edit');
  }

  // 关闭抽屉
  function closeDrawer() {
    setDrawerMode(null);
    setSelectedSummary(null);
    setSelectedDetail(null);
    setFormValues(emptyCommandForm);
    setDrawerError(null);
  }

  // 提交表单(创建或编辑)
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!formValues.title.trim() || !formValues.command_text.trim() || !formValues.category) {
      setDrawerError('标题/含义、命令、分类都是必填项');
      return;
    }

    setIsSubmitting(true);
    setDrawerError(null);

    const payload: CommandInput = {
      title: formValues.title.trim(),
      command_text: formValues.command_text.trim(),
      category: formValues.category,
      sub_category: formValues.sub_category.trim(),
      introduction: formValues.introduction.trim(),
      parameters: formValues.parameters.trim(),
      notes: formValues.notes.trim(),
      reference_url: formValues.reference_url.trim(),
    };

    try {
      if (drawerMode === 'create') {
        await createCommand(token, payload);
        closeDrawer();
        await loadCommands(selectedCategory, searchKeyword);
        await loadCategoryCounts();
      } else if (drawerMode === 'edit' && selectedSummary) {
        const updated = await updateCommand(token, selectedSummary.id, payload);
        setSelectedDetail(updated);
        // 刷新当前列表并同步分类计数(命令分类可能变化)
        await loadCommands(selectedCategory, searchKeyword);
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
    const map = new Map<string, number>();
    for (const cmd of allCommands) {
      map.set(cmd.category, (map.get(cmd.category) ?? 0) + 1);
    }
    return map;
  }, [allCommands]);

  return (
    <div className="flex h-full flex-col bg-gray-50">
      {/* 顶部标题栏 */}
      <div className="border-b border-gray-200 bg-white px-6 py-4 shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Book className="h-6 w-6 text-indigo-600" />
            <div>
              <h1 className="text-lg font-semibold text-gray-900">命令手册</h1>
              <p className="text-sm text-gray-500">记录各类命令及个人理解,搜索即得</p>
            </div>
          </div>

          {/* 搜索框:输入时 300ms 防抖触发后端搜索 */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                value={searchKeyword}
                onChange={(e) => handleSearchInput(e.target.value)}
                placeholder="搜索命令/关键词..."
                className="w-72 rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
        </div>
      </div>

      {/* 主体三栏布局:左侧分类树最窄,中间列表固定宽度,右侧详情/编辑占剩余空间 */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[160px_340px_1fr] gap-4 p-6">
        {/* 左侧:分类树 */}
        <aside className="hidden lg:flex flex-col rounded-2xl border border-gray-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wider">
            分类
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-0.5">
            {/* 全部分类 */}
            <CategoryItem
              label="全部"
              count={commands.length}
              active={selectedCategory === ''}
              onClick={() => handleSelectCategory('')}
            />
            {/* 各固定分类 */}
            {COMMAND_CATEGORIES.map((item) => (
              <CategoryItem
                key={item.value}
                label={item.label}
                count={categoryCounts.get(item.value) ?? 0}
                active={selectedCategory === item.value}
                onClick={() => handleSelectCategory(item.value)}
              />
            ))}
          </div>
        </aside>

        {/* 中间:命令列表 */}
        <section className="min-h-0 rounded-2xl border border-gray-200 bg-white overflow-hidden flex flex-col">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-800">
              {selectedCategory ? getCategoryLabel(selectedCategory) : '全部命令'}
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
                    className={`w-full text-left rounded-xl border p-3 transition-colors hover:border-indigo-300 hover:bg-indigo-50/40 ${
                      selectedSummary?.id === cmd.id
                        ? 'border-indigo-300 bg-indigo-50'
                        : 'border-gray-200'
                    }`}
                  >
                    {/* 第一行:标题(兼含义) + 分类标签 */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-gray-900 truncate">
                        {cmd.title}
                      </span>
                      <CategoryBadge value={cmd.category} />
                    </div>
                    {/* 第二行:命令文本 */}
                    <div className="mt-1.5 font-mono text-xs text-gray-600 bg-gray-50 rounded px-2 py-1 truncate">
                      {cmd.command_text}
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
                />
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

// --- 子组件 ---

/** 分类树条目 */
function CategoryItem(props: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`w-full flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
        props.active
          ? 'bg-indigo-50 text-indigo-700 font-medium'
          : 'text-gray-700 hover:bg-gray-50'
      }`}
    >
      <span>{props.label}</span>
      <span className={`text-xs ${props.active ? 'text-indigo-500' : 'text-gray-400'}`}>
        {props.count}
      </span>
    </button>
  );
}

/** 分类标签徽章 */
function CategoryBadge(props: { value: string }) {
  return (
    <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">
      {getCategoryLabel(props.value)}
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
    <div className="px-5 py-4 space-y-4">
      {/* 标题(兼一句话含义) + 分类标签 */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <CategoryBadge value={detail.category} />
          {detail.sub_category && (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
              {detail.sub_category}
            </span>
          )}
        </div>
        <h3 className="text-lg font-semibold text-gray-900 break-all">
          {detail.title}
        </h3>
      </div>

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

      {/* 详细介绍 */}
      {detail.introduction && (
        <div>
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">详细介绍</div>
          <div className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap break-words">
            {detail.introduction}
          </div>
        </div>
      )}

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
}) {
  const { values, onChange, onSubmit, onCancel, isSubmitting, submitLabel } = props;

  function updateField<K extends keyof CommandInput>(key: K, value: CommandInput[K]) {
    onChange({ ...values, [key]: value });
  }

  return (
    <form onSubmit={onSubmit} className="px-5 py-4 space-y-4">
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
            value={values.category}
            onChange={(e) => updateField('category', e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            required
          >
            {COMMAND_CATEGORIES.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
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
          {props.submitLabel}
        </button>
      </div>
    </form>
  );
}
