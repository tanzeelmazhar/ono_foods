import { Router } from "express";
import { pool } from "../db.js";
import { HttpError } from "../middleware/errors.js";
import { centsToMoney, moneyToCents } from "../services/pricing.js";

export const adminCatalogRouter = Router();

function positiveId(value, label) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, "INVALID_ID", "Choose a valid " + label + ".");
  return id;
}

function requiredName(value, field, max) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new HttpError(400, "VALIDATION_FAILED", "Enter a valid " + field + ".", { [field]: "Required" });
  }
  return value.trim();
}

function amount(value, field) {
  try {
    const cents = moneyToCents(value);
    return centsToMoney(cents);
  } catch {
    throw new HttpError(400, "VALIDATION_FAILED", "Enter a valid non-negative " + field + ".", { [field]: "Use an amount with up to 2 decimals" });
  }
}

function optionList(value, type) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 20) throw new HttpError(400, "INVALID_CONFIGURATION", "Add up to 20 " + type + ".");
  const seen = new Set();
  return value.map((option) => {
    if (!option || typeof option !== "object" || !/^[A-Za-z0-9_-]{1,80}$/.test(option.id || "")) {
      throw new HttpError(400, "INVALID_CONFIGURATION", "Each " + type + " needs a stable ID.");
    }
    if (seen.has(option.id)) throw new HttpError(400, "INVALID_CONFIGURATION", "Option IDs must be unique.");
    seen.add(option.id);
    const name = requiredName(option.name, type, 80);
    const price = amount(option.price, "option price");
    if (type === "add-on" && option.required !== undefined && typeof option.required !== "boolean") {
      throw new HttpError(400, "INVALID_CONFIGURATION", "Required add-on values must be true or false.");
    }
    return type === "size"
      ? { id: option.id, name, price }
      : { id: option.id, name, price, required: Boolean(option.required) };
  });
}

function imageReference(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 2000) throw new HttpError(400, "INVALID_IMAGE_URL", "Enter a valid image URL.");
  if (/^\/images\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) && !value.split("/").includes("..")) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error();
    return url.href;
  } catch {
    throw new HttpError(400, "INVALID_IMAGE_URL", "Use an absolute HTTPS URL or a safe local /images/ path.");
  }
}

adminCatalogRouter.get("/categories", async (_req, res) => {
  const { rows } = await pool.query("SELECT category_id,category_name,description,display_order,is_active FROM categories ORDER BY display_order,category_name");
  res.json({ categories: rows });
});

adminCatalogRouter.post("/categories", async (req, res) => {
  const name = requiredName(req.body.category_name, "category_name", 80);
  const description = typeof req.body.description === "string" ? req.body.description.trim().slice(0, 1000) : null;
  const displayOrder = Number.isInteger(req.body.display_order) ? req.body.display_order : 0;
  try {
    const { rows } = await pool.query(
      "INSERT INTO categories (category_name,description,display_order) VALUES ($1,$2,$3) RETURNING category_id,category_name,description,display_order,is_active",
      [name, description, displayOrder]
    );
    res.status(201).json({ category: rows[0] });
  } catch (error) {
    if (error.code === "23505") throw new HttpError(409, "CATEGORY_EXISTS", "A category already uses that name.");
    throw error;
  }
});

adminCatalogRouter.patch("/categories/:id", async (req, res) => {
  const id = positiveId(req.params.id, "category");
  const current = await pool.query("SELECT * FROM categories WHERE category_id=$1", [id]);
  if (!current.rowCount) throw new HttpError(404, "CATEGORY_NOT_FOUND", "That category was not found.");
  const previous = current.rows[0];
  const name = req.body.category_name === undefined ? previous.category_name : requiredName(req.body.category_name, "category_name", 80);
  const description = req.body.description === undefined ? previous.description : String(req.body.description || "").trim().slice(0, 1000) || null;
  const displayOrder = req.body.display_order === undefined ? previous.display_order : Number(req.body.display_order);
  const active = req.body.is_active === undefined ? previous.is_active : req.body.is_active;
  if (!Number.isInteger(displayOrder) || typeof active !== "boolean") throw new HttpError(400, "VALIDATION_FAILED", "Check the category fields.");
  try {
    const { rows } = await pool.query(
      "UPDATE categories SET category_name=$2,description=$3,display_order=$4,is_active=$5 WHERE category_id=$1 RETURNING category_id,category_name,description,display_order,is_active",
      [id, name, description, displayOrder, active]
    );
    res.json({ category: rows[0] });
  } catch (error) {
    if (error.code === "23505") throw new HttpError(409, "CATEGORY_EXISTS", "A category already uses that name.");
    throw error;
  }
});

adminCatalogRouter.delete("/categories/:id", async (req, res) => {
  const id = positiveId(req.params.id, "category");
  const dependencies = await pool.query("SELECT 1 FROM menu_items WHERE category_id=$1 AND is_archived=FALSE LIMIT 1", [id]);
  if (dependencies.rowCount) throw new HttpError(409, "CATEGORY_IN_USE", "Archive or move the active menu items first.");
  const result = await pool.query("UPDATE categories SET is_active=FALSE WHERE category_id=$1 RETURNING category_id", [id]);
  if (!result.rowCount) throw new HttpError(404, "CATEGORY_NOT_FOUND", "That category was not found.");
  res.json({ category_id: id, is_active: false });
});

adminCatalogRouter.get("/menu-items", async (req, res) => {
  const includeArchived = req.query.include_archived === "true";
  const { rows } = await pool.query(
    "SELECT mi.*,c.category_name FROM menu_items mi JOIN categories c ON c.category_id=mi.category_id WHERE ($1::boolean OR mi.is_archived=FALSE) ORDER BY mi.created_at DESC,mi.item_name",
    [includeArchived]
  );
  res.json({ items: rows });
});

adminCatalogRouter.post("/menu-items", async (req, res) => {
  const categoryId = positiveId(req.body.category_id, "category");
  const name = requiredName(req.body.item_name, "item_name", 140);
  const price = amount(req.body.base_price, "base price");
  const category = await pool.query("SELECT 1 FROM categories WHERE category_id=$1 AND is_active=TRUE", [categoryId]);
  if (!category.rowCount) throw new HttpError(400, "INVALID_CATEGORY", "Choose an active category.");
  const sizes = optionList(req.body.sizes || [], "size");
  const addons = optionList(req.body.addons_config || [], "add-on");
  const image = imageReference(req.body.image_url ?? null);
  const description = typeof req.body.description === "string" ? req.body.description.trim().slice(0, 2000) : null;
  const available = req.body.availability_status === undefined ? true : req.body.availability_status;
  if (typeof available !== "boolean") throw new HttpError(400, "INVALID_AVAILABILITY", "Availability must be true or false.");
  const { rows } = await pool.query(
    "INSERT INTO menu_items (category_id,item_name,description,base_price,availability_status,image_url,sizes,addons_config,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
    [categoryId, name, description, price, available, image, JSON.stringify(sizes), JSON.stringify(addons), req.session.user.id]
  );
  res.status(201).json({ item: rows[0] });
});

adminCatalogRouter.patch("/menu-items/:id", async (req, res) => {
  const id = positiveId(req.params.id, "menu item");
  const found = await pool.query("SELECT * FROM menu_items WHERE item_id=$1 AND is_archived=FALSE", [id]);
  if (!found.rowCount) throw new HttpError(404, "ITEM_NOT_FOUND", "That menu item was not found.");
  const old = found.rows[0];
  const categoryId = req.body.category_id === undefined ? old.category_id : positiveId(req.body.category_id, "category");
  const name = req.body.item_name === undefined ? old.item_name : requiredName(req.body.item_name, "item_name", 140);
  const price = req.body.base_price === undefined ? old.base_price : amount(req.body.base_price, "base price");
  const category = await pool.query("SELECT 1 FROM categories WHERE category_id=$1 AND is_active=TRUE", [categoryId]);
  if (!category.rowCount) throw new HttpError(400, "INVALID_CATEGORY", "Choose an active category.");
  const sizes = optionList(req.body.sizes, "size") ?? old.sizes;
  const addons = optionList(req.body.addons_config, "add-on") ?? old.addons_config;
  const image = imageReference(req.body.image_url) ?? (req.body.image_url === null || req.body.image_url === "" ? null : old.image_url);
  const description = req.body.description === undefined ? old.description : String(req.body.description || "").trim().slice(0, 2000) || null;
  const available = req.body.availability_status === undefined ? old.availability_status : req.body.availability_status;
  if (typeof available !== "boolean") throw new HttpError(400, "INVALID_AVAILABILITY", "Availability must be true or false.");
  const { rows } = await pool.query(
    "UPDATE menu_items SET category_id=$2,item_name=$3,description=$4,base_price=$5,availability_status=$6,image_url=$7,sizes=$8,addons_config=$9,updated_at=CURRENT_TIMESTAMP WHERE item_id=$1 RETURNING *",
    [id, categoryId, name, description, price, available, image, JSON.stringify(sizes), JSON.stringify(addons)]
  );
  res.json({ item: rows[0] });
});

adminCatalogRouter.patch("/menu-items/:id/availability", async (req, res) => {
  if (typeof req.body.availability_status !== "boolean") throw new HttpError(400, "INVALID_AVAILABILITY", "Availability must be true or false.");
  const { rows } = await pool.query(
    "UPDATE menu_items SET availability_status=$2,updated_at=CURRENT_TIMESTAMP WHERE item_id=$1 AND is_archived=FALSE RETURNING item_id,availability_status",
    [positiveId(req.params.id, "menu item"), req.body.availability_status]
  );
  if (!rows.length) throw new HttpError(404, "ITEM_NOT_FOUND", "That menu item was not found.");
  res.json({ item: rows[0] });
});

adminCatalogRouter.delete("/menu-items/:id", async (req, res) => {
  const { rows } = await pool.query(
    "UPDATE menu_items SET is_archived=TRUE,availability_status=FALSE,updated_at=CURRENT_TIMESTAMP WHERE item_id=$1 AND is_archived=FALSE RETURNING item_id",
    [positiveId(req.params.id, "menu item")]
  );
  if (!rows.length) throw new HttpError(404, "ITEM_NOT_FOUND", "That menu item was not found.");
  res.json({ item_id: rows[0].item_id, is_archived: true });
});

adminCatalogRouter.get("/delivery-zones", async (_req, res) => {
  const { rows } = await pool.query("SELECT zone_id,zone_name,delivery_fee,is_active,coverage_notes FROM delivery_zones ORDER BY zone_name");
  res.json({ zones: rows });
});

adminCatalogRouter.post("/delivery-zones", async (req, res) => {
  const name = requiredName(req.body.zone_name, "zone_name", 100);
  const fee = amount(req.body.delivery_fee, "delivery fee");
  const notes = typeof req.body.coverage_notes === "string" ? req.body.coverage_notes.trim().slice(0, 1000) : null;
  try {
    const { rows } = await pool.query(
      "INSERT INTO delivery_zones (zone_name,delivery_fee,coverage_notes) VALUES ($1,$2,$3) RETURNING zone_id,zone_name,delivery_fee,is_active,coverage_notes",
      [name, fee, notes]
    );
    res.status(201).json({ zone: rows[0] });
  } catch (error) {
    if (error.code === "23505") throw new HttpError(409, "ZONE_EXISTS", "A delivery zone already uses that name.");
    throw error;
  }
});

adminCatalogRouter.patch("/delivery-zones/:id", async (req, res) => {
  const id = positiveId(req.params.id, "delivery zone");
  const found = await pool.query("SELECT * FROM delivery_zones WHERE zone_id=$1", [id]);
  if (!found.rowCount) throw new HttpError(404, "ZONE_NOT_FOUND", "That delivery zone was not found.");
  const old = found.rows[0];
  const name = req.body.zone_name === undefined ? old.zone_name : requiredName(req.body.zone_name, "zone_name", 100);
  const fee = req.body.delivery_fee === undefined ? old.delivery_fee : amount(req.body.delivery_fee, "delivery fee");
  const notes = req.body.coverage_notes === undefined ? old.coverage_notes : String(req.body.coverage_notes || "").trim().slice(0, 1000) || null;
  const active = req.body.is_active === undefined ? old.is_active : req.body.is_active;
  if (typeof active !== "boolean") throw new HttpError(400, "INVALID_AVAILABILITY", "Availability must be true or false.");
  try {
    const { rows } = await pool.query(
      "UPDATE delivery_zones SET zone_name=$2,delivery_fee=$3,coverage_notes=$4,is_active=$5 WHERE zone_id=$1 RETURNING zone_id,zone_name,delivery_fee,is_active,coverage_notes",
      [id, name, fee, notes, active]
    );
    res.json({ zone: rows[0] });
  } catch (error) {
    if (error.code === "23505") throw new HttpError(409, "ZONE_EXISTS", "A delivery zone already uses that name.");
    throw error;
  }
});

adminCatalogRouter.delete("/delivery-zones/:id", async (req, res) => {
  const { rows } = await pool.query("UPDATE delivery_zones SET is_active=FALSE WHERE zone_id=$1 RETURNING zone_id", [positiveId(req.params.id, "delivery zone")]);
  if (!rows.length) throw new HttpError(404, "ZONE_NOT_FOUND", "That delivery zone was not found.");
  res.json({ zone_id: rows[0].zone_id, is_active: false });
});
