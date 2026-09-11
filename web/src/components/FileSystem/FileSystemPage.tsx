import { useState, useEffect, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import {
  ChevronDown,
  ChevronRight,
  Cpu,
  Cog,
  Folder,
  FolderOpen,
  FileText,
  FilePlus,
  Layers,
  Settings,
  HardDrive,
  MemoryStick,
  Terminal,
  Box,
  Pencil,
  Trash2,
  Save,
  X,
  Plus,
  Loader2,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import {
  SK_CATEGORIES,
  listSystemKnowledgeNodes,
  createSystemKnowledgeNode,
  updateSystemKnowledgeNode,
  deleteSystemKnowledgeNode,
  resetSystemKnowledgeCategory,
  type SkNode,
  type SkCategory,
} from '../../api/systemKnowledge';

/**
 * 系统底层知识库页面
 *
 * 数据通过后端 API 存取(PostgreSQL),按 user_id 隔离,支持多端同步。
 * 每个分类展开时从后端拉取整棵树(内置节点+用户自定义合并结果)。
 */
export function FileSystemPage() {
  const { session } = useAuth();
  const token = session?.token;

  const [expandedCategory, setExpandedCategory] = useState<SkCategory | null>(SK_CATEGORIES.linuxFHS);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [addingChildTo, setAddingChildTo] = useState<string | null>(null);

  // 当前分类的扁平节点列表(来自后端)
  const [flatNodes, setFlatNodes] = useState<SkNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // 按 parent_path 分组构建的 children 索引(用于渲染)
  const tree = useMemo(() => buildTree(flatNodes), [flatNodes]);
  const selectedNode = useMemo(
    () => flatNodes.find(n => n.path === selectedPath) ?? null,
    [flatNodes, selectedPath],
  );

  // 切换分类时拉取数据
  const loadCategory = useCallback(async (cat: SkCategory) => {
    if (!token) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const nodes = await listSystemKnowledgeNodes(token, cat);
      setFlatNodes(nodes);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (expandedCategory && token) {
      loadCategory(expandedCategory);
    }
  }, [expandedCategory, token, loadCategory]);

  // 所有 Hook 必须在条件 return 之前调用,否则会违反 React Hook 规则
  if (session?.isGuest === true) {
    return <Navigate to="/chat" replace />;
  }

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  const toggleCategory = (id: SkCategory) => {
    setExpandedCategory(expandedCategory === id ? null : id);
    setSelectedPath(null);
    setEditingPath(null);
    setAddingChildTo(null);
  };

  /** 创建子节点 */
  const handleAddChild = async (parentPath: string, name: string) => {
    if (!token || !expandedCategory) return;
    try {
      const newNode = await createSystemKnowledgeNode(token, {
        category: expandedCategory,
        parent_path: parentPath,
        name,
        node_type: 'dir',
        description: '',
        contents: '',
        examples: [],
      });
      setFlatNodes(prev => upsertNode(prev, newNode));
      setAddingChildTo(null);
      setSelectedPath(newNode.path);
      setEditingPath(newNode.path);
      showToast('已添加节点');
    } catch (e) {
      showToast(e instanceof Error ? e.message : '添加失败');
    }
  };

  /** 更新节点内容 */
  const handleUpdate = async (path: string, updates: { description?: string; contents?: string; examples?: string[] }) => {
    if (!token || !expandedCategory) return;
    try {
      const updated = await updateSystemKnowledgeNode(token, {
        category: expandedCategory,
        path,
        ...updates,
      });
      setFlatNodes(prev => upsertNode(prev, updated));
      setEditingPath(null);
      showToast('已保存');
    } catch (e) {
      showToast(e instanceof Error ? e.message : '保存失败');
    }
  };

  /** 删除节点 */
  const handleDelete = async (path: string) => {
    if (!token || !expandedCategory) return;
    if (!confirm(`确定删除 "${path}" 及其所有子节点吗？`)) return;
    try {
      const result = await deleteSystemKnowledgeNode(token, expandedCategory, path);
      // 重新拉取整棵树(因为删除操作可能只删除了用户覆盖,内置节点恢复;或删除了子树)
      await loadCategory(expandedCategory);
      if (selectedPath === path || selectedPath?.startsWith(path + '/')) {
        setSelectedPath(result.restored_builtin ? path : null);
      }
      setAddingChildTo(null);
      setEditingPath(null);
      showToast(result.restored_builtin ? '已恢复为内置版本' : '已删除');
    } catch (e) {
      showToast(e instanceof Error ? e.message : '删除失败');
    }
  };

  /** 重置当前分类 */
  const handleReset = async () => {
    if (!token || !expandedCategory) return;
    if (!confirm('确定要重置当前分类的所有自定义内容吗？')) return;
    try {
      const nodes = await resetSystemKnowledgeCategory(token, expandedCategory);
      setFlatNodes(nodes);
      setSelectedPath(null);
      setEditingPath(null);
      setAddingChildTo(null);
      showToast('已重置');
    } catch (e) {
      showToast(e instanceof Error ? e.message : '重置失败');
    }
  };

  return (
    <div className="flex h-full flex-col bg-gray-50">
      {/* 页面标题 */}
      <div className="border-b border-gray-200 bg-white px-6 py-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600">
              <Cpu className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">系统底层</h1>
              <p className="mt-0.5 text-sm text-gray-500">
                操作系统底层接口与原理知识结构 — 数据随账号同步，可在任意设备访问
              </p>
            </div>
          </div>
          <button
            onClick={handleReset}
            disabled={loading}
            className="rounded-lg px-3 py-1.5 text-sm text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
          >
            重置
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 rounded-lg bg-gray-800 px-4 py-2 text-sm text-white shadow-lg animate-pulse">
          {toast}
        </div>
      )}

      {/* 内容区域 */}
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-6xl space-y-4">
          <CategoryCard
            id={SK_CATEGORIES.linuxFHS}
            icon={<Folder className="h-5 w-5" />}
            title="Linux 文件系统层级结构 (FHS)"
            subtitle="Filesystem Hierarchy Standard — 点击目录可编辑说明、添加子目录，数据自动保存并同步"
            isExpanded={expandedCategory === SK_CATEGORIES.linuxFHS}
            onToggle={() => toggleCategory(SK_CATEGORIES.linuxFHS)}
          >
            {loading ? (
              <LoadingPlaceholder />
            ) : errorMsg ? (
              <ErrorPlaceholder message={errorMsg} onRetry={() => loadCategory(SK_CATEGORIES.linuxFHS)} />
            ) : (
              <>
                <FhsTree
                  roots={tree.get('') ?? []}
                  childMap={tree}
                  selectedPath={selectedPath}
                  onSelectNode={(p) => { setSelectedPath(p); setEditingPath(null); setAddingChildTo(null); }}
                  onAddChildStart={(p) => { setAddingChildTo(p); setEditingPath(null); setSelectedPath(p); }}
                />
                {selectedNode && !addingChildTo && !editingPath && (
                  <div className="mt-4">
                    <NodeDetailCard
                      entry={selectedNode}
                      onClose={() => setSelectedPath(null)}
                      onEdit={() => setEditingPath(selectedNode.path)}
                      onAddChild={() => setAddingChildTo(selectedNode.path)}
                      onDelete={selectedNode.is_custom ? () => handleDelete(selectedNode.path) : undefined}
                    />
                  </div>
                )}
                {editingPath && (() => {
                  const node = flatNodes.find(n => n.path === editingPath);
                  if (!node) return null;
                  return (
                    <div className="mt-4">
                      <NodeEditCard
                        entry={node}
                        onCancel={() => setEditingPath(null)}
                        onSave={(updates) => handleUpdate(editingPath, updates)}
                      />
                    </div>
                  );
                })()}
                {addingChildTo && (
                  <div className="mt-4">
                    <AddChildCard
                      parentPath={addingChildTo}
                      onCancel={() => setAddingChildTo(null)}
                      onAdd={(name) => handleAddChild(addingChildTo, name)}
                    />
                  </div>
                )}
              </>
            )}
          </CategoryCard>

          <CategoryCard
            id={SK_CATEGORIES.syscall}
            icon={<Terminal className="h-5 w-5" />}
            title="系统调用接口"
            subtitle="System Call Interface — 用户态与内核态的交互入口"
            isExpanded={expandedCategory === SK_CATEGORIES.syscall}
            onToggle={() => toggleCategory(SK_CATEGORIES.syscall)}
            disabled
          >
            <PlaceholderContent text="系统调用知识模块待补充" />
          </CategoryCard>

          <CategoryCard
            id={SK_CATEGORIES.process}
            icon={<Cog className="h-5 w-5" />}
            title="进程管理与调度"
            subtitle="Process Management & Scheduling"
            isExpanded={expandedCategory === SK_CATEGORIES.process}
            onToggle={() => toggleCategory(SK_CATEGORIES.process)}
            disabled
          >
            <PlaceholderContent text="进程调度知识模块待补充" />
          </CategoryCard>

          <CategoryCard
            id={SK_CATEGORIES.memory}
            icon={<MemoryStick className="h-5 w-5" />}
            title="内存管理"
            subtitle="Memory Management"
            isExpanded={expandedCategory === SK_CATEGORIES.memory}
            onToggle={() => toggleCategory(SK_CATEGORIES.memory)}
            disabled
          >
            <PlaceholderContent text="内存管理知识模块待补充" />
          </CategoryCard>

          <CategoryCard
            id={SK_CATEGORIES.driver}
            icon={<HardDrive className="h-5 w-5" />}
            title="硬件驱动层"
            subtitle="Device Driver Layer"
            isExpanded={expandedCategory === SK_CATEGORIES.driver}
            onToggle={() => toggleCategory(SK_CATEGORIES.driver)}
            disabled
          >
            <PlaceholderContent text="硬件驱动知识模块待补充" />
          </CategoryCard>

          <CategoryCard
            id={SK_CATEGORIES.cpu}
            icon={<Cpu className="h-5 w-5" />}
            title="CPU 原理"
            subtitle="CPU Architecture"
            isExpanded={expandedCategory === SK_CATEGORIES.cpu}
            onToggle={() => toggleCategory(SK_CATEGORIES.cpu)}
            disabled
          >
            <PlaceholderContent text="CPU 原理知识模块待补充" />
          </CategoryCard>
        </div>
      </div>
    </div>
  );
}

// --- 树构建工具 ---

function buildTree(nodes: SkNode[]): Map<string, SkNode[]> {
  const map = new Map<string, SkNode[]>();
  // 先按parent_path分组
  for (const n of nodes) {
    const key = n.parent_path;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(n);
  }
  // 排序:内置按sort_order,自定义按id追加(后端已排好序,这里保持稳定)
  for (const [, list] of map) {
    list.sort((a, b) => {
      if (a.is_builtin !== b.is_builtin) return a.is_builtin ? -1 : 1;
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.id - b.id;
    });
  }
  return map;
}

function upsertNode(list: SkNode[], node: SkNode): SkNode[] {
  const idx = list.findIndex(n => n.path === node.path);
  if (idx >= 0) {
    const copy = [...list];
    copy[idx] = node;
    return copy;
  }
  return [...list, node];
}

// --- 子组件 ---

function CategoryCard(props: {
  id: string;
  icon: ReactNode;
  title: string;
  subtitle: string;
  isExpanded: boolean;
  disabled?: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  const { icon, title, subtitle, isExpanded, disabled, onToggle, children } = props;
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <button
        onClick={disabled ? undefined : onToggle}
        disabled={disabled}
        className={`flex w-full items-center gap-4 px-5 py-4 text-left transition-colors ${
          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-gray-50'
        } ${isExpanded ? 'border-b border-gray-100 bg-gray-50/50' : ''}`}
      >
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
          isExpanded ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-500'
        }`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <p className="mt-0.5 text-sm text-gray-500 truncate">{subtitle}</p>
        </div>
        {disabled ? (
          <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-400">待补充</span>
        ) : (
          <div className="shrink-0 text-gray-400">
            {isExpanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
          </div>
        )}
      </button>
      {isExpanded && !disabled && <div className="p-5">{children}</div>}
    </div>
  );
}

function PlaceholderContent({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center rounded-lg border-2 border-dashed border-gray-200 py-10">
      <div className="text-center">
        <Box className="mx-auto h-8 w-8 text-gray-300" />
        <p className="mt-2 text-sm text-gray-400">{text}</p>
      </div>
    </div>
  );
}

function LoadingPlaceholder() {
  return (
    <div className="flex items-center justify-center rounded-lg bg-gradient-to-br from-slate-50 to-gray-50 py-12">
      <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
      <span className="ml-3 text-sm text-gray-500">加载中...</span>
    </div>
  );
}

function ErrorPlaceholder({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-center rounded-lg bg-red-50 py-10">
      <div className="text-center">
        <p className="text-sm text-red-600">{message}</p>
        <button onClick={onRetry} className="mt-2 text-sm text-indigo-600 hover:underline">重试</button>
      </div>
    </div>
  );
}

/** FHS 树形结构 */
function FhsTree(props: {
  roots: SkNode[];
  childMap: Map<string, SkNode[]>;
  selectedPath: string | null;
  onSelectNode: (path: string) => void;
  onAddChildStart: (path: string) => void;
}) {
  const { roots, childMap, selectedPath, onSelectNode, onAddChildStart } = props;
  return (
    <div className="rounded-lg bg-gradient-to-br from-slate-50 to-gray-50 p-4">
      <div className="space-y-1">
        {roots.map((entry, idx) => (
          <FhsTreeNode
            key={entry.path}
            entry={entry}
            depth={0}
            isLast={idx === roots.length - 1}
            parentLines={[]}
            childMap={childMap}
            selectedPath={selectedPath}
            onSelectNode={onSelectNode}
            onAddChildStart={onAddChildStart}
            defaultExpanded={entry.path === '/'}
          />
        ))}
      </div>
    </div>
  );
}

/** FHS 单个树节点 */
function FhsTreeNode(props: {
  entry: SkNode;
  depth: number;
  isLast: boolean;
  parentLines: boolean[];
  childMap: Map<string, SkNode[]>;
  selectedPath: string | null;
  onSelectNode: (path: string) => void;
  onAddChildStart: (path: string) => void;
  defaultExpanded: boolean;
}) {
  const { entry, depth, isLast, parentLines, childMap, selectedPath, onSelectNode, onAddChildStart, defaultExpanded } = props;
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const children = childMap.get(entry.path) ?? [];
  const hasChildren = children.length > 0;
  const isSelected = selectedPath === entry.path;

  const toggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  return (
    <div>
      <div className="flex items-center group" style={{ minHeight: '32px' }}>
        {depth > 0 && (
          <div className="flex shrink-0" style={{ height: '32px' }}>
            {parentLines.map((showLine, idx) => (
              <div key={idx} className="w-5 shrink-0 relative">
                {showLine && <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-300" />}
              </div>
            ))}
            <div className="w-5 shrink-0 relative">
              <div className="absolute left-1/2 top-0 bottom-1/2 w-px bg-gray-300" />
              <div className="absolute left-1/2 top-1/2 w-2.5 h-px bg-gray-300" />
              {isLast && <div className="absolute left-1/2 top-1/2 bottom-0 w-px bg-transparent" />}
            </div>
          </div>
        )}

        <button
          onClick={toggleExpand}
          className="shrink-0 h-5 w-5 flex items-center justify-center text-gray-400 hover:text-gray-600"
        >
          {hasChildren ? (
            isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-gray-300" />
          )}
        </button>

        <button
          onClick={() => onSelectNode(entry.path)}
          className={`ml-1 flex items-center gap-2 rounded-lg px-3 py-1 text-left text-sm transition-all ${
            isSelected
              ? 'bg-indigo-100 text-indigo-700 font-medium shadow-sm'
              : 'hover:bg-white hover:shadow-sm text-gray-700'
          } ${entry.is_custom ? 'ring-1 ring-emerald-200' : ''}`}
        >
          {hasChildren ? (
            isExpanded
              ? <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" />
              : <Folder className="h-4 w-4 shrink-0 text-amber-500" />
          ) : (
            <FileText className={`h-4 w-4 shrink-0 ${entry.is_custom ? 'text-emerald-500' : 'text-blue-400'}`} />
          )}
          <code className={`font-mono text-sm ${isSelected ? 'text-indigo-700' : 'text-gray-800'}`}>
            {entry.name}
          </code>
          {entry.is_custom && (
            <span className="ml-1 rounded bg-emerald-100 px-1 py-0.5 text-[10px] font-medium text-emerald-700">自定义</span>
          )}
        </button>

        <div className="ml-2 hidden group-hover:flex items-center gap-0.5">
          <button
            onClick={(e) => { e.stopPropagation(); onAddChildStart(entry.path); setIsExpanded(true); onSelectNode(entry.path); }}
            className="p-1 rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50"
            title="添加子目录/文件"
          >
            <FilePlus className="h-3.5 w-3.5" />
          </button>
        </div>

        {entry.description && (
          <span className="ml-3 text-xs text-gray-400 truncate hidden md:inline max-w-md">
            — {entry.description.length > 40 ? entry.description.substring(0, 40) + '...' : entry.description}
          </span>
        )}
      </div>

      {isExpanded && hasChildren && (
        <div>
          {children.map((child, idx) => (
            <FhsTreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              isLast={idx === children.length - 1}
              parentLines={[...parentLines, !isLast]}
              childMap={childMap}
              selectedPath={selectedPath}
              onSelectNode={onSelectNode}
              onAddChildStart={onAddChildStart}
              defaultExpanded={false}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** 节点详情卡片（只读） */
function NodeDetailCard(props: {
  entry: SkNode;
  onClose: () => void;
  onEdit: () => void;
  onAddChild: () => void;
  onDelete?: () => void;
}) {
  const { entry, onClose, onEdit, onAddChild, onDelete } = props;

  return (
    <div className="rounded-lg border border-indigo-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100">
            <FolderOpen className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <h4 className="text-lg font-bold text-gray-900 font-mono flex items-center gap-2">
              {entry.path}
              {entry.is_custom && (
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">自定义</span>
              )}
            </h4>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onAddChild}
            className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50"
            title="添加子目录/文件"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            onClick={onEdit}
            className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50"
            title="编辑"
          >
            <Pencil className="h-4 w-4" />
          </button>
          {onDelete && (
            <button
              onClick={onDelete}
              className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"
              title="删除"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 ml-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <DetailSection icon={<Settings className="h-3 w-3" />} label="目录作用">
          {entry.description ? (
            <p className="text-sm text-gray-700 leading-relaxed bg-gray-50 rounded-md p-3">{entry.description}</p>
          ) : (
            <p className="text-sm text-gray-400 italic bg-gray-50 rounded-md p-3">暂无说明，点击编辑按钮添加</p>
          )}
        </DetailSection>

        <DetailSection icon={<Layers className="h-3 w-3" />} label="存放内容">
          {entry.contents ? (
            <p className="text-sm text-gray-700 leading-relaxed bg-gray-50 rounded-md p-3">{entry.contents}</p>
          ) : (
            <p className="text-sm text-gray-400 italic bg-gray-50 rounded-md p-3">暂无说明，点击编辑按钮添加</p>
          )}
        </DetailSection>

        {entry.examples.length > 0 && (
          <DetailSection icon={<FileText className="h-3 w-3" />} label="常见文件/目录示例">
            <div className="flex flex-wrap gap-1.5">
              {entry.examples.map((example) => (
                <span
                  key={example}
                  className="inline-flex items-center rounded-md bg-indigo-50 px-2.5 py-1 text-xs font-mono text-indigo-700 border border-indigo-100"
                >
                  {example}
                </span>
              ))}
            </div>
          </DetailSection>
        )}
      </div>
    </div>
  );
}

function DetailSection(props: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div>
      <h5 className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 uppercase tracking-wider mb-1.5">
        {props.icon}
        {props.label}
      </h5>
      {props.children}
    </div>
  );
}

/** 节点编辑卡片 */
function NodeEditCard(props: {
  entry: SkNode;
  onCancel: () => void;
  onSave: (updates: { description: string; contents: string; examples: string[] }) => void;
}) {
  const { entry, onCancel, onSave } = props;
  const [description, setDescription] = useState(entry.description);
  const [contents, setContents] = useState(entry.contents);
  const [examplesText, setExamplesText] = useState(entry.examples.join('\n'));
  const [saving, setSaving] = useState(false);

  const handleSave = () => {
    const examples = examplesText
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    setSaving(true);
    onSave({ description: description.trim(), contents: contents.trim(), examples });
    // 保存后由父组件切换状态,saving状态保持到下一次渲染
    setTimeout(() => setSaving(false), 500);
  };

  return (
    <div className="rounded-lg border-2 border-indigo-300 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100">
            <Pencil className="h-5 w-5 text-indigo-600" />
          </div>
          <h4 className="text-lg font-bold text-gray-900 font-mono">编辑 {entry.path}</h4>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            <Save className="h-3.5 w-3.5" /> 保存
          </button>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 uppercase tracking-wider mb-1.5">
            <Settings className="h-3 w-3" /> 目录作用
          </label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={3}
            placeholder="描述这个目录的核心作用..."
            className="w-full rounded-md border border-gray-200 p-3 text-sm text-gray-700 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-none"
          />
        </div>

        <div>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 uppercase tracking-wider mb-1.5">
            <Layers className="h-3 w-3" /> 存放内容
          </label>
          <textarea
            value={contents}
            onChange={e => setContents(e.target.value)}
            rows={3}
            placeholder="描述这个目录一般存放什么类型的文件..."
            className="w-full rounded-md border border-gray-200 p-3 text-sm text-gray-700 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-none"
          />
        </div>

        <div>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 uppercase tracking-wider mb-1.5">
            <FileText className="h-3 w-3" /> 常见文件/目录（每行一个）
          </label>
          <textarea
            value={examplesText}
            onChange={e => setExamplesText(e.target.value)}
            rows={4}
            placeholder={'每行写一个示例，例如：\nvmlinuz\ngrub/\nefi/'}
            className="w-full rounded-md border border-gray-200 p-3 text-sm font-mono text-gray-700 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-none"
          />
        </div>
      </div>
    </div>
  );
}

/** 添加子节点卡片 */
function AddChildCard(props: {
  parentPath: string;
  onCancel: () => void;
  onAdd: (name: string) => void;
}) {
  const { parentPath, onCancel, onAdd } = props;
  const [name, setName] = useState('');

  const handleAdd = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const cleanName = trimmed.replace(/\//g, '');
    if (cleanName) onAdd(cleanName);
  };

  return (
    <div className="rounded-lg border-2 border-dashed border-emerald-300 bg-emerald-50/50 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100">
            <FilePlus className="h-5 w-5 text-emerald-600" />
          </div>
          <div>
            <h4 className="text-base font-semibold text-gray-900">添加子项到 {parentPath}</h4>
            <p className="text-xs text-gray-500">输入目录或文件名，不要包含路径分隔符 /</p>
          </div>
        </div>
        <button
          onClick={onCancel}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex gap-2">
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') onCancel(); }}
          placeholder="例如：grub、nginx.conf、subdir/"
          className="flex-1 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-mono text-gray-800 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400"
        />
        <button
          onClick={handleAdd}
          disabled={!name.trim()}
          className="flex items-center gap-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="h-3.5 w-3.5" /> 添加
        </button>
      </div>
    </div>
  );
}
