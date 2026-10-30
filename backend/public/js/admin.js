import { api } from "./api.js";

const $ = (selector, root = document) => root.querySelector(selector);
const state = { user: null, orders: [], categories: [], items: [], zones: [], sales: null, acceptingOrders: null, toastTimer: 0 };
const transitions = { Pending: ["Preparing", "Cancelled"], Preparing: ["Out for Delivery"], "Out for Delivery": ["Delivered"], Delivered: [], Cancelled: [] };

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function money(value) {
  return "PKR " + Number(value || 0).toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function feedback(selector, text, type = "") {
  const element = $(selector);
  element.textContent = text || "";
  element.classList.toggle("error", type === "error");
  element.classList.toggle("success", type === "success");
}

function notify(text) {
  const element = $("#toast");
  element.textContent = text;
  element.classList.add("visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => element.classList.remove("visible"), 2600);
}

function todayLocal() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function renderStoreStatus() {
  const panel = $(".store-control");
  const title = $("#store-status-title");
  const description = $("#store-status-description");
  const button = $("#store-status-toggle");
  panel.classList.toggle("is-open", state.acceptingOrders === true);
  panel.classList.toggle("is-closed", state.acceptingOrders === false);
  if (state.acceptingOrders === null) {
    title.textContent = "Store status unavailable";
    description.textContent = "The backend must provide the store-status setting before this control can be used.";
    button.textContent = "Status unavailable";
    button.disabled = true;
    return;
  }
  title.textContent = state.acceptingOrders ? "Accepting orders" : "Orders paused";
  description.textContent = state.acceptingOrders
    ? "Customers can place orders during the regular opening hours."
    : "Customers can browse the menu, but cannot place new orders.";
  button.textContent = state.acceptingOrders ? "Close store" : "Open store";
  button.setAttribute("aria-label", state.acceptingOrders ? "Stop accepting new orders" : "Resume accepting orders");
  button.disabled = false;
}

async function loadStoreStatus() {
  try {
    const result = await api.get("/admin/store-status");
    if (typeof result.accepting_orders !== "boolean") throw new Error("The store-status response is missing accepting_orders.");
    state.acceptingOrders = result.accepting_orders;
    feedback("#store-status-message", "");
  } catch (error) {
    state.acceptingOrders = null;
    feedback("#store-status-message", error.message.includes("missing accepting_orders")
      ? error.message
      : "Store controls need GET/PATCH /admin/store-status in the backend.", "error");
  }
  renderStoreStatus();
}

async function toggleStoreStatus() {
  if (state.acceptingOrders === null) return;
  const next = !state.acceptingOrders;
  if (!next && !confirm("Close ordering for customers? Existing orders will not be changed.")) return;
  const button = $("#store-status-toggle");
  button.disabled = true;
  try {
    const result = await api.patch("/admin/store-status", { accepting_orders: next });
    if (typeof result.accepting_orders !== "boolean") throw new Error("The store-status response is missing accepting_orders.");
    state.acceptingOrders = result.accepting_orders;
    renderStoreStatus();
    notify(state.acceptingOrders ? "Store is accepting orders" : "Store is closed to new orders");
  } catch (error) {
    button.disabled = false;
    feedback("#store-status-message", error.message, "error");
  }
}

function setView(name) {
  document.querySelectorAll(".admin-view").forEach((section) => { section.hidden = section.id !== "view-" + name; });
  document.querySelectorAll(".admin-tabs button").forEach((button) => {
    if (button.dataset.view === name) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  const actions = { orders: loadOrders, menu: loadMenu, categories: loadCategories, zones: loadZones, sales: loadSales };
  actions[name]?.().catch((error) => feedback("#" + name + "-message", error.message, "error"));
}

function renderCounts(counts) {
  const order = ["Pending", "Preparing", "Out for Delivery", "Delivered", "Cancelled"];
  $("#order-counts").innerHTML = order.map((status) => `<div class="count-item"><strong>${esc(counts[status] || 0)}</strong><span>${esc(status)}</span></div>`).join("");
}

function renderOrders() {
  const target = $("#orders-table");
  if (!state.orders.length) { target.innerHTML = '<div class="empty-state">No orders in this view.</div>'; return; }
  target.innerHTML = `<table class="admin-table"><thead><tr><th>Order</th><th>Received</th><th>Customer</th><th>Zone</th><th>Total</th><th>Status</th><th>Update</th><th>Details</th></tr></thead><tbody>${state.orders.map((order) => {
    const options = transitions[order.order_status] || [];
    const statusControl = options.length ? `<div class="row-actions"><select data-next-status="${esc(order.order_id)}" aria-label="Next status for order ${esc(order.order_id)}"><option value="">Next status</option>${options.map((option) => `<option value="${esc(option)}">${esc(option)}</option>`).join("")}</select><button class="small-button" type="button" data-apply-status="${esc(order.order_id)}">Apply</button></div>` : '<span class="status-label">Final</span>';
    return `<tr><td>#${esc(order.order_id)}</td><td>${esc(new Date(order.order_timestamp).toLocaleString())}</td><td>${esc(order.customer_name)}<br><span>${esc(order.customer_phone)}</span></td><td>${esc(order.zone_name || "-")}</td><td>${esc(money(order.total_amount))}</td><td>${esc(order.order_status)}</td><td>${statusControl}</td><td><button class="small-button" type="button" data-order-detail="${esc(order.order_id)}">Details</button></td></tr>`;
  }).join("")}</tbody></table>`;
}

async function loadOrders() {
  const status = $("#order-status-filter").value;
  const [summary, result] = await Promise.all([api.get("/admin/summary"), api.get("/admin/orders?limit=100" + (status ? "&status=" + encodeURIComponent(status) : ""))]);
  renderCounts(summary.counts);
  state.orders = result.orders;
  renderOrders();
  feedback("#orders-message", "");
}

function optionsText(options = [], includeRequired = false) {
  return options.map((option) => `${option.name} | ${option.price}${includeRequired && option.required ? " | required" : ""}`).join("\n");
}

function parseOptions(value, label, requiredFlag = false) {
  const rows = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return rows.map((line, index) => {
    const [rawName, rawPrice, rawRequired] = line.split("|").map((part) => part.trim());
    const price = Number(rawPrice);
    if (!rawName || !Number.isFinite(price) || price < 0) throw new Error(`Check the ${label} options. Each line needs a name and non-negative price.`);
    const idBase = rawName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || label;
    return { id: idBase.slice(0, 65) + "-" + (index + 1), name: rawName, price: price.toFixed(2), ...(requiredFlag ? { required: rawRequired?.toLowerCase() === "required" } : {}) };
  });
}

function fillCategorySelect(selected = "") {
  const active = state.categories.filter((category) => category.is_active);
  $("#menu-item-form [name=category_id]").innerHTML = active.map((category) => `<option value="${esc(category.category_id)}">${esc(category.category_name)}</option>`).join("");
  if (selected) $("#menu-item-form [name=category_id]").value = selected;
}

function renderMenu() {
  const query = $("#menu-admin-search").value.trim().toLowerCase();
  const items = state.items.filter((item) => !item.is_archived && (item.item_name + " " + (item.category_name || "")).toLowerCase().includes(query));
  $("#menu-admin-list").innerHTML = items.length ? items.map((item) => `<article class="record-row"><div class="record-title"><strong>${esc(item.item_name)}</strong><span>${esc(item.category_name)} / ${esc(money(item.base_price))}</span></div><div class="record-fields single"><span class="status-label ${item.availability_status ? "" : "out-of-stock-label"}">${item.availability_status ? "In stock" : "Out of stock"}</span></div><div class="record-fields"><span>${item.sizes?.length ? `${item.sizes.length} size options` : "No sizes"}</span><span>${item.addons_config?.length ? `${item.addons_config.length} add-ons` : "No add-ons"}</span></div><div class="record-actions"><button class="small-button" type="button" data-edit-item="${esc(item.item_id)}">Edit</button><button class="small-button" type="button" data-availability="${esc(item.item_id)}" data-value="${!item.availability_status}">${item.availability_status ? "Mark out of stock" : "Mark in stock"}</button><button class="small-button danger" type="button" data-archive-item="${esc(item.item_id)}">Archive</button></div></article>`).join("") : '<div class="empty-state">No menu items have been added.</div>';
}

async function loadMenu() {
  const result = await api.get("/admin/menu-items?include_archived=true");
  state.items = result.items;
  renderMenu();
  feedback("#menu-admin-message", "");
}

function renderCategories() {
  $("#category-admin-list").innerHTML = state.categories.length ? state.categories.map((category) => `<article class="record-row" data-category-row="${esc(category.category_id)}"><div class="record-title"><strong>${esc(category.category_name)}</strong><span>Display order ${esc(category.display_order)}</span></div><div class="record-fields"><input aria-label="Category name" name="category_name" value="${esc(category.category_name)}" maxlength="80"><input aria-label="Display order" name="display_order" type="number" value="${esc(category.display_order)}"></div><div class="record-fields single"><input aria-label="Category description" name="description" value="${esc(category.description || "")}" maxlength="1000"></div><div class="record-actions"><button class="small-button" type="button" data-save-category="${esc(category.category_id)}">Save</button><button class="small-button ${category.is_active ? "danger" : ""}" type="button" data-toggle-category="${esc(category.category_id)}" data-value="${!category.is_active}">${category.is_active ? "Deactivate" : "Activate"}</button></div></article>`).join("") : '<div class="empty-state">No categories yet.</div>';
  fillCategorySelect();
}

async function loadCategories() {
  const result = await api.get("/admin/categories");
  state.categories = result.categories;
  renderCategories();
  feedback("#category-message", "");
}

function renderZones() {
  $("#zone-admin-list").innerHTML = state.zones.length ? state.zones.map((zone) => `<article class="record-row" data-zone-row="${esc(zone.zone_id)}"><div class="record-title"><strong>${esc(zone.zone_name)}</strong><span>${zone.is_active ? "Active" : "Inactive"}</span></div><div class="record-fields"><input aria-label="Zone name" name="zone_name" value="${esc(zone.zone_name)}" maxlength="100"><input aria-label="Delivery fee" name="delivery_fee" type="number" min="0" step="0.01" value="${esc(zone.delivery_fee)}"></div><div class="record-fields single"><input aria-label="Coverage notes" name="coverage_notes" value="${esc(zone.coverage_notes || "")}" maxlength="1000"></div><div class="record-actions"><button class="small-button" type="button" data-save-zone="${esc(zone.zone_id)}">Save</button><button class="small-button ${zone.is_active ? "danger" : ""}" type="button" data-toggle-zone="${esc(zone.zone_id)}" data-value="${!zone.is_active}">${zone.is_active ? "Deactivate" : "Activate"}</button></div></article>`).join("") : '<div class="empty-state">No delivery zones yet.</div>';
}

async function loadZones() {
  const result = await api.get("/admin/delivery-zones");
  state.zones = result.zones;
  renderZones();
  feedback("#zone-message", "");
}

async function loadSales(event) {
  if (event) event.preventDefault();
  const form = $("#sales-form");
  const from = form.elements.from.value;
  const to = form.elements.to.value;
  const result = await api.get(`/admin/sales?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  state.sales = result;
  $("#sales-totals").innerHTML = `<div class="sales-total"><span>Delivered orders</span><strong>${esc(result.totals.delivered_orders)}</strong></div><div class="sales-total"><span>Delivered order value</span><strong>${esc(money(result.totals.delivered_order_value))}</strong></div>`;
  $("#sales-table").innerHTML = result.days.length ? `<table class="admin-table"><thead><tr><th>Date</th><th>Delivered orders</th><th>Delivered order value</th></tr></thead><tbody>${result.days.map((day) => `<tr><td>${esc(day.sales_date)}</td><td>${esc(day.orders)}</td><td>${esc(money(day.delivered_order_value))}</td></tr>`).join("")}</tbody></table>` : '<div class="empty-state">No delivered orders in this date range.</div>';
  feedback("#sales-message", "");
}

function resetMenuForm(item = null) {
  const form = $("#menu-item-form");
  form.reset();
  form.elements.item_id.value = item?.item_id || "";
  form.elements.item_name.value = item?.item_name || "";
  form.elements.category_id.value = item?.category_id || state.categories.find((entry) => entry.is_active)?.category_id || "";
  form.elements.base_price.value = item?.base_price || "";
  form.elements.image_url.value = item?.image_url || "";
  form.elements.description.value = item?.description || "";
  form.elements.sizes_text.value = optionsText(item?.sizes || []);
  form.elements.addons_text.value = optionsText(item?.addons_config || [], true);
  form.elements.availability_status.checked = item?.availability_status ?? true;
  $("#menu-dialog-title").textContent = item ? "Edit menu item" : "Add menu item";
  feedback("#menu-item-form-message", "");
  $("#menu-item-dialog").showModal();
}

async function saveMenuItem(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const body = {
    item_name: form.elements.item_name.value.trim(), category_id: form.elements.category_id.value,
    base_price: form.elements.base_price.value, image_url: form.elements.image_url.value.trim() || null,
    description: form.elements.description.value.trim(), availability_status: form.elements.availability_status.checked,
    sizes: parseOptions(form.elements.sizes_text.value, "size"),
    addons_config: parseOptions(form.elements.addons_text.value, "add-on", true)
  };
  try {
    const id = form.elements.item_id.value;
    if (id) await api.patch("/admin/menu-items/" + id, body);
    else await api.post("/admin/menu-items", body);
    $("#menu-item-dialog").close();
    await loadMenu();
    notify(id ? "Menu item updated" : "Menu item added");
  } catch (error) { feedback("#menu-item-form-message", error.message, "error"); }
}

async function showOrder(id) {
  const { order } = await api.get("/admin/orders/" + id);
  const details = [
    ["Customer", order.customer_name], ["Phone", order.customer_phone], ["Received", new Date(order.order_timestamp).toLocaleString()],
    ["Status", order.order_status], ["Payment", order.payment_type], ["Delivery zone", order.zone_name],
    ["Address", order.delivery_address], ["Delivery notes", order.delivery_instructions || "-"],
    ["Food subtotal", money(order.subtotal_amount)], ["Delivery fee", money(order.fee_snapshot)], ["Total", money(order.total_amount)]
  ];
  $("#order-detail-title").textContent = "Order #" + order.order_id;
  $("#order-detail-content").innerHTML = `<div class="detail-grid">${details.map(([label, value]) => `<div class="detail-cell"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join("")}</div><h3 class="account-orders">Items</h3>${order.items.map((item) => `<div class="detail-line"><span>${esc(item.quantity)} x ${esc(item.item_name_snapshot)}${item.size_option ? ` / ${esc(item.size_option)}` : ""}${item.selected_addons?.length ? ` / ${esc(item.selected_addons.map((addon) => addon.name).join(", "))}` : ""}</span><strong>${esc(money(item.subtotal))}</strong></div>`).join("")}<h3 class="account-orders">Status history</h3><ol class="status-history">${order.status_history.map((entry) => `<li>${esc(entry.new_status)}${entry.note ? ` / ${esc(entry.note)}` : ""}<time>${esc(new Date(entry.changed_at).toLocaleString())}</time></li>`).join("")}</ol>`;
  $("#order-detail-dialog").showModal();
}

async function init() {
  $("#sales-form").elements.to.value = todayLocal();
  const from = new Date(Date.now() - 29 * 86400000);
  $("#sales-form").elements.from.value = new Date(from.getTime() - from.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  $("#admin-login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const result = await api.post("/auth/login", values);
      if (result.user.role !== "admin") {
        await api.post("/auth/logout", {});
        throw new Error("This account does not have owner access.");
      }
      state.user = result.user;
      $("#admin-login").hidden = true;
      $("#admin-dashboard").hidden = false;
      $("#admin-sign-out").hidden = false;
      $("#admin-welcome").textContent = result.user.full_name;
      loadStoreStatus();
      setView("orders");
    } catch (error) { feedback("#login-message", error.message, "error"); }
  });
  $("#admin-sign-out").addEventListener("click", async () => {
    try { await api.post("/auth/logout", {}); location.reload(); }
    catch (error) { feedback("#orders-message", error.message, "error"); }
  });
  $("#store-status-toggle").addEventListener("click", toggleStoreStatus);
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  document.querySelectorAll("[data-refresh]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.refresh)));
  $("#order-status-filter").addEventListener("change", () => loadOrders().catch((error) => feedback("#orders-message", error.message, "error")));
  $("#orders-table").addEventListener("click", async (event) => {
    const detail = event.target.closest("[data-order-detail]");
    if (detail) { try { await showOrder(detail.dataset.orderDetail); } catch (error) { feedback("#orders-message", error.message, "error"); } return; }
    const apply = event.target.closest("[data-apply-status]");
    if (apply) {
      const select = $(`[data-next-status="${CSS.escape(apply.dataset.applyStatus)}"]`, $("#orders-table"));
      if (!select.value) return;
      apply.disabled = true;
      try { await api.patch(`/admin/orders/${apply.dataset.applyStatus}/status`, { order_status: select.value }); await loadOrders(); notify("Order status updated"); }
      catch (error) { feedback("#orders-message", error.message, "error"); apply.disabled = false; }
    }
  });
  $("#menu-admin-search").addEventListener("input", renderMenu);
  $("#new-menu-item").addEventListener("click", async () => { try { await loadCategories(); resetMenuForm(); } catch (error) { feedback("#menu-admin-message", error.message, "error"); } });
  $("#menu-item-form").addEventListener("submit", saveMenuItem);
  $("#menu-admin-list").addEventListener("click", async (event) => {
    const edit = event.target.closest("[data-edit-item]");
    const availability = event.target.closest("[data-availability]");
    const archive = event.target.closest("[data-archive-item]");
    try {
      if (edit) { await loadCategories(); resetMenuForm(state.items.find((item) => String(item.item_id) === edit.dataset.editItem)); }
      if (availability) { await api.patch(`/admin/menu-items/${availability.dataset.availability}/availability`, { availability_status: availability.dataset.value === "true" }); await loadMenu(); }
      if (archive && confirm("Archive this menu item? Past order records will remain unchanged.")) { await api.delete("/admin/menu-items/" + archive.dataset.archiveItem); await loadMenu(); }
    } catch (error) { feedback("#menu-admin-message", error.message, "error"); }
  });
  $("#new-category-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    values.display_order = Number(values.display_order);
    try { await api.post("/admin/categories", values); event.currentTarget.reset(); await loadCategories(); notify("Category added"); }
    catch (error) { feedback("#category-message", error.message, "error"); }
  });
  $("#category-admin-list").addEventListener("click", async (event) => {
    const save = event.target.closest("[data-save-category]");
    const toggle = event.target.closest("[data-toggle-category]");
    const row = event.target.closest("[data-category-row]");
    if (!row) return;
    try {
      if (save) {
        await api.patch("/admin/categories/" + save.dataset.saveCategory, { category_name: row.querySelector("[name=category_name]").value, description: row.querySelector("[name=description]").value, display_order: Number(row.querySelector("[name=display_order]").value) });
        await loadCategories(); notify("Category saved");
      }
      if (toggle) {
        const active = toggle.dataset.value === "true";
        if (!active && !confirm("Deactivate this category? Its items will no longer appear to customers.")) return;
        if (active) await api.patch("/admin/categories/" + toggle.dataset.toggleCategory, { is_active: true });
        else await api.delete("/admin/categories/" + toggle.dataset.toggleCategory);
        await loadCategories();
      }
    } catch (error) { feedback("#category-message", error.message, "error"); }
  });
  $("#new-zone-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try { await api.post("/admin/delivery-zones", Object.fromEntries(new FormData(event.currentTarget))); event.currentTarget.reset(); await loadZones(); notify("Delivery zone added"); }
    catch (error) { feedback("#zone-message", error.message, "error"); }
  });
  $("#zone-admin-list").addEventListener("click", async (event) => {
    const save = event.target.closest("[data-save-zone]");
    const toggle = event.target.closest("[data-toggle-zone]");
    const row = event.target.closest("[data-zone-row]");
    if (!row) return;
    try {
      if (save) {
        await api.patch("/admin/delivery-zones/" + save.dataset.saveZone, { zone_name: row.querySelector("[name=zone_name]").value, delivery_fee: row.querySelector("[name=delivery_fee]").value, coverage_notes: row.querySelector("[name=coverage_notes]").value });
        await loadZones(); notify("Delivery zone saved");
      }
      if (toggle) {
        const active = toggle.dataset.value === "true";
        if (!active && !confirm("Deactivate this delivery zone? Customers will no longer be able to select it.")) return;
        if (active) await api.patch("/admin/delivery-zones/" + toggle.dataset.toggleZone, { is_active: true });
        else await api.delete("/admin/delivery-zones/" + toggle.dataset.toggleZone);
        await loadZones();
      }
    } catch (error) { feedback("#zone-message", error.message, "error"); }
  });
  $("#sales-form").addEventListener("submit", (event) => loadSales(event).catch((error) => feedback("#sales-message", error.message, "error")));
  document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => document.getElementById(button.dataset.close).close()));
  for (const dialog of document.querySelectorAll("dialog")) dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
}

init();
