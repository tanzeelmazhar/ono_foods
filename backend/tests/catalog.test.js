import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { catalogCategories, catalogItems } from "../../frontend/js/catalog-data.js";
import { normalizeCustomization } from "../src/services/pricing.js";

test("ONO catalog groups pizza and fries size variants into 8 products", () => {
  assert.equal(catalogItems.length, 8);
  assert.equal(catalogCategories.length, 6);
  const prices = new Map(catalogItems.map((item) => [item.item_name, item.base_price]));
  const pizza = catalogItems.find((item) => item.item_name === "Creamy Cheesy Tikka Pizza");
  const fries = catalogItems.find((item) => item.item_name === "Plain Fries");
  const kutsuFries = catalogItems.find((item) => item.item_name === "Kutsu Pizza Fries");
  assert.deepEqual(pizza.sizes.map(({ name, price }) => [name, price]), [["Small", "350.00"], ["Medium", "500.00"], ["Large", "700.00"]]);
  assert.deepEqual(fries.sizes.map(({ name, price }) => [name, price]), [["Small", "200.00"], ["Large", "300.00"]]);
  assert.deepEqual(kutsuFries.sizes.map(({ name, price }) => [name, price]), [["Small", "350.00"], ["Large", "450.00"]]);
  assert.ok(!catalogItems.some((item) => /\((Small|Medium|Large)\)$/.test(item.item_name)));
  assert.equal(prices.get("Alfredo Pasta"), "600.00");
  assert.equal(prices.get("Tango Zinger Burger"), "500.00");
  assert.equal(prices.get("Korean Noodles"), "350.00");
  assert.equal(prices.get("Arbiata Pasta"), "550.00");
  assert.equal(prices.get("Nana Wings"), "500.00");
});

test("selected size determines the order price and saved size label", () => {
  const pizza = catalogItems.find((item) => item.item_name === "Creamy Cheesy Tikka Pizza");
  const selected = normalizeCustomization(pizza, "medium", []);
  assert.equal(selected.unitPriceCents, 50000);
  assert.equal(selected.sizeOption, "Medium");
  assert.throws(() => normalizeCustomization(pizza, null, []), { code: "SIZE_REQUIRED" });
});

test("every seeded catalog item has a description and a local food photo", async () => {
  for (const item of catalogItems) {
    assert.ok(item.description.length > 30, item.item_name);
    assert.match(item.image_url, /^\/images\/[a-z-]+\.jpg$/);
    await access(fileURLToPath(new URL("../../frontend" + item.image_url, import.meta.url)));
  }
});
