package receiving

import "context"

type Repository interface {
	ListReceipts(ctx context.Context) ([]Receipt, error)
}

type Service struct {
	repository Repository
}

func NewService(repository Repository) *Service {
	return &Service{repository: repository}
}

func (s *Service) ListReceipts(ctx context.Context) ([]Receipt, error) {
	if s.repository == nil {
		return []Receipt{}, nil
	}

	return s.repository.ListReceipts(ctx)
}
