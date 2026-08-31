import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useSearchParams } from 'react-router-dom';
import {
  BookOpen,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Search,
  Terminal,
  Trash2,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import Markdown from 'react-markdown';

/** 根据内容自动调整 textarea 高度 */
function autoResizeTextarea(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}
import { CommandbookPage } from '../Commandbook/CommandbookPage';
import type { CommandbookPageRef } from '../Commandbook/CommandbookPage';
import {
  createKnowledgeItem,
  deleteKnowledgeItem,
  getKnowledgeItem,
  listKnowledgeItems,
  moveKnowledgeCategory,
  parseKnowledgeAI,
  updateKnowledgeItem,
} from '../../api/knowledgebook';
import {
  createCategory,
  deleteCategory,
  listCategories,
  renameCategory,
} from '../../api/category';

import { isUnauthorizedError } from '../../api/http';
import {
  emptyKnowledgeForm,
  createEmptyComparison,
  getRiskColor,
  getRiskLabel,
  getTemplateTypeLabel,
  parseExtra,
  parseKeySpecs,
  parseTags,
  stringifyExtra,
} from '../../types/knowledgebook';
import type {
  AlgorithmExtra,
  ComparisonTable,
  DocumentExtra,
  HardwareExtra,
  KnowledgeDetail,
  KnowledgeExtra,
  KnowledgeInput,
  KnowledgeSummary,
  ProcedureStep,
  SystemPathExtra,
  TemplateType,
  UrlResourceExtra,
} from '../../types/knowledgebook';
import type { Category } from '../../types/category';
import { sortCategories } from '../../types/category';

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

  // --- 分类状态(从后端加载,支持增删改查) ---
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoadingCategories, setIsLoadingCategories] = useState(false);
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');

  // --- 列表状态 ---
  const [selectedCategoryId, setSelectedCategoryId] = useState<number>(0);
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
      void loadItems(selectedCategoryId, value);
    }, 300);
  }, [selectedCategoryId]);

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

  const loadCategories = useCallback(async () => {
    setIsLoadingCategories(true);
    try {
      const data = await listCategories(token, 'knowledge');
      setCategories(sortCategories(data));
    } catch (err) {
      handleApiError(err, '加载分类列表失败', setListError);
    } finally {
      setIsLoadingCategories(false);
    }
  }, [token, handleApiError]);

  const loadItems = useCallback(async (categoryId: number, q: string) => {
    setIsLoadingList(true);
    setListError(null);
    try {
      const data = await listKnowledgeItems(token, categoryId || undefined, q || undefined);
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
    void loadCategories();
    void loadItems(0, '');
    void loadCategoryCounts();
  }, [loadCategories, loadItems, loadCategoryCounts]);

  function handleSelectCategory(categoryId: number) {
    setSelectedCategoryId(categoryId);
    setDrawerMode(null);
    setSelectedSummary(null);
    setSelectedDetail(null);
    setDrawerError(null);
    void loadItems(categoryId, searchKeyword);
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
      await createCategory(token, { scope: 'knowledge', name });
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
      await loadItems(selectedCategoryId, searchKeyword);
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
      await loadItems(selectedCategoryId, searchKeyword);
      await loadCategoryCounts();
    } catch (err) {
      handleApiError(err, '重命名分类失败', setListError);
    }
  }

  function startRenameCategory(category: Category) {
    setEditingCategoryId(category.id);
    setEditingCategoryName(category.name);
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

  const defaultCategoryId = useMemo(() => {
    return categories.find((c) => c.slug === 'system-path')?.id ?? (categories[0]?.id || 0);
  }, [categories]);

  function openCreateForm() {
    setSelectedSummary(null);
    setSelectedDetail(null);
    setFormValues({ ...emptyKnowledgeForm, category_id: selectedCategoryId || defaultCategoryId });
    setDrawerError(null);
    resetAIState();
    setDrawerMode('create');
  }

  function openEditForm() {
    if (!selectedDetail) return;
    setFormValues({
      title: selectedDetail.title,
      category_id: selectedDetail.category_id,
      sub_category: selectedDetail.sub_category ?? '',
      tags: selectedDetail.tags ?? '',
      summary: selectedDetail.summary ?? '',
      content: selectedDetail.content ?? '',
      notes: selectedDetail.notes ?? '',
      reference_url: selectedDetail.reference_url ?? '',
      extra: selectedDetail.extra ?? '',
      template_type: selectedDetail.template_type,
      steps: selectedDetail.steps ?? [],
      comparison: selectedDetail.comparison
        ? {
            headers: [...selectedDetail.comparison.headers],
            rows: selectedDetail.comparison.rows.map((r) => [...r]),
            intro: selectedDetail.comparison.intro,
            supplement: selectedDetail.comparison.supplement,
          }
        : undefined,
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
        category_id: formValues.category_id,
        template_type: formValues.template_type,
      });

      setFormValues((prev) => ({
        ...prev,
        title: result.title || prev.title,
        category_id: result.category_id || prev.category_id,
        sub_category: result.sub_category || prev.sub_category,
        tags: result.tags || prev.tags,
        summary: result.summary || prev.summary,
        content: result.content || prev.content,
        notes: result.notes || prev.notes,
        reference_url: result.reference_url || prev.reference_url,
        extra: result.extra || prev.extra,
        template_type: result.template_type || prev.template_type,
        steps: result.steps && result.steps.length > 0 ? result.steps : prev.steps,
        comparison: result.comparison && result.comparison.headers.length > 0
          ? result.comparison
          : prev.comparison,
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

    if (!formValues.title.trim() || !formValues.category_id) {
      setDrawerError('标题和分类都是必填项');
      return;
    }
    if (formValues.template_type === 'article' && !formValues.content.trim()) {
      setDrawerError('文章模板下,详细介绍是必填项');
      return;
    }
    if (formValues.template_type === 'document' && !formValues.content.trim()) {
      setDrawerError('文档模板下,请上传 Markdown 文件或填写内容');
      return;
    }
    if (formValues.template_type === 'procedure' && formValues.steps.length === 0) {
      setDrawerError('流程模板下,至少需要添加一个步骤');
      return;
    }
    if (formValues.template_type === 'comparison') {
      const cmp = formValues.comparison;
      if (!cmp || cmp.headers.length < 2 || cmp.rows.length === 0) {
        setDrawerError('对比模板下,至少需要 2 列和 1 行对比数据');
        return;
      }
      const hasContent = cmp.rows.some((row) => row.some((cell) => cell.trim() !== ''));
      if (!hasContent) {
        setDrawerError('对比模板下,请至少填写一行对比内容');
        return;
      }
    }

    setIsSubmitting(true);
    setDrawerError(null);

    const payload: KnowledgeInput = {
      title: formValues.title.trim(),
      category_id: formValues.category_id,
      sub_category: formValues.sub_category.trim(),
      tags: formValues.tags.trim(),
      summary: formValues.summary.trim(),
      content: formValues.content.trim(),
      notes: formValues.notes.trim(),
      reference_url: formValues.reference_url.trim(),
      extra: formValues.extra.trim(),
      template_type: formValues.template_type,
      steps: formValues.steps,
      comparison: formValues.template_type === 'comparison' ? formValues.comparison : undefined,
    };

    try {
      if (drawerMode === 'create') {
        await createKnowledgeItem(token, payload);
        closeDrawer();
        await loadItems(selectedCategoryId, searchKeyword);
        await loadCategoryCounts();
      } else if (drawerMode === 'edit' && selectedSummary) {
        const updated = await updateKnowledgeItem(token, selectedSummary.id, payload);
        setSelectedDetail(updated);
        await loadItems(selectedCategoryId, searchKeyword);
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

  // 从列表卡片删除知识条目
  async function handleDeleteItemFromList(item: KnowledgeSummary, event?: React.MouseEvent) {
    if (event) event.stopPropagation();
    const confirmed = window.confirm(`确定删除知识「${item.title}」吗？`);
    if (!confirmed) return;

    try {
      await deleteKnowledgeItem(token, item.id);
      await loadItems(selectedCategoryId, searchKeyword);
      await loadCategoryCounts();
      if (selectedSummary?.id === item.id) {
        closeDrawer();
      }
    } catch (deleteError) {
      handleApiError(deleteError, '删除失败', setListError);
    }
  }

  // 移动知识到其他分类
  async function handleMoveItemToCategory(item: KnowledgeSummary, targetCategoryId: number) {
    try {
      await moveKnowledgeCategory(token, item.id, targetCategoryId);
      await loadItems(selectedCategoryId, searchKeyword);
      await loadCategoryCounts();
      // 如果当前查看的是这条记录，更新详情
      if (selectedSummary?.id === item.id && selectedDetail) {
        const updated = await getKnowledgeItem(token, item.id);
        setSelectedDetail(updated);
      }
    } catch (err) {
      handleApiError(err, '移动分类失败', setListError);
    }
  }

  // 删除自定义分类:将其下知识条目移动到"其他"(后端事务处理)
  async function handleDeleteCategory(category: Category, event: React.MouseEvent) {
    event.stopPropagation();
    const count = categoryCounts.get(category.id) ?? 0;
    const confirmed = window.confirm(
      `确定删除分类「${category.name}」吗？该分类下的 ${count} 条知识将移动到「其他」分类。`,
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
      await loadItems(selectedCategoryId === category.id ? 0 : selectedCategoryId, searchKeyword);
      await loadCategoryCounts();
    } catch (deleteError) {
      handleApiError(deleteError, '删除分类失败', setListError);
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
    const map = new Map<number, number>();
    for (const item of allItems) {
      map.set(item.category_id, (map.get(item.category_id) ?? 0) + 1);
    }
    return map;
  }, [allItems]);

  const categoryMap = useMemo(() => {
    const map = new Map<number, Category>();
    for (const category of categories) {
      map.set(category.id, category);
    }
    return map;
  }, [categories]);

  const selectedCategoryName = useMemo(() => {
    return categoryMap.get(selectedCategoryId)?.name ?? '全部知识';
  }, [categoryMap, selectedCategoryId]);

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
              count={allItems.length}
              active={selectedCategoryId === 0}
              onClick={() => handleSelectCategory(0)}
            />
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

        {/* 中间:知识列表 */}
        <section className="min-h-0 rounded-2xl border border-gray-200 bg-white overflow-hidden flex flex-col">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-800">
              {selectedCategoryId ? selectedCategoryName : '全部知识'}
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
                  <KnowledgeItemCard
                    key={item.id}
                    item={item}
                    isActive={selectedSummary?.id === item.id}
                    category={categoryMap.get(item.category_id)}
                    categories={categories.filter(c => c.id !== item.category_id)}
                    onClick={() => void openItemDetail(item)}
                    onMoveToCategory={(targetId) => void handleMoveItemToCategory(item, targetId)}
                    onDelete={() => void handleDeleteItemFromList(item)}
                  />
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
                    categories={categories}
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

function KnowledgeCategoryBadge(props: { category?: Category; value?: string }) {
  const displayName = props.category?.name ?? props.value ?? '其他';
  return (
    <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">
      {displayName}
    </span>
  );
}

// 知识记录卡片:支持右键菜单(移动分类/删除)
function KnowledgeItemCard(props: {
  item: KnowledgeSummary;
  isActive: boolean;
  category?: Category;
  categories: Category[];
  onClick: () => void;
  onMoveToCategory: (targetCategoryId: number) => void;
  onDelete: () => void;
}) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [moveSubmenuOpen, setMoveSubmenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }

  function closeMenu() {
    setContextMenu(null);
    setMoveSubmenuOpen(false);
  }

  // 点击外部关闭菜单
  useEffect(() => {
    if (!contextMenu) return;
    function handler(e: PointerEvent) {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
      closeMenu();
    }
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [contextMenu]);

  return (
    <>
      <button
        type="button"
        onClick={props.onClick}
        onContextMenu={handleContextMenu}
        className={`relative w-full text-left rounded-xl border p-3 transition-colors hover:border-indigo-300 hover:bg-indigo-50/40 ${
          props.isActive ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-gray-900 truncate">
            {props.item.title}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                props.item.template_type === 'procedure'
                  ? 'bg-purple-50 text-purple-600'
                  : props.item.template_type === 'comparison'
                  ? 'bg-emerald-50 text-emerald-600'
                  : props.item.template_type === 'document'
                  ? 'bg-amber-50 text-amber-600'
                  : 'bg-blue-50 text-blue-600'
              }`}
            >
              {getTemplateTypeLabel(props.item.template_type)}
            </span>
            <KnowledgeCategoryBadge category={props.category} />
          </div>
        </div>
        {props.item.summary && (
          <div className="mt-1.5 text-xs text-gray-500 line-clamp-2">
            {props.item.summary}
          </div>
        )}
        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
          {props.item.sub_category && (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
              {props.item.sub_category}
            </span>
          )}
          {parseTags(props.item.tags).map((tag) => (
            <span key={tag} className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-600">
              {tag}
            </span>
          ))}
        </div>
      </button>

      {/* 右键上下文菜单 */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[160px] bg-white rounded-lg shadow-lg border border-gray-200 py-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {/* 移动到分类 */}
          <div
            className="relative"
            onMouseEnter={() => setMoveSubmenuOpen(true)}
            onMouseLeave={() => setMoveSubmenuOpen(false)}
          >
            <div className="flex items-center justify-between px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer">
              移动到分类
              <ChevronRight size={14} className="text-gray-400" />
            </div>
            {/* 子菜单:可选分类列表 */}
            {moveSubmenuOpen && props.categories.length > 0 && (
              <div
                className="absolute left-full top-0 ml-1 min-w-[140px] bg-white rounded-lg shadow-lg border border-gray-200 py-1"
                onMouseEnter={() => setMoveSubmenuOpen(true)}
                onMouseLeave={() => setMoveSubmenuOpen(false)}
              >
                {props.categories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => {
                      props.onMoveToCategory(cat.id);
                      closeMenu();
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 whitespace-nowrap"
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
            )}
            {moveSubmenuOpen && props.categories.length === 0 && (
              <div className="absolute left-full top-0 ml-1 min-w-[140px] bg-white rounded-lg shadow-lg border border-gray-200 py-2 px-3 text-sm text-gray-400">
                无其他分类
              </div>
            )}
          </div>

          <hr className="my-1 border-gray-100" />

          {/* 删除 */}
          <button
            type="button"
            onClick={() => {
              props.onDelete();
              closeMenu();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
          >
            <Trash2 size={14} />
            删除
          </button>
        </div>
      )}
    </>
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
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
              detail.template_type === 'procedure'
                ? 'bg-purple-50 text-purple-600'
                : detail.template_type === 'comparison'
                ? 'bg-emerald-50 text-emerald-600'
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

      {detail.summary && (
        <div className="text-sm text-gray-700 bg-blue-50 rounded-lg p-3 border border-blue-100">
          {detail.summary}
        </div>
      )}

      {/* 流程步骤 */}
      {detail.template_type === 'procedure' && detail.steps && detail.steps.length > 0 && (
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

      {/* 对比模板 */}
      {detail.template_type === 'comparison' && detail.comparison && detail.comparison.headers.length > 0 && (
        <div className="space-y-3">
          {/* 基础介绍 */}
          {detail.comparison.intro && (
            <div>
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">基础介绍</div>
              <div className="text-sm text-gray-700 bg-emerald-50/50 rounded-lg p-3 border border-emerald-100 whitespace-pre-wrap break-words">
                {detail.comparison.intro}
              </div>
            </div>
          )}

          {/* 对比表格 */}
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">对比表格</div>
            <div className="overflow-x-auto rounded-lg border border-emerald-100">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-emerald-50">
                    {detail.comparison.headers.map((h, i) => (
                      <th
                        key={i}
                        className={`px-3 py-2 text-left text-xs font-semibold text-emerald-800 border-b border-emerald-100 ${
                          i === 0 ? 'w-32' : ''
                        }`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {detail.comparison.rows.map((row, ri) => (
                    <tr key={ri} className="hover:bg-gray-50">
                      {row.map((cell, ci) => (
                        <td
                          key={ci}
                          className={`px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                            ci === 0 ? 'font-medium text-gray-900 bg-gray-50/50' : 'text-gray-700'
                          }`}
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 补充说明 */}
          {detail.comparison.supplement && (
            <div>
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">补充说明</div>
              <div className="text-sm text-gray-700 bg-amber-50/50 rounded-lg p-3 border border-amber-100 whitespace-pre-wrap break-words">
                {detail.comparison.supplement}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 类型专属详情 */}
      {detail.category === 'system-path' && <SystemPathDetailView extra={extra as SystemPathExtra} onCopy={onCopy} copyFeedback={copyFeedback} />}
      {detail.category === 'url-resource' && <UrlResourceDetailView extra={extra as UrlResourceExtra} />}
      {detail.category === 'hardware' && <HardwareDetailView extra={extra as HardwareExtra} />}
      {detail.category === 'algorithm' && <AlgorithmDetailView extra={extra as AlgorithmExtra} onCopy={onCopy} copyFeedback={copyFeedback} />}

      {/* 文档模板:Markdown 渲染 + 预览/源码切换;其他模板保持纯文本 */}
      {detail.template_type === 'document' ? (
        detail.content && (
          <DocumentContentView
            content={detail.content}
            filename={parseExtra<DocumentExtra>(detail.extra).filename}
          />
        )
      ) : detail.content && (
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

/** Markdown 渲染预览:react-markdown + Tailwind 手写排版样式 */
function MarkdownPreview(props: { content: string }) {
  return (
    <div className="text-sm leading-relaxed text-gray-700">
      <Markdown
        components={{
          h1: ({ children }) => <h1 className="mt-5 mb-2 text-xl font-bold text-gray-900 first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="mt-4 mb-2 text-lg font-bold text-gray-900 first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="mt-3 mb-1.5 text-base font-semibold text-gray-900 first:mt-0">{children}</h3>,
          h4: ({ children }) => <h4 className="mt-3 mb-1 text-sm font-semibold text-gray-900 first:mt-0">{children}</h4>,
          p: ({ children }) => <p className="my-2 whitespace-pre-wrap break-words">{children}</p>,
          ul: ({ children }) => <ul className="my-2 list-disc pl-5 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal pl-5 space-y-1">{children}</ol>,
          li: ({ children }) => <li className="break-words">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-4 border-amber-300 bg-amber-50/60 px-3 py-2 text-gray-700">{children}</blockquote>
          ),
          hr: () => <hr className="my-4 border-gray-200" />,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline break-all">
              {children}
            </a>
          ),
          img: ({ src, alt }) => (
            <img src={src} alt={alt ?? ''} className="my-2 max-w-full rounded-lg border border-gray-200" />
          ),
          pre: ({ children }) => (
            <pre className="my-2 overflow-x-auto rounded-lg bg-gray-900 p-3 text-xs leading-relaxed text-gray-50">
              {children}
            </pre>
          ),
          code: ({ className, children }) =>
            // 带 language- 前缀的是代码块(样式在 pre 上),否则按行内代码处理
            /language-/.test(className ?? '') ? (
              <code className={`${className ?? ''} font-mono`}>{children}</code>
            ) : (
              <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs text-pink-600 break-all">
                {children}
              </code>
            ),
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full text-sm">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-gray-50">{children}</thead>,
          th: ({ children }) => (
            <th className="border-b border-gray-200 px-3 py-2 text-left text-xs font-semibold text-gray-800">{children}</th>
          ),
          td: ({ children }) => <td className="border-b border-gray-100 px-3 py-2 align-top break-words">{children}</td>,
        }}
      >
        {props.content}
      </Markdown>
    </div>
  );
}

/** 文档内容查看:预览(Markdown 渲染)/源码切换 */
function DocumentContentView(props: { content: string; filename?: string }) {
  const { content, filename } = props;
  const [mode, setMode] = useState<'preview' | 'source'>('preview');

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500 uppercase tracking-wide">
          <FileText size={14} />
          文档内容
        </div>
        {/* 预览/源码切换 */}
        <div className="flex items-center rounded-lg bg-gray-100 p-0.5">
          <button
            type="button"
            onClick={() => setMode('preview')}
            className={`rounded-md px-2 py-0.5 text-xs font-medium transition-colors ${
              mode === 'preview' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            预览
          </button>
          <button
            type="button"
            onClick={() => setMode('source')}
            className={`rounded-md px-2 py-0.5 text-xs font-medium transition-colors ${
              mode === 'source' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            源码
          </button>
        </div>
      </div>
      {filename && (
        <div className="mb-2 inline-flex items-center gap-1.5 rounded-lg border border-amber-100 bg-amber-50 px-2.5 py-1 text-xs text-amber-700">
          <FileText size={12} />
          {filename}
        </div>
      )}
      {mode === 'preview' ? (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <MarkdownPreview content={content} />
        </div>
      ) : (
        <pre className="rounded-lg bg-gray-50 p-3 font-mono text-xs text-gray-800 whitespace-pre-wrap break-words">
          {content}
        </pre>
      )}
    </div>
  );
}

/** 文档模板编辑器:上传 .md 文件回填正文,支持源码编辑与预览切换 */
function DocumentContentEditor(props: {
  value: string;
  extra: string;
  onChange: (content: string) => void;
  onExtraChange: (patch: KnowledgeExtra) => void;
}) {
  const { value, extra, onChange, onExtraChange } = props;
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [isReading, setIsReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const filename = parseExtra<DocumentExtra>(extra).filename;

  // 读取本地 Markdown 文件,回填正文与文件名
  async function handleFile(file: File) {
    setIsReading(true);
    setReadError(null);
    try {
      const text = await file.text();
      onChange(text);
      onExtraChange({ filename: file.name });
    } catch {
      setReadError('文件读取失败');
    } finally {
      setIsReading(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500 uppercase tracking-wide">
          <FileText size={14} />
          文档内容
        </div>
        <div className="flex items-center gap-2">
          {/* 编辑/预览切换 */}
          <div className="flex items-center rounded-lg bg-gray-100 p-0.5">
            <button
              type="button"
              onClick={() => setMode('edit')}
              className={`rounded-md px-2 py-0.5 text-xs font-medium transition-colors ${
                mode === 'edit' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              编辑
            </button>
            <button
              type="button"
              onClick={() => setMode('preview')}
              className={`rounded-md px-2 py-0.5 text-xs font-medium transition-colors ${
                mode === 'preview' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              预览
            </button>
          </div>
          {/* 上传按钮 */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isReading}
            className="inline-flex items-center gap-1 rounded-lg border border-amber-200 px-2.5 py-1 text-xs font-medium text-amber-600 hover:bg-amber-50 disabled:opacity-50"
          >
            {isReading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            上传文件
          </button>
          {/* 隐藏的文件选择框(不限制后缀:macOS 下 accept=".md" 过滤会导致 .md 文件在对话框中不可见) */}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              // 清空 value 以便重复选择同一文件时仍触发 onChange
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {filename && (
        <div className="inline-flex items-center gap-1.5 rounded-lg border border-amber-100 bg-amber-50 px-2.5 py-1 text-xs text-amber-700">
          <FileText size={12} />
          {filename}
        </div>
      )}
      {readError && <div className="text-xs text-red-600">{readError}</div>}

      {mode === 'edit' ? (
        <textarea
          ref={autoResizeTextarea}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            autoResizeTextarea(e.target);
          }}
          placeholder="点击「上传文件」导入 .md 文件,或直接在此粘贴/编写 Markdown..."
          rows={6}
          className="w-full resize-y min-h-[160px] rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      ) : value ? (
        <div className="rounded-lg border border-gray-200 bg-white p-4 min-h-[160px]">
          <MarkdownPreview content={value} />
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">
          暂无内容,请上传文件或切换到编辑模式
        </div>
      )}
    </div>
  );
}

function KnowledgeForm(props: {
  values: KnowledgeInput;
  onChange: (updater: KnowledgeInput | ((prev: KnowledgeInput) => KnowledgeInput)) => void;
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

  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === values.category_id),
    [categories, values.category_id],
  );

  // 函数式更新:避免同一事件内多次调用时用旧闭包 values 互相覆盖字段
  function updateField<K extends keyof KnowledgeInput>(key: K, value: KnowledgeInput[K]) {
    onChange((prev: KnowledgeInput) => ({ ...prev, [key]: value }));
  }

  function updateExtra(patch: KnowledgeExtra) {
    onChange((prev: KnowledgeInput) => {
      const current = parseExtra(prev.extra);
      const next = { ...current, ...patch };
      return { ...prev, extra: stringifyExtra(next) };
    });
  }

  return (
    <form onSubmit={onSubmit} className="px-5 py-4 pb-20 space-y-4">
      {/* AI 智能预填(文档模板不适用,隐藏) */}
      {values.template_type !== 'document' && (
      <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-3 space-y-2">
        <div className="flex items-center gap-1.5 text-sm font-medium text-indigo-700">
          <Wand2 size={16} />
          AI 智能预填
        </div>
        <textarea
          ref={autoResizeTextarea}
          value={aiRawText}
          onChange={(e) => {
            onAiRawTextChange(e.target.value);
            autoResizeTextarea(e.target);
          }}
          placeholder="把 AI 对知识点的解释全文粘贴到这里,点击解析后会自动预填下方字段..."
          rows={1}
          className="w-full resize-none overflow-hidden rounded-lg border border-indigo-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
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
      )}

      {/* 模板类型 */}
      <label className="block">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">模板类型</span>
        <select
          value={values.template_type}
          onChange={(e) => {
            const t = e.target.value as TemplateType;
            const patch: Partial<KnowledgeInput> = { template_type: t };
            if (t === 'comparison' && !values.comparison) {
              patch.comparison = createEmptyComparison();
            }
            onChange({ ...values, ...patch });
          }}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="article">文章模板</option>
          <option value="procedure">流程模板</option>
          <option value="comparison">对比模板</option>
          <option value="document">文档模板</option>
        </select>
      </label>

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
            value={values.category_id}
            onChange={(e) => {
              const newCategoryId = Number(e.target.value);
              onChange({ ...values, category_id: newCategoryId, extra: '' });
            }}
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

      {values.template_type === 'article' ? (
        <>
          {/* 类型专属字段 */}
          <ExtraFieldsEditor category={selectedCategory} extra={values.extra} onChange={updateExtra} />

          {/* 详细介绍 */}
          <label className="block">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">详细介绍</span>
            <textarea
              ref={autoResizeTextarea}
              value={values.content}
              onChange={(e) => {
                updateField('content', e.target.value);
                autoResizeTextarea(e.target);
              }}
              placeholder="知识点的完整说明、背景、注意事项..."
              rows={1}
              className="mt-1 w-full resize-none overflow-hidden rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </label>
        </>
      ) : values.template_type === 'procedure' ? (
        <ProcedureStepEditor
          value={values.steps}
          onChange={(v) => updateField('steps', v)}
        />
      ) : values.template_type === 'document' ? (
        <DocumentContentEditor
          value={values.content}
          extra={values.extra}
          onChange={(v) => updateField('content', v)}
          onExtraChange={updateExtra}
        />
      ) : (
        <ComparisonTableEditor
          value={values.comparison ?? createEmptyComparison()}
          onChange={(v) => updateField('comparison', v)}
        />
      )}

      {/* 我的理解 */}
      <label className="block">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">我的理解</span>
        <textarea
          ref={autoResizeTextarea}
          value={values.notes}
          onChange={(e) => {
            updateField('notes', e.target.value);
            autoResizeTextarea(e.target);
          }}
          placeholder="个人笔记:坑点、记忆要点、联想..."
          rows={1}
          className="mt-1 w-full resize-none overflow-hidden rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
  category?: Category;
  extra: string;
  onChange: (patch: KnowledgeExtra) => void;
}) {
  const { category, extra, onChange } = props;
  const value = parseExtra(extra);

  switch (category?.slug) {
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
          ref={autoResizeTextarea}
          value={(value.related_paths ?? []).join('\n')}
          onChange={(e) => {
            onChange({ ...value, related_paths: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) });
            autoResizeTextarea(e.target);
          }}
          rows={1}
          className="mt-1 w-full resize-none overflow-hidden rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-mono focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
          ref={autoResizeTextarea}
          value={(value.key_specs ?? []).join('\n')}
          onChange={(e) => {
            onChange({ ...value, key_specs: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) });
            autoResizeTextarea(e.target);
          }}
          placeholder="核心数|12&#10;制程|3nm"
          rows={1}
          className="mt-1 w-full resize-none overflow-hidden rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
          ref={autoResizeTextarea}
          value={value.code_example ?? ''}
          onChange={(e) => {
            onChange({ ...value, code_example: e.target.value });
            autoResizeTextarea(e.target);
          }}
          rows={1}
          className="mt-1 w-full resize-none overflow-hidden rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-mono focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </label>
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
            ref={autoResizeTextarea}
            value={step.code}
            onChange={(e) => {
              updateStep(index, { code: e.target.value });
              autoResizeTextarea(e.target);
            }}
            placeholder="该步骤的命令或代码(可选)"
            rows={1}
            className="w-full resize-none overflow-hidden rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <textarea
            ref={autoResizeTextarea}
            value={step.note}
            onChange={(e) => {
              updateStep(index, { note: e.target.value });
              autoResizeTextarea(e.target);
            }}
            placeholder="补充说明或注意事项(可选)"
            rows={1}
            className="w-full resize-none overflow-hidden rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      ))}
    </div>
  );
}

/** 对比表格编辑器 */
function ComparisonTableEditor(props: {
  value: ComparisonTable;
  onChange: (value: ComparisonTable) => void;
}) {
  const { value, onChange } = props;

  function updateIntro(v: string) {
    onChange({ ...value, intro: v });
  }

  function updateSupplement(v: string) {
    onChange({ ...value, supplement: v });
  }

  function updateHeader(index: number, v: string) {
    const headers = [...value.headers];
    headers[index] = v;
    onChange({ ...value, headers });
  }

  function updateCell(rowIndex: number, colIndex: number, v: string) {
    const rows = value.rows.map((r) => [...r]);
    rows[rowIndex][colIndex] = v;
    onChange({ ...value, rows });
  }

  function addColumn() {
    const colLabel = String.fromCharCode(65 + value.headers.length - 1); // A, B, C...
    const headers = [...value.headers, colLabel];
    const rows = value.rows.map((r) => [...r, '']);
    onChange({ ...value, headers, rows });
  }

  function removeColumn(index: number) {
    if (value.headers.length <= 2) return; // 至少保留 2 列(维度列 + 1 个对比列)
    const headers = value.headers.filter((_, i) => i !== index);
    const rows = value.rows.map((r) => r.filter((_, i) => i !== index));
    onChange({ ...value, headers, rows });
  }

  function addRow() {
    const row = value.headers.map(() => '');
    onChange({ ...value, rows: [...value.rows, row] });
  }

  function removeRow(index: number) {
    if (value.rows.length <= 1) return; // 至少保留 1 行
    const rows = value.rows.filter((_, i) => i !== index);
    onChange({ ...value, rows });
  }

  return (
    <div className="space-y-4">
      {/* 基础介绍 */}
      <label className="block">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">基础介绍</span>
        <textarea
          ref={autoResizeTextarea}
          value={value.intro ?? ''}
          onChange={(e) => {
            updateIntro(e.target.value);
            autoResizeTextarea(e.target);
          }}
          placeholder="对比内容的背景说明、核心结论..."
          rows={1}
          className="mt-1 w-full resize-none overflow-hidden rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </label>

      {/* 对比表格 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">对比表格</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={addColumn}
              className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50"
            >
              <Plus size={12} />
              添加列
            </button>
            <button
              type="button"
              onClick={addRow}
              className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50"
            >
              <Plus size={12} />
              添加行
            </button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-emerald-50/60">
                {value.headers.map((h, i) => (
                  <th key={i} className="px-2 py-2 border-b border-emerald-100">
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={h}
                        onChange={(e) => updateHeader(i, e.target.value)}
                        placeholder={i === 0 ? '对比维度' : `对比项 ${i}`}
                        className={`w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-xs font-semibold text-emerald-800 focus:border-emerald-300 focus:bg-white focus:outline-none ${
                          i === 0 ? 'w-28' : 'min-w-[100px]'
                        }`}
                      />
                      {value.headers.length > 2 && i > 0 && (
                        <button
                          type="button"
                          onClick={() => removeColumn(i)}
                          className="shrink-0 rounded p-0.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                          title="删除此列"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {value.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} className={`px-2 py-1.5 align-top ${ci === 0 ? 'bg-gray-50/40' : ''}`}>
                      <div className="flex items-start gap-1">
                        <textarea
                        ref={autoResizeTextarea}
                        value={cell}
                        onChange={(e) => {
                          updateCell(ri, ci, e.target.value);
                          autoResizeTextarea(e.target);
                        }}
                        placeholder={ci === 0 ? '维度名称' : ''}
                        rows={1}
                        className={`w-full resize-none overflow-hidden rounded border border-transparent bg-transparent px-1.5 py-1 text-sm focus:border-emerald-300 focus:bg-white focus:outline-none ${
                          ci === 0 ? 'font-medium text-gray-900 w-28' : 'text-gray-700 min-w-[100px]'
                        }`}
                      />
                        {ci === 0 && value.rows.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeRow(ri)}
                            className="shrink-0 mt-1 rounded p-0.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                            title="删除此行"
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-gray-400">
          提示：第一列为对比维度，其余列为被对比的事物；可添加/删除行列以支持 2 列、3 列或更多对比。
        </p>
      </div>

      {/* 补充说明 */}
      <label className="block">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">补充说明</span>
        <textarea
          ref={autoResizeTextarea}
          value={value.supplement ?? ''}
          onChange={(e) => {
            updateSupplement(e.target.value);
            autoResizeTextarea(e.target);
          }}
          placeholder="额外补充、选型建议、注意事项..."
          rows={1}
          className="mt-1 w-full resize-none overflow-hidden rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </label>
    </div>
  );
}
