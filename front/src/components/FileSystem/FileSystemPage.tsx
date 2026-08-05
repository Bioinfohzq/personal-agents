import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import {
  ChevronDown,
  ChevronRight,
  Database,
  FileText,
  Folder,
  FolderOpen,
  HardDrive,
  Info,
  Loader2,
  Search,
} from 'lucide-react';
import {
  getStorageAnalysis,
  getPermissions,
  scanDirectory,
} from '../../api/filesystem';
import { isUnauthorizedError } from '../../api/http';
import type {
  FileSystemEntry,
  PermissionDetail,
  StorageItem,
} from '../../types/filesystem';
import { useAuth } from '../../auth/AuthContext';

/**
 * FileSystemPage 文件系统管理页面
 *
 * 功能:
 *   1. 目录扫描:输入路径,展示目录树(可展开/折叠),显示权限/大小/所有者
 *   2. 存储分析:展示 home 目录下各子目录的磁盘占用,按大小降序排列
 *   3. 权限详情:点击任意条目查看详细权限信息
 *
 * 仅支持 macOS / Linux,Windows 后端会返回 501。
 */
export function FileSystemPage() {
  // 认证信息:访客模式不允许访问文件系统
  const { session, logout } = useAuth();

  if (session?.isGuest === true) {
    return <Navigate to="/chat" replace />;
  }

  const token = session!.token;
  const onSessionExpired = logout;

  // --- 目录扫描状态 ---
  const [scanPath, setScanPath] = useState('');          // 输入框的路径值
  const [currentPath, setCurrentPath] = useState('');    // 实际扫描的路径
  const [entries, setEntries] = useState<FileSystemEntry[]>([]);
  const [isLoadingScan, setIsLoadingScan] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  // --- 存储分析状态 ---
  const [storagePath, setStoragePath] = useState('');    // 存储分析的目标路径
  const [storageItems, setStorageItems] = useState<StorageItem[]>([]);
  const [isLoadingStorage, setIsLoadingStorage] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);

  // --- 权限详情弹窗 ---
  const [permissionDetail, setPermissionDetail] = useState<PermissionDetail | null>(null);
  const [isLoadingPermission, setIsLoadingPermission] = useState(false);

  // --- Tab 切换:目录扫描 / 存储分析 ---
  const [activeTab, setActiveTab] = useState<'scan' | 'storage'>('storage');

  // 进入页面时自动加载 home 目录的存储分析
  useEffect(() => {
    loadStorageAnalysis('');
  }, []);

  // 处理 401:token 过期则登出
  const handleApiError = useCallback(
    (error: unknown) => {
      if (isUnauthorizedError(error)) {
        onSessionExpired();
      }
    },
    [onSessionExpired],
  );

  // 扫描目录
  const loadScan = useCallback(
    async (path: string) => {
      setIsLoadingScan(true);
      setScanError(null);
      try {
        const result = await scanDirectory(token, path, 1);
        setEntries(result.entries);
        setCurrentPath(result.path);
        setScanPath(result.path);
      } catch (error) {
        setScanError(error instanceof Error ? error.message : '扫描失败');
        handleApiError(error);
      } finally {
        setIsLoadingScan(false);
      }
    },
    [token, handleApiError],
  );

  // 分析存储占用
  const loadStorageAnalysis = useCallback(
    async (path: string) => {
      setIsLoadingStorage(true);
      setStorageError(null);
      try {
        const result = await getStorageAnalysis(token, path);
        setStorageItems(result.items ?? []);
        setStoragePath(result.path);
      } catch (error) {
        setStorageError(error instanceof Error ? error.message : '分析失败');
        handleApiError(error);
      } finally {
        setIsLoadingStorage(false);
      }
    },
    [token, handleApiError],
  );

  // 查看权限详情
  const loadPermission = useCallback(
    async (path: string) => {
      setIsLoadingPermission(true);
      try {
        const detail = await getPermissions(token, path);
        setPermissionDetail(detail);
      } catch (error) {
        handleApiError(error);
      } finally {
        setIsLoadingPermission(false);
      }
    },
    [token, handleApiError],
  );

  return (
    <div className="flex h-full flex-col bg-gray-50">
      {/* 页面标题 */}
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center gap-3">
          <HardDrive className="h-6 w-6 text-indigo-600" />
          <div>
            <h1 className="text-lg font-semibold text-gray-900">文件系统</h1>
            <p className="text-sm text-gray-500">
              查看目录权限、分析磁盘占用,仅支持 macOS / Linux
            </p>
          </div>
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 border-b border-gray-200 bg-white px-6">
        <TabButton
          active={activeTab === 'storage'}
          onClick={() => setActiveTab('storage')}
          icon={<Database className="h-4 w-4" />}
          label="存储分析"
        />
        <TabButton
          active={activeTab === 'scan'}
          onClick={() => setActiveTab('scan')}
          icon={<Folder className="h-4 w-4" />}
          label="目录扫描"
        />
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-auto p-6">
        {/* 存储分析 Tab */}
        {activeTab === 'storage' && (
          <div className="mx-auto max-w-4xl space-y-4">
            {/* 路径输入 */}
            <div className="flex gap-2">
              <input
                type="text"
                value={storagePath}
                onChange={(e) => setStoragePath(e.target.value)}
                placeholder="输入路径(留空为 home 目录)"
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') loadStorageAnalysis(storagePath);
                }}
              />
              <button
                onClick={() => loadStorageAnalysis(storagePath)}
                disabled={isLoadingStorage}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {isLoadingStorage ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                分析
              </button>
            </div>

            {storageError && (
              <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
                {storageError}
              </div>
            )}

            {/* 存储占用列表 */}
            {isLoadingStorage ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                <span className="ml-2 text-sm text-gray-500">正在分析磁盘占用...</span>
              </div>
            ) : storageItems.length > 0 ? (
              <StorageBarChart items={storageItems} onItemClick={loadPermission} />
            ) : (
              !storageError && (
                <div className="py-12 text-center text-sm text-gray-400">
                  暂无数据
                </div>
              )
            )}
          </div>
        )}

        {/* 目录扫描 Tab */}
        {activeTab === 'scan' && (
          <div className="mx-auto max-w-4xl space-y-4">
            {/* 路径输入 */}
            <div className="flex gap-2">
              <input
                type="text"
                value={scanPath}
                onChange={(e) => setScanPath(e.target.value)}
                placeholder="输入要扫描的目录路径"
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && scanPath) loadScan(scanPath);
                }}
              />
              <button
                onClick={() => scanPath && loadScan(scanPath)}
                disabled={isLoadingScan || !scanPath}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {isLoadingScan ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                扫描
              </button>
            </div>

            {scanError && (
              <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
                {scanError}
              </div>
            )}

            {/* 目录树 */}
            {isLoadingScan ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                <span className="ml-2 text-sm text-gray-500">正在扫描目录...</span>
              </div>
            ) : entries.length > 0 ? (
              <div className="rounded-lg border border-gray-200 bg-white">
                <div className="border-b border-gray-100 px-4 py-2 text-xs text-gray-500">
                  当前路径: {currentPath}
                </div>
                <div className="divide-y divide-gray-50">
                  {entries.map((entry) => (
                    <EntryRow
                      key={entry.path}
                      entry={entry}
                      depth={0}
                      token={token}
                      onCheckPermission={loadPermission}
                    />
                  ))}
                </div>
              </div>
            ) : (
              !scanError && (
                <div className="py-12 text-center text-sm text-gray-400">
                  输入路径并点击扫描
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* 权限详情弹窗 */}
      {permissionDetail && (
        <PermissionModal
          detail={permissionDetail}
          loading={isLoadingPermission}
          onClose={() => setPermissionDetail(null)}
        />
      )}
    </div>
  );
}

// --- 子组件 ---

/** Tab 按钮 */
function TabButton(props: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={props.onClick}
      className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
        props.active
          ? 'border-indigo-600 text-indigo-600'
          : 'border-transparent text-gray-500 hover:text-gray-700'
      }`}
    >
      {props.icon}
      {props.label}
    </button>
  );
}

/** 存储占用条形图 */
function StorageBarChart(props: {
  items: StorageItem[];
  onItemClick: (path: string) => void;
}) {
  const { items, onItemClick } = props;
  // 计算最大值用于条形图比例
  const maxSize = items.length > 0 ? items[0].size_bytes : 1;

  return (
    <div className="space-y-2">
      {items.map((item) => {
        // 条形图宽度百分比(最小 2% 保证可见)
        const widthPercent = Math.max(2, (item.size_bytes / maxSize) * 100);

        // 根据大小选择颜色: >10GB 红色, >1GB 橙色, >100MB 黄色, 其他绿色
        const barColor =
          item.size_bytes > 10 * 1024 * 1024 * 1024
            ? 'bg-red-400'
            : item.size_bytes > 1 * 1024 * 1024 * 1024
              ? 'bg-orange-400'
              : item.size_bytes > 100 * 1024 * 1024
                ? 'bg-yellow-400'
                : 'bg-green-400';

        return (
          <div
            key={item.path}
            onClick={() => onItemClick(item.path)}
            className="cursor-pointer rounded-lg border border-gray-200 bg-white p-3 hover:border-indigo-300 hover:shadow-sm"
          >
            <div className="mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <Folder className="h-4 w-4 text-gray-400" />
                {item.name}
              </span>
              <span className="text-sm font-semibold text-gray-900">
                {item.size_human}
              </span>
            </div>
            {/* 条形图 */}
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className={`h-full rounded-full ${barColor}`}
                style={{ width: `${widthPercent}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 目录树条目行(支持递归展开) */
function EntryRow(props: {
  entry: FileSystemEntry;
  depth: number;
  token: string;
  onCheckPermission: (path: string) => void;
}) {
  const { entry, depth, token, onCheckPermission } = props;

  // 展开状态:目录默认折叠
  const [isExpanded, setIsExpanded] = useState(false);
  const [children, setChildren] = useState<FileSystemEntry[]>([]);
  const [isLoadingChildren, setIsLoadingChildren] = useState(false);

  // 点击目录:展开/折叠,首次展开时加载子目录
  const handleToggle = async () => {
    if (!entry.is_dir) {
      onCheckPermission(entry.path);
      return;
    }

    if (!isExpanded && children.length === 0) {
      // 首次展开,加载子目录
      setIsLoadingChildren(true);
      try {
        const result = await scanDirectory(token, entry.path, 1);
        setChildren(result.entries ?? []);
      } catch {
        // 加载失败,静默处理
      } finally {
        setIsLoadingChildren(false);
      }
    }
    setIsExpanded(!isExpanded);
  };

  return (
    <div>
      <div
        className="flex items-center gap-2 px-4 py-2 hover:bg-gray-50"
        style={{ paddingLeft: `${16 + depth * 20}px` }}
      >
        {/* 展开/折叠箭头 */}
        {entry.is_dir ? (
          <button onClick={handleToggle} className="shrink-0 text-gray-400 hover:text-gray-600">
            {isLoadingChildren ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        {/* 图标 */}
        {entry.is_dir ? (
          isExpanded ? (
            <FolderOpen className="h-4 w-4 shrink-0 text-indigo-500" />
          ) : (
            <Folder className="h-4 w-4 shrink-0 text-indigo-500" />
          )
        ) : (
          <FileText className="h-4 w-4 shrink-0 text-gray-400" />
        )}

        {/* 名称(点击查看权限) */}
        <button
          onClick={() => onCheckPermission(entry.path)}
          className="flex-1 truncate text-left text-sm text-gray-700 hover:text-indigo-600 hover:underline"
        >
          {entry.name}
        </button>

        {/* 权限 */}
        <span className="shrink-0 font-mono text-xs text-gray-500">
          {entry.permission}
        </span>

        {/* 所有者 */}
        <span className="shrink-0 text-xs text-gray-400">
          {entry.owner}:{entry.group}
        </span>

        {/* 大小 */}
        <span className="shrink-0 w-20 text-right text-xs text-gray-500">
          {entry.is_dir ? '-' : entry.size_human}
        </span>
      </div>

      {/* 递归渲染子目录 */}
      {isExpanded && children.length > 0 && (
        <div>
          {children.map((child) => (
            <EntryRow
              key={child.path}
              entry={child}
              depth={depth + 1}
              token={token}
              onCheckPermission={onCheckPermission}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** 权限详情弹窗 */
function PermissionModal(props: {
  detail: PermissionDetail;
  loading: boolean;
  onClose: () => void;
}) {
  const { detail, loading, onClose } = props;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Info className="h-5 w-5 text-indigo-600" />
            <h2 className="text-base font-semibold text-gray-900">权限详情</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : (
          <div className="space-y-3">
            <DetailRow label="路径" value={detail.path} mono />
            <DetailRow label="名称" value={detail.name} />
            <DetailRow
              label="类型"
              value={detail.is_dir ? '目录' : '文件'}
            />
            <DetailRow label="权限" value={detail.permission} mono />
            <DetailRow label="八进制" value={detail.mode} mono />
            <DetailRow label="所有者" value={`${detail.owner}:${detail.group}`} />
            <DetailRow label="大小" value={detail.size_human} />
            <DetailRow
              label="修改时间"
              value={new Date(detail.mod_time).toLocaleString('zh-CN')}
            />
          </div>
        )}

        {/* 关闭按钮 */}
        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

/** 详情行 */
function DetailRow(props: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-20 shrink-0 text-sm text-gray-500">{props.label}</span>
      <span
        className={`flex-1 break-all text-sm text-gray-900 ${
          props.mono ? 'font-mono' : ''
        }`}
      >
        {props.value}
      </span>
    </div>
  );
}
