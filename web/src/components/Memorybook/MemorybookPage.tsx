import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import {
  Brain,
  Loader2,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
  X,
  Archive,
  ArchiveRestore,
} from 'lucide-react';
import {
  createMemory,
  deleteMemory,
  listMemories,
  updateMemory,
} from '../../api/memorybook';
import { isUnauthorizedError } from '../../api/http';
import type { MemoryInput, MemorySummary, MemoryTopic } from '../../types/memorybook';
import {
  TOPIC_LABELS,
  TOPIC_OPTIONS,
  emptyMemoryForm,
  getImportanceColor,
  getImportanceLabel,
} from '../../types/memorybook';
import { formatDate } from '../../utils/format';
import { useAuth } from '../../auth/AuthContext';

type FormMode = 'create' | 'edit' | null;

export function MemorybookPage() {
  const { session, logout } = useAuth();

  // 访客模式拦截
  if (session?.isGuest === true) {
    return <Navigate to="/chat" replace />;
  }

  const token = session!.token;
  const onSessionExpired = logout;
  const [items, setItems] = useState<MemorySummary[]>([]);
  const [keyword, setKeyword] = useState('');
  const [topicFilter, setTopicFilter] = useState<MemoryTopic | ''>('');
  const [showArchived, setShowArchived] = useState(false);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formValues, setFormValues] = useState<MemoryInput>(emptyMemoryForm);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const filteredItems = useMemo(() => {
    let result = items;
    if (topicFilter) {
      result = result.filter((item) => item.topic === topicFilter);
    }
    if (!showArchived) {
      result = result.filter((item) => item.is_active);
    }
    const query = keyword.trim().toLowerCase();
    if (query) {
      result = result.filter((item) =>
        item.title.toLowerCase().includes(query)
        || item.content.toLowerCase().includes(query),
      );
    }
    // 按重要性降序,再按更新时间降序
    return [...result].sort((a, b) => {
      if (a.importance !== b.importance) return b.importance - a.importance;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
  }, [items, keyword, topicFilter, showArchived]);

  // 按 topic 分组统计数量
  const topicCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of items) {
      if (item.is_active) {
        counts[item.topic] = (counts[item.topic] ?? 0) + 1;
      }
    }
    return counts;
  }, [items]);

  const handleApiError = useCallback((apiError: unknown, fallback: string) => {
    if (isUnauthorizedError(apiError)) {
      onSessionExpired();
      return;
    }
    setError(apiError instanceof Error ? apiError.message : fallback);
  }, [onSessionExpired]);

  const loadItems = useCallback(async () => {
    setIsLoadingList(true);
    setError(null);
    try {
      // 加载全部(包含归档),前端过滤
      const data = await listMemories(token, undefined, false);
      setItems(data);
    } catch (err) {
      handleApiError(err, '加载记忆列表失败');
    } finally {
      setIsLoadingList(false);
    }
  }, [token, handleApiError]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const openCreate = () => {
    setFormMode('create');
    setEditingId(null);
    setFormValues(emptyMemoryForm);
    setError(null);
  };

  const openEdit = (item: MemorySummary) => {
    setFormMode('edit');
    setEditingId(item.id);
    setFormValues({
      topic: item.topic,
      title: item.title,
      content: item.content,
      importance: item.importance,
      is_active: item.is_active,
    });
    setError(null);
  };

  const closeForm = () => {
    setFormMode(null);
    setEditingId(null);
    setFormValues(emptyMemoryForm);
    setError(null);
  };

  const toggleActive = async (item: MemorySummary) => {
    try {
      const updated = await updateMemory(token, item.id, {
        topic: item.topic,
        title: item.title,
        content: item.content,
        importance: item.importance,
        is_active: !item.is_active,
      });
      setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
    } catch (err) {
      handleApiError(err, item.is_active ? '归档失败' : '恢复失败');
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      if (formMode === 'create') {
        const created = await createMemory(token, formValues);
        setItems((prev) => [created, ...prev]);
      } else if (formMode === 'edit' && editingId !== null) {
        const updated = await updateMemory(token, editingId, formValues);
        setItems((prev) => prev.map((i) => (i.id === editingId ? updated : i)));
      }
      closeForm();
    } catch (err) {
      handleApiError(err, formMode === 'create' ? '创建记忆失败' : '更新记忆失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteMemory(token, id);
      setItems((prev) => prev.filter((i) => i.id !== id));
      setDeletingId(null);
      if (editingId === id) {
        closeForm();
      }
    } catch (err) {
      handleApiError(err, '删除记忆失败');
    }
  };

  return (
    <div className="h-full flex flex-col bg-white">
      {/* 头部 */}
      <div className="px-6 py-5 border-b border-gray-100 shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Brain size={24} className="text-indigo-600" />
            <h1 className="text-xl font-semibold text-gray-900">长期记忆</h1>
            <span className="text-sm text-gray-500">
              共 {items.filter((i) => i.is_active).length} 条激活，{items.filter((i) => !i.is_active).length} 条归档
            </span>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-colors"
          >
            <Plus size={16} />
            新建记忆
          </button>
        </div>

        {/* 筛选栏 */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索记忆标题或内容..."
              className="w-full pl-9 pr-4 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
            />
          </div>
          <select
            value={topicFilter}
            onChange={(e) => setTopicFilter(e.target.value as MemoryTopic | '')}
            className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 bg-white"
          >
            <option value="">全部分类</option>
            {TOPIC_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label} ({topicCounts[opt.value] ?? 0})
              </option>
            ))}
          </select>
          <label className="inline-flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            显示已归档
          </label>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mx-6 mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-center justify-between shrink-0">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
            <X size={16} />
          </button>
        </div>
      )}

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoadingList ? (
          <div className="flex items-center justify-center h-64 text-gray-400">
            <Loader2 size={24} className="animate-spin mr-2" />
            加载中...
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <Brain size={40} className="mb-3 opacity-40" />
            <p className="text-sm">
              {items.length === 0 ? '还没有记忆条目，点击右上角「新建记忆」开始记录' : '没有匹配的记忆'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredItems.map((item) => (
              <div
                key={item.id}
                className={`p-4 rounded-xl border transition-colors ${
                  item.is_active
                    ? 'border-gray-200 bg-white hover:border-gray-300'
                    : 'border-gray-100 bg-gray-50 opacity-70'
                } ${editingId === item.id ? 'ring-2 ring-indigo-500/20 border-indigo-300' : ''}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="text-xs font-medium px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-100">
                        {TOPIC_LABELS[item.topic]}
                      </span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-md border ${getImportanceColor(item.importance)}`}>
                        {getImportanceLabel(item.importance)}
                      </span>
                      {!item.is_active && (
                        <span className="text-xs font-medium px-2 py-0.5 rounded-md bg-gray-100 text-gray-500 border border-gray-200">
                          已归档
                        </span>
                      )}
                    </div>
                    <h3 className="text-sm font-semibold text-gray-900 mb-1 truncate">{item.title}</h3>
                    <p className="text-sm text-gray-600 whitespace-pre-wrap break-words line-clamp-3">
                      {item.content}
                    </p>
                    <p className="text-xs text-gray-400 mt-2">
                      创建于 {formatDate(item.created_at)}，更新于 {formatDate(item.updated_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEdit(item)}
                      className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                      title="编辑"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleActive(item)}
                      className="p-2 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                      title={item.is_active ? '归档' : '恢复'}
                    >
                      {item.is_active ? <Archive size={15} /> : <ArchiveRestore size={15} />}
                    </button>
                    {deletingId === item.id ? (
                      <div className="flex items-center gap-1 ml-1">
                        <button
                          type="button"
                          onClick={() => setDeletingId(null)}
                          className="px-2 py-1 text-xs rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(item.id)}
                          className="px-2 py-1 text-xs rounded-md bg-red-600 text-white hover:bg-red-500 transition-colors"
                        >
                          确认删除
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDeletingId(item.id)}
                        className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        title="删除"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 编辑/创建弹窗 */}
      {formMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
              <h2 className="text-lg font-semibold text-gray-900">
                {formMode === 'create' ? '新建记忆' : '编辑记忆'}
              </h2>
              <button
                type="button"
                onClick={closeForm}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
              <div className="px-6 py-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">主题分类</label>
                  <select
                    value={formValues.topic}
                    onChange={(e) => setFormValues((prev) => ({ ...prev, topic: e.target.value as MemoryTopic }))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 bg-white"
                    required
                  >
                    {TOPIC_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">标题</label>
                  <input
                    type="text"
                    value={formValues.title}
                    onChange={(e) => setFormValues((prev) => ({ ...prev, title: e.target.value }))}
                    placeholder="简短标题，如：包管理器使用 pnpm"
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
                    required
                    maxLength={200}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">重要度</label>
                  <div className="flex gap-2">
                    {[1, 2, 3, 4, 5].map((level) => (
                      <button
                        key={level}
                        type="button"
                        onClick={() => setFormValues((prev) => ({ ...prev, importance: level }))}
                        className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                          formValues.importance === level
                            ? level >= 4
                              ? 'bg-orange-50 border-orange-300 text-orange-700'
                              : 'bg-indigo-50 border-indigo-300 text-indigo-700'
                            : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                        }`}
                      >
                        {level}
                        <span className="block text-xs font-normal opacity-70 mt-0.5">
                          {level === 5 ? '核心' : level === 4 ? '重要' : level === 3 ? '一般' : level === 2 ? '较低' : '归档'}
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    重要度≥4的记忆会在每次对话开始时自动注入给 AI
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">内容</label>
                  <textarea
                    value={formValues.content}
                    onChange={(e) => setFormValues((prev) => ({ ...prev, content: e.target.value }))}
                    placeholder="记忆正文内容..."
                    rows={6}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 resize-y"
                    required
                  />
                </div>
                {formMode === 'edit' && (
                  <div>
                    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formValues.is_active}
                        onChange={(e) => setFormValues((prev) => ({ ...prev, is_active: e.target.checked }))}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      激活（未激活的记忆不会预注入，但仍可语义检索）
                    </label>
                  </div>
                )}
              </div>
              <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-3 shrink-0">
                <button
                  type="button"
                  onClick={closeForm}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Save size={16} />
                  )}
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
