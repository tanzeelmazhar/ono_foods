import { HttpError } from "../middleware/errors.js";

const transitions = {
  Pending: ["Preparing", "Cancelled"],
  Preparing: ["Out for Delivery"],
  "Out for Delivery": ["Delivered"],
  Delivered: [],
  Cancelled: []
};

export function canTransition(current, next) {
  return Boolean(transitions[current]?.includes(next));
}

export function assertTransition(current, next) {
  if (!canTransition(current, next)) {
    throw new HttpError(409, "INVALID_ORDER_TRANSITION", "This order can no longer move to that status.");
  }
}

export function nextStatuses(status) {
  return [...(transitions[status] || [])];
}
