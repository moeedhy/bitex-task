-- Carries the request's correlation id with the event it produced.
--
-- The id was generated at the HTTP edge and died at the controller, which is
-- the half of the flow that least needs it. Correlating a customer's report
-- with the settlement that answered it meant matching timestamps by eye across
-- the API log, the publisher log and the consumer log.
--
-- Nullable on purpose: rows written before this column existed have no id, and
-- recovery re-publishes an intent that belongs to no request at all.
ALTER TABLE outbox_events
  ADD COLUMN IF NOT EXISTS correlation_id TEXT;
