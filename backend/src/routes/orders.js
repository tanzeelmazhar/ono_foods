import { Router } from "express";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { pool, withTransaction } from "../db.js";
import { HttpError } from "../middleware/errors.js";
import { guestCartToken } from "../middleware/security.js";
import { calculateSubtotal, centsToMoney, normalizeCustomization, moneyToCents } from "../services/pricing.js";
import { assertTransition } from "../services/order-status.js";
import { isStoreOpen } from "../services/store-hours.js";
import { validateReview } from "../services/reviews.js";

export const orderRouter = Router();

function positiveId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(404, "ORDER_NOT_FOUND", "That order was not found.");
  return id;
}

function text(value, field, max) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new HttpError(400, "VALIDATION_FAILED", "Check the highlighted fields.", { [field]: "Required" });
  }
  return value.trim();
}

function sha(value) {
  return createHash("sha256").update(value).digest("hex");
}

function trackingToken(orderId, secret) {
  return createHmac("sha256", secret).update("ONO-ORDER-" + orderId).digest("base64url");
}

function tokenMatches(raw, storedHash) {
  if (!raw || !storedHash) return false;
  const received = Buffer.from(sha(raw));
  const expected = Buffer.from(storedHash);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function setTrackingCookie(req, res, orderId, token) {
  const config = req.app.locals.config;
  res.cookie("ono_track_" + orderId, token, {
    httpOnly: true, secure: config.cookieSecure, sameSite: config.cookieSameSite,
    maxAge: 30 * 24 * 60 * 60 * 1000, path: "/api/v1/orders/" + orderId
  });
}

async function findExistingOrder(key) {
  const result = await pool.query("SELECT order_id,order_status,payment_type,subtotal_amount,delivery_fee,total_amount,order_timestamp FROM orders WHERE idempotency_key=$1", [key]);
  return result.rows[0] || null;
}

orderRouter.post("/checkout", guestCartToken, async (req, res) => {
  const config = req.app.locals.config;
  const idempotencyKey = req.get("idempotency-key") || "";
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) {
    throw new HttpError(400, "IDEMPOTENCY_KEY_REQUIRED", "Please retry checkout.");
  }
  const oldOrder = await findExistingOrder(idempotencyKey);
  if (oldOrder) {
    if (!req.session.user) setTrackingCookie(req, res, oldOrder.order_id, trackingToken(oldOrder.order_id, config.trackingSecret));
    return res.status(201).json({ order: oldOrder, reused: true });
  }

  const customerName = text(req.body.customer_name, "customer_name", 120);
  const phone = text(req.body.customer_phone, "customer_phone", 30);
  if (!/^[0-9+()\-\s]{7,30}$/.test(phone)) {
    throw new HttpError(400, "VALIDATION_FAILED", "Enter a valid phone number.", { customer_phone: "Invalid phone number" });
  }
  const address = text(req.body.delivery_address, "delivery_address", 1000);
  const instructions = typeof req.body.delivery_instructions === "string" ? req.body.delivery_instructions.trim().slice(0, 500) : null;
  const zoneId = Number(req.body.delivery_zone_id);
  if (!Number.isSafeInteger(zoneId) || zoneId < 1) throw new HttpError(400, "INVALID_ZONE", "Choose a delivery zone.");
  if ((req.body.payment_type || "COD") !== "COD") throw new HttpError(400, "PAYMENT_NOT_SUPPORTED", "Cash on Delivery is the only available payment method.");
  if (!isStoreOpen(new Date(), config.storeTimezone, config.storeOpenTime, config.storeCloseTime)) {
    throw new HttpError(400, "STORE_CLOSED", "Checkout is closed right now. The menu is still available to browse.");
  }

  let resultOrder;
  try {
    resultOrder = await withTransaction(async (client) => {
      const store = await client.query("SELECT accepting_orders FROM store_settings WHERE setting_id=1 FOR SHARE");
      if (!store.rows[0] || !store.rows[0].accepting_orders) {
        throw new HttpError(400, "STORE_PAUSED", "ONO Food is not accepting new orders right now.");
      }
      const cartResult = await client.query(
        "SELECT cart_id FROM carts WHERE session_token_hash=$1 AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP) FOR UPDATE",
        [sha(req.cartToken)]
      );
      if (!cartResult.rowCount) throw new HttpError(400, "CART_EXPIRED", "Your cart expired. Refresh and add the items again.");
      const cartId = cartResult.rows[0].cart_id;
      const lineResult = await client.query(
        "SELECT ci.cart_item_id,ci.item_id,ci.quantity,ci.size_option,ci.selected_addons,mi.item_name,mi.base_price,mi.sizes,mi.addons_config,mi.availability_status,mi.is_archived FROM cart_items ci JOIN menu_items mi ON mi.item_id=ci.item_id JOIN categories c ON c.category_id=mi.category_id WHERE ci.cart_id=$1 AND c.is_active=TRUE FOR UPDATE OF ci,mi,c",
        [cartId]
      );
      if (!lineResult.rowCount) throw new HttpError(400, "EMPTY_CART", "Add an available item before checkout.");
      if (lineResult.rows.some((line) => !line.availability_status || line.is_archived)) {
        throw new HttpError(409, "ITEM_UNAVAILABLE", "An item in your cart is no longer available.");
      }
      const lines = lineResult.rows.map((line) => ({ ...line, ...normalizeCustomization(line, line.size_option, line.selected_addons) }));
      const subtotalCents = calculateSubtotal(lines);
      if (subtotalCents < config.minimumSubtotalCents) {
        throw new HttpError(400, "MINIMUM_SUBTOTAL_NOT_MET", "The food subtotal must be at least PKR " + centsToMoney(config.minimumSubtotalCents) + ".");
      }
      const zoneResult = await client.query("SELECT zone_id,delivery_fee FROM delivery_zones WHERE zone_id=$1 AND is_active=TRUE FOR SHARE", [zoneId]);
      if (!zoneResult.rowCount) throw new HttpError(400, "INVALID_ZONE", "Choose an active delivery zone.");
      const feeCents = moneyToCents(zoneResult.rows[0].delivery_fee);
      const totalCents = subtotalCents + feeCents;
      const inserted = await client.query(
        "INSERT INTO orders (user_id,total_amount,order_status,payment_type,subtotal_amount,delivery_fee,customer_name,customer_phone,idempotency_key) VALUES ($1,$2,'Pending','COD',$3,$4,$5,$6,$7) ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING order_id,order_status,payment_type,subtotal_amount,delivery_fee,total_amount,order_timestamp",
        [req.session.user?.id || null, centsToMoney(totalCents), centsToMoney(subtotalCents), centsToMoney(feeCents), customerName, phone, idempotencyKey]
      );
      if (!inserted.rowCount) {
        const existing = await client.query("SELECT order_id,order_status,payment_type,subtotal_amount,delivery_fee,total_amount,order_timestamp FROM orders WHERE idempotency_key=$1", [idempotencyKey]);
        return { reused: true, order: existing.rows[0], trackingToken: trackingToken(existing.rows[0].order_id, config.trackingSecret) };
      }
      const created = inserted.rows[0];
      const accessToken = trackingToken(created.order_id, config.trackingSecret);
      await client.query("UPDATE orders SET tracking_token_hash=$2 WHERE order_id=$1", [created.order_id, sha(accessToken)]);
      await client.query("INSERT INTO delivery_info (order_id,zone_id,delivery_address,delivery_instructions,fee_snapshot) VALUES ($1,$2,$3,$4,$5)",
        [created.order_id, zoneId, address, instructions, centsToMoney(feeCents)]);
      for (const line of lines) {
        const lineSubtotal = line.quantity * (line.unitPriceCents + line.addonTotalCents);
        await client.query("INSERT INTO order_items (order_id,item_id,item_name_snapshot,unit_price_snapshot,quantity,size_option,selected_addons,addon_total,subtotal) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [created.order_id, line.item_id, line.item_name, centsToMoney(line.unitPriceCents), line.quantity,
            line.sizeOption, JSON.stringify(line.selectedAddons), centsToMoney(line.addonTotalCents), centsToMoney(lineSubtotal)]);
      }
      await client.query("INSERT INTO order_status_history (order_id,old_status,new_status) VALUES ($1,NULL,'Pending')", [created.order_id]);
      await client.query("DELETE FROM cart_items WHERE cart_id=$1", [cartId]);
      await client.query("UPDATE carts SET updated_at=CURRENT_TIMESTAMP WHERE cart_id=$1", [cartId]);
      return { reused: false, order: created, trackingToken: accessToken };
    });
  } catch (error) {
    if (error.code === "23505") {
      const raced = await findExistingOrder(idempotencyKey);
      if (raced) resultOrder = { reused: true, order: raced, trackingToken: trackingToken(raced.order_id, config.trackingSecret) };
      else throw error;
    } else throw error;
  }
  if (!req.session.user) setTrackingCookie(req, res, resultOrder.order.order_id, resultOrder.trackingToken);
  res.status(201).json({ order: resultOrder.order, reused: resultOrder.reused });
});

async function orderAccess(req, order) {
  if (req.session.user?.role === "admin") return true;
  if (req.session.user && String(req.session.user.id) === String(order.user_id)) return true;
  return tokenMatches(req.cookies?.["ono_track_" + order.order_id], order.tracking_token_hash);
}

orderRouter.get("/orders/:id", async (req, res) => {
  const orderId = positiveId(req.params.id);
  const found = await pool.query("SELECT order_id,user_id,order_timestamp,order_status,payment_type,subtotal_amount,delivery_fee,total_amount,tracking_token_hash FROM orders WHERE order_id=$1", [orderId]);
  const order = found.rows[0];
  if (!order || !(await orderAccess(req, order))) throw new HttpError(404, "ORDER_NOT_FOUND", "That order was not found.");
  const [items, history] = await Promise.all([
    pool.query(`SELECT oi.order_item_id,oi.item_id,oi.item_name_snapshot,oi.unit_price_snapshot,oi.quantity,
        oi.size_option,oi.selected_addons,oi.addon_total,oi.subtotal,
        pr.rating AS review_rating,pr.review_text,pr.created_at AS review_created_at
      FROM order_items oi LEFT JOIN product_reviews pr ON pr.order_item_id=oi.order_item_id
      WHERE oi.order_id=$1 ORDER BY oi.order_item_id`, [orderId]),
    pool.query("SELECT old_status,new_status,changed_at FROM order_status_history WHERE order_id=$1 ORDER BY changed_at", [orderId])
  ]);
  res.json({ order: {
    order_id: order.order_id, order_timestamp: order.order_timestamp, order_status: order.order_status,
    payment_type: order.payment_type, subtotal_amount: order.subtotal_amount,
    delivery_fee: order.delivery_fee, total_amount: order.total_amount,
    items: items.rows, status_history: history.rows
  } });
});

orderRouter.post("/orders/:id/reviews", async (req, res) => {
  const orderId = positiveId(req.params.id);
  if (req.session.user?.role === "admin") throw new HttpError(403, "CUSTOMER_REVIEW_ONLY", "Reviews can only be submitted by the customer who placed the order.");
  const orderItemId = Number(req.body.order_item_id);
  if (!Number.isSafeInteger(orderItemId) || orderItemId < 1) throw new HttpError(400, "INVALID_ORDER_ITEM", "Choose an item from this order.");
  const { rating, reviewText } = validateReview(req.body.rating, req.body.review_text);

  try {
    const review = await withTransaction(async (client) => {
      const found = await client.query(`SELECT order_id,user_id,customer_name,order_status,tracking_token_hash
        FROM orders WHERE order_id=$1 FOR UPDATE`, [orderId]);
      const order = found.rows[0];
      if (!order || !(await orderAccess(req, order))) throw new HttpError(404, "ORDER_NOT_FOUND", "That order was not found.");
      if (order.order_status !== "Delivered") throw new HttpError(409, "ORDER_NOT_DELIVERED", "You can review this food after the order is delivered.");
      const line = await client.query("SELECT order_item_id FROM order_items WHERE order_item_id=$1 AND order_id=$2", [orderItemId, orderId]);
      if (!line.rowCount) throw new HttpError(404, "ORDER_ITEM_NOT_FOUND", "That item is not part of this order.");
      const inserted = await client.query(`INSERT INTO product_reviews
        (order_id,order_item_id,reviewer_user_id,reviewer_name,rating,review_text)
        VALUES ($1,$2,$3,$4,$5,$6)
        RETURNING review_id,rating,review_text,created_at`,
      [orderId, orderItemId, order.user_id, order.customer_name, rating, reviewText]);
      return inserted.rows[0];
    });
    res.status(201).json({ review });
  } catch (error) {
    if (error.code === "23505") throw new HttpError(409, "REVIEW_ALREADY_EXISTS", "This order item has already been reviewed.");
    throw error;
  }
});

orderRouter.post("/orders/:id/cancel", async (req, res) => {
  const orderId = positiveId(req.params.id);
  const status = await withTransaction(async (client) => {
    const found = await client.query("SELECT order_id,user_id,order_status,tracking_token_hash FROM orders WHERE order_id=$1 FOR UPDATE", [orderId]);
    const order = found.rows[0];
    if (!order || !(await orderAccess(req, order))) throw new HttpError(404, "ORDER_NOT_FOUND", "That order was not found.");
    assertTransition(order.order_status, "Cancelled");
    const updated = await client.query("UPDATE orders SET order_status='Cancelled',updated_at=CURRENT_TIMESTAMP WHERE order_id=$1 AND order_status='Pending' RETURNING order_status", [orderId]);
    if (!updated.rowCount) throw new HttpError(409, "ORDER_STATE_CONFLICT", "This order has already started and cannot be cancelled.");
    await client.query("INSERT INTO order_status_history (order_id,old_status,new_status,changed_by,note) VALUES ($1,'Pending','Cancelled',$2,'Customer cancellation request')",
      [orderId, req.session.user?.id || null]);
    return updated.rows[0].order_status;
  });
  res.json({ order_id: orderId, order_status: status });
});
