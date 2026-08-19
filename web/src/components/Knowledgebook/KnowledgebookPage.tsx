import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useSearchParams } from 'react-router-dom';
import {
  BookOpen,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  Search,
  Terminal,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { CommandbookPage } from '../Commandbook/CommandbookPage';
import type { CommandbookPageRef } from '../Commandbook/CommandbookPage';
import {
  createKnowledgeItem,
  deleteKnowledgeItem,
  getKnowledgeItem,
  listKnowledgeItems,
  parseKnowledgeAI,
  updateKnowledgeItem,
} from '../../api/knowledgebook';

import { isUnauthorizedError } from '../../api/http';
import {
  emptyKnowledgeForm,
  getAllCategories,
  getCategoryLabel as getKnowledgeCategoryLabel,
  getRiskColor,
  getRiskLabel,
  loadCustomCategories,
  parseExtra,
  parseKeySpecs,
  parseTags,
  saveCustomCategories,
  slugifyCategory,
  stringifyExtra,
} from '../../types/knowledgebook';
import type {
  AlgorithmExtra,
  CustomCategory,
  HardwareExtra,
  KnowledgeCategory,
  KnowledgeDetail,
  KnowledgeExtra,
  KnowledgeInput,
  KnowledgeSummary,
  SystemPathExtra,
  UrlResourceExtra,
} from '../../types/knowledgebook';

import { useAuth } from '../../auth/AuthContext';

type DrawerMode = 'create' | 'edit' | 'view';
type HubView = 'knowledge' | 'commands';

/**
 * KnowledgebookPage 知识中枢页面
 *
 * 将原来的知识库和命令手册合并为统一的"知识中枢":
 *   顶部:视图切换 Tab(知识 / 命令) + 搜索 + 新建
 *   左:分类树(根据当前视图显示不同分类)
 *   中:列表卡片(知识卡片 / 命令卡片)
 *   右:常驻详情/编辑面板(不再是从右侧滑出的抽屉)
 */
export function KnowledgebookPage() {
  const { session, logout } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const isGuest = session?.isGuest === true;

  const token = session!.token;
  const onSessionExpired = logout;

  // --- 视图切换:知识 / 命令 ---
  const [activeView, setActiveView] = useState<HubView>(() => {
    const view = searchParams.get('view');
    return view === 'commands' ? 'commands' : 'knowledge';
  });

  // 命令视图搜索框状态(与知识视图独立)
  const [commandSearchKeyword, setCommandSearchKeyword] = useState('');
  const commandViewRef = useRef<CommandbookPageRef>(null);

  function handleSwitchView(view: HubView) {
    setActiveView(view);
    setSearchParams(view === 'commands' ? { view: 'commands' } : {});
    // 切换视图时重置当前选中,避免右侧面板显示旧数据
    setDrawerMode(null);
    setSelectedSummary(null);
    setSelectedDetail(null);
    setDrawerError(null);
    resetAIState();
    // 切回知识视图时清空命令搜索词,下次进入命令视图重新加载全部
    if (view === 'knowledge') {
      setCommandSearchKeyword('');
    }
  }

  // --- 自定义分类状态(存 localStorage) ---
  const [customCategories, setCustomCategories] = useState<CustomCategory[]>(() => loadCustomCategories());
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const allCategories = useMemo(() => getAllCategories(customCategories), [customCategories]);

  // --- 列表状态 ---
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [items, setItems] = useState<KnowledgeSummary[]>([]);
  const [allItems, setAllItems] = useState<KnowledgeSummary[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // --- 右侧抽屉状态 ---
  const [drawerMode, setDrawerMode] = useState<DrawerMode | null>(null);
  const [selectedSummary, setSelectedSummary] = useState<KnowledgeSummary | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<KnowledgeDetail | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [formValues, setFormValues] = useState<KnowledgeInput>(emptyKnowledgeForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  // --- AI 智能预填状态 ---
  const [aiRawText, setAiRawText] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // --- 搜索防抖 ---
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchInput = useCallback((value: string) => {
    setSearchKeyword(value);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      void loadItems(selectedCategory, value);
    }, 300);
  }, [selectedCategory]);

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

  const loadItems = useCallback(async (category: string, q: string) => {
    setIsLoadingList(true);
    setListError(null);
    try {
      const data = await listKnowledgeItems(token, category || undefined, q || undefined);
      setItems(data);
    } catch (loadError) {
      handleApiError(loadError, '加载知识库列表失败', setListError);
    } finally {
      setIsLoadingList(false);
    }
  }, [token, handleApiError]);

  const loadCategoryCounts = useCallback(async () => {
    try {
      const data = await listKnowledgeItems(token, undefined, undefined);
      setAllItems(data);
    } catch (loadError) {
      handleApiError(loadError, '加载分类计数失败', setListError);
    }
  }, [token, handleApiError]);

  useEffect(() => {
    void loadItems('', '');
    void loadCategoryCounts();
  }, [loadItems, loadCategoryCounts]);

  function handleSelectCategory(category: string) {
    setSelectedCategory(category);
    setDrawerMode(null);
    setSelectedSummary(null);
    setSelectedDetail(null);
    setDrawerError(null);
    void loadItems(category, searchKeyword);
  }

  // 添加自定义分类:同名/同 slug 视为重复,直接关闭输入框
  function handleAddCategory() {
    const label = newCategoryName.trim();
    if (!label) return;
    const value = slugifyCategory(label);
    if (!allCategories.some((item) => item.value === value || item.label === label)) {
      const next = [...customCategories, { value, label }];
      setCustomCategories(next);
      saveCustomCategories(next);
    }
    setIsAddingCategory(false);
    setNewCategoryName('');
  }

  async function openItemDetail(summary: KnowledgeSummary) {
    setSelectedSummary(summary);
    setSelectedDetail(null);
    setDrawerMode('view');
    setDrawerError(null);
    setIsLoadingDetail(true);

    try {
      const detail = await getKnowledgeItem(token, summary.id);
      setSelectedDetail(detail);
    } catch (detailError) {
      handleApiError(detailError, '读取知识详情失败', setDrawerError);
    } finally {
      setIsLoadingDetail(false);
    }
  }

  function openCreateForm() {
    setSelectedSummary(null);
    setSelectedDetail(null);
    setFormValues({ ...emptyKnowledgeForm, category: (selectedCategory as KnowledgeCategory) || 'system-path' });
    setDrawerError(null);
    resetAIState();
    setDrawerMode('create');
  }

  function openEditForm() {
    if (!selectedDetail) return;
    setFormValues({
      title: selectedDetail.title,
      category: selectedDetail.category,
      sub_category: selectedDetail.sub_category ?? '',
      tags: selectedDetail.tags ?? '',
      summary: selectedDetail.summary ?? '',
      content: selectedDetail.content ?? '',
      notes: selectedDetail.notes ?? '',
      reference_url: selectedDetail.reference_url ?? '',
      extra: selectedDetail.extra ?? '',
    });
    setDrawerError(null);
    resetAIState();
    setDrawerMode('edit');
  }

  function closeDrawer() {
    setDrawerMode(null);
    setSelectedSummary(null);
    setSelectedDetail(null);
    setFormValues(emptyKnowledgeForm);
    setDrawerError(null);
    resetAIState();
  }

  function resetAIState() {
    setAiRawText('');
    setIsParsing(false);
    setAiError(null);
  }

  async function handleParseAI() {
    const rawText = aiRawText.trim();
    if (!rawText) {
      setAiError('请先粘贴 AI 解释文本');
      return;
    }

    setIsParsing(true);
    setAiError(null);
    try {
      const result = await parseKnowledgeAI(token, {
        raw_text: rawText,
        category: formValues.category,
      });

      setFormValues((prev) => ({
        ...prev,
        title: result.title || prev.title,
        category: result.category || prev.category,
        sub_category: result.sub_category || prev.sub_category,
        tags: result.tags || prev.tags,
        summary: result.summary || prev.summary,
        content: result.content || prev.content,
        notes: result.notes || prev.notes,
        reference_url: result.reference_url || prev.reference_url,
        extra: result.extra || prev.extra,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI 解析失败';
      setAiError(message);
    } finally {
      setIsParsing(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!formValues.title.trim() || !formValues.category) {
      setDrawerError('标题和分类都是必填项');
      return;
    }

    setIsSubmitting(true);
    setDrawerError(null);

    const payload: KnowledgeInput = {
      title: formValues.title.trim(),
      category: formValues.category,
      sub_category: formValues.sub_category.trim(),
      tags: formValues.tags.trim(),
      summary: formValues.summary.trim(),
      content: formValues.content.trim(),
      notes: formValues.notes.trim(),
      reference_url: formValues.reference_url.trim(),
      extra: formValues.extra.trim(),
    };

    try {
      if (drawerMode === 'create') {
        await createKnowledgeItem(token, payload);
        closeDrawer();
        await loadItems(selectedCategory, searchKeyword);
        await loadCategoryCounts();
      } else if (drawerMode === 'edit' && selectedSummary) {
        const updated = await updateKnowledgeItem(token, selectedSummary.id, payload);
        setSelectedDetail(updated);
        await loadItems(selectedCategory, searchKeyword);
        await loadCategoryCounts();
        setDrawerMode('view');
      }
    } catch (submitError) {
      handleApiError(submitError, '保存失败', setDrawerError);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!selectedSummary) return;

    const confirmed = window.confirm(`确定删除知识「${selectedSummary.title}」吗？`);
    if (!confirmed) return;

    setIsSubmitting(true);
    setDrawerError(null);

    try {
      await deleteKnowledgeItem(token, selectedSummary.id);
      const newList = items.filter((item) => item.id !== selectedSummary.id);
      setItems(newList);
      await loadCategoryCounts();
      closeDrawer();
    } catch (deleteError) {
      handleApiError(deleteError, '删除失败', setDrawerError);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCopy(text: string) {
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

  const categoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of allItems) {
      map.set(item.category, (map.get(item.category) ?? 0) + 1);
    }
    return map;
  }, [allItems]);

  return (
    <>
      {isGuest && <Navigate to="/chat" replace />}
      <div className="flex h-full flex-col bg-gray-50">
        {/* 顶部操作栏 */}
        <div className="border-b border-gray-200 bg-white px-6 py-3 shrink-0 flex items-center justify-between gap-3">
        {/* 左侧:知识中枢视图切换 */}
        <div className="flex items-center gap-1 rounded-xl bg-gray-100 p-1">
          <button
            type="button"
            onClick={() => handleSwitchView('knowledge')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              activeView === 'knowledge'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/50'
            }`}
          >
            <BookOpen size={16} />
            知识
          </button>
          <button
            type="button"
            onClick={() => handleSwitchView('commands')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              activeView === 'commands'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/50'
            }`}
          >
            <Terminal size={16} />
            命令
          </button>
        </div>

        {/* 右侧:搜索 + 新建(知识与命令视图共用顶栏位置,内容根据视图切换) */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              value={activeView === 'commands' ? commandSearchKeyword : searchKeyword}
              onChange={(e) =>
                activeView === 'commands'
                  ? setCommandSearchKeyword(e.target.value)
                  : handleSearchInput(e.target.value)
              }
              placeholder={activeView === 'commands' ? '搜索命令/关键词...' : '搜索知识/关键词...'}
              className="w-64 rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          {activeView === 'commands' ? (
            <button
              type="button"
              onClick={() => commandViewRef.current?.openCreateForm()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <Plus size={16} />
              新建命令
            </button>
          ) : (
            <button
              type="button"
              onClick={openCreateForm}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <Plus size={16} />
              新建知识
            </button>
          )}
        </div>
      </div>

      {/* 主体内容区 */}
      <div className={`flex-1 min-h-0 bg-gray-50 ${activeView === 'knowledge' ? 'p-6' : ''}`}>
        {activeView === 'commands' ? (
          <CommandbookPage
            ref={commandViewRef}
            hideHeader
            searchKeyword={commandSearchKeyword}
            onSearchKeywordChange={setCommandSearchKeyword}
          />
        ) : (
          <div className="h-full grid grid-cols-1 lg:grid-cols-[180px_340px_1fr] gap-4">
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
            <CategoryItem
              label="全部"
              count={items.length}
              active={selectedCategory === ''}
              onClick={() => handleSelectCategory('')}
            />
            {allCategories.map((item) => (
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

        {/* 中间:知识列表 */}
        <section className="min-h-0 rounded-2xl border border-gray-200 bg-white overflow-hidden flex flex-col">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-800">
              {selectedCategory ? getKnowledgeCategoryLabel(selectedCategory) : '全部知识'}
              <span className="ml-2 text-xs text-gray-500">{items.length} 项</span>
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
            ) : items.length === 0 ? (
              <div className="py-16 text-center">
                <p className="text-sm text-gray-500">
                  {searchKeyword ? '没有匹配的知识' : '暂无知识,点击右上角"新建知识"开始记录'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void openItemDetail(item)}
                    className={`w-full text-left rounded-xl border p-3 transition-colors hover:border-indigo-300 hover:bg-indigo-50/40 ${
                      selectedSummary?.id === item.id
                        ? 'border-indigo-300 bg-indigo-50'
                        : 'border-gray-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-gray-900 truncate">
                        {item.title}
                      </span>
                      <KnowledgeCategoryBadge value={item.category} />
                    </div>
                    {item.summary && (
                      <div className="mt-1.5 text-xs text-gray-500 line-clamp-2">
                        {item.summary}
                      </div>
                    )}
                    <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                      {item.sub_category && (
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                          {item.sub_category}
                        </span>
                      )}
                      {parseTags(item.tags).map((tag) => (
                        <span key={tag} className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-600">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* 右侧:常驻详情/编辑面板 */}
        <aside className="min-h-0 rounded-2xl border border-gray-200 bg-white overflow-hidden flex flex-col">
          {drawerMode ? (
            <>
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-800">
                  {drawerMode === 'create' && '新建知识'}
                  {drawerMode === 'edit' && '编辑知识'}
                  {drawerMode === 'view' && '知识详情'}
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
                  {(drawerMode === 'create' || drawerMode === 'edit') && (
                    <button
                      type="button"
                      onClick={closeDrawer}
                      className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      <X size={12} />
                      取消
                    </button>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar">
                {drawerError && (
                  <div className="mx-5 mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                    {drawerError}
                  </div>
                )}

                {drawerMode === 'view' && (
                  isLoadingDetail ? (
                    <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
                      <Loader2 size={16} className="animate-spin" />
                      加载中...
                    </div>
                  ) : selectedDetail ? (
                    <KnowledgeDetailView
                      detail={selectedDetail}
                      onCopy={handleCopy}
                      copyFeedback={copyFeedback}
                    />
                  ) : (
                    <div className="py-16 text-center text-sm text-gray-500">
                      无法加载知识详情
                    </div>
                  )
                )}

                {(drawerMode === 'create' || drawerMode === 'edit') && (
                  <KnowledgeForm
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
                    categories={allCategories}
                  />
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-gray-500">
              <BookOpen size={40} className="text-gray-300" />
              <p>选择一项知识查看详情</p>
              <p className="text-xs text-gray-400">或点击右上角"新建知识"开始记录</p>
            </div>
          )}
        </aside>
        </div>
      )}
    </div>
  </div>
  </>
  );
}

// --- 子组件 ---

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

function KnowledgeCategoryBadge(props: { value: string }) {
  return (
    <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">
      {getKnowledgeCategoryLabel(props.value)}
    </span>
  );
}

function KnowledgeDetailView(props: {
  detail: KnowledgeDetail;
  onCopy: (text: string) => void;
  copyFeedback?: string | null;
}) {
  const { detail, onCopy, copyFeedback } = props;
  const extra = parseExtra(detail.extra);

  return (
    <div className="px-5 py-4 pb-20 space-y-4">
      <div>
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <KnowledgeCategoryBadge value={detail.category} />
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

      {detail.summary && (
        <div className="text-sm text-gray-700 bg-blue-50 rounded-lg p-3 border border-blue-100">
          {detail.summary}
        </div>
      )}

      {/* 类型专属详情 */}
      {detail.category === 'system-path' && <SystemPathDetailView extra={extra as SystemPathExtra} onCopy={onCopy} copyFeedback={copyFeedback} />}
      {detail.category === 'url-resource' && <UrlResourceDetailView extra={extra as UrlResourceExtra} />}
      {detail.category === 'hardware' && <HardwareDetailView extra={extra as HardwareExtra} />}
      {detail.category === 'algorithm' && <AlgorithmDetailView extra={extra as AlgorithmExtra} onCopy={onCopy} copyFeedback={copyFeedback} />}

      {detail.content && (
        <div>
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">详细介绍</div>
          <div className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap break-words">
            {detail.content}
          </div>
        </div>
      )}

      {detail.notes && (
        <div>
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">我的理解</div>
          <pre className="text-sm text-gray-800 bg-amber-50 rounded-lg p-3 whitespace-pre-wrap break-words border border-amber-100">
            {detail.notes}
          </pre>
        </div>
      )}

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

      <div className="pt-3 border-t border-gray-100 text-xs text-gray-400 space-y-0.5">
        <div>创建: {new Date(detail.created_at).toLocaleString('zh-CN')}</div>
        <div>更新: {new Date(detail.updated_at).toLocaleString('zh-CN')}</div>
      </div>
    </div>
  );
}

function SystemPathDetailView(props: {
  extra: SystemPathExtra;
  onCopy: (text: string) => void;
  copyFeedback?: string | null;
}) {
  const { extra, onCopy, copyFeedback } = props;
  if (!extra.path && !extra.parent_path) return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">路径信息</div>
      {extra.path && (
        <div>
          <div className="text-xs text-gray-400 mb-1">完整路径</div>
          <div className="flex items-center gap-2">
            <pre className="flex-1 font-mono text-xs text-gray-800 bg-gray-50 rounded px-2 py-1.5 whitespace-pre-wrap break-all">
              {extra.path}
            </pre>
            <CopyButton text={extra.path} onCopy={onCopy} feedback={copyFeedback} />
          </div>
        </div>
      )}
      {extra.parent_path && (
        <div>
          <div className="text-xs text-gray-400 mb-1">父级路径</div>
          <div className="font-mono text-xs text-gray-600 bg-gray-50 rounded px-2 py-1.5 break-all">
            {extra.parent_path}
          </div>
        </div>
      )}
      {extra.risk_level && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">清理风险:</span>
          <span className={`text-xs font-medium px-2 py-0.5 rounded border ${getRiskColor(extra.risk_level)}`}>
            {getRiskLabel(extra.risk_level)}
          </span>
        </div>
      )}
      {extra.cleanup_command && (
        <div>
          <div className="text-xs text-gray-400 mb-1">清理方式</div>
          <div className="flex items-center gap-2">
            <pre className="flex-1 font-mono text-xs text-gray-800 bg-gray-50 rounded px-2 py-1.5 whitespace-pre-wrap break-all">
              {extra.cleanup_command}
            </pre>
            <CopyButton text={extra.cleanup_command} onCopy={onCopy} feedback={copyFeedback} />
          </div>
        </div>
      )}
      {extra.related_paths && extra.related_paths.length > 0 && (
        <div>
          <div className="text-xs text-gray-400 mb-1">相关路径</div>
          <ul className="space-y-1">
            {extra.related_paths.map((path, idx) => (
              <li key={idx} className="font-mono text-xs text-gray-600 bg-gray-50 rounded px-2 py-1 break-all">
                {path}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function UrlResourceDetailView(props: { extra: UrlResourceExtra }) {
  const { extra } = props;
  if (!extra.url && !extra.site_name) return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">资源信息</div>
      {extra.url && (
        <a
          href={extra.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700 hover:underline break-all"
        >
          <ExternalLink size={14} />
          {extra.site_name || extra.url}
        </a>
      )}
      <div className="flex flex-wrap gap-2">
        {extra.resource_type && (
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600 border border-blue-100">
            {extra.resource_type}
          </span>
        )}
        {extra.language && (
          <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-600 border border-green-100">
            {extra.language}
          </span>
        )}
      </div>
    </div>
  );
}

function HardwareDetailView(props: { extra: HardwareExtra }) {
  const { extra } = props;
  if (!extra.hardware_type && !extra.brand_model) return null;

  const specs = parseKeySpecs(extra.key_specs);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">硬件规格</div>
      <div className="flex flex-wrap gap-2">
        {extra.hardware_type && (
          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
            {extra.hardware_type}
          </span>
        )}
        {extra.brand_model && (
          <span className="text-sm font-medium text-gray-800">
            {extra.brand_model}
          </span>
        )}
      </div>
      {specs.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full text-left text-sm">
            <tbody className="divide-y divide-gray-100">
              {specs.map((spec, idx) => (
                <tr key={idx}>
                  <td className="px-3 py-2 text-xs text-gray-500 w-24">{spec.key}</td>
                  <td className="px-3 py-2 text-sm text-gray-800">{spec.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {extra.use_case && (
        <div>
          <div className="text-xs text-gray-400 mb-1">适用场景</div>
          <div className="text-sm text-gray-700">{extra.use_case}</div>
        </div>
      )}
    </div>
  );
}

function AlgorithmDetailView(props: {
  extra: AlgorithmExtra;
  onCopy: (text: string) => void;
  copyFeedback?: string | null;
}) {
  const { extra, onCopy, copyFeedback } = props;
  if (!extra.algorithm_type && !extra.code_example) return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">算法信息</div>
      <div className="flex flex-wrap gap-2">
        {extra.difficulty && (
          <span className="rounded-full bg-purple-50 px-2 py-0.5 text-xs text-purple-600 border border-purple-100">
            {extra.difficulty}
          </span>
        )}
        {extra.algorithm_type && (
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600 border border-indigo-100">
            {extra.algorithm_type}
          </span>
        )}
        {extra.language && (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
            {extra.language}
          </span>
        )}
      </div>
      {(extra.time_complexity || extra.space_complexity) && (
        <div className="flex flex-wrap gap-4 text-sm">
          {extra.time_complexity && (
            <div>
              <span className="text-xs text-gray-400">时间复杂度:</span>
              <span className="ml-1 font-mono text-gray-800">{extra.time_complexity}</span>
            </div>
          )}
          {extra.space_complexity && (
            <div>
              <span className="text-xs text-gray-400">空间复杂度:</span>
              <span className="ml-1 font-mono text-gray-800">{extra.space_complexity}</span>
            </div>
          )}
        </div>
      )}
      {extra.code_example && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-400">代码示例</span>
            <CopyButton text={extra.code_example} onCopy={onCopy} feedback={copyFeedback} />
          </div>
          <pre className="font-mono text-xs text-gray-800 bg-gray-900 text-gray-50 rounded-lg p-3 whitespace-pre-wrap break-all">
            {extra.code_example}
          </pre>
        </div>
      )}
    </div>
  );
}

function CopyButton(props: {
  text: string;
  onCopy: (text: string) => void;
  feedback?: string | null;
}) {
  return (
    <button
      type="button"
      onClick={() => props.onCopy(props.text)}
      className="shrink-0 inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700"
    >
      {props.feedback ? (
        <span className="text-green-600">{props.feedback}</span>
      ) : (
        <>
          <Copy size={12} />
          复制
        </>
      )}
    </button>
  );
}

function KnowledgeForm(props: {
  values: KnowledgeInput;
  onChange: (values: KnowledgeInput) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  isSubmitting: boolean;
  submitLabel: string;
  aiRawText: string;
  onAiRawTextChange: (value: string) => void;
  isParsing: boolean;
  aiError: string | null;
  onParseAI: () => void;
  categories: Array<{ value: string; label: string }>;
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

  function updateField<K extends keyof KnowledgeInput>(key: K, value: KnowledgeInput[K]) {
    onChange({ ...values, [key]: value });
  }

  function updateExtra(patch: KnowledgeExtra) {
    const current = parseExtra(values.extra);
    const next = { ...current, ...patch };
    updateField('extra', stringifyExtra(next));
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
          placeholder="把 AI 对知识点的解释全文粘贴到这里,点击解析后会自动预填下方字段..."
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

      {/* 标题 */}
      <label className="block">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">标题 / 一句话说明</span>
        <input
          type="text"
          value={values.title}
          onChange={(e) => updateField('title', e.target.value)}
          placeholder="~/Library/Caches - macOS 应用临时缓存目录"
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          required
        />
      </label>

      {/* 分类 + 子分类 */}
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">知识类型</span>
          <select
            value={values.category}
            onChange={(e) => {
              const newCategory = e.target.value as KnowledgeCategory;
              updateField('category', newCategory);
              updateField('extra', '');
            }}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            required
          >
            {categories.map((item) => (
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
            placeholder="如:macOS"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </label>
      </div>

      {/* 标签 */}
      <label className="block">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">标签</span>
        <span className="text-xs text-gray-400 ml-1">多个用逗号分隔</span>
        <input
          type="text"
          value={values.tags}
          onChange={(e) => updateField('tags', e.target.value)}
          placeholder="缓存, 清理, 系统目录"
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </label>

      {/* 摘要 */}
      <label className="block">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">一句话摘要</span>
        <input
          type="text"
          value={values.summary}
          onChange={(e) => updateField('summary', e.target.value)}
          placeholder="50 字以内核心要点"
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </label>

      {/* 类型专属字段 */}
      <ExtraFieldsEditor category={values.category} extra={values.extra} onChange={updateExtra} />

      {/* 详细介绍 */}
      <label className="block">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">详细介绍</span>
        <textarea
          value={values.content}
          onChange={(e) => updateField('content', e.target.value)}
          placeholder="知识点的完整说明、背景、注意事项..."
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
          placeholder="个人笔记:坑点、记忆要点、联想..."
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
          placeholder="https://example.com"
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </label>

      {/* 操作按钮 */}
      <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isSubmitting && <Loader2 size={14} className="animate-spin" />}
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

function ExtraFieldsEditor(props: {
  category: KnowledgeCategory;
  extra: string;
  onChange: (patch: KnowledgeExtra) => void;
}) {
  const { category, extra, onChange } = props;
  const value = parseExtra(extra);

  switch (category) {
    case 'system-path':
      return <SystemPathExtraEditor value={value as SystemPathExtra} onChange={onChange} />;
    case 'url-resource':
      return <UrlResourceExtraEditor value={value as UrlResourceExtra} onChange={onChange} />;
    case 'hardware':
      return <HardwareExtraEditor value={value as HardwareExtra} onChange={onChange} />;
    case 'algorithm':
      return <AlgorithmExtraEditor value={value as AlgorithmExtra} onChange={onChange} />;
    default:
      return (
        <div className="rounded-lg border border-dashed border-gray-300 p-4 text-center text-sm text-gray-500">
          当前类型暂无专属字段
        </div>
      );
  }
}

function SystemPathExtraEditor(props: {
  value: SystemPathExtra;
  onChange: (patch: SystemPathExtra) => void;
}) {
  const { value, onChange } = props;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-3">
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">路径信息</div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-gray-500">完整路径</span>
          <input
            type="text"
            value={value.path ?? ''}
            onChange={(e) => onChange({ ...value, path: e.target.value })}
            placeholder="~/Library/Caches"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-mono focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">父级路径</span>
          <input
            type="text"
            value={value.parent_path ?? ''}
            onChange={(e) => onChange({ ...value, parent_path: e.target.value })}
            placeholder="~/Library"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-mono focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-gray-500">清理风险</span>
          <select
            value={value.risk_level ?? ''}
            onChange={(e) => onChange({ ...value, risk_level: e.target.value as SystemPathExtra['risk_level'] })}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="">请选择</option>
            <option value="safe">安全</option>
            <option value="caution">谨慎</option>
            <option value="danger">危险</option>
          </select>
        </label>
        <label className="block flex items-center gap-2 pt-5">
          <input
            type="checkbox"
            checked={value.can_cleanup ?? false}
            onChange={(e) => onChange({ ...value, can_cleanup: e.target.checked })}
            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span className="text-sm text-gray-700">可以清理</span>
        </label>
      </div>
      <label className="block">
        <span className="text-xs text-gray-500">清理方式</span>
        <input
          type="text"
          value={value.cleanup_command ?? ''}
          onChange={(e) => onChange({ ...value, cleanup_command: e.target.value })}
          placeholder="rm -rf ~/Library/Caches/*"
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-mono focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </label>
      <label className="block">
        <span className="text-xs text-gray-500">相关路径(每行一个)</span>
        <textarea
          value={(value.related_paths ?? []).join('\n')}
          onChange={(e) => onChange({ ...value, related_paths: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })}
          rows={3}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-mono focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </label>
    </div>
  );
}

function UrlResourceExtraEditor(props: {
  value: UrlResourceExtra;
  onChange: (patch: UrlResourceExtra) => void;
}) {
  const { value, onChange } = props;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-3">
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">资源信息</div>
      <label className="block">
        <span className="text-xs text-gray-500">资源地址</span>
        <input
          type="url"
          value={value.url ?? ''}
          onChange={(e) => onChange({ ...value, url: e.target.value })}
          placeholder="https://developer.mozilla.org"
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-gray-500">网站名称</span>
          <input
            type="text"
            value={value.site_name ?? ''}
            onChange={(e) => onChange({ ...value, site_name: e.target.value })}
            placeholder="MDN Web Docs"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">资源类型</span>
          <select
            value={value.resource_type ?? ''}
            onChange={(e) => onChange({ ...value, resource_type: e.target.value as UrlResourceExtra['resource_type'] })}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="">请选择</option>
            <option value="文档">文档</option>
            <option value="教程">教程</option>
            <option value="社区">社区</option>
            <option value="工具">工具</option>
            <option value="视频">视频</option>
            <option value="博客">博客</option>
          </select>
        </label>
      </div>
      <label className="block">
        <span className="text-xs text-gray-500">语言</span>
        <input
          type="text"
          value={value.language ?? ''}
          onChange={(e) => onChange({ ...value, language: e.target.value })}
          placeholder="中文 / 英文"
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </label>
    </div>
  );
}

function HardwareExtraEditor(props: {
  value: HardwareExtra;
  onChange: (patch: HardwareExtra) => void;
}) {
  const { value, onChange } = props;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-3">
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">硬件规格</div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-gray-500">硬件类型</span>
          <input
            type="text"
            value={value.hardware_type ?? ''}
            onChange={(e) => onChange({ ...value, hardware_type: e.target.value })}
            placeholder="CPU / GPU / 内存"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">品牌型号</span>
          <input
            type="text"
            value={value.brand_model ?? ''}
            onChange={(e) => onChange({ ...value, brand_model: e.target.value })}
            placeholder="Apple M3 Pro"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </label>
      </div>
      <label className="block">
        <span className="text-xs text-gray-500">关键规格(每行格式: 指标|数值)</span>
        <textarea
          value={(value.key_specs ?? []).join('\n')}
          onChange={(e) => onChange({ ...value, key_specs: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })}
          placeholder="核心数|12&#10;制程|3nm"
          rows={3}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </label>
      <label className="block">
        <span className="text-xs text-gray-500">适用场景</span>
        <input
          type="text"
          value={value.use_case ?? ''}
          onChange={(e) => onChange({ ...value, use_case: e.target.value })}
          placeholder="日常办公 / 深度学习 / 游戏"
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </label>
    </div>
  );
}

function AlgorithmExtraEditor(props: {
  value: AlgorithmExtra;
  onChange: (patch: AlgorithmExtra) => void;
}) {
  const { value, onChange } = props;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-3">
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">算法信息</div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-gray-500">难度</span>
          <select
            value={value.difficulty ?? ''}
            onChange={(e) => onChange({ ...value, difficulty: e.target.value as AlgorithmExtra['difficulty'] })}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="">请选择</option>
            <option value="入门">入门</option>
            <option value="中等">中等</option>
            <option value="进阶">进阶</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">算法类型</span>
          <input
            type="text"
            value={value.algorithm_type ?? ''}
            onChange={(e) => onChange({ ...value, algorithm_type: e.target.value })}
            placeholder="排序 / 搜索 / 动态规划"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-gray-500">示例代码语言</span>
          <input
            type="text"
            value={value.language ?? ''}
            onChange={(e) => onChange({ ...value, language: e.target.value })}
            placeholder="Python / Go / JavaScript"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">时间复杂度</span>
          <input
            type="text"
            value={value.time_complexity ?? ''}
            onChange={(e) => onChange({ ...value, time_complexity: e.target.value })}
            placeholder="O(n log n)"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-mono focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </label>
      </div>
      <label className="block">
        <span className="text-xs text-gray-500">空间复杂度</span>
        <input
          type="text"
          value={value.space_complexity ?? ''}
          onChange={(e) => onChange({ ...value, space_complexity: e.target.value })}
          placeholder="O(n)"
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-mono focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </label>
      <label className="block">
        <span className="text-xs text-gray-500">代码示例</span>
        <textarea
          value={value.code_example ?? ''}
          onChange={(e) => onChange({ ...value, code_example: e.target.value })}
          rows={6}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-mono focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </label>
    </div>
  );
}
