import { Router } from "express";
import { pool, withTransaction } from "../db.js";
import { HttpError } from "../middleware/errors.js";
import { assertTransition } from "../services/order-status.js";

export const adminOrdersRouter = Router();
const states = new Set(["Pending", "Preparing", "Out for Delivery", "Delivered", "Cancelled"]);

function orderId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(404, "ORDER_NOT_FOUND", "That order was not found.");
  return id;
}

function dateValue(value, fallback) {
  const date = value || fallback;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new HttpError(400, "INVALID_DATE", "Use a date in YYYY-MM-DD format.");
  }
  const parsed = new Date(date + "T00:00:00Z");
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new HttpError(400, "INVALID_DATE", "Choose a valid calendar date.");
  }
  return date;
}

adminOrdersRouter.get("/summary", async (_req, res) => {
  const { rows } = await pool.query(
    "SELECT order_status,COUNT(*)::int AS count FROM orders GROUP BY order_status"
  );
  res.json({ counts: Object.fromEntries(rows.map((row) => [row.order_status, row.count])) });
});

adminOrdersRouter.get("/sales", async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
  const from = dateValue(req.query.from, thirtyDaysAgo);
  const to = dateValue(req.query.to, today);
  if (from > to) throw new HttpError(400, "INVALID_DATE_RANGE", "The start date must be on or before the end date.");
  const { rows } = await pool.query(
    "SELECT (order_timestamp AT TIME ZONE $3)::date::text AS sales_date,COUNT(*)::int AS orders,SUM(total_amount)::numeric(12,2)::text AS delivered_order_value FROM orders WHERE order_status='Delivered' AND (order_timestamp AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date GROUP BY sales_date ORDER BY sales_date",
    [from, to, req.app.locals.config.storeTimezone]
  );
  const totals = rows.reduce((sum, row) => ({
    orders: sum.orders + row.orders,
    value: sum.value + Number(row.delivered_order_value)
  }), { orders: 0, value: 0 });
  res.json({
    from, to, currency: "PKR", days: rows,
    totals: { delivered_orders: totals.orders, delivered_order_value: totals.value.toFixed(2) },
    basis: "Delivered order totals. COD collection is handled by the courier and is not verified by this system."
  });
});

adminOrdersRouter.get("/orders", async (req, res) => {
  const state = typeof req.query.status === "string" ? req.query.status : "";
  if (state && !states.has(state)) throw new HttpError(400, "INVALID_STATUS", "Choose a valid order status.");
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit || "50", 10)));
  const { rows } = await pool.query(
    "SELECT o.order_id,o.order_timestamp,o.order_status,o.payment_type,o.subtotal_amount,o.delivery_fee,o.total_amount,o.customer_name,o.customer_phone,z.zone_name FROM orders o LEFT JOIN delivery_info d ON d.order_id=o.order_id LEFT JOIN delivery_zones z ON z.zone_id=d.zone_id WHERE ($1::text='' OR o.order_status=$1) ORDER BY o.order_timestamp ASC LIMIT $2",
    [state, limit]
  );
  res.json({ orders: rows });
});

adminOrdersRouter.get("/orders/:id", async (req, res) => {
  const id = orderId(req.params.id);
  const found = await pool.query(
    "SELECT o.order_id,o.user_id,o.order_timestamp,o.order_status,o.payment_type,o.subtotal_amount,o.delivery_fee,o.total_amount,o.customer_name,o.customer_phone,d.delivery_address,d.delivery_instructions,d.fee_snapshot,d.dispatched_at,d.delivered_at,d.courier_name,d.courier_phone,z.zone_name FROM orders o JOIN delivery_info d ON d.order_id=o.order_id JOIN delivery_zones z ON z.zone_id=d.zone_id WHERE o.order_id=$1",
    [id]
  );
  if (!found.rowCount) throw new HttpError(404, "ORDER_NOT_FOUND", "That order was not found.");
  const [items, history] = await Promise.all([
    pool.query("SELECT item_name_snapshot,unit_price_snapshot,quantity,size_option,selected_addons,addon_total,subtotal FROM order_items WHERE order_id=$1 ORDER BY order_item_id", [id]),
    pool.query("SELECT old_status,new_status,changed_at,note,changed_by FROM order_status_history WHERE order_id=$1 ORDER BY changed_at", [id])
  ]);
  res.json({ order: { ...found.rows[0], items: items.rows, status_history: history.rows } });
});

adminOrdersRouter.patch("/orders/:id/status", async (req, res) => {
  const id = orderId(req.params.id);
  const next = req.body.order_status;
  if (!states.has(next)) throw new HttpError(400, "INVALID_STATUS", "Choose a valid order status.");
  const updated = await withTransaction(async (client) => {
    const found = await client.query("SELECT order_status FROM orders WHERE order_id=$1 FOR UPDATE", [id]);
    if (!found.rowCount) throw new HttpError(404, "ORDER_NOT_FOUND", "That order was not found.");
    const current = found.rows[0].order_status;
    assertTransition(current, next);
    const result = await client.query(
      "UPDATE orders SET order_status=$2,last_updated_by=$3,updated_at=CURRENT_TIMESTAMP WHERE order_id=$1 AND order_status=$4 RETURNING order_status",
      [id, next, req.session.user.id, current]
    );
    if (!result.rowCount) throw new HttpError(409, "ORDER_STATE_CONFLICT", "The order changed. Refresh and try again.");
    if (next === "Out for Delivery") {
      await client.query("UPDATE delivery_info SET dispatched_at=COALESCE(dispatched_at,CURRENT_TIMESTAMP) WHERE order_id=$1", [id]);
    }
    if (next === "Delivered") {
      await client.query("UPDATE delivery_info SET delivered_at=CURRENT_TIMESTAMP,dispatched_at=COALESCE(dispatched_at,CURRENT_TIMESTAMP) WHERE order_id=$1", [id]);
    }
    await client.query(
      "INSERT INTO order_status_history (order_id,old_status,new_status,changed_by) VALUES ($1,$2,$3,$4)",
      [id, current, next, req.session.user.id]
    );
    return result.rows[0].order_status;
  });
  res.json({ order_id: id, order_status: updated });
});
