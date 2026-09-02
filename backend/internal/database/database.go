package database

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"

	"personal-agents/backend/internal/config"
)

type Store struct {
	db *sql.DB
}

func New(ctx context.Context, cfg config.DatabaseConfig) (*Store, error) {
	if cfg.DSN == "" {
		return nil, errors.New("database dsn is required")
	}

	if cfg.Driver != "postgres" {
		return nil, errors.New("only postgres database driver is supported")
	}

	db, err := sql.Open("pgx", cfg.DSN)
	if err != nil {
		return nil, err
	}

	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(10)
	db.SetConnMaxLifetime(30 * time.Minute)
	db.SetConnMaxIdleTime(5 * time.Minute)

	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}

	return &Store{db: db}, nil
}

// rebind 把 MySQL 风格的 ? 占位符转换为 PG 的 $1,$2...
// 业务代码中的 SQL 保持 ? 写法不变,由本层统一翻译
func rebind(query string) string {
	var b strings.Builder
	n := 0
	for _, r := range query {
		if r == '?' {
			n++
			b.WriteByte('$')
			b.WriteString(strconv.Itoa(n))
		} else {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// 以下包装方法统一走 rebind,业务模块通过 Store 查询时占位符无需改写

func (store *Store) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return store.DB().QueryContext(ctx, rebind(query), args...)
}

func (store *Store) QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row {
	return store.DB().QueryRowContext(ctx, rebind(query), args...)
}

func (store *Store) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return store.DB().ExecContext(ctx, rebind(query), args...)
}

func (store *Store) BeginTx(ctx context.Context, opts *sql.TxOptions) (*Tx, error) {
	tx, err := store.DB().BeginTx(ctx, opts)
	if err != nil {
		return nil, err
	}
	return &Tx{tx: tx}, nil
}

// Tx 事务包装,同样统一走 rebind
type Tx struct {
	tx *sql.Tx
}

func (t *Tx) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return t.tx.QueryContext(ctx, rebind(query), args...)
}

func (t *Tx) QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row {
	return t.tx.QueryRowContext(ctx, rebind(query), args...)
}

func (t *Tx) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return t.tx.ExecContext(ctx, rebind(query), args...)
}

func (t *Tx) Commit() error   { return t.tx.Commit() }
func (t *Tx) Rollback() error { return t.tx.Rollback() }

func (store *Store) Configured() bool {
	return store != nil && store.db != nil
}

func (store *Store) DB() *sql.DB {
	if store == nil {
		return nil
	}

	return store.db
}

func (store *Store) Close() error {
	if store == nil || store.db == nil {
		return nil
	}

	return store.db.Close()
}
