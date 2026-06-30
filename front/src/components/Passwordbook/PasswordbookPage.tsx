import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  createPasswordbookItem,
  deletePasswordbookItem,
  getPasswordbookItem,
  listPasswordbookItems,
  updatePasswordbookItem,
} from '../../api/passwordbook';
import type { PasswordbookItemInput, PasswordbookItemSummary } from '../../types/passwordbook';
import { formatDate } from '../../utils/format';

interface PasswordbookPageProps {
  token: string;
}

type FormMode = 'create' | 'edit';

const emptyForm: PasswordbookItemInput = {
  platform: '',
  login_account: '',
  password: '',
  login_url: '',
  notes: '',
};

export function PasswordbookPage({ token }: PasswordbookPageProps) {
  const [items, setItems] = useState<PasswordbookItemSummary[]>([]);
  const [keyword, setKeyword] = useState('');
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [selectedPassword, setSelectedPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<FormMode | null>(null);
  const [formValues, setFormValues] = useState<PasswordbookItemInput>(emptyForm);
  const [copyHint, setCopyHint] = useState<string | null>(null);

  const filteredItems = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    if (!query) {
      return items;
    }

    return items.filter((item) =>
      item.platform.toLowerCase().includes(query)
      || item.login_account.toLowerCase().includes(query)
      || (item.notes ?? '').toLowerCase().includes(query),
    );
  }, [items, keyword]);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedItemId) ?? null,
    [items, selectedItemId],
  );

  const loadItems = useCallback(async () => {
    setIsLoadingList(true);
    setError(null);

    try {
      const nextItems = await listPasswordbookItems(token);
      setItems(nextItems);

      if (selectedItemId && !nextItems.some((item) => item.id === selectedItemId)) {
        setSelectedItemId(null);
        setSelectedPassword('');
        setShowPassword(false);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载密码本失败');
    } finally {
      setIsLoadingList(false);
    }
  }, [selectedItemId, token]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  async function openItemDetail(itemId: number) {
    setSelectedItemId(itemId);
    setShowPassword(false);
    setCopyHint(null);
    setIsLoadingDetail(true);
    setError(null);

    try {
      const detail = await getPasswordbookItem(token, itemId);
      setSelectedPassword(detail.password);
    } catch (detailError) {
      setSelectedPassword('');
      setError(detailError instanceof Error ? detailError.message : '读取账号详情失败');
    } finally {
      setIsLoadingDetail(false);
    }
  }

  function openCreateForm() {
    setFormMode('create');
    setFormValues(emptyForm);
    setCopyHint(null);
  }

  function openEditForm() {
    if (!selectedItem) {
      return;
    }

    setFormMode('edit');
    setFormValues({
      platform: selectedItem.platform,
      login_account: selectedItem.login_account,
      password: '',
      login_url: selectedItem.login_url ?? '',
      notes: selectedItem.notes ?? '',
    });
    setCopyHint(null);
  }

  function closeForm() {
    setFormMode(null);
    setFormValues(emptyForm);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!formValues.platform.trim() || !formValues.login_account.trim()) {
      setError('平台和账号不能为空');
      return;
    }

    if (formMode === 'create' && !formValues.password.trim()) {
      setError('创建账号时必须填写密码');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const payload: PasswordbookItemInput = {
      platform: formValues.platform.trim(),
      login_account: formValues.login_account.trim(),
      password: formValues.password.trim(),
      login_url: formValues.login_url.trim(),
      notes: formValues.notes.trim(),
    };

    try {
      if (formMode === 'create') {
        const created = await createPasswordbookItem(token, payload);
        await loadItems();
        closeForm();
        await openItemDetail(created.id);
        return;
      }

      if (formMode === 'edit' && selectedItemId) {
        await updatePasswordbookItem(token, selectedItemId, payload);
        await loadItems();
        closeForm();
        await openItemDetail(selectedItemId);
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '保存失败');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!selectedItemId || !selectedItem) {
      return;
    }

    const confirmed = window.confirm(`确定删除 ${selectedItem.platform} 的账号记录吗？`);
    if (!confirmed) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await deletePasswordbookItem(token, selectedItemId);
      setSelectedItemId(null);
      setSelectedPassword('');
      setShowPassword(false);
      closeForm();
      await loadItems();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除失败');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCopyPassword() {
    if (!selectedPassword) {
      return;
    }

    await navigator.clipboard.writeText(selectedPassword);
    setCopyHint('密码已复制');
    window.setTimeout(() => setCopyHint(null), 2000);
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-gray-50">
      <div className="px-6 py-5 border-b border-gray-200 bg-white shrink-0">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-blue-600">
              <KeyRound size={18} />
              <span className="text-sm font-semibold">个人密码本</span>
            </div>
            <p className="mt-1 text-sm text-gray-500">集中管理平台账号、密码和登录地址，替代手机备忘录。</p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="w-full sm:w-72 rounded-xl border border-gray-200 bg-gray-50 pl-9 pr-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                placeholder="搜索平台、账号或备注"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
              />
            </div>

            <button
              type="button"
              onClick={() => void loadItems()}
              disabled={isLoadingList}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw size={16} className={isLoadingList ? 'animate-spin' : ''} />
              刷新
            </button>

            <button
              type="button"
              onClick={openCreateForm}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              <Plus size={16} />
              添加账号
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-6 mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shrink-0">
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] gap-4 p-6">
        <section className="min-h-0 rounded-2xl border border-gray-200 bg-white overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-800">账号列表</h2>
            <span className="text-xs text-gray-500">{filteredItems.length} 条记录</span>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {isLoadingList ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
                <Loader2 size={16} className="animate-spin" />
                正在加载密码本...
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="py-16 text-center px-6">
                <p className="text-sm font-medium text-gray-700">还没有保存任何账号</p>
                <p className="mt-2 text-sm text-gray-500">点击右上角「添加账号」，把常用平台资料集中到这里。</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {filteredItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void openItemDetail(item.id)}
                    className={`w-full text-left px-5 py-4 transition-colors hover:bg-blue-50/60 ${
                      selectedItemId === item.id ? 'bg-blue-50' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate">{item.platform}</p>
                        <p className="mt-1 text-sm text-gray-600 truncate">{item.login_account}</p>
                        {item.notes && (
                          <p className="mt-2 text-xs text-gray-500 line-clamp-2">{item.notes}</p>
                        )}
                      </div>
                      <span className="text-xs text-gray-400 whitespace-nowrap">{formatDate(item.updated_at)}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="min-h-[320px] rounded-2xl border border-gray-200 bg-white overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-800">账号详情</h2>
            {selectedItem && (
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
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar p-5">
            {!selectedItem ? (
              <div className="h-full flex items-center justify-center text-sm text-gray-500 text-center px-4">
                从左侧选择一条账号记录，查看密码和登录信息。
              </div>
            ) : isLoadingDetail ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
                <Loader2 size={16} className="animate-spin" />
                正在读取详情...
              </div>
            ) : (
              <div className="space-y-5">
                <DetailField label="平台" value={selectedItem.platform} />
                <DetailField label="登录账号" value={selectedItem.login_account} />

                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">密码</p>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-mono text-gray-800 break-all">
                      {showPassword ? selectedPassword : '••••••••••••'}
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      className="rounded-xl border border-gray-200 p-3 text-gray-600 hover:bg-gray-50"
                      title={showPassword ? '隐藏密码' : '显示密码'}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCopyPassword()}
                      className="rounded-xl border border-gray-200 p-3 text-gray-600 hover:bg-gray-50"
                      title="复制密码"
                    >
                      <Copy size={16} />
                    </button>
                  </div>
                  {copyHint && <p className="mt-2 text-xs text-green-600">{copyHint}</p>}
                </div>

                {selectedItem.login_url && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">登录地址</p>
                    <a
                      href={selectedItem.login_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 break-all"
                    >
                      {selectedItem.login_url}
                      <ExternalLink size={14} />
                    </a>
                  </div>
                )}

                {selectedItem.notes && (
                  <DetailField label="备注" value={selectedItem.notes} />
                )}

                <div className="pt-2 text-xs text-gray-400">
                  更新于 {formatDate(selectedItem.updated_at)}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {formMode && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-gray-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">
                {formMode === 'create' ? '添加账号' : '编辑账号'}
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
              <FormField
                label="平台"
                value={formValues.platform}
                onChange={(value) => setFormValues((current) => ({ ...current, platform: value }))}
                placeholder="例如：GitHub、微信、阿里云"
                required
              />
              <FormField
                label="登录账号"
                value={formValues.login_account}
                onChange={(value) => setFormValues((current) => ({ ...current, login_account: value }))}
                placeholder="邮箱、手机号或用户名"
                required
              />
              <FormField
                label={formMode === 'create' ? '密码' : '新密码（留空则不修改）'}
                value={formValues.password}
                onChange={(value) => setFormValues((current) => ({ ...current, password: value }))}
                placeholder={formMode === 'create' ? '请输入密码' : '如需修改密码请填写'}
                type="password"
                required={formMode === 'create'}
              />
              <FormField
                label="登录地址"
                value={formValues.login_url}
                onChange={(value) => setFormValues((current) => ({ ...current, login_url: value }))}
                placeholder="https://example.com/login"
              />
              <label className="block">
                <span className="text-sm font-medium text-gray-700">备注</span>
                <textarea
                  className="mt-2 w-full min-h-24 rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                  value={formValues.notes}
                  onChange={(event) => setFormValues((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="例如：绑定手机号、恢复码位置等"
                />
              </label>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeForm}
                  className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSubmitting && <Loader2 size={16} className="animate-spin" />}
                  保存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="mt-2 text-sm text-gray-800 break-all">{value}</p>
    </div>
  );
}

function FormField({
  label,
  value,
  onChange,
  placeholder,
  required = false,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <input
        className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        type={type}
      />
    </label>
  );
}
