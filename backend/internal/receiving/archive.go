package receiving

// Archive job — promotes 'matched' receipts to 'archived' once they're
// older than the configured threshold (default 14 days).
//
// Archived receipts stay in the database (queryable via the admin-only
// ?include_archived=1 flag) but disappear from the default list views.
// This keeps the active list manageable as receipt volume grows without
// losing audit history.

import (
	"context"
	"log"
	"time"
)

// RunArchiveLoop runs the auto-archive job in the background. The first
// tick happens immediately; subsequent ticks every interval until ctx is
// done. Pass interval=0 to default to 1 hour (the threshold is in days,
// so polling more often than hourly is wasted work).
func (s *Service) RunArchiveLoop(ctx context.Context, threshold time.Duration, interval time.Duration) {
	if s == nil || s.repository == nil {
		return
	}
	if threshold <= 0 {
		// Disabled.
		return
	}
	if interval <= 0 {
		interval = time.Hour
	}

	// Run once on startup so a freshly deployed binary catches up to the
	// backlog of stale matched receipts immediately.
	s.archiveOnce(ctx, threshold)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.archiveOnce(ctx, threshold)
		}
	}
}

func (s *Service) archiveOnce(ctx context.Context, threshold time.Duration) {
	count, err := s.repository.ArchiveStaleMatched(ctx, threshold)
	if err != nil {
		log.Printf("archive job failed: %v", err)
		return
	}
	if count > 0 {
		log.Printf("archive job: archived %d matched receipts older than %s", count, threshold)
	}
}
