import "dotenv/config";
import { catalogCategories, catalogItems } from "../runtime-frontend/js/catalog-data.js";
import { pool, withTransaction } from "../src/db.js";

const legacyVariants = new Map([
  ["pizza", [
    "Creamy Cheesy Tikka Pizza (Small)", "Creamy Cheesy Tikka Pizza (Medium)", "Creamy Cheesy Tikka Pizza (Large)",
    "Small Pizza Cheesy Creamy Tikka", "Medium Pizza Cheesy Creamy Tikka", "Large Pizza Cheesy Creamy Tikka"
  ]],
  ["fries", [
    "Plain Fries (Small)", "Plain Fries (Large)", "Plain Fries Small", "Plain Fries Medium", "Plain Fries Large",
    "Kutsu Pizza Fries (Small)", "Kutsu Pizza Fries (Large)", "Kutsu Pizza Fries Small", "Kutsu Pizza Fries Medium", "Kutsu Pizza Fries Large"
  ]]
]);
const categoryNames = new Map([
  ["pizza", ["Pizzas", "Pizza"]],
  ["fries", ["Fries"]],
  ["pasta", ["Pastas", "Pasta"]],
  ["burgers", ["Burgers"]],
  ["noodles", ["Noodles"]],
  ["wings", ["Wings & Starters", "Wings"]]
]);
const itemAliases = new Map([
  ["Creamy Cheesy Tikka Pizza", [
    "Small Pizza Cheesy Creamy Tikka", "Medium Pizza Cheesy Creamy Tikka", "Large Pizza Cheesy Creamy Tikka",
    "Creamy Cheesy Tikka Pizza (Small)", "Creamy Cheesy Tikka Pizza (Medium)", "Creamy Cheesy Tikka Pizza (Large)"
  ]],
  ["Plain Fries", ["Plain Fries Small", "Plain Fries Medium", "Plain Fries (Small)", "Plain Fries (Large)", "Plain Fries Large"]],
  ["Kutsu Pizza Fries", ["Kutsu Pizza Fries Small", "Kutsu Pizza Fries Medium", "Kutsu Pizza Fries (Small)", "Kutsu Pizza Fries (Large)", "Kutsu Pizza Fries Large"]],
  ["Arbiata Pasta", ["Arrabiata Pasta"]]
]);
const excludedLegacyItems = ["Shahi Shami Burger", "Tako Chicken Sandwich"];
const deliveryZones = [
  ["Karachi Central District", "210.00"],
  ["Karachi East District", "180.00"],
  ["Karachi South District", "240.00"],
  ["Karachi West District", "270.00"],
  ["Keamari District", "300.00"],
  ["Korangi District", "180.00"],
  ["Malir District", "150.00"]
];

try {
  await withTransaction(async (client) => {
    for (const [zoneName, deliveryFee] of deliveryZones) {
      await client.query(
        "INSERT INTO delivery_zones (zone_name,delivery_fee,is_active) VALUES ($1,$2,TRUE) ON CONFLICT (zone_name) DO NOTHING",
        [zoneName, deliveryFee]
      );
    }

    const categoryIds = new Map();
    for (const category of catalogCategories) {
      const names = categoryNames.get(category.category_id) || [category.category_name];
      let result = await client.query(
        "SELECT category_id FROM categories WHERE category_name=ANY($1::text[]) ORDER BY array_position($1::text[],category_name) LIMIT 1 FOR UPDATE",
        [names]
      );
      if (!result.rowCount) {
        result = await client.query(
          "INSERT INTO categories (category_name,display_order,is_active) VALUES ($1,$2,TRUE) RETURNING category_id",
          [category.category_name, category.display_order]
        );
      } else {
        await client.query("UPDATE categories SET display_order=$2 WHERE category_id=$1", [result.rows[0].category_id, category.display_order]);
      }
      categoryIds.set(category.category_id, result.rows[0].category_id);
    }

    for (const item of catalogItems) {
      const categoryId = categoryIds.get(item.category_id);
      const names = [item.item_name, ...(itemAliases.get(item.item_name) || [])];
      const existing = await client.query(
        "SELECT item_id FROM menu_items WHERE category_id=$1 AND item_name=ANY($2::text[]) ORDER BY (item_name=$3) DESC,is_archived,item_id LIMIT 1 FOR UPDATE",
        [categoryId, names, item.item_name]
      );
      if (existing.rowCount) {
        await client.query(
          "UPDATE menu_items SET category_id=$2,item_name=$3,description=$4,base_price=$5,image_url=$6,sizes=$7::jsonb,addons_config=$8::jsonb,is_archived=FALSE,updated_at=CURRENT_TIMESTAMP WHERE item_id=$1",
          [existing.rows[0].item_id, categoryId, item.item_name, item.description, item.base_price, item.image_url, JSON.stringify(item.sizes || []), JSON.stringify(item.addons_config || [])]
        );
      } else {
        await client.query(
          "INSERT INTO menu_items (category_id,item_name,description,base_price,availability_status,image_url,sizes,addons_config) VALUES ($1,$2,$3,$4,TRUE,$5,$6::jsonb,$7::jsonb)",
          [categoryId, item.item_name, item.description, item.base_price, item.image_url, JSON.stringify(item.sizes || []), JSON.stringify(item.addons_config || [])]
        );
      }

      const oldNames = names.filter((name) => name !== item.item_name);
      if (oldNames.length) {
        await client.query(
          "UPDATE menu_items SET is_archived=TRUE,availability_status=FALSE,updated_at=CURRENT_TIMESTAMP WHERE category_id=$1 AND item_name=ANY($2::text[]) AND item_id<>$3 AND is_archived=FALSE",
          [categoryId, oldNames, existing.rows[0]?.item_id ?? -1]
        );
      }
    }
    for (const [categoryKey, itemNames] of legacyVariants) {
      const categoryId = categoryIds.get(categoryKey);
      await client.query(
        "UPDATE menu_items SET is_archived=TRUE,availability_status=FALSE,updated_at=CURRENT_TIMESTAMP WHERE category_id=$1 AND item_name=ANY($2::text[]) AND is_archived=FALSE",
        [categoryId, itemNames]
      );
    }
    await client.query(
      "UPDATE menu_items SET is_archived=TRUE,availability_status=FALSE,updated_at=CURRENT_TIMESTAMP WHERE item_name=ANY($1::text[]) AND is_archived=FALSE",
      [excludedLegacyItems]
    );
  });
  console.log("ONO Food catalog seeded: 8 grouped menu items across 6 categories; legacy size variants and unlisted legacy products archived without deleting order history.");
} catch (error) {
  console.error("Catalog seed failed:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
