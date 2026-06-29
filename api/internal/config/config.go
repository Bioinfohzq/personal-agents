package config

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

type Config struct {
	AppName  string
	Env      string
	Host     string
	Port     string
	Database DatabaseConfig
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

func Load() Config {
	fileConfig := loadLocalYAML()

	return Config{
		AppName: getEnv("APP_NAME", valueOrDefault(fileConfig.AppName, "personal-agents-api")),
		Env:     getEnv("APP_ENV", valueOrDefault(fileConfig.Env, "local")),
		Host:    getEnv("API_HOST", valueOrDefault(fileConfig.Host, "127.0.0.1")),
		Port:    getEnv("API_PORT", valueOrDefault(fileConfig.Port, "8080")),
		Database: DatabaseConfig{
			Driver:    getEnv("DATABASE_DRIVER", valueOrDefault(fileConfig.Database.Driver, "mysql")),
			Host:      getEnv("DATABASE_HOST", fileConfig.Database.Host),
			Port:      getEnv("DATABASE_PORT", fileConfig.Database.Port),
			Username:  getEnv("DATABASE_USERNAME", fileConfig.Database.Username),
			Password:  getEnv("DATABASE_PASSWORD", fileConfig.Database.Password),
			Name:      getEnv("DATABASE_NAME", fileConfig.Database.Name),
			ParseTime: getEnv("DATABASE_PARSE_TIME", valueOrDefault(fileConfig.Database.ParseTime, "true")),
			Loc:       getEnv("DATABASE_LOC", valueOrDefault(fileConfig.Database.Loc, "Local")),
			DSN:       getEnv("DATABASE_DSN", buildDatabaseDSN(fileConfig.Database)),
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
