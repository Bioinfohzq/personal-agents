package filesystem

import (
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"syscall"
	"time"
)

// fsPathPrefix 文件系统单条操作的路由前缀
const fsPathPrefix = "/api/v1/filesystem/"

// Handler 文件系统 HTTP 处理器
type Handler struct{}

// NewHandler 创建文件系统处理器
func NewHandler() *Handler {
	return &Handler{}
}

// FileSystemEntry 文件系统条目(目录或文件)
type FileSystemEntry struct {
	Name       string            `json:"name"`               // 文件/目录名
	Path       string            `json:"path"`               // 完整路径
	IsDir      bool              `json:"is_dir"`             // 是否为目录
	Permission string            `json:"permission"`         // 权限字符串,如 "drwxr-xr-x"
	Size       int64             `json:"size"`               // 文件大小(字节),目录为 0
	SizeHuman  string            `json:"size_human"`         // 人类可读大小,如 "1.2 GB"
	Owner      string            `json:"owner"`              // 所有者用户名
	Group      string            `json:"group"`              // 所属组名
	ModTime    time.Time         `json:"mod_time"`           // 最后修改时间
	Children   []FileSystemEntry `json:"children,omitempty"` // 子条目(展开时才有)
}

// StorageItem 存储占用条目
type StorageItem struct {
	Name      string `json:"name"`       // 目录名
	Path      string `json:"path"`       // 完整路径
	SizeHuman string `json:"size_human"` // 人类可读大小
	SizeBytes int64  `json:"size_bytes"` // 字节数(用于排序)
}

// Scan 扫描目录
//
//	GET /api/v1/filesystem/scan?path=...&depth=1
//	path: 要扫描的目录路径,默认用户 home 目录
//	depth: 扫描深度,默认 1,最大 2(防止响应过大)
func (handler *Handler) Scan(w http.ResponseWriter, r *http.Request) {
	// 仅支持 macOS / Linux
	if runtime.GOOS == "windows" {
		writeError(w, http.StatusNotImplemented, "filesystem scan not supported on Windows")
		return
	}

	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	// 获取路径参数,默认 home 目录
	path := r.URL.Query().Get("path")
	if path == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to get home directory")
			return
		}
		path = home
	}

	// 展开 ~ 为 home 目录
	path = expandHome(path)

	// 解析深度参数,默认 1,最大 2
	depth := 1
	if d := r.URL.Query().Get("depth"); d != "" {
		if _, err := fmt.Sscanf(d, "%d", &depth); err == nil {
			if depth > 2 {
				depth = 2
			}
			if depth < 1 {
				depth = 1
			}
		}
	}

	// 扫描目录
	entries, err := scanDirectory(path, depth)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to scan: %v", err))
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"path":    path,
		"entries": entries,
	})
}

// Storage 分析磁盘占用
//
//	GET /api/v1/filesystem/storage?path=...
//	path: 要分析的目录路径,默认 home 目录
//	返回各子目录的占用大小,按降序排列
func (handler *Handler) Storage(w http.ResponseWriter, r *http.Request) {
	if runtime.GOOS == "windows" {
		writeError(w, http.StatusNotImplemented, "storage analysis not supported on Windows")
		return
	}

	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	path := r.URL.Query().Get("path")
	if path == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to get home directory")
			return
		}
		path = home
	}
	path = expandHome(path)

	// 用 du 命令分析各子目录大小
	// du -sh 每个子目录,获取人类可读大小
	entries, err := os.ReadDir(path)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to read directory: %v", err))
		return
	}

	var items []StorageItem
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		fullPath := filepath.Join(path, entry.Name())

		// 用 du -sk 获取大小(KB),再转为人类可读
		cmd := exec.CommandContext(r.Context(), "du", "-sk", fullPath)
		output, err := cmd.Output()
		if err != nil {
			// 权限不足等情况跳过
			continue
		}

		// du -sk 输出格式: "12345\t/path/to/dir"
		parts := strings.Fields(string(output))
		if len(parts) < 1 {
			continue
		}

		var sizeKB int64
		fmt.Sscanf(parts[0], "%d", &sizeKB)
		sizeBytes := sizeKB * 1024

		items = append(items, StorageItem{
			Name:      entry.Name(),
			Path:      fullPath,
			SizeHuman: humanReadableSize(sizeBytes),
			SizeBytes: sizeBytes,
		})
	}

	// 按大小降序排序
	sort.Slice(items, func(i, j int) bool {
		return items[i].SizeBytes > items[j].SizeBytes
	})

	writeJSON(w, http.StatusOK, map[string]any{
		"path":  path,
		"items": items,
	})
}

// Permissions 查看文件/目录详细权限
//
//	GET /api/v1/filesystem/permissions?path=...
func (handler *Handler) Permissions(w http.ResponseWriter, r *http.Request) {
	if runtime.GOOS == "windows" {
		writeError(w, http.StatusNotImplemented, "permission check not supported on Windows")
		return
	}

	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	path := r.URL.Query().Get("path")
	if path == "" {
		writeError(w, http.StatusBadRequest, "path parameter is required")
		return
	}
	path = expandHome(path)

	info, err := os.Stat(path)
	if err != nil {
		writeError(w, http.StatusNotFound, fmt.Sprintf("path not found: %v", err))
		return
	}

	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		writeError(w, http.StatusInternalServerError, "failed to get file stat")
		return
	}

	// 获取所有者和组名
	owner := fmt.Sprintf("%d", stat.Uid)
	group := fmt.Sprintf("%d", stat.Gid)
	if username := lookupUsername(stat.Uid); username != "" {
		owner = username
	}
	if groupname := lookupGroupname(stat.Gid); groupname != "" {
		group = groupname
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"path":       path,
		"name":       info.Name(),
		"is_dir":     info.IsDir(),
		"permission": info.Mode().String(),
		"mode":       fmt.Sprintf("%o", info.Mode().Perm()),
		"owner":      owner,
		"group":      group,
		"size":       info.Size(),
		"size_human": humanReadableSize(info.Size()),
		"mod_time":   info.ModTime(),
	})
}

// --- 内部辅助函数 ---

// scanDirectory 扫描目录,返回子条目列表
func scanDirectory(path string, depth int) ([]FileSystemEntry, error) {
	entries, err := os.ReadDir(path)
	if err != nil {
		return nil, err
	}

	var result []FileSystemEntry
	for _, entry := range entries {
		// 跳过隐藏文件(以 . 开头)
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}

		fullPath := filepath.Join(path, entry.Name())
		info, err := entry.Info()
		if err != nil {
			continue
		}

		fsEntry := FileSystemEntry{
			Name:       entry.Name(),
			Path:       fullPath,
			IsDir:      entry.IsDir(),
			Permission: info.Mode().String(),
			Size:       info.Size(),
			SizeHuman:  humanReadableSize(info.Size()),
			ModTime:    info.ModTime(),
		}

		// 获取所有者和组
		if stat, ok := info.Sys().(*syscall.Stat_t); ok {
			if username := lookupUsername(stat.Uid); username != "" {
				fsEntry.Owner = username
			} else {
				fsEntry.Owner = fmt.Sprintf("%d", stat.Uid)
			}
			if groupname := lookupGroupname(stat.Gid); groupname != "" {
				fsEntry.Group = groupname
			} else {
				fsEntry.Group = fmt.Sprintf("%d", stat.Gid)
			}
		}

		// 如果是目录且还有深度,递归扫描
		if entry.IsDir() && depth > 1 {
			children, err := scanDirectory(fullPath, depth-1)
			if err == nil {
				fsEntry.Children = children
			}
		}

		result = append(result, fsEntry)
	}

	// 排序: 目录在前,然后按名称排序
	sort.Slice(result, func(i, j int) bool {
		if result[i].IsDir != result[j].IsDir {
			return result[i].IsDir
		}
		return result[i].Name < result[j].Name
	})

	return result, nil
}

// expandHome 展开 ~ 为 home 目录
func expandHome(path string) string {
	if path == "~" {
		home, _ := os.UserHomeDir()
		return home
	}
	if strings.HasPrefix(path, "~/") {
		home, _ := os.UserHomeDir()
		return filepath.Join(home, path[2:])
	}
	return path
}

// humanReadableSize 将字节数转为人类可读格式
func humanReadableSize(size int64) string {
	fsize := float64(size)
	units := []string{"B", "KB", "MB", "GB", "TB"}
	for _, unit := range units {
		if fsize < 1024 {
			return fmt.Sprintf("%.1f %s", fsize, unit)
		}
		fsize /= 1024
	}
	return fmt.Sprintf("%.1f PB", fsize)
}

// lookupUsername 通过 UID 查找用户名
func lookupUsername(uid uint32) string {
	// macOS 上用 id 命令查找
	cmd := exec.Command("id", "-un", fmt.Sprintf("%d", uid))
	output, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(output))
}

// lookupGroupname 通过 GID 查找组名
func lookupGroupname(gid uint32) string {
	cmd := exec.Command("id", "-gn", fmt.Sprintf("%d", gid))
	output, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(output))
}
