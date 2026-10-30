BEGIN;

CREATE TABLE users (
    user_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    full_name VARCHAR(120) NOT NULL,
    phone_number VARCHAR(30) NOT NULL,
    email VARCHAR(254) UNIQUE,
    password_hash VARCHAR(100),
    role VARCHAR(20) NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
    default_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE categories (
    category_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category_name VARCHAR(80) NOT NULL UNIQUE,
    description TEXT,
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE delivery_zones (
    zone_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    zone_name VARCHAR(100) NOT NULL UNIQUE,
    delivery_fee NUMERIC(10,2) NOT NULL CHECK (delivery_fee >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    coverage_notes TEXT
);

ALTER TABLE users ADD COLUMN default_zone_id BIGINT REFERENCES delivery_zones(zone_id) ON DELETE SET NULL;

CREATE TABLE menu_items (
    item_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category_id BIGINT NOT NULL REFERENCES categories(category_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    item_name VARCHAR(140) NOT NULL,
    description TEXT,
    base_price NUMERIC(10,2) NOT NULL CHECK (base_price >= 0),
    availability_status BOOLEAN NOT NULL DEFAULT TRUE,
    image_url TEXT,
    sizes JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sizes) = 'array'),
    addons_config JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(addons_config) = 'array'),
    created_by BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE carts (
    cart_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_token_hash VARCHAR(128) NOT NULL UNIQUE,
    user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ,
    CHECK (expires_at IS NULL OR expires_at > created_at)
);

CREATE TABLE cart_items (
    cart_item_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cart_id BIGINT NOT NULL REFERENCES carts(cart_id) ON DELETE CASCADE,
    item_id BIGINT NOT NULL REFERENCES menu_items(item_id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),
    size_option VARCHAR(80),
    selected_addons JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(selected_addons) = 'array'),
    added_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE orders (
    order_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
    order_timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
    order_status VARCHAR(30) NOT NULL DEFAULT 'Pending'
        CHECK (order_status IN ('Pending','Preparing','Out for Delivery','Delivered','Cancelled')),
    payment_type VARCHAR(10) NOT NULL DEFAULT 'COD' CHECK (payment_type = 'COD'),
    subtotal_amount NUMERIC(12,2) NOT NULL CHECK (subtotal_amount >= 0),
    delivery_fee NUMERIC(10,2) NOT NULL CHECK (delivery_fee >= 0),
    customer_name VARCHAR(120) NOT NULL,
    customer_phone VARCHAR(30) NOT NULL,
    idempotency_key VARCHAR(128) UNIQUE,
    tracking_token_hash VARCHAR(128),
    last_updated_by BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (total_amount = subtotal_amount + delivery_fee)
);

CREATE TABLE order_items (
    order_item_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
    item_id BIGINT REFERENCES menu_items(item_id) ON DELETE SET NULL,
    item_name_snapshot VARCHAR(140) NOT NULL,
    unit_price_snapshot NUMERIC(10,2) NOT NULL CHECK (unit_price_snapshot >= 0),
    quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),
    size_option VARCHAR(80),
    selected_addons JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(selected_addons) = 'array'),
    addon_total NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (addon_total >= 0),
    subtotal NUMERIC(12,2) NOT NULL CHECK (subtotal >= 0),
    CHECK (subtotal = quantity * (unit_price_snapshot + addon_total))
);

CREATE TABLE delivery_info (
    delivery_info_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id BIGINT NOT NULL UNIQUE REFERENCES orders(order_id) ON DELETE CASCADE,
    zone_id BIGINT NOT NULL REFERENCES delivery_zones(zone_id) ON DELETE RESTRICT,
    delivery_address TEXT NOT NULL,
    delivery_instructions TEXT,
    fee_snapshot NUMERIC(10,2) NOT NULL CHECK (fee_snapshot >= 0),
    dispatched_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    courier_name VARCHAR(120),
    courier_phone VARCHAR(30),
    CHECK (delivered_at IS NULL OR dispatched_at IS NOT NULL)
);

CREATE TABLE order_status_history (
    history_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
    old_status VARCHAR(30),
    new_status VARCHAR(30) NOT NULL
        CHECK (new_status IN ('Pending','Preparing','Out for Delivery','Delivered','Cancelled')),
    changed_by BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    note TEXT
);

CREATE TABLE user_sessions (
    sid VARCHAR NOT NULL PRIMARY KEY,
    sess JSON NOT NULL,
    expire TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_user_sessions_expire ON user_sessions(expire);

CREATE INDEX idx_menu_category_available ON menu_items(category_id, availability_status) WHERE is_archived = FALSE;
CREATE INDEX idx_orders_status_time ON orders(order_status, order_timestamp);
CREATE INDEX idx_orders_user_time ON orders(user_id, order_timestamp DESC);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_cart_items_cart ON cart_items(cart_id);
CREATE INDEX idx_delivery_zone ON delivery_info(zone_id);
CREATE INDEX idx_order_history_order_time ON order_status_history(order_id, changed_at);

COMMIT;
