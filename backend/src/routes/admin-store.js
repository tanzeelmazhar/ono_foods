import { Router } from "express";
import { pool } from "../db.js";
import { HttpError } from "../middleware/errors.js";

export const adminStoreRouter = Router();

adminStoreRouter.get("/store-status", async (_req, res) => {
  const { rows } = await pool.query("SELECT accepting_orders, updated_at FROM store_settings WHERE setting_id=1");
  if (!rows[0]) throw new HttpError(503, "STORE_STATUS_UNAVAILABLE", "Store settings are not available yet.");
  res.json(rows[0]);
});

adminStoreRouter.patch("/store-status", async (req, res) => {
  if (typeof req.body.accepting_orders !== "boolean") {
    throw new HttpError(400, "VALIDATION_FAILED", "Choose whether the store is accepting orders.", { accepting_orders: "Choose open or paused" });
  }
  const { rows } = await pool.query(`INSERT INTO store_settings (setting_id, accepting_orders, updated_by)
    VALUES (1, $1, $2)
    ON CONFLICT (setting_id) DO UPDATE SET accepting_orders=EXCLUDED.accepting_orders,
      updated_by=EXCLUDED.updated_by, updated_at=CURRENT_TIMESTAMP
    RETURNING accepting_orders, updated_at`, [req.body.accepting_orders, req.session.user.id]);
  res.json(rows[0]);
});
