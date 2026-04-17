package users

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository interface {
	CountUsers(ctx context.Context) (int, error)
	GetByEmail(ctx context.Context, email string) (userRecord, error)
	GetByID(ctx context.Context, id string) (User, error)
	List(ctx context.Context) ([]User, error)
	Create(ctx context.Context, params CreateUserParams) (User, error)
	Update(ctx context.Context, params UpdateUserParams) (User, error)
}

type PostgresRepository struct {
	pool *pgxpool.Pool
}

type rowScanner interface {
	Scan(dest ...any) error
}

func NewRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func (r *PostgresRepository) CountUsers(ctx context.Context) (int, error) {
	var count int
	err := r.pool.QueryRow(ctx, `SELECT COUNT(*) FROM app_users`).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count users: %w", err)
	}

	return count, nil
}

func (r *PostgresRepository) GetByEmail(ctx context.Context, email string) (userRecord, error) {
	row := r.pool.QueryRow(ctx, `
		SELECT id::text, email, display_name, role::text, is_active, created_at, updated_at, password_hash
		FROM app_users
		WHERE email = $1
	`, email)

	record, err := scanUserRecord(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return userRecord{}, ErrNotFound
	}
	if err != nil {
		return userRecord{}, fmt.Errorf("get user by email: %w", err)
	}

	return record, nil
}

func (r *PostgresRepository) GetByID(ctx context.Context, id string) (User, error) {
	row := r.pool.QueryRow(ctx, `
		SELECT id::text, email, display_name, role::text, is_active, created_at, updated_at
		FROM app_users
		WHERE id = $1::uuid
	`, id)

	user, err := scanUser(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrNotFound
	}
	if err != nil {
		return User{}, fmt.Errorf("get user by id: %w", err)
	}

	return user, nil
}

func (r *PostgresRepository) List(ctx context.Context) ([]User, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, email, display_name, role::text, is_active, created_at, updated_at
		FROM app_users
		ORDER BY created_at ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	defer rows.Close()

	users := []User{}
	for rows.Next() {
		user, err := scanUser(rows)
		if err != nil {
			return nil, fmt.Errorf("scan user: %w", err)
		}
		users = append(users, user)
	}

	return users, rows.Err()
}

func (r *PostgresRepository) Create(ctx context.Context, params CreateUserParams) (User, error) {
	row := r.pool.QueryRow(ctx, `
		INSERT INTO app_users (email, password_hash, display_name, role, is_active)
		VALUES ($1, $2, $3, $4::app_user_role, $5)
		RETURNING id::text, email, display_name, role::text, is_active, created_at, updated_at
	`, params.Email, params.PasswordHash, params.DisplayName, string(params.Role), params.IsActive)

	user, err := scanUser(row)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return User{}, ErrConflict
		}
		return User{}, fmt.Errorf("create user: %w", err)
	}

	return user, nil
}

func (r *PostgresRepository) Update(ctx context.Context, params UpdateUserParams) (User, error) {
	row := r.pool.QueryRow(ctx, `
		UPDATE app_users
		SET display_name = $2,
		    role = $3::app_user_role,
		    is_active = $4,
		    updated_at = NOW()
		WHERE id = $1::uuid
		RETURNING id::text, email, display_name, role::text, is_active, created_at, updated_at
	`, params.ID, params.DisplayName, string(params.Role), params.IsActive)

	user, err := scanUser(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrNotFound
	}
	if err != nil {
		return User{}, fmt.Errorf("update user: %w", err)
	}

	return user, nil
}

func scanUser(row rowScanner) (User, error) {
	var user User
	var role string

	err := row.Scan(
		&user.ID,
		&user.Email,
		&user.DisplayName,
		&role,
		&user.IsActive,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	if err != nil {
		return User{}, err
	}

	user.Role = Role(role)
	return user, nil
}

func scanUserRecord(row rowScanner) (userRecord, error) {
	var record userRecord
	var role string

	err := row.Scan(
		&record.ID,
		&record.Email,
		&record.DisplayName,
		&role,
		&record.IsActive,
		&record.CreatedAt,
		&record.UpdatedAt,
		&record.PasswordHash,
	)
	if err != nil {
		return userRecord{}, err
	}

	record.Role = Role(role)
	return record, nil
}
