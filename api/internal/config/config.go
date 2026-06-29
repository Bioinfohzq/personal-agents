package config

import "os"

type Config struct {
	AppName  string
	Env      string
	Host     string
	Port     string
	Database DatabaseConfig
}

type DatabaseConfig struct {
	DSN string
}

func Load() Config {
	return Config{
		AppName: getEnv("APP_NAME", "personal-agents-api"),
		Env:     getEnv("APP_ENV", "local"),
		Host:    getEnv("API_HOST", "127.0.0.1"),
		Port:    getEnv("API_PORT", "8080"),
		Database: DatabaseConfig{
			DSN: os.Getenv("DATABASE_DSN"),
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
