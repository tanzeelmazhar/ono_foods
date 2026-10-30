import { HttpError } from "../middleware/errors.js";

export function moneyToCents(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error("Invalid monetary value.");
  const [whole, fraction = ""] = text.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export function centsToMoney(cents) {
  return (cents / 100).toFixed(2);
}

function uniqueIds(ids) {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || id.length > 80)) {
    throw new HttpError(400, "INVALID_ADDONS", "Choose valid item add-ons.");
  }
  if (new Set(ids).size !== ids.length) {
    throw new HttpError(400, "INVALID_ADDONS", "An add-on can only be selected once.");
  }
  return ids;
}

export function normalizeCustomization(item, sizeId, addonIds = []) {
  const sizes = Array.isArray(item.sizes) ? item.sizes : [];
  const addons = Array.isArray(item.addons_config) ? item.addons_config : [];
  const chosenAddons = uniqueIds(addonIds);
  let size = null;
  if (sizes.length) {
    size = sizes.find((option) => option.id === sizeId);
    if (!size) throw new HttpError(400, "SIZE_REQUIRED", "Choose an available size.", { size: "Required" });
  } else if (sizeId) {
    throw new HttpError(400, "SIZE_NOT_AVAILABLE", "This item does not have size choices.");
  }

  const selected = addons.filter((addon) => chosenAddons.includes(addon.id));
  if (selected.length !== chosenAddons.length) {
    throw new HttpError(400, "ADDON_NOT_AVAILABLE", "One or more selected add-ons are unavailable.");
  }
  if (addons.some((addon) => addon.required && !chosenAddons.includes(addon.id))) {
    throw new HttpError(400, "REQUIRED_ADDON_MISSING", "Choose all required add-ons.");
  }
  const unitPriceCents = moneyToCents(size?.price ?? item.base_price);
  const selectedAddons = selected.map((addon) => ({
    id: addon.id, name: addon.name, price: centsToMoney(moneyToCents(addon.price))
  }));
  const addonTotalCents = selectedAddons.reduce((sum, addon) => sum + moneyToCents(addon.price), 0);
  return { sizeOption: size?.name || null, unitPriceCents, addonTotalCents, selectedAddons };
}

export function calculateSubtotal(lines) {
  return lines.reduce((sum, line) => {
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 99) {
      throw new HttpError(400, "INVALID_QUANTITY", "Quantity must be between 1 and 99.");
    }
    return sum + line.quantity * (line.unitPriceCents + line.addonTotalCents);
  }, 0);
}
