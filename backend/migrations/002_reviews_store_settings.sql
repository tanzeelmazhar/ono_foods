BEGIN;

CREATE TABLE IF NOT EXISTS store_settings (
    setting_id SMALLINT PRIMARY KEY CHECK (setting_id = 1),
    accepting_orders BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by BIGINT REFERENCES users(user_id) ON DELETE SET NULL
);

INSERT INTO store_settings (setting_id, accepting_orders)
VALUES (1, TRUE)
ON CONFLICT (setting_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS product_reviews (
    review_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
    order_item_id BIGINT NOT NULL UNIQUE REFERENCES order_items(order_item_id) ON DELETE CASCADE,
    reviewer_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
    reviewer_name VARCHAR(120) NOT NULL,
    rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    review_text TEXT NOT NULL DEFAULT '' CHECK (char_length(review_text) <= 1000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_product_reviews_created ON product_reviews(created_at DESC);

COMMIT;
