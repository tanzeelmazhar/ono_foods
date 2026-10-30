import { Router } from "express";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";
import { HttpError } from "../middleware/errors.js";
import { guestCartToken, requireUser } from "../middleware/security.js";
import { centsToMoney, normalizeCustomization } from "../services/pricing.js";
import { isStoreOpen } from "../services/store-hours.js";

export const customerRouter = Router();

function positiveId(value, field = "id") {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new HttpError(400, "INVALID_ID", "Enter a valid " + field + ".");
  return number;
}

function requiredText(value, field, max) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new HttpError(400, "VALIDATION_FAILED", "Check the highlighted fields.", { [field]: "Required" });
  }
  return value.trim();
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

async function cartFor(token, userId = null) {
  const result = await pool.query(`INSERT INTO carts (session_token_hash, user_id, expires_at)
     VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '30 days')
     ON CONFLICT (session_token_hash) DO UPDATE SET
       user_id=COALESCE(EXCLUDED.user_id, carts.user_id),
       expires_at=CURRENT_TIMESTAMP + INTERVAL '30 days',
       updated_at=CURRENT_TIMESTAMP
     RETURNING cart_id`, [tokenHash(token), userId]);
  return result.rows[0].cart_id;
}

async function cartView(cartId) {
  const { rows } = await pool.query(`SELECT ci.cart_item_id, ci.item_id, ci.quantity, ci.size_option,
            ci.selected_addons, mi.item_name, mi.description, mi.base_price,
            mi.image_url, mi.sizes, mi.addons_config, mi.availability_status,
            mi.is_archived, c.is_active AS category_active, c.category_name
       FROM cart_items ci
       JOIN menu_items mi ON mi.item_id=ci.item_id
       JOIN categories c ON c.category_id=mi.category_id
      WHERE ci.cart_id=$1 ORDER BY ci.added_at, ci.cart_item_id`, [cartId]);
  let subtotalCents = 0;
  const items = rows.map((row) => {
    try {
      const custom = normalizeCustomization(row, row.size_option, row.selected_addons);
      const lineCents = row.quantity * (custom.unitPriceCents + custom.addonTotalCents);
      const available = Boolean(row.availability_status && !row.is_archived && row.category_active);
      if (available) subtotalCents += lineCents;
      return {
        cart_item_id: row.cart_item_id, item_id: row.item_id, item_name: row.item_name,
        category_name: row.category_name, description: row.description, image_url: row.image_url,
        quantity: row.quantity, size_option: custom.sizeOption, selected_addons: custom.selectedAddons,
        unit_price: centsToMoney(custom.unitPriceCents), addon_total: centsToMoney(custom.addonTotalCents),
        line_subtotal: centsToMoney(lineCents), available
      };
    } catch {
      return { cart_item_id: row.cart_item_id, item_id: row.item_id, item_name: row.item_name,
        quantity: row.quantity, size_option: row.size_option, selected_addons: [],
        line_subtotal: "0.00", available: false };
    }
  });
  return {
    items, subtotal_amount: centsToMoney(subtotalCents),
    item_count: items.reduce((sum, item) => sum + item.quantity, 0)
  };
}

async function currentItem(itemId) {
  const { rows } = await pool.query(`SELECT mi.*, c.is_active AS category_active
       FROM menu_items mi JOIN categories c ON c.category_id=mi.category_id WHERE mi.item_id=$1`, [itemId]);
  const item = rows[0];
  if (!item || item.is_archived || !item.availability_status || !item.category_active) {
    throw new HttpError(409, "ITEM_UNAVAILABLE", "This item is no longer available.");
  }
  return item;
}

function validateQuantity(value) {
  const quantity = Number(value);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    throw new HttpError(400, "INVALID_QUANTITY", "Quantity must be between 1 and 99.", { quantity: "Use 1 to 99" });
  }
  return quantity;
}

customerRouter.get("/config", async (req, res) => {
  const config = req.app.locals.config;
  const { rows } = await pool.query("SELECT accepting_orders FROM store_settings WHERE setting_id=1");
  const acceptingOrders = rows[0]?.accepting_orders ?? true;
  const withinHours = isStoreOpen(new Date(), config.storeTimezone, config.storeOpenTime, config.storeCloseTime);
  res.json({
    currency: "PKR", minimum_subtotal: centsToMoney(config.minimumSubtotalCents),
    store_timezone: config.storeTimezone, opens_at: config.storeOpenTime,
    closes_at: config.storeCloseTime,
    accepting_orders: acceptingOrders,
    is_open: acceptingOrders && withinHours,
    payment_type: "COD"
  });
});

customerRouter.get("/security/csrf", (req, res) => {
  if (!req.session.csrfToken) req.session.csrfToken = randomBytes(32).toString("base64url");
  res.json({ csrf_token: req.session.csrfToken });
});

customerRouter.get("/categories", async (_req, res) => {
  const { rows } = await pool.query(`SELECT c.category_id, c.category_name, c.description
      FROM categories c
     WHERE c.is_active=TRUE
       AND EXISTS (SELECT 1 FROM menu_items mi WHERE mi.category_id=c.category_id AND mi.is_archived=FALSE)
     ORDER BY c.display_order, c.category_name`);
  res.json({ categories: rows });
});

customerRouter.get("/menu-items", async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page || "1", 10));
  const limit = Math.min(48, Math.max(1, Number.parseInt(req.query.limit || "24", 10)));
  const categoryId = req.query.category_id ? positiveId(req.query.category_id, "category") : null;
  const search = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
  const availableOnly = req.query.available === "true";
  const { rows } = await pool.query(`SELECT mi.item_id, mi.category_id, c.category_name, mi.item_name,
            mi.description, mi.base_price, mi.availability_status, mi.image_url, mi.sizes, mi.addons_config,
            COALESCE(reviews.review_count, 0)::int AS review_count,
            reviews.average_rating
       FROM menu_items mi JOIN categories c ON c.category_id=mi.category_id
       LEFT JOIN (
         SELECT oi.item_id, COUNT(pr.review_id)::int AS review_count, ROUND(AVG(pr.rating), 1) AS average_rating
           FROM product_reviews pr JOIN order_items oi ON oi.order_item_id=pr.order_item_id
          WHERE oi.item_id IS NOT NULL GROUP BY oi.item_id
       ) reviews ON reviews.item_id=mi.item_id
      WHERE mi.is_archived=FALSE AND c.is_active=TRUE
        AND ($1::bigint IS NULL OR mi.category_id=$1)
        AND ($2::text='' OR mi.item_name ILIKE '%' || $2 || '%' OR COALESCE(mi.description,'') ILIKE '%' || $2 || '%')
        AND (NOT $3::boolean OR mi.availability_status=TRUE)
      ORDER BY c.display_order, mi.item_name LIMIT $4 OFFSET $5`,
    [categoryId, search, availableOnly, limit, (page - 1) * limit]);
  res.json({ items: rows, page, limit });
});

customerRouter.get("/menu-items/:id/reviews", async (req, res) => {
  const itemId = positiveId(req.params.id, "menu item");
  const requestedLimit = Number.parseInt(req.query.limit || "20", 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(50, Math.max(1, requestedLimit)) : 20;
  const item = await pool.query("SELECT 1 FROM menu_items WHERE item_id=$1 AND is_archived=FALSE", [itemId]);
  if (!item.rowCount) throw new HttpError(404, "MENU_ITEM_NOT_FOUND", "That menu item was not found.");
  const { rows } = await pool.query(`SELECT split_part(pr.reviewer_name, ' ', 1) AS reviewer_name,
      pr.rating, pr.review_text, pr.created_at
    FROM product_reviews pr JOIN order_items oi ON oi.order_item_id=pr.order_item_id
    WHERE oi.item_id=$1 ORDER BY pr.created_at DESC LIMIT $2`, [itemId, limit]);
  const summary = await pool.query(`SELECT COUNT(*)::int AS review_count, ROUND(AVG(pr.rating), 1) AS average_rating
    FROM product_reviews pr JOIN order_items oi ON oi.order_item_id=pr.order_item_id WHERE oi.item_id=$1`, [itemId]);
  res.json({ reviews: rows, ...summary.rows[0] });
});

customerRouter.get("/auth/me", (req, res) => res.json({ user: req.session.user || null }));

customerRouter.post("/auth/register", async (req, res) => {
  const name = requiredText(req.body.full_name, "full_name", 120);
  const phone = requiredText(req.body.phone_number, "phone_number", 30);
  const email = requiredText(req.body.email, "email", 254).toLowerCase();
  const password = req.body.password;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, "VALIDATION_FAILED", "Enter a valid email address.", { email: "Invalid email" });
  }
  if (typeof password !== "string" || password.length < 12 || password.length > 200) {
    throw new HttpError(400, "VALIDATION_FAILED", "Use a password of at least 12 characters.", { password: "At least 12 characters" });
  }
  const passwordHash = await bcrypt.hash(password, 12);
  let user;
  try {
    const result = await pool.query(`INSERT INTO users (full_name, phone_number, email, password_hash)
       VALUES ($1,$2,$3,$4) RETURNING user_id, full_name, phone_number, email, role`,
      [name, phone, email, passwordHash]);
    user = result.rows[0];
  } catch (error) {
    if (error.code === "23505") throw new HttpError(409, "EMAIL_IN_USE", "An account already uses that email.", { email: "Already registered" });
    throw error;
  }
  await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
  req.session.user = { id: user.user_id, full_name: user.full_name, role: user.role };
  req.session.csrfToken = randomBytes(32).toString("base64url");
  res.status(201).json({ user });
});

customerRouter.post("/auth/login", async (req, res) => {
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const { rows } = await pool.query("SELECT user_id, full_name, phone_number, email, password_hash, role, is_active FROM users WHERE email=$1", [email]);
  const user = rows[0];
  const valid = user?.password_hash ? await bcrypt.compare(password, user.password_hash) : false;
  if (!valid || !user.is_active) throw new HttpError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
  await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
  req.session.user = { id: user.user_id, full_name: user.full_name, role: user.role };
  req.session.csrfToken = randomBytes(32).toString("base64url");
  res.json({ user: { user_id: user.user_id, full_name: user.full_name, phone_number: user.phone_number, email: user.email, role: user.role } });
});

customerRouter.post("/auth/logout", (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie("ono.sid", { path: "/" });
    res.json({ signed_out: true });
  });
});

customerRouter.get("/account/profile", requireUser, async (req, res) => {
  const { rows } = await pool.query(`SELECT u.user_id, u.full_name, u.phone_number, u.email, u.default_address,
            u.default_zone_id, z.zone_name
       FROM users u LEFT JOIN delivery_zones z ON z.zone_id=u.default_zone_id WHERE u.user_id=$1`,
    [req.session.user.id]);
  res.json({ profile: rows[0] });
});

customerRouter.patch("/account/profile", requireUser, async (req, res) => {
  const name = requiredText(req.body.full_name, "full_name", 120);
  const phone = requiredText(req.body.phone_number, "phone_number", 30);
  const address = typeof req.body.default_address === "string" ? req.body.default_address.trim().slice(0, 1000) : null;
  const zoneId = req.body.default_zone_id ? positiveId(req.body.default_zone_id, "delivery zone") : null;
  if (zoneId) {
    const zone = await pool.query("SELECT 1 FROM delivery_zones WHERE zone_id=$1 AND is_active=TRUE", [zoneId]);
    if (!zone.rowCount) throw new HttpError(400, "INVALID_ZONE", "Choose an active delivery zone.");
  }
  const { rows } = await pool.query(`UPDATE users SET full_name=$2, phone_number=$3, default_address=$4,
            default_zone_id=$5 WHERE user_id=$1
     RETURNING user_id, full_name, phone_number, email, default_address, default_zone_id`,
    [req.session.user.id, name, phone, address, zoneId]);
  req.session.user.full_name = rows[0].full_name;
  res.json({ profile: rows[0] });
});

customerRouter.get("/delivery-zones", async (_req, res) => {
  const { rows } = await pool.query("SELECT zone_id, zone_name, delivery_fee, coverage_notes FROM delivery_zones WHERE is_active=TRUE ORDER BY zone_name");
  res.json({ zones: rows });
});

customerRouter.get("/cart", guestCartToken, async (req, res) => {
  const cartId = await cartFor(req.cartToken, req.session.user?.id || null);
  res.json({ cart: await cartView(cartId) });
});

customerRouter.post("/cart/items", guestCartToken, async (req, res) => {
  const itemId = positiveId(req.body.item_id, "menu item");
  const quantity = validateQuantity(req.body.quantity ?? 1);
  const item = await currentItem(itemId);
  const custom = normalizeCustomization(item, req.body.size_option || null, req.body.addons || []);
  const cartId = await cartFor(req.cartToken, req.session.user?.id || null);
  await pool.query("INSERT INTO cart_items (cart_id,item_id,quantity,size_option,selected_addons) VALUES ($1,$2,$3,$4,$5)",
    [cartId, itemId, quantity, req.body.size_option || null, JSON.stringify(custom.selectedAddons.map((addon) => addon.id))]);
  res.status(201).json({ cart: await cartView(cartId) });
});

customerRouter.patch("/cart/items/:id", guestCartToken, async (req, res) => {
  const lineId = positiveId(req.params.id, "cart line");
  const cartId = await cartFor(req.cartToken, req.session.user?.id || null);
  const { rows } = await pool.query("SELECT ci.*, mi.* FROM cart_items ci JOIN menu_items mi ON mi.item_id=ci.item_id WHERE ci.cart_item_id=$1 AND ci.cart_id=$2", [lineId, cartId]);
  const line = rows[0];
  if (!line) throw new HttpError(404, "CART_LINE_NOT_FOUND", "That cart item was not found.");
  const quantity = req.body.quantity === undefined ? line.quantity : validateQuantity(req.body.quantity);
  const size = req.body.size_option === undefined ? line.size_option : req.body.size_option || null;
  const addons = req.body.addons === undefined ? line.selected_addons : req.body.addons;
  const custom = normalizeCustomization(line, size, addons);
  await pool.query("UPDATE cart_items SET quantity=$3,size_option=$4,selected_addons=$5 WHERE cart_item_id=$1 AND cart_id=$2",
    [lineId, cartId, quantity, size, JSON.stringify(custom.selectedAddons.map((addon) => addon.id))]);
  res.json({ cart: await cartView(cartId) });
});

customerRouter.delete("/cart/items/:id", guestCartToken, async (req, res) => {
  const cartId = await cartFor(req.cartToken, req.session.user?.id || null);
  await pool.query("DELETE FROM cart_items WHERE cart_item_id=$1 AND cart_id=$2", [positiveId(req.params.id, "cart line"), cartId]);
  res.json({ cart: await cartView(cartId) });
});

customerRouter.get("/account/orders", requireUser, async (req, res) => {
  const { rows } = await pool.query(`SELECT order_id, order_timestamp, order_status, payment_type,
            subtotal_amount, delivery_fee, total_amount
       FROM orders WHERE user_id=$1 ORDER BY order_timestamp DESC LIMIT 100`, [req.session.user.id]);
  res.json({ orders: rows });
});
