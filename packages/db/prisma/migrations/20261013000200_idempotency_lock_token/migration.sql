-- Fencing token for idempotency keys: after a lapsed lock is taken over, the earlier attempt can
-- no longer complete or release the key (docs/03-security.md §11).
ALTER TABLE "idempotency_keys" ADD COLUMN "lock_token" UUID;
