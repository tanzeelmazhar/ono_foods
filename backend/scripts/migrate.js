import "dotenv/config";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db.js";

const migrations = [
  { version: "001_initial", path: fileURLToPath(new URL("../migrations/001_initial.sql", import.meta.url)) },
  { version: "002_reviews_store_settings", path: fileURLToPath(new URL("../migrations/002_reviews_store_settings.sql", import.meta.url)) },
  { version: "003_catalog_backup_compatibility", path: fileURLToPath(new URL("../migrations/003_catalog_backup_compatibility.sql", import.meta.url)) }
];

const requiredTables = [
  "users", "categories", "delivery_zones", "menu_items", "carts", "cart_items",
  "orders", "order_items", "delivery_info", "order_status_history"
];

const requiredColumns = {
  users: ["user_id", "full_name", "phone_number", "email", "password_hash", "role", "created_at", "is_active"],
  categories: ["category_id", "category_name"],
  delivery_zones: ["zone_id", "zone_name", "delivery_fee", "is_active"],
  menu_items: ["item_id", "category_id", "item_name", "description", "base_price", "availability_status", "image_url", "created_by", "created_at", "updated_at", "is_archived"],
  carts: ["cart_id", "session_token_hash", "user_id", "created_at", "updated_at", "expires_at"],
  cart_items: ["cart_item_id", "cart_id", "item_id", "quantity", "size_option", "selected_addons", "added_at"],
  orders: ["order_id", "user_id", "order_timestamp", "total_amount", "order_status", "payment_type", "subtotal_amount", "delivery_fee", "customer_name", "customer_phone", "last_updated_by", "updated_at"],
  order_items: ["order_item_id", "order_id", "item_id", "item_name_snapshot", "unit_price_snapshot", "quantity", "size_option", "selected_addons", "addon_total", "subtotal"],
  delivery_info: ["delivery_info_id", "order_id", "zone_id", "delivery_address", "delivery_instructions", "fee_snapshot", "dispatched_at", "delivered_at", "courier_name", "courier_phone"],
  order_status_history: ["history_id", "order_id", "old_status", "new_status", "changed_by", "changed_at", "note"]
};

async function inspectExistingSchema(client) {
  const tables = await client.query(`SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_type='BASE TABLE'`);
  const names = new Set(tables.rows.map((row) => row.table_name));
  if (!names.size) return false;
  if (!names.has("users")) throw new Error("This database already has tables but no ONO users table; no migration was applied.");
  const missingTables = requiredTables.filter((table) => !names.has(table));
  if (missingTables.length) {
    throw new Error("Existing ONO database is missing required tables (" + missingTables.join(", ") + "); no migration was applied.");
  }

  const columns = await client.query(`SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name = ANY($1::text[])`, [Object.keys(requiredColumns)]);
  const actual = new Map();
  for (const row of columns.rows) {
    if (!actual.has(row.table_name)) actual.set(row.table_name, new Set());
    actual.get(row.table_name).add(row.column_name);
  }
  const missing = Object.entries(requiredColumns).flatMap(([table, required]) =>
    required.filter((column) => !actual.get(table)?.has(column)).map((column) => `${table}.${column}`));
  if (missing.length) {
    throw new Error("Existing ONO database is missing required base columns (" + missing.join(", ") + "); no migration was applied.");
  }
  return true;
}

const client = await pool.connect();
try {
  await client.query("SELECT pg_advisory_lock(hashtext('ono-food-schema-migrations'))");
  const initialized = await inspectExistingSchema(client);
  await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
    version VARCHAR(120) PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  const applied = new Set((await client.query("SELECT version FROM schema_migrations")).rows.map((row) => row.version));
  if (initialized && !applied.has(migrations[0].version)) {
    await client.query("INSERT INTO schema_migrations(version) VALUES ($1) ON CONFLICT DO NOTHING", [migrations[0].version]);
    applied.add(migrations[0].version);
  }

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    await client.query(await readFile(migration.path, "utf8"));
    await client.query("INSERT INTO schema_migrations(version) VALUES ($1)", [migration.version]);
    console.log(`Applied ${migration.version}.`);
  }
  console.log("Database migrations are up to date.");
} catch (error) {
  console.error("Migration failed:", error.message);
  process.exitCode = 1;
} finally {
  await client.query("SELECT pg_advisory_unlock(hashtext('ono-food-schema-migrations'))").catch(() => {});
  client.release();
  await pool.end();
}
