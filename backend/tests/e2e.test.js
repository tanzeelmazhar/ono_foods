import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

const baseUrl = (process.env.ONO_E2E_BASE_URL || "").replace(/\/$/, "");
const adminEmail = process.env.ONO_E2E_ADMIN_EMAIL || "";
const adminPassword = process.env.ONO_E2E_ADMIN_PASSWORD || "";

class CookieJar {
  cookies = new Map();

  absorb(response) {
    const lines = response.headers.getSetCookie?.() || [response.headers.get("set-cookie")].filter(Boolean);
    for (const line of lines) {
      const pair = line.split(";", 1)[0];
      const separator = pair.indexOf("=");
      if (separator < 1) continue;
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (!value || /max-age=0/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  header() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

async function request(jar, route, { method = "GET", body, headers = {} } = {}) {
  const requestHeaders = new Headers(headers);
  if (jar.header()) requestHeaders.set("Cookie", jar.header());
  if (body !== undefined) requestHeaders.set("Content-Type", "application/json");
  const response = await fetch(baseUrl + "/api/v1" + route, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  jar.absorb(response);
  const payload = await response.json().catch(() => ({}));
  assert.ok(response.ok, `${method} ${route} returned ${response.status}: ${payload.error?.message || JSON.stringify(payload)}`);
  return payload;
}

async function csrf(jar) {
  return (await request(jar, "/security/csrf")).csrf_token;
}

async function mutate(jar, route, method, body, headers = {}) {
  return request(jar, route, {
    method,
    body,
    headers: { ...headers, "X-CSRF-Token": await csrf(jar) }
  });
}

test("customer checkout is saved, visible to admin, trackable, and reviewable", {
  skip: !baseUrl || !adminEmail || !adminPassword
    ? "Set ONO_E2E_BASE_URL, ONO_E2E_ADMIN_EMAIL, and ONO_E2E_ADMIN_PASSWORD for a disposable test database."
    : false
}, async () => {
  const page = await fetch(baseUrl + "/");
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /apiBaseUrl:\s*["']\/api\/v1["']/);
  assert.doesNotMatch(html, /offlinePreview\s*:\s*true/);
  assert.doesNotMatch(html, /Retry\s*&\s*add/);
  assert.match(html, /id="customize-message"/);
  assert.match(html, /id="live-site-link"/);
  assert.match(html, /id="customize-live-link"/);
  const adminPage = await fetch(baseUrl + "/admin");
  assert.equal(adminPage.status, 200);
  assert.match(adminPage.headers.get("content-security-policy") || "", /nonce-/);
  assert.match(await adminPage.text(), /id="admin-file-notice"/);

  const customer = new CookieJar();
  const admin = new CookieJar();
  assert.equal((await request(customer, "/health")).status, "ok");

  const denied = await fetch(baseUrl + "/api/v1/admin/summary");
  assert.equal(denied.status, 401, "admin endpoints must require an admin session");
  await mutate(admin, "/auth/login", "POST", { email: adminEmail, password: adminPassword });
  const { user } = await request(admin, "/auth/me");
  assert.equal(user.role, "admin");

  const zoneName = `E2E ${randomUUID().slice(0, 8)}`;
  const { zone } = await mutate(admin, "/admin/delivery-zones", "POST", {
    zone_name: zoneName, delivery_fee: "150.00", coverage_notes: "Automated test only"
  });
  const publicZones = await request(customer, "/delivery-zones");
  assert.ok(publicZones.zones.some((entry) => entry.zone_id === zone.zone_id));

  const { items } = await request(customer, "/menu-items?limit=48");
  const pizza = items.find((item) => item.item_name === "Creamy Cheesy Tikka Pizza");
  assert.ok(pizza, "the seeded pizza should be visible to customers");
  assert.equal(pizza.sizes.find((option) => option.id === "medium")?.price, "500.00");
  const { cart } = await mutate(customer, "/cart/items", "POST", {
    item_id: pizza.item_id, quantity: 1, size_option: "medium", addons: []
  });
  assert.equal(Number(cart.subtotal_amount), 500);

  const idempotencyKey = randomUUID();
  const checkoutBody = {
    customer_name: "ONO E2E Customer",
    customer_phone: "03001234567",
    delivery_address: "Automated test address, Karachi",
    delivery_zone_id: zone.zone_id,
    delivery_instructions: "Test order; no delivery",
    payment_type: "COD"
  };
  const placed = await mutate(customer, "/checkout", "POST", checkoutBody, { "Idempotency-Key": idempotencyKey });
  const orderId = placed.order.order_id;
  assert.equal(placed.order.order_status, "Pending");
  assert.equal(Number(placed.order.total_amount), 650);
  assert.equal(placed.order.payment_type, "COD");

  const tracked = await request(customer, `/orders/${orderId}`);
  assert.equal(tracked.order.order_status, "Pending");
  assert.equal(tracked.order.items[0].size_option, "Medium");
  assert.equal(Number(tracked.order.items[0].unit_price_snapshot), 500);
  const reused = await mutate(customer, "/checkout", "POST", {}, { "Idempotency-Key": idempotencyKey });
  assert.equal(reused.reused, true);
  assert.equal(reused.order.order_id, orderId);

  const adminOrders = await request(admin, "/admin/orders?limit=100");
  assert.ok(adminOrders.orders.some((order) => order.order_id === orderId && order.customer_name === checkoutBody.customer_name));
  const details = await request(admin, `/admin/orders/${orderId}`);
  assert.equal(details.order.delivery_address, checkoutBody.delivery_address);
  assert.equal(details.order.items[0].item_name_snapshot, pizza.item_name);

  for (const order_status of ["Preparing", "Out for Delivery", "Delivered"]) {
    const updated = await mutate(admin, `/admin/orders/${orderId}/status`, "PATCH", { order_status });
    assert.equal(updated.order_status, order_status);
  }
  const delivered = await request(customer, `/orders/${orderId}`);
  assert.equal(delivered.order.order_status, "Delivered");
  const lineId = delivered.order.items[0].order_item_id;
  await mutate(customer, `/orders/${orderId}/reviews`, "POST", {
    order_item_id: lineId, rating: 5, review_text: "Automated test review"
  });
  const reviews = await request(customer, `/menu-items/${pizza.item_id}/reviews`);
  assert.ok(reviews.reviews.some((review) => review.review_text === "Automated test review"));

  const summary = await request(admin, "/admin/summary");
  assert.ok(summary.counts.Delivered >= 1);
  const paused = await mutate(admin, "/admin/store-status", "PATCH", { accepting_orders: false });
  assert.equal(paused.accepting_orders, false);
  assert.equal((await request(customer, "/config")).accepting_orders, false);
  const reopened = await mutate(admin, "/admin/store-status", "PATCH", { accepting_orders: true });
  assert.equal(reopened.accepting_orders, true);
});
