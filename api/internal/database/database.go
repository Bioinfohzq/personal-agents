package database

import (
	"context"
	"database/sql"
	"errors"
	"time"

	_ "github.com/go-sql-driver/mysql"

	"personal-agents/api/internal/config"
)

type Store struct {
	db *sql.DB
}

func New(ctx context.Context, cfg config.DatabaseConfig) (*Store, error) {
	if cfg.DSN == "" {
		return nil, errors.New("database dsn is required")
	}

	if cfg.Driver != "mysql" {
		return nil, errors.New("only mysql database driver is supported")
	}

	db, err := sql.Open(cfg.Driver, cfg.DSN)
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
