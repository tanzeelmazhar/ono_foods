import test from "node:test";
import assert from "node:assert/strict";
import { calculateSubtotal, moneyToCents } from "../src/services/pricing.js";
import { canTransition, nextStatuses } from "../src/services/order-status.js";
import { isStoreOpen, parseClock } from "../src/services/store-hours.js";

test("subtotal uses integer cents for quantity and customizations", () => {
  assert.equal(calculateSubtotal([
    { quantity: 2, unitPriceCents: moneyToCents("650.00"), addonTotalCents: moneyToCents("75.50") },
    { quantity: 1, unitPriceCents: moneyToCents("350.00"), addonTotalCents: 0 }
  ]), 180100);
});

test("store hours include 11:00 and exclude midnight in Karachi", () => {
  const time = (value) => new Date("2026-10-24T" + value + ":00+05:00");
  assert.equal(isStoreOpen(time("11:00"), "Asia/Karachi", "11:00", "24:00"), true);
  assert.equal(isStoreOpen(time("23:59"), "Asia/Karachi", "11:00", "24:00"), true);
  assert.equal(isStoreOpen(time("00:00"), "Asia/Karachi", "11:00", "24:00"), false);
  assert.equal(isStoreOpen(time("10:59"), "Asia/Karachi", "11:00", "24:00"), false);
});

test("order workflow allows only documented forward transitions", () => {
  assert.deepEqual(nextStatuses("Pending"), ["Preparing", "Cancelled"]);
  assert.equal(canTransition("Pending", "Cancelled"), true);
  assert.equal(canTransition("Preparing", "Cancelled"), false);
  assert.equal(canTransition("Preparing", "Out for Delivery"), true);
  assert.equal(canTransition("Delivered", "Preparing"), false);
});

test("24:00 is valid only as the end-of-day bound", () => {
  assert.equal(parseClock("24:00"), 1440);
  assert.throws(() => parseClock("24:01"));
  assert.throws(() => parseClock("25:00"));
});
