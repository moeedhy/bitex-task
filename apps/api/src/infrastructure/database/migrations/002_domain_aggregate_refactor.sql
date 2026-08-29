ALTER TABLE wallet_reservations
  ADD COLUMN IF NOT EXISTS asset TEXT;

UPDATE wallet_reservations AS reservation
SET asset = wallet.asset
FROM wallets AS wallet
WHERE wallet.id = reservation.wallet_id;

ALTER TABLE wallet_reservations
  ALTER COLUMN asset SET NOT NULL;

ALTER TABLE wallets
  DROP CONSTRAINT IF EXISTS wallets_id_asset_unique;
ALTER TABLE wallets
  ADD CONSTRAINT wallets_id_asset_unique UNIQUE (id, asset);

ALTER TABLE wallet_reservations
  DROP CONSTRAINT IF EXISTS wallet_reservations_wallet_id_fkey,
  DROP CONSTRAINT IF EXISTS wallet_reservations_id_withdrawal_unique,
  DROP CONSTRAINT IF EXISTS wallet_reservations_wallet_asset_fk;
ALTER TABLE wallet_reservations
  ADD CONSTRAINT wallet_reservations_id_withdrawal_unique
    UNIQUE (id, withdrawal_id),
  ADD CONSTRAINT wallet_reservations_wallet_asset_fk
    FOREIGN KEY (wallet_id, asset)
    REFERENCES wallets(id, asset) ON DELETE RESTRICT;

ALTER TABLE withdrawals
  DROP CONSTRAINT IF EXISTS withdrawals_reservation_id_fkey,
  DROP CONSTRAINT IF EXISTS withdrawals_reservation_ownership_fk,
  DROP CONSTRAINT IF EXISTS withdrawals_status_check,
  DROP CONSTRAINT IF EXISTS withdrawals_terminal_payload_check;

UPDATE withdrawals
SET status = 'PENDING'
WHERE status = 'FUNDS_RESERVED';

ALTER TABLE withdrawals
  ADD CONSTRAINT withdrawals_reservation_ownership_fk
    FOREIGN KEY (reservation_id, id)
    REFERENCES wallet_reservations(id, withdrawal_id) ON DELETE RESTRICT,
  ADD CONSTRAINT withdrawals_status_check
    CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  ADD CONSTRAINT withdrawals_terminal_payload_check CHECK (
    (status = 'COMPLETED' AND transaction_reference IS NOT NULL AND failure_reason IS NULL)
    OR (status = 'FAILED' AND transaction_reference IS NULL AND failure_reason = 'PROVIDER_ERROR')
    OR (status IN ('PENDING', 'PROCESSING') AND transaction_reference IS NULL AND failure_reason IS NULL)
  );

