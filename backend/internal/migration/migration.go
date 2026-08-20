package migration

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func Apply(ctx context.Context, db *sql.DB) error {
	if db == nil {
		return fmt.Errorf("database is required")
	}

	if _, err := db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version VARCHAR(255) PRIMARY KEY,
			applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
	`); err != nil {
		return err
	}

	files, err := migrationFiles()
	if err != nil {
		return err
	}

	for _, file := range files {
		version := strings.TrimSuffix(filepath.Base(file), ".up.sql")
		applied, err := isApplied(ctx, db, version)
		if err != nil {
			return err
		}

		if applied {
			continue
		}

		if err := applyFile(ctx, db, file); err != nil {
			return fmt.Errorf("apply migration %s: %w", version, err)
		}

		if _, err := db.ExecContext(ctx, `INSERT INTO schema_migrations (version) VALUES (?)`, version); err != nil {
			return err
		}
	}

	return nil
}

func migrationFiles() ([]string, error) {
	for _, dir := range []string{"migrations", "api/migrations"} {
		files, err := filepath.Glob(filepath.Join(dir, "*.up.sql"))
		if err != nil {
			return nil, err
		}

		if len(files) > 0 {
			sort.Strings(files)
			return files, nil
		}
	}

	return nil, nil
}

func isApplied(ctx context.Context, db *sql.DB, version string) (bool, error) {
	var count int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM schema_migrations WHERE version = ?`, version).Scan(&count); err != nil {
		return false, err
	}

	return count > 0, nil
}

func applyFile(ctx context.Context, db *sql.DB, path string) error {
	content, err := os.ReadFile(path)
	if err != nil {
		return err
	}

	// 如果包含 DELIMITER 指令,按 DELIMITER 分割执行(支持存储过程)
	sqlContent := string(content)
	if strings.Contains(sqlContent, "DELIMITER") {
		return applyWithDelimiter(ctx, db, sqlContent)
	}

	// 普通模式:清理注释行后按分号分割
	lines := strings.Split(sqlContent, "\n")
	var cleaned strings.Builder
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "--") || trimmed == "" {
			continue
		}
		cleaned.WriteString(line)
		cleaned.WriteString("\n")
	}

	for _, stmt := range strings.Split(cleaned.String(), ";") {
		stmt = strings.TrimSpace(stmt)
		if stmt == "" {
			continue
		}
		if _, err := db.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("executing: %s\nerror: %w", truncate(stmt, 200), err)
		}
	}

	return nil
}

// applyWithDelimiter 解析 DELIMITER 指令执行 SQL(支持存储过程)
func applyWithDelimiter(ctx context.Context, db *sql.DB, content string) error {
	// 按行处理,追踪当前 delimiter
	delimiter := ";"
	var currentStmt strings.Builder

	for _, line := range strings.Split(content, "\n") {
		trimmed := strings.TrimSpace(line)

		// 跳过注释行
		if strings.HasPrefix(trimmed, "--") || trimmed == "" {
			continue
		}

		// 处理 DELIMITER 指令
		if strings.HasPrefix(strings.ToUpper(trimmed), "DELIMITER ") {
			parts := strings.Fields(trimmed)
			if len(parts) >= 2 {
				delimiter = parts[1]
			}
			continue
		}

		currentStmt.WriteString(line)
		currentStmt.WriteString("\n")

		// 检查当前行是否以 delimiter 结尾
		if strings.HasSuffix(trimmed, delimiter) {
			stmt := strings.TrimSpace(currentStmt.String())
			stmt = strings.TrimSuffix(stmt, delimiter)
			stmt = strings.TrimSpace(stmt)
			if stmt != "" {
				if _, err := db.ExecContext(ctx, stmt); err != nil {
					return fmt.Errorf("executing: %s\nerror: %w", truncate(stmt, 200), err)
				}
			}
			currentStmt.Reset()
		}
	}

	// 执行最后一条语句(如果没有 delimiter 结尾)
	remaining := strings.TrimSpace(currentStmt.String())
	if remaining != "" {
		if _, err := db.ExecContext(ctx, remaining); err != nil {
			return fmt.Errorf("executing: %s\nerror: %w", truncate(remaining, 200), err)
		}
	}

	return nil
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
