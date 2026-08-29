-- Development seed. Re-run on every boot when SEED_DEV_DATA=true, so it must
-- stay idempotent.
--
-- The identifiers are fixed UUIDs rather than readable slugs because every
-- identity in this service is a parsed UUID: `WalletId.parse('wallet-user-123-usdt')`
-- rejects, and a seeded row the adapters cannot hydrate is worse than no seed.
-- The all-zero prefix marks them unmistakably as fixtures.
INSERT INTO wallets (id, user_id, asset, balance_atomic, reserved_atomic)
VALUES (
  '00000000-0000-7000-8000-0000000000a1',
  '00000000-0000-7000-8000-000000000001',
  'USDT',
  1000000000,
  0
)
ON CONFLICT (user_id, asset) DO NOTHING;
