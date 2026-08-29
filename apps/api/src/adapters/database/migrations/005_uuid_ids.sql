-- Retypes every identifier column from TEXT to the native `uuid` type.
--
-- This is an ALTER, deliberately -- not a squashed baseline and not a
-- drop-and-recreate. `SchemaMigrator` keys the applied set by *filename*, so on
-- an existing volume a rewritten `001_baseline.sql` is not in that set, runs,
-- no-ops through every `CREATE TABLE IF NOT EXISTS`, and is then recorded as
-- applied -- leaving a silently TEXT-typed database that the bookkeeping swears
-- is current. And if the rewritten baseline contains anything non-idempotent it
-- throws inside the migrator's per-file transaction, is never recorded, and the
-- application crash-loops on every boot forever.
--
-- The whole file runs in one transaction, so it either lands or it does not.
--
-- Ordering matters three times over, and a naive `ALTER ... TYPE uuid` fails on
-- each of them:
--
--   1. `'user-123'::uuid` raises 22P02. Rows whose ids are not UUIDs must go
--      first, child before parent, because every foreign key here is
--      ON DELETE RESTRICT. In practice this matches only the old dev seed row;
--      every application-generated id has always come from randomUUID().
--   2. PostgreSQL refuses to retype a column referenced by a foreign key, and
--      002's composite `withdrawals_reservation_ownership_fk (reservation_id, id)`
--      makes `withdrawals.id` -- a primary key -- also an FK column.
--   3. Those composite keys reference UNIQUE constraints, which must be dropped
--      after the keys that use them and restored before them.
--
-- Columns that stay TEXT, and why:
--   idempotency_records.idempotency_key  client-supplied, not ours to constrain
--   idempotency_records.operation        an enum-like name
--   withdrawals.transaction_reference    a provider reference, `tx-<uuid>`
--   outbox_events.locked_by              a publisher instance label
--   outbox_events.correlation_id         caller-supplied, may be any trace id
--   wallets.asset, every *status column* not identifiers at all

-- ---------------------------------------------------------------------------
-- 1. Remove rows that cannot be represented as UUIDs, child -> parent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.is_uuid_text(value TEXT) RETURNS BOOLEAN AS $$
  SELECT value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$$ LANGUAGE SQL IMMUTABLE;

DELETE FROM idempotency_records
WHERE withdrawal_id IS NOT NULL AND NOT pg_temp.is_uuid_text(withdrawal_id);

DELETE FROM processed_events
WHERE NOT pg_temp.is_uuid_text(event_id);

DELETE FROM outbox_events
WHERE NOT pg_temp.is_uuid_text(id) OR NOT pg_temp.is_uuid_text(aggregate_id);

DELETE FROM fake_provider_executions
WHERE NOT pg_temp.is_uuid_text(withdrawal_id);

-- A withdrawal goes if its own ids are bad, or if the reservation it points at
-- is about to be removed.
DELETE FROM withdrawals w
WHERE NOT pg_temp.is_uuid_text(w.id)
   OR NOT pg_temp.is_uuid_text(w.user_id)
   OR NOT pg_temp.is_uuid_text(w.reservation_id)
   OR EXISTS (
     SELECT 1 FROM wallet_reservations r
     WHERE r.id = w.reservation_id
       AND (NOT pg_temp.is_uuid_text(r.id)
            OR NOT pg_temp.is_uuid_text(r.wallet_id)
            OR NOT pg_temp.is_uuid_text(r.withdrawal_id))
   );

DELETE FROM wallet_reservations r
WHERE NOT pg_temp.is_uuid_text(r.id)
   OR NOT pg_temp.is_uuid_text(r.wallet_id)
   OR NOT pg_temp.is_uuid_text(r.withdrawal_id)
   OR EXISTS (
     SELECT 1 FROM wallets w
     WHERE w.id = r.wallet_id
       AND (NOT pg_temp.is_uuid_text(w.id) OR NOT pg_temp.is_uuid_text(w.user_id))
   );

DELETE FROM wallets
WHERE NOT pg_temp.is_uuid_text(id) OR NOT pg_temp.is_uuid_text(user_id);

-- ---------------------------------------------------------------------------
-- 2. Drop the foreign keys, then the unique constraints they reference.
-- ---------------------------------------------------------------------------
ALTER TABLE idempotency_records
  DROP CONSTRAINT IF EXISTS idempotency_records_withdrawal_id_fkey;

ALTER TABLE withdrawals
  DROP CONSTRAINT IF EXISTS withdrawals_reservation_ownership_fk,
  DROP CONSTRAINT IF EXISTS withdrawals_reservation_id_fkey,
  DROP CONSTRAINT IF EXISTS withdrawals_reservation_id_key;

ALTER TABLE wallet_reservations
  DROP CONSTRAINT IF EXISTS wallet_reservations_wallet_asset_fk,
  DROP CONSTRAINT IF EXISTS wallet_reservations_wallet_id_fkey,
  DROP CONSTRAINT IF EXISTS wallet_reservations_id_withdrawal_unique,
  DROP CONSTRAINT IF EXISTS wallet_reservations_withdrawal_id_key;

ALTER TABLE wallets
  DROP CONSTRAINT IF EXISTS wallets_id_asset_unique;

-- ---------------------------------------------------------------------------
-- 3. Retype. Primary keys stay in place; PostgreSQL rebuilds their indexes.
-- ---------------------------------------------------------------------------
ALTER TABLE wallets
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN user_id TYPE uuid USING user_id::uuid;

ALTER TABLE wallet_reservations
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN wallet_id TYPE uuid USING wallet_id::uuid,
  ALTER COLUMN withdrawal_id TYPE uuid USING withdrawal_id::uuid;

ALTER TABLE withdrawals
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN user_id TYPE uuid USING user_id::uuid,
  ALTER COLUMN reservation_id TYPE uuid USING reservation_id::uuid;

ALTER TABLE idempotency_records
  ALTER COLUMN withdrawal_id TYPE uuid USING withdrawal_id::uuid;

ALTER TABLE outbox_events
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN aggregate_id TYPE uuid USING aggregate_id::uuid;

ALTER TABLE processed_events
  ALTER COLUMN event_id TYPE uuid USING event_id::uuid;

ALTER TABLE fake_provider_executions
  ALTER COLUMN withdrawal_id TYPE uuid USING withdrawal_id::uuid;

-- ---------------------------------------------------------------------------
-- 4. Restore the unique constraints, then the foreign keys -- parent -> child,
--    the mirror of step 2.
-- ---------------------------------------------------------------------------
ALTER TABLE wallets
  ADD CONSTRAINT wallets_id_asset_unique UNIQUE (id, asset);

ALTER TABLE wallet_reservations
  ADD CONSTRAINT wallet_reservations_withdrawal_id_key UNIQUE (withdrawal_id),
  ADD CONSTRAINT wallet_reservations_id_withdrawal_unique UNIQUE (id, withdrawal_id),
  ADD CONSTRAINT wallet_reservations_wallet_asset_fk
    FOREIGN KEY (wallet_id, asset)
    REFERENCES wallets(id, asset) ON DELETE RESTRICT;

ALTER TABLE withdrawals
  ADD CONSTRAINT withdrawals_reservation_id_key UNIQUE (reservation_id),
  ADD CONSTRAINT withdrawals_reservation_ownership_fk
    FOREIGN KEY (reservation_id, id)
    REFERENCES wallet_reservations(id, withdrawal_id) ON DELETE RESTRICT;

ALTER TABLE idempotency_records
  ADD CONSTRAINT idempotency_records_withdrawal_id_fkey
    FOREIGN KEY (withdrawal_id) REFERENCES withdrawals(id) ON DELETE RESTRICT;
