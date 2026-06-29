package database

import "personal-agents/api/internal/config"

type Store struct {
	dsn string
}

func New(cfg config.DatabaseConfig) *Store {
	return &Store{dsn: cfg.DSN}
}

func (store *Store) Configured() bool {
	return store != nil && store.dsn != ""
}
