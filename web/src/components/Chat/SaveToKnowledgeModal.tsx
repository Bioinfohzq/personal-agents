import { useEffect, useState } from 'react';
import { X, BookMarked, Check, Loader2 } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { listCategories } from '../../api/category';
import { createKnowledgeItem } from '../../api/knowledgebook';
import type { Category } from '../../types/category';
import type { Message } from '../../types/chat';
import { emptyKnowledgeForm } from '../../types/knowledgebook';
import type { KnowledgeInput } from '../../types/knowledgebook';

interface SaveToKnowledgeModalProps {
  open: boolean;
  message: Message | null;
  threadId: string | undefined;
  onClose: () => void;
  onSaved?: (itemId: number) => void;
}

/**
 * 从消息气泡"📥 存入"按钮唤起的弹窗
 * - 自动预填标题(取消息前30字)和正文(消息内容)
 * - 用户选择分类,可修改标题和添加标签/备注
 * - 提交后创建知识条目,携带 source_thread_id/source_msg_id/source_role
 */
export function SaveToKnowledgeModal({ open, message, threadId, onClose, onSaved }: SaveToKnowledgeModalProps) {
  const { session } = useAuth();
  const token = session?.token ?? '';

  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState<number>(0);
  const [tags, setTags] = useState('');
  const [summary, setSummary] = useState('');
  const [content, setContent] = useState('');

  // 打开时加载分类并预填消息内容
  useEffect(() => {
    if (!open || !message) return;
    setError('');

    // 预填:标题取消息前30字,正文用消息原文
    const raw = message.content.trim();
    const firstLine = raw.split('\n')[0].trim();
    setTitle(firstLine.length > 30 ? firstLine.slice(0, 30) + '…' : firstLine);
    setContent(raw);
    setSummary('');
    setTags('');
    setCategoryId(0);

    const load = async () => {
      setLoading(true);
      try {
        const cats = await listCategories(token, 'knowledge');
        setCategories(cats);
        // 默认选第一个分类
        if (cats.length > 0) {
          setCategoryId(cats[0].id);
        }
      } catch (err: any) {
        setError(err?.message || '加载分类失败');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [open, message, token]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message) return;
    if (!title.trim()) {
      setError('请填写标题');
      return;
    }
    if (!categoryId) {
      setError('请选择分类');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const payload: KnowledgeInput = {
        ...emptyKnowledgeForm,
        title: title.trim(),
        category_id: categoryId,
        tags: tags.trim(),
        summary: summary.trim(),
        content: content.trim(),
        template_type: 'article',
        source_thread_id: threadId || '',
        source_msg_id: message.id,
        source_role: message.role === 'user' ? 'user' : 'agent',
      };
      const created = await createKnowledgeItem(token, payload);
      onSaved?.(created.id);
      onClose();
    } catch (err: any) {
      setError(err?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <BookMarked size={18} className="text-blue-600" />
            <h3 className="text-base font-semibold text-gray-900">存入知识记录</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>

        {/* 表单 */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* 来源提示 */}
          <div className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
            来源:
            <span className={`ml-1 font-medium ${message?.role === 'user' ? 'text-blue-600' : 'text-gray-700'}`}>
              {message?.role === 'user' ? '我' : 'AI' }
            </span>
            的消息
            {threadId && <span className="ml-1 text-gray-400">(会话 {threadId.slice(0, 8)}…)</span>}
          </div>

          {/* 标题 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">标题 <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 text-sm"
              placeholder="知识条目标题"
              autoFocus
            />
          </div>

          {/* 分类 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">分类 <span className="text-red-500">*</span></label>
            {loading ? (
              <div className="text-sm text-gray-400 py-2">加载分类中...</div>
            ) : (
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 text-sm bg-white"
              >
                <option value={0} disabled>请选择分类</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* 标签 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">标签</label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 text-sm"
              placeholder="多个标签用逗号分隔,如:Go,数据库,踩坑"
            />
          </div>

          {/* 摘要 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">摘要</label>
            <input
              type="text"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 text-sm"
              placeholder="一句话概括(可选)"
            />
          </div>

          {/* 内容(预填,可编辑) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">内容</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={6}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 text-sm resize-y font-mono"
            />
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>
          )}
        </form>

        {/* 底部按钮 */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
            disabled={saving}
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving || loading}
            className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
