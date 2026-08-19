package config

import (
	"bufio"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	AppName  string
	Env      string
	Host     string
	Port     string
	Database DatabaseConfig
	Auth     AuthConfig
	LLM      LLMConfig
}

type DatabaseConfig struct {
	Driver    string
	Host      string
	Port      string
	Username  string
	Password  string
	Name      string
	ParseTime string
	Loc       string
	DSN       string
}

type AuthConfig struct {
	JWTSecret       string
	TokenTTLMinutes string
}

type LLMConfig struct {
	DefaultModel string
}

func (cfg AuthConfig) TokenTTL() time.Duration {
	minutes, err := strconv.Atoi(cfg.TokenTTLMinutes)
	if err != nil || minutes <= 0 {
		minutes = 10080
	}

	return time.Duration(minutes) * time.Minute
}

func Load() Config {
	// 加载项目根目录的 .env 文件,让后端不再依赖 pa-start 脚本的 source .env。
	// 查找顺序:从可执行文件当前工作目录向上查找,最多 5 层。
	loadRootEnv()

	fileConfig := loadLocalYAML()
	databaseConfig := DatabaseConfig{
		Driver:    getEnv("DATABASE_DRIVER", valueOrDefault(fileConfig.Database.Driver, "mysql")),
		Host:      getEnv("DATABASE_HOST", fileConfig.Database.Host),
		Port:      getEnv("DATABASE_PORT", fileConfig.Database.Port),
		Username:  getEnv("DATABASE_USERNAME", fileConfig.Database.Username),
		Password:  getEnv("DATABASE_PASSWORD", fileConfig.Database.Password),
		Name:      getEnv("DATABASE_NAME", fileConfig.Database.Name),
		ParseTime: getEnv("DATABASE_PARSE_TIME", valueOrDefault(fileConfig.Database.ParseTime, "true")),
		Loc:       getEnv("DATABASE_LOC", valueOrDefault(fileConfig.Database.Loc, "Local")),
	}
	databaseConfig.DSN = getEnv("DATABASE_DSN", buildDatabaseDSN(databaseConfig))

	return Config{
		AppName:  getEnv("APP_NAME", valueOrDefault(fileConfig.AppName, "personal-agents-api")),
		Env:      getEnv("APP_ENV", valueOrDefault(fileConfig.Env, "local")),
		Host:     getEnv("API_HOST", valueOrDefault(fileConfig.Host, "127.0.0.1")),
		Port:     getEnv("API_PORT", valueOrDefault(fileConfig.Port, "8080")),
		Database: databaseConfig,
		Auth: AuthConfig{
			JWTSecret:       getEnv("AUTH_JWT_SECRET", fileConfig.Auth.JWTSecret),
			TokenTTLMinutes: getEnv("AUTH_TOKEN_TTL_MINUTES", valueOrDefault(fileConfig.Auth.TokenTTLMinutes, "10080")),
		},
		LLM: LLMConfig{
			DefaultModel: getEnv("DEFAULT_MODEL", fileConfig.LLM.DefaultModel),
		},
	}
}

func (cfg Config) HTTPAddr() string {
	return cfg.Host + ":" + cfg.Port
}

func getEnv(key string, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}

	return value
}

// loadRootEnv 查找并加载项目根目录的 .env 文件。
// 后端通常在 backend/ 目录运行,所以 .env 在父目录。
// 使用 godotenv.Overload 已经加载过的变量不覆盖,这里只负责首次加载。
func loadRootEnv() {
	candidates := []string{}

	// 1. API_CONFIG_FILE 显式指定(也可以指向 .env)
	if cfg := os.Getenv("API_CONFIG_FILE"); cfg != "" {
		candidates = append(candidates, cfg)
	}

	// 2. 从当前工作目录向上查找 .env (最多 5 层)
	if cwd, err := os.Getwd(); err == nil {
		dir := cwd
		for i := 0; i < 5; i++ {
			candidates = append(candidates, filepath.Join(dir, ".env"))
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}

	// 3. 兜底:backend/../.env
	candidates = append(candidates, "../.env", "../../.env")

	for _, p := range candidates {
		if p == "" {
			continue
		}
		if _, err := os.Stat(p); err != nil {
			continue
		}
		if err := godotenv.Load(p); err != nil {
			// 不打印 err 详情,避免 .env 内容(可能含敏感 key)泄漏到日志
			slog.Warn("failed to load .env, please check format (each line must be KEY=VALUE or #comment)", "path", p)
			continue
		}
		slog.Info("loaded .env", "path", p)
		return
	}
}

func valueOrDefault(value string, fallback string) string {
	if value == "" {
		return fallback
	}

	return value
}

func loadLocalYAML() Config {
	configFile := os.Getenv("API_CONFIG_FILE")
	if configFile != "" {
		return loadYAMLFile(configFile)
	}

	for _, candidate := range []string{"configs/config.yaml", "api/configs/config.yaml"} {
		if _, err := os.Stat(candidate); err == nil {
			return loadYAMLFile(candidate)
		}
	}

	return Config{}
}

func loadYAMLFile(path string) Config {
	file, err := os.Open(path)
	if err != nil {
		return Config{}
	}
	defer file.Close()

	var cfg Config
	section := ""

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		if strings.HasSuffix(line, ":") {
			section = strings.TrimSuffix(line, ":")
			continue
		}

		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}

		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), `"'`)

		if key == "" {
			continue
		}

		assignYAMLValue(&cfg, section, key, value)
	}

	return cfg
}

func assignYAMLValue(cfg *Config, section string, key string, value string) {
	switch section {
	case "":
		switch key {
		case "app_name":
			cfg.AppName = value
		case "env":
			cfg.Env = value
		}
	case "api":
		switch key {
		case "host":
			cfg.Host = value
		case "port":
			cfg.Port = value
		}
	case "database":
		switch key {
		case "driver":
			cfg.Database.Driver = value
		case "host":
			cfg.Database.Host = value
		case "port":
			cfg.Database.Port = value
		case "username":
			cfg.Database.Username = value
		case "password":
			cfg.Database.Password = value
		case "name":
			cfg.Database.Name = value
		case "parse_time":
			cfg.Database.ParseTime = value
		case "loc":
			cfg.Database.Loc = value
		case "dsn":
			cfg.Database.DSN = value
		}
	case "auth":
		switch key {
		case "jwt_secret":
			cfg.Auth.JWTSecret = value
		case "token_ttl_minutes":
			cfg.Auth.TokenTTLMinutes = value
		}
	case "llm":
		switch key {
		case "default_model":
			cfg.LLM.DefaultModel = value
		}
	}
}

func buildDatabaseDSN(database DatabaseConfig) string {
	if database.DSN != "" {
		return database.DSN
	}

	if database.Username == "" || database.Host == "" || database.Port == "" || database.Name == "" {
		return ""
	}

	parseTime := valueOrDefault(database.ParseTime, "true")
	loc := valueOrDefault(database.Loc, "Local")

	return fmt.Sprintf(
		"%s:%s@tcp(%s:%s)/%s?parseTime=%s&loc=%s",
		database.Username,
		database.Password,
		database.Host,
		database.Port,
		database.Name,
		parseTime,
		loc,
	)
}
