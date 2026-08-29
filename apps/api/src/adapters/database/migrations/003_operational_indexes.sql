-- Recovery scans for withdrawals stranded in PROCESSING. Without a partial
-- index this is a sequential scan over the whole table on every cycle.
CREATE INDEX IF NOT EXISTS withdrawals_processing_idx
  ON withdrawals(updated_at)
  WHERE status = 'PROCESSING';

-- Retention pruning deletes published rows. The existing partial index covers
-- only unpublished ones, so the delete had no usable index.
CREATE INDEX IF NOT EXISTS outbox_published_idx
  ON outbox_events(published_at)
  WHERE published_at IS NOT NULL;

