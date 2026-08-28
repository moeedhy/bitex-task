INSERT INTO wallets (id, user_id, asset, balance_atomic, reserved_atomic)
VALUES ('wallet-user-123-usdt', 'user-123', 'USDT', 1000000000, 0)
ON CONFLICT (user_id, asset) DO NOTHING;
