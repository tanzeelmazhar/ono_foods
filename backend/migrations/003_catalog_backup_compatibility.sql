BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS default_address TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_zone_id BIGINT REFERENCES delivery_zones(zone_id) ON DELETE SET NULL;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS sizes JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS addons_config JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_token_hash VARCHAR(128);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'menu_items'
          AND column_name = 'selected_addons_config'
    ) THEN
        UPDATE menu_items
        SET addons_config = selected_addons_config
        WHERE addons_config = '[]'::jsonb
          AND jsonb_typeof(selected_addons_config) = 'array'
          AND selected_addons_config <> '[]'::jsonb;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS user_sessions (
    sid VARCHAR NOT NULL PRIMARY KEY,
    sess JSON NOT NULL,
    expire TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_expire ON user_sessions(expire);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key
    ON orders(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_history_order_time ON order_status_history(order_id, changed_at);

COMMIT;
