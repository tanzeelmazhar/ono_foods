import test from "node:test";
import assert from "node:assert/strict";
import { validateReview } from "../src/services/reviews.js";

test("review accepts integer star ratings and trims optional text", () => {
  assert.deepEqual(validateReview("5", "  Loved the creamy sauce.  "), {
    rating: 5,
    reviewText: "Loved the creamy sauce."
  });
  assert.deepEqual(validateReview(3), { rating: 3, reviewText: "" });
});

test("review rejects ratings outside 1 to 5 and fractional values", () => {
  for (const rating of [0, 6, 2.5, "stars", ""]) {
    assert.throws(() => validateReview(rating), { code: "VALIDATION_FAILED" });
  }
});

test("review text must be text and no longer than 1000 characters", () => {
  assert.throws(() => validateReview(4, 42), { code: "VALIDATION_FAILED" });
  assert.throws(() => validateReview(4, "x".repeat(1001)), { code: "VALIDATION_FAILED" });
});
