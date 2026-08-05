// 文件系统条目(目录或文件)
export interface FileSystemEntry {
  name: string;        // 文件/目录名
  path: string;        // 完整路径
  is_dir: boolean;     // 是否为目录
  permission: string;  // 权限字符串,如 "drwxr-xr-x"
  size: number;        // 文件大小(字节),目录为 0
  size_human: string;  // 人类可读大小,如 "1.2 GB"
  owner: string;       // 所有者用户名
  group: string;       // 所属组名
  mod_time: string;    // 最后修改时间(ISO 字符串)
  children?: FileSystemEntry[]; // 子条目(展开时才有)
}

// 存储占用条目
export interface StorageItem {
  name: string;        // 目录名
  path: string;        // 完整路径
  size_human: string;  // 人类可读大小
  size_bytes: number;  // 字节数(用于排序)
}

// 权限详情
export interface PermissionDetail {
  path: string;
  name: string;
  is_dir: boolean;
  permission: string;   // 权限字符串,如 "drwxr-xr-x"
  mode: string;         // 八进制权限,如 "755"
  owner: string;        // 所有者
  group: string;        // 所属组
  size: number;         // 字节数
  size_human: string;   // 人类可读大小
  mod_time: string;     // 最后修改时间
}
