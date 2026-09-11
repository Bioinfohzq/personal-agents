package systemknowledge

// seedNodes 返回内置的 Linux FHS 标准节点数据
// user_id=0, is_builtin=true, 按 sort_order 排序
// 约定:根节点 "/" 的 parentPath 为空串 "";其他一级子目录的 parentPath 为 "/";
// 二级子目录(如 /usr/bin)的 parentPath 为父节点 path(如 "/usr")
func seedNodes() []struct {
	parentPath  string
	path        string
	name        string
	nodeType    string
	description string
	contents    string
	examples    []string
	sortOrder   int
} {
	return []struct {
		parentPath  string
		path        string
		name        string
		nodeType    string
		description string
		contents    string
		examples    []string
		sortOrder   int
	}{
		{"", "/", "/ (根目录)", TypeDir,
			"文件系统的顶层起点，所有其他目录都挂载在根目录之下。系统启动时最先挂载的目录。",
			"不直接存放普通文件，只包含顶层子目录。根分区必须包含足够的文件来引导、恢复、修复系统。",
			[]string{"bin", "etc", "home", "usr", "var", "proc", "sys", "dev"}, 1},

		{"/", "/bin", "/bin", TypeDir,
			"基础用户命令二进制目录，存放所有用户都可使用的、单用户模式下也必需的核心命令。",
			"系统启动和运行所必需的基本命令，普通用户和 root 都可执行，在挂载其他文件系统之前就必须可用。",
			[]string{"ls", "cp", "mv", "rm", "cat", "echo", "bash", "sh", "mount", "umount"}, 2},

		{"/", "/sbin", "/sbin", TypeDir,
			"系统管理二进制目录，存放主要供 root 使用的系统管理和维护命令。",
			"系统引导、修复、恢复等关键管理命令，普通用户通常无权执行或不在PATH中。",
			[]string{"fdisk", "fsck", "mkfs", "reboot", "shutdown", "ifconfig", "iptables", "init"}, 3},

		{"/", "/etc", "/etc", TypeDir,
			"系统配置文件目录，存放系统全局的配置文件和子目录（Editable Text Configuration）。",
			"几乎所有系统服务和程序的配置文件，不存放二进制程序。",
			[]string{"passwd（用户账户）", "group（用户组）", "hosts（主机名映射）", "fstab（文件系统挂载表）", "ssh/（SSH配置）", "systemd/（systemd配置）", "nginx/（Nginx配置）"}, 4},

		{"/", "/home", "/home", TypeDir,
			"普通用户的主目录，每个用户在此目录下有一个以用户名命名的子目录。",
			"用户个人文件、配置、下载、文档等数据。",
			[]string{"/home/alice", "/home/bob/.bashrc", "~/Documents", "~/Downloads"}, 5},

		{"/", "/root", "/root", TypeDir,
			"root 超级用户的主目录，不在 /home 下，因为 /home 可能挂载在其他分区，单用户模式下不一定可用。",
			"root 用户的个人配置和文件，普通用户无访问权限。",
			[]string{".bashrc", ".ssh/authorized_keys", ".bash_history"}, 6},

		{"/", "/lib", "/lib", TypeDir,
			"共享库目录，存放 /bin 和 /sbin 中程序运行所必需的共享库文件和内核模块。",
			"C 标准库、动态链接器、内核模块等基础运行时库。",
			[]string{"libc.so.6（C标准库）", "ld-linux.so（动态链接器）", "modules/（内核模块）"}, 7},

		{"/", "/lib64", "/lib64", TypeDir,
			"64 位系统专用的共享库目录。",
			"64 位架构的共享库文件。",
			[]string{"libc.so.6", "ld-linux-x86-64.so.2"}, 8},

		{"/", "/usr", "/usr", TypeDir,
			"用户程序和数据目录（Unix System Resources），存放非系统必需的用户程序和数据。",
			"大多数用户安装的软件、库、文档、头文件等。可以只读挂载，多台机器可共享。",
			[]string{"usr/bin", "usr/sbin", "usr/lib", "usr/local", "usr/share", "usr/include"}, 9},

		{"/usr", "/usr/bin", "/usr/bin", TypeDir,
			"大多数用户命令的二进制目录，是系统中命令最多的目录。",
			"非单用户模式必需的普通用户命令，发行版包管理器安装的大部分命令都在这里。",
			[]string{"python3", "git", "vim", "gcc", "curl", "wget", "systemctl"}, 1},

		{"/usr", "/usr/sbin", "/usr/sbin", TypeDir,
			"非必需的系统管理命令目录。",
			"系统管理员使用但非启动必需的命令，网络服务等管理工具。",
			[]string{"sshd", "nginx", "httpd", "useradd", "usermod", "crond"}, 2},

		{"/usr", "/usr/lib", "/usr/lib", TypeDir,
			"/usr/bin 和 /usr/sbin 程序使用的共享库。",
			"用户程序的库文件、软件包内部数据、插件等。",
			[]string{"python3/（Python库）", "x86_64-linux-gnu/（架构相关库）"}, 3},

		{"/usr", "/usr/local", "/usr/local", TypeDir,
			"本地安装软件目录，存放系统管理员手动编译安装的软件，不受包管理器管理。",
			"本地编译的程序、第三方软件，结构与 /usr 类似。",
			[]string{"usr/local/bin", "usr/local/lib", "usr/local/etc"}, 4},

		{"/usr", "/usr/share", "/usr/share", TypeDir,
			"架构无关的共享数据目录。",
			"与硬件架构无关的只读数据，如 man 手册、文档、字体、时区数据等。",
			[]string{"man/（手册页）", "doc/（文档）", "zoneinfo/（时区数据）", "fonts/（字体）"}, 5},

		{"/usr", "/usr/include", "/usr/include", TypeDir,
			"C/C++ 头文件目录，存放编译程序所需的标准头文件。",
			"标准库头文件、内核头文件等开发所需文件。",
			[]string{"stdio.h", "stdlib.h", "unistd.h", "sys/"}, 6},

		{"/", "/var", "/var", TypeDir,
			"可变数据目录（Variable data），存放系统运行过程中会变化的数据。",
			"日志文件、缓存数据、邮件队列、数据库文件、锁文件等，通常单独分区。",
			[]string{"var/log", "var/cache", "var/spool", "var/lib"}, 10},

		{"/var", "/var/log", "/var/log", TypeDir,
			"系统日志目录，存放各种服务和内核的日志文件。",
			"系统日志、应用日志、认证日志、内核日志等，排错时首先查看的目录。",
			[]string{"syslog/messages（系统日志）", "auth.log（认证日志）", "nginx/（Nginx日志）", "kern.log（内核日志）"}, 1},

		{"/var", "/var/lib", "/var/lib", TypeDir,
			"可变状态数据目录，存放程序运行时需要持久化修改的数据。",
			"应用状态数据、数据库文件、包管理器元数据、Docker镜像等。",
			[]string{"docker/（Docker数据）", "mysql/（MySQL数据）", "dpkg/（dpkg状态）", "rpm/（RPM数据库）"}, 2},

		{"/var", "/var/cache", "/var/cache", TypeDir,
			"应用缓存数据目录，存放可重新生成的缓存数据。",
			"包下载缓存、网页缓存、编译缓存等，删除不影响程序运行。",
			[]string{"apt/（APT包缓存）", "yum/（YUM缓存）"}, 3},

		{"/var", "/var/spool", "/var/spool", TypeDir,
			"排队等待处理的数据目录（spool = 假脱机）。",
			"邮件队列、打印任务、定时任务等待处理的数据。",
			[]string{"mail/（邮件队列）", "cron/（cron任务）", "cups/（打印队列）"}, 4},

		{"/", "/tmp", "/tmp", TypeDir,
			"临时文件目录，所有用户都可读写，存放程序运行时产生的临时文件。",
			"临时文件和目录，系统重启后通常会被自动清空，不要在此存放重要数据。",
			[]string{"临时下载文件", "程序运行临时产物", "socket文件"}, 11},

		{"/", "/dev", "/dev", TypeDir,
			"设备文件目录（Devices），以文件形式呈现系统中的硬件设备，是 Unix\"一切皆文件\"哲学的体现。",
			"块设备（磁盘）和字符设备（终端、键盘）的特殊文件，通过读写这些文件与硬件交互。",
			[]string{"sda/sda1（硬盘及分区）", "tty（终端）", "null（黑洞设备）", "zero（零设备）", "random/urandom（随机数）"}, 12},

		{"/", "/proc", "/proc", TypeDir,
			"进程与内核虚拟文件系统（Process information pseudo-filesystem），不占用磁盘空间，内核在内存中动态生成。",
			"实时反映当前内核和进程状态的虚拟文件，通过读取获取系统运行时信息。",
			[]string{"cpuinfo（CPU信息）", "meminfo（内存信息）", "loadavg（负载）", "uptime（运行时间）", "[pid]/（各进程目录）", "sys/（内核参数）"}, 13},

		{"/", "/sys", "/sys", TypeDir,
			"设备与驱动虚拟文件系统（sysfs），比 /proc 更结构化地展示硬件设备和驱动信息。",
			"内核对象、设备模型、驱动、总线等结构化信息。",
			[]string{"bus/（总线类型）", "class/（设备类）", "devices/（所有设备）", "block/（块设备）", "module/（已加载内核模块）"}, 14},

		{"/", "/boot", "/boot", TypeDir,
			"引导加载程序目录，存放系统启动所需的文件。",
			"内核镜像、initrd/initramfs（临时根文件系统）、引导加载器（GRUB）配置等，通常单独分区。",
			[]string{"vmlinuz（Linux内核镜像）", "initrd.img/initramfs（临时文件系统）", "grub/（GRUB配置）", "efi/（UEFI文件）"}, 15},

		{"/", "/opt", "/opt", TypeDir,
			"可选附加软件包目录（Optional），存放第三方商业软件或独立打包的大型应用。",
			"不属于发行版包管理系统的附加软件，每个软件有自己独立的子目录。",
			[]string{"google/chrome（Chrome浏览器）", "visual-studio-code（VS Code）", "oracle/（Oracle数据库）"}, 16},

		{"/", "/mnt", "/mnt", TypeDir,
			"临时挂载点目录（Mount），供系统管理员临时挂载其他文件系统。",
			"通常为空，手动挂载外部文件系统时使用。",
			[]string{"/mnt/usb", "/mnt/nfs", "/mnt/external"}, 17},

		{"/", "/media", "/media", TypeDir,
			"可移动媒体挂载点目录，自动挂载 U 盘、光盘、移动硬盘等可移动设备。",
			"系统自动为插入的可移动设备创建子目录并挂载。",
			[]string{"cdrom（光盘）", "usb（U盘）"}, 18},

		{"/", "/srv", "/srv", TypeDir,
			"服务数据目录（Service），存放本系统提供的服务相关的数据。",
			"Web 服务、FTP 服务等对外提供服务的数据。",
			[]string{"www/（网站文件）", "ftp/（FTP文件）"}, 19},

		{"/", "/run", "/run", TypeDir,
			"运行时可变数据目录（Run-time variable data），tmpfs 挂载，系统启动后才存在，重启清空。",
			"进程 PID 文件、锁文件、socket 文件等运行时数据，取代了旧的 /var/run。",
			[]string{"*.pid（进程ID文件）", "docker.sock（Docker socket）", "lock/（锁文件）"}, 20},
	}
}
