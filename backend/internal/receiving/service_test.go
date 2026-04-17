package receiving

import (
	"context"
	"testing"
)

func TestListReceiptsWithNilRepository(t *testing.T) {
	service := NewService(nil)

	receipts, err := service.ListReceipts(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(receipts) != 0 {
		t.Fatalf("len(receipts) = %d, want 0", len(receipts))
	}
}
