import { HttpError } from "../middleware/errors.js";

export function validateReview(rating, reviewText) {
  const value = Number(rating);
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new HttpError(400, "VALIDATION_FAILED", "Choose a rating from 1 to 5 stars.", { rating: "Choose 1 to 5 stars" });
  }
  if (reviewText !== undefined && typeof reviewText !== "string") {
    throw new HttpError(400, "VALIDATION_FAILED", "Enter a valid review.", { review_text: "Must be text" });
  }
  const text = (reviewText || "").trim();
  if (text.length > 1000) {
    throw new HttpError(400, "VALIDATION_FAILED", "Reviews can be up to 1000 characters.", { review_text: "Maximum 1000 characters" });
  }
  return { rating: value, reviewText: text };
}
