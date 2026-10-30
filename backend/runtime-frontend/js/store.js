import { api } from "./api.js";
import { catalogCategories, catalogItems } from "./catalog-data.js";

const $ = (selector, root = document) => root.querySelector(selector);
const readOnlyPreview = window.ONO_CONFIG?.offlinePreview === true;
const state = { config: null, categories: [], items: [], zones: [], cart: { items: [], subtotal_amount: "0.00" }, user: null, category: "all", query: "", availableOnly: false, selectedItem: null, authMode: "login", toastTimer: 0, searchTimer: 0, apiOnline: false };
let reconnectTimer = 0;
let statusTimer = 0;

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function money(value) {
  const amount = Number(value || 0);
  return "PKR " + amount.toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function message(selector, text = "", kind = "") {
  const element = $(selector);
  if (!element) return;
  element.textContent = text;
  element.classList.toggle("error", kind === "error");
  element.classList.toggle("success", kind === "success");
}

function toast(text) {
  const element = $("#toast");
  element.textContent = text;
  element.classList.add("visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => element.classList.remove("visible"), 2800);
}

function showError(target, error) {
  message(target, error.message || "Something went wrong. Please try again.", "error");
}

function openDialog(id) {
  const dialog = document.getElementById(id);
  if (!dialog.open) dialog.showModal();
}

function updateHours() {
  if (!state.config) return;
  if (!state.apiOnline) {
    $("#store-state").textContent = "Ordering service offline";
    $(".hours-stamp").setAttribute("aria-label", "Ordering service unavailable");
    $("#place-order").disabled = true;
    return;
  }
  const ownerPaused = state.config.accepting_orders === false;
  const text = state.config.is_open ? "Taking orders now" : ownerPaused ? "Orders temporarily paused" : "Ordering opens at 11 AM";
  $("#store-state").textContent = text;
  $(".hours-stamp").setAttribute("aria-label", ownerPaused ? "Ordering is paused by ONO Food" : state.config.is_open ? "Open daily from 11 AM to midnight; accepting orders now" : "Open daily from 11 AM to midnight; currently closed");
  $("#place-order").disabled = !state.config.is_open;
  if (!state.config.is_open) message("#checkout-message", "Ordering is closed right now. You can still browse the menu.");
}

function filteredItems() {
  const query = state.query.trim().toLocaleLowerCase();
  return state.items.filter((item) => (state.category === "all" || String(item.category_id) === state.category) &&
    (!state.availableOnly || item.availability_status) &&
    (!query || (item.item_name + " " + (item.description || "") + " " + item.category_name).toLocaleLowerCase().includes(query)));
}

function renderCategories() {
  const options = [{ category_id: "all", category_name: "All items" }, ...state.categories];
  $("#category-list").innerHTML = options.map((category) => `<button class="category-chip" type="button" data-category="${esc(category.category_id)}" aria-pressed="${String(String(category.category_id) === state.category)}">${esc(category.category_name)}</button>`).join("");
}

function watchMenuCards() {
  const cards = document.querySelectorAll(".menu-card.reveal-card:not(.is-visible)");
  if (!("IntersectionObserver" in window)) {
    cards.forEach((card) => card.classList.add("is-visible"));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.12 });
  cards.forEach((card) => observer.observe(card));
}

function renderMenu() {
  const items = filteredItems();
  const grid = $("#menu-grid");
  $("#menu-empty").hidden = items.length > 0;
  grid.hidden = items.length === 0;
  if (!items.length) {
    const emptyTitle = state.items.length ? "No dishes match your search." : "The menu is being prepared.";
    $("#menu-empty h3").textContent = emptyTitle;
    $("#menu-empty > p:last-child").textContent = state.items.length ? "Try another search or category." : "Check back soon for ONO Food's current dishes.";
    return;
  }
  grid.innerHTML = items.map((item) => {
    const customized = item.sizes?.length || item.addons_config?.length;
    const price = item.sizes?.length ? "From " + money(Math.min(...item.sizes.map((size) => Number(size.price)))) : money(item.base_price);
    const hotSeller = item.item_name.toLocaleLowerCase() === "tango zinger burger";
    const reviewCount = Number(item.review_count || 0);
    const rating = Number(item.average_rating || 0);
    const ratingSummary = reviewCount
      ? `<span class="review-stars" aria-label="Rated ${esc(rating)} out of 5">${"★".repeat(Math.round(rating))}${"☆".repeat(5 - Math.round(rating))}</span><span>${esc(rating.toFixed(1))} · ${reviewCount}</span>`
      : `<span>${reviewCount} reviews</span>`;
    return `<article class="menu-card reveal-card">
      <div class="menu-photo">${item.image_url ? `<img src="${esc(item.image_url)}" alt="${esc(item.item_name)}" loading="lazy">` : `<div class="photo-fallback"><span>ONO</span></div>`}${hotSeller ? '<span class="hot-seller-label">Hot selling</span>' : ""}</div>
      <div class="menu-card-top"><div><p class="menu-category">${esc(item.category_name)}</p><h3>${esc(item.item_name)}</h3></div>${item.availability_status ? "" : '<span class="stock-label">Out of stock</span>'}</div>
      <p class="menu-description">${esc(item.description || "")}</p>
      <button class="review-link" type="button" data-product-reviews="${esc(item.item_id)}" data-product-name="${esc(item.item_name)}" aria-label="Read ${esc(item.item_name)} reviews">${ratingSummary}</button>
      <div class="menu-card-bottom"><span class="menu-price">${esc(price)}</span><button class="menu-add" type="button" data-add-item="${esc(item.item_id)}" ${readOnlyPreview || !item.availability_status ? "disabled" : ""}>${readOnlyPreview ? "Preview only" : customized ? "Choose options" : "Add"}</button></div>
    </article>`;
  }).join("");
  grid.querySelectorAll(".menu-photo img").forEach((image) => image.addEventListener("error", () => image.remove()));
  watchMenuCards();
}

function fillZoneSelects() {
  const zones = state.zones.map((zone) => `<option value="${esc(zone.zone_id)}">${esc(zone.zone_name)} - ${esc(money(zone.delivery_fee))}</option>`).join("");
  for (const select of [$("#checkout-form [name=delivery_zone_id]"), $("#profile-form [name=default_zone_id]")]) {
    const previous = select.value;
    const placeholder = select.name === "default_zone_id" ? "No default zone" : "Choose a zone";
    select.innerHTML = `<option value="">${placeholder}</option>${zones}`;
    if (previous) select.value = previous;
  }
}

async function loadMenu() {
  if (!state.apiOnline) {
    renderMenu();
    return;
  }
  const params = new URLSearchParams({ limit: "48" });
  if (state.query) params.set("q", state.query);
  if (state.category !== "all") params.set("category_id", state.category);
  if (state.availableOnly) params.set("available", "true");
  const result = await api.get("/menu-items?" + params.toString());
  state.items = result.items;
  renderMenu();
}

async function loadCart() {
  const result = await api.get("/cart");
  state.cart = result.cart;
  renderCart();
}

function renderCart() {
  const items = state.cart.items || [];
  const count = items.reduce((sum, item) => sum + Number(item.quantity), 0);
  $("#cart-count").textContent = count;
  $("#drawer-cart-count").textContent = count ? `(${count})` : "";
  $("#cart-subtotal").textContent = money(state.cart.subtotal_amount);
  const minimum = Number(state.config?.minimum_subtotal || 500);
  const available = items.every((item) => item.available);
  const enough = Number(state.cart.subtotal_amount) >= minimum;
  $("#checkout-open").disabled = !state.apiOnline || !items.length || !available || !enough;
  message("#cart-minimum-message", !state.apiOnline ? "Checkout is unavailable until the ordering service is connected." : !items.length ? "Your cart is empty." : !available ? "Remove unavailable items before checkout." : !enough ? `Add ${money(minimum - Number(state.cart.subtotal_amount))} more to reach the minimum.` : "Your cart meets the minimum order.", state.apiOnline && enough && available && items.length ? "success" : "");
  if (!items.length) {
    $("#cart-lines").innerHTML = '<p class="empty-cart">Your cart is empty. Browse the menu to start an order.</p>';
    return;
  }
  $("#cart-lines").innerHTML = items.map((item) => `<article class="cart-line" data-line="${esc(item.cart_item_id)}">
    <div><h3>${esc(item.item_name)}</h3><p>${esc([item.size_option, ...(item.selected_addons || []).map((addon) => addon.name)].filter(Boolean).join(" / ") || "Standard")}</p>${item.available ? "" : '<p class="error-text">Unavailable</p>'}</div>
    <strong class="cart-line-total">${esc(money(item.line_subtotal))}</strong>
    <div class="quantity-controls"><button type="button" data-quantity="-1" aria-label="Decrease quantity" ${item.quantity <= 1 ? "disabled" : ""}>-</button><span>${esc(item.quantity)}</span><button type="button" data-quantity="1" aria-label="Increase quantity" ${item.quantity >= 99 ? "disabled" : ""}>+</button><button class="remove-line" type="button" data-remove-line>Remove</button></div>
  </article>`).join("");
}

function renderCustomizer(item) {
  state.selectedItem = item;
  const openedAsFile = window.location.protocol === "file:";
  const options = $("#customize-options");
  const sizes = item.sizes || [];
  const addons = item.addons_config || [];
  let html = "";
  if (sizes.length) html += `<fieldset class="option-group"><legend>Choose a size</legend>${sizes.map((size, index) => `<label class="option-choice"><span>${esc(size.name)} - ${esc(money(size.price))}</span><input type="radio" name="size_option" value="${esc(size.id)}" ${index === 0 ? "checked" : ""} required></label>`).join("")}</fieldset>`;
  if (addons.length) html += `<fieldset class="option-group"><legend>Add-ons</legend>${addons.map((addon) => `<label class="option-choice"><span>${esc(addon.name)}${addon.required ? " (required)" : ""} - ${esc(money(addon.price))}</span><input type="checkbox" name="addon" value="${esc(addon.id)}" ${addon.required ? "required checked" : ""}></label>`).join("")}</fieldset>`;
  $("#customize-options").innerHTML = html || '<p>No custom options are available.</p>';
  $("#customize-title").textContent = item.item_name;
  $("#customize-price").textContent = money(sizes.length ? sizes[0].price : item.base_price);
  const submitButton = $("#customize-form button[type=submit]");
  submitButton.disabled = readOnlyPreview || !item.availability_status || openedAsFile;
  submitButton.textContent = readOnlyPreview ? "Preview only" : "Add to cart";
  const serviceMessage = openedAsFile
    ? "This HTML file cannot connect to your cart or order database. Start ONO Food.cmd, then use the live website."
    : !state.apiOnline && !readOnlyPreview ? "Ordering service is disconnected. Start ONO Food, then try again." : "";
  message("#customize-message", serviceMessage, serviceMessage ? "error" : "");
  $("#customize-live-link").hidden = !openedAsFile;
  options.querySelectorAll("input").forEach((input) => input.addEventListener("change", () => {
    const choice = sizes.find((size) => size.id === options.querySelector("[name=size_option]:checked")?.value);
    const extras = [...options.querySelectorAll("[name=addon]:checked")].reduce((sum, selected) => sum + Number(addons.find((addon) => addon.id === selected.value)?.price || 0), 0);
    $("#customize-price").textContent = money((choice ? Number(choice.price) : Number(item.base_price)) + extras);
  }));
  openDialog("customize-dialog");
}

async function addItem(item, customization = {}) {
  await api.post("/cart/items", { item_id: item.item_id, quantity: 1, size_option: customization.size_option || null, addons: customization.addons || [] });
  await loadCart();
  $("#customize-dialog").close();
  toast("Added to your cart");
}

async function loadAccount() {
  const result = await api.get("/account/profile");
  const profile = result.profile;
  const form = $("#profile-form");
  for (const field of ["full_name", "phone_number", "default_address", "default_zone_id"]) form.elements[field].value = profile[field] ?? "";
  const { orders } = await api.get("/account/orders");
  $("#account-orders-list").innerHTML = orders.length ? orders.map((order) => `<div class="account-order-row"><span>#${esc(order.order_id)} - ${esc(order.order_status)} - ${esc(money(order.total_amount))}</span><button type="button" data-track="${esc(order.order_id)}">Track</button></div>`).join("") : '<p class="muted-copy">No orders yet.</p>';
}

function setAuthMode(mode) {
  state.authMode = mode;
  const register = mode === "register";
  $("#auth-name-field").hidden = !register;
  $("#auth-phone-field").hidden = !register;
  $("#auth-form [name=full_name]").required = register;
  $("#auth-form [name=phone_number]").required = register;
  $("#auth-form [name=password]").autocomplete = register ? "new-password" : "current-password";
  $("#auth-form [name=password]").minLength = register ? 12 : 1;
  $("#auth-submit").textContent = register ? "Create account" : "Sign in";
  document.querySelectorAll("[data-auth-mode]").forEach((button) => button.classList.toggle("selected", button.dataset.authMode === mode));
  message("#auth-message");
}

async function openAccount() {
  openDialog("account-dialog");
  $("#auth-panel").hidden = Boolean(state.user);
  $("#account-panel").hidden = !state.user;
  if (state.user) {
    try { await loadAccount(); } catch (error) { showError("#profile-message", error); }
  }
}

async function trackOrder(orderId) {
  message("#tracking-message");
  if (!state.apiOnline) {
    message("#tracking-message", readOnlyPreview ? "Order tracking is available on the full ONO Food website." : "The ordering database is disconnected. Start ONO Food and reload this page.", "error");
    openDialog("tracking-dialog");
    return;
  }
  try {
    const { order } = await api.get("/orders/" + encodeURIComponent(orderId));
    $("#tracking-title").dataset.orderId = order.order_id;
    const canCancel = order.order_status === "Pending";
    const history = order.status_history.map((entry) => `<li>${esc(entry.new_status)}<time>${esc(new Date(entry.changed_at).toLocaleString())}</time></li>`).join("");
    const lines = order.items.map((item) => {
      const stars = Number(item.review_rating || 0);
      const existingReview = item.review_rating == null ? "" : `<div class="submitted-review"><span class="review-stars" aria-label="${esc(stars)} out of 5 stars">${"★".repeat(stars)}${"☆".repeat(5 - stars)}</span>${item.review_text ? `<p>${esc(item.review_text)}</p>` : "<p>Rating submitted. Thank you.</p>"}</div>`;
      const reviewForm = order.order_status === "Delivered" && item.review_rating == null ? `<form class="order-review-form" data-order-review="${esc(item.order_item_id)}"><fieldset class="rating-picker"><legend>Your rating</legend>${[1, 2, 3, 4, 5].map((rating) => `<label><input type="radio" name="rating" value="${rating}" required><span aria-hidden="true">★</span><span class="visually-hidden">${rating} ${rating === 1 ? "star" : "stars"}</span></label>`).join("")}</fieldset><label class="review-input-label">Your review <span class="optional-label">Optional</span><textarea name="review_text" maxlength="1000" rows="2" placeholder="How was it?"></textarea></label><button class="button button-outline" type="submit">Submit review</button></form>` : existingReview;
      return `<div class="tracked-line"><span>${esc(item.quantity)} x ${esc(item.item_name_snapshot)}${item.size_option ? ` (${esc(item.size_option)})` : ""}</span><strong>${esc(money(item.subtotal))}</strong>${reviewForm}</div>`;
    }).join("");
    $("#tracking-details").innerHTML = `<div class="order-status-block"><p class="eyebrow">ORDER #${esc(order.order_id)}</p><p class="order-status-name">${esc(order.order_status)}</p><p class="order-status-meta">${esc(new Date(order.order_timestamp).toLocaleString())} / ${esc(order.payment_type)}</p></div><div class="tracked-items">${lines}</div><div class="tracked-totals"><span>Food subtotal</span><strong>${esc(money(order.subtotal_amount))}</strong><span>Delivery</span><strong>${esc(money(order.delivery_fee))}</strong><span>Total due on delivery</span><strong>${esc(money(order.total_amount))}</strong></div><ol class="status-history">${history}</ol>${canCancel ? `<button class="button button-outline button-wide" type="button" id="cancel-order" data-order-id="${esc(order.order_id)}">Cancel pending order</button>` : ""}`;
    openDialog("tracking-dialog");
  } catch (error) { showError("#tracking-message", error); openDialog("tracking-dialog"); }
}

async function openProductReviews(itemId, itemName) {
  $("#product-reviews-title").textContent = itemName + " reviews";
  $("#product-reviews-content").innerHTML = '<p class="muted-copy">Loading reviews...</p>';
  message("#product-reviews-message");
  openDialog("product-reviews-dialog");
  try {
    const result = await api.get(`/menu-items/${encodeURIComponent(itemId)}/reviews`);
    $("#product-reviews-content").innerHTML = result.reviews.length
      ? result.reviews.map((review) => `<article class="public-review"><div><strong>${esc(review.reviewer_name || "ONO customer")}</strong><span class="review-stars" aria-label="${esc(review.rating)} out of 5 stars">${"★".repeat(Number(review.rating))}${"☆".repeat(5 - Number(review.rating))}</span></div><time>${esc(new Date(review.created_at).toLocaleDateString())}</time>${review.review_text ? `<p>${esc(review.review_text)}</p>` : ""}</article>`).join("")
      : '<p class="muted-copy">No reviews yet.</p>';
    if (result.review_count) message("#product-reviews-message", `${Number(result.average_rating).toFixed(1)} out of 5 · ${result.review_count} customer ratings`);
  } catch (error) {
    $("#product-reviews-content").innerHTML = "";
    showError("#product-reviews-message", error);
  }
}

function fillCheckout() {
  const form = $("#checkout-form");
  const profile = $("#profile-form");
  if (!state.user) return;
  form.elements.customer_name.value = profile.elements.full_name.value || state.user.full_name || "";
  form.elements.customer_phone.value = profile.elements.phone_number.value || "";
  form.elements.delivery_address.value = profile.elements.default_address.value || "";
  form.elements.delivery_zone_id.value = profile.elements.default_zone_id.value || "";
}

function bindEvents() {
  $("#menu-search").addEventListener("input", (event) => {
    state.query = event.target.value;
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => loadMenu().catch((error) => message("#menu-message", error.message, "error")), 200);
  });
  $("#available-only").addEventListener("change", (event) => { state.availableOnly = event.target.checked; loadMenu().catch((error) => message("#menu-message", error.message, "error")); });
  $("#category-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    state.category = button.dataset.category;
    renderCategories();
    loadMenu().catch((error) => message("#menu-message", error.message, "error"));
  });
  $("#menu-grid").addEventListener("click", async (event) => {
    const reviewsButton = event.target.closest("[data-product-reviews]");
    if (reviewsButton) {
      await openProductReviews(reviewsButton.dataset.productReviews, reviewsButton.dataset.productName);
      return;
    }
    const button = event.target.closest("[data-add-item]");
    if (!button) return;
    const item = state.items.find((entry) => String(entry.item_id) === button.dataset.addItem);
    if (!item) return;
    try { if (item.sizes?.length || item.addons_config?.length) renderCustomizer(item); else await addItem(item); }
    catch (error) { message("#menu-message", error.message, "error"); }
  });
  $("#customize-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const item = state.selectedItem;
    const submit = $("#customize-form button[type=submit]");
    submit.disabled = true;
    submit.textContent = "Adding...";
    try {
      if (!state.apiOnline) await connectToBackend();
      if (!state.apiOnline) throw new Error("Ordering is offline. Please try again in a moment.");
      await addItem(item, { size_option: form.get("size_option"), addons: form.getAll("addon") });
    } catch (error) {
      if (!error.status) {
        state.apiOnline = false;
        updateHours();
        renderMenu();
        renderCart();
        startReconnectLoop();
      }
      submit.disabled = !item?.availability_status;
      submit.textContent = "Add to cart";
      message("#customize-message", error.message || "Could not connect. Start ONO Food and try again.", "error");
    }
  });
  $("#cart-open").addEventListener("click", () => { openDialog("cart-dialog"); loadCart().catch((error) => message("#cart-message", error.message, "error")); });
  $("#cart-lines").addEventListener("click", async (event) => {
    const line = event.target.closest("[data-line]");
    if (!line) return;
    try {
      if (event.target.closest("[data-remove-line]")) await api.delete("/cart/items/" + line.dataset.line);
      else if (event.target.closest("[data-quantity]")) {
        const current = Number(line.querySelector(".quantity-controls span").textContent);
        const quantity = current + Number(event.target.dataset.quantity);
        if (quantity < 1) return;
        await api.patch("/cart/items/" + line.dataset.line, { quantity });
      } else return;
      await loadCart();
    } catch (error) { message("#cart-message", error.message, "error"); }
  });
  $("#checkout-open").addEventListener("click", async () => {
    fillCheckout();
    const selectedZone = state.zones.find((zone) => String(zone.zone_id) === $("#checkout-form [name=delivery_zone_id]").value);
    $("#checkout-total").textContent = money(Number(state.cart.subtotal_amount) + Number(selectedZone?.delivery_fee || 0));
    $("#cart-dialog").close();
    openDialog("checkout-dialog");
    if (state.user && !$("#checkout-form [name=customer_phone]").value) {
      try { await loadAccount(); fillCheckout(); } catch {}
    }
  });
  $("#checkout-form [name=delivery_zone_id]").addEventListener("change", (event) => {
    const zone = state.zones.find((entry) => String(entry.zone_id) === event.target.value);
    $("#checkout-total").textContent = money(Number(state.cart.subtotal_amount) + Number(zone?.delivery_fee || 0));
  });
  $("#checkout-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = $("#place-order");
    submit.disabled = true;
    message("#checkout-message");
    try {
      const fields = Object.fromEntries(new FormData(event.currentTarget));
      const key = crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const result = await api.post("/checkout", { ...fields, payment_type: "COD" }, { "Idempotency-Key": key });
      $("#checkout-dialog").close();
      await loadCart();
      await trackOrder(result.order.order_id);
      toast(`Order #${result.order.order_id} placed`);
    } catch (error) { showError("#checkout-message", error); }
    finally { submit.disabled = !state.config?.is_open; }
  });
  $("#account-open").addEventListener("click", () => openAccount());
  document.querySelectorAll("[data-auth-mode]").forEach((button) => button.addEventListener("click", () => setAuthMode(button.dataset.authMode)));
  $("#auth-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form);
    try {
      const result = await api.post(state.authMode === "register" ? "/auth/register" : "/auth/login", body);
      state.user = result.user;
      $("#auth-form").reset();
      await openAccount();
      toast("Signed in");
    } catch (error) { showError("#auth-message", error); }
  });
  $("#profile-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const { profile } = await api.patch("/account/profile", { ...body, default_zone_id: body.default_zone_id || null });
      state.user.full_name = profile.full_name;
      message("#profile-message", "Profile saved.", "success");
    } catch (error) { showError("#profile-message", error); }
  });
  $("#sign-out").addEventListener("click", async () => {
    try { await api.post("/auth/logout", {}); state.user = null; $("#account-panel").hidden = true; $("#auth-panel").hidden = false; setAuthMode("login"); toast("Signed out"); }
    catch (error) { showError("#profile-message", error); }
  });
  $("#track-form").addEventListener("submit", (event) => { event.preventDefault(); trackOrder($("#track-order-id").value.trim()); });
  $("#account-orders-list").addEventListener("click", (event) => { const button = event.target.closest("[data-track]"); if (button) trackOrder(button.dataset.track); });
  $("#tracking-details").addEventListener("click", async (event) => {
    if (event.target.id !== "cancel-order") return;
    event.target.disabled = true;
    try { await api.post(`/orders/${event.target.dataset.orderId}/cancel`, {}); await trackOrder(event.target.dataset.orderId); toast("Order cancelled"); }
    catch (error) { showError("#tracking-message", error); event.target.disabled = false; }
  });
  $("#tracking-details").addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-order-review]");
    if (!form) return;
    event.preventDefault();
    const button = form.querySelector("[type=submit]");
    button.disabled = true;
    try {
      const data = new FormData(form);
      const orderId = $("#tracking-title").dataset.orderId;
      await api.post("/orders/" + encodeURIComponent(orderId) + "/reviews", {
        order_item_id: form.dataset.orderReview,
        rating: data.get("rating"),
        review_text: data.get("review_text")
      });
      await trackOrder(orderId);
      await loadMenu();
      toast("Thank you for reviewing your order");
    } catch (error) {
      showError("#tracking-message", error);
      button.disabled = false;
    }
  });
  document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => document.getElementById(button.dataset.close).close()));
  for (const dialog of document.querySelectorAll("dialog")) dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) { event.preventDefault(); $("#menu-search").focus(); }
  });
}

async function connectToBackend() {
  const [config, categories, zones, me] = await Promise.all([api.get("/config"), api.get("/categories"), api.get("/delivery-zones"), api.get("/auth/me")]);
  state.apiOnline = true;
  state.config = config;
  state.categories = categories.categories;
  state.zones = zones.zones;
  state.user = me.user;
  $(".minimum-note").textContent = money(config.minimum_subtotal) + " minimum food subtotal";
  $(".cart-summary > div:nth-child(2) strong").textContent = money(config.minimum_subtotal);
  updateHours();
  renderCategories();
  fillZoneSelects();
  await Promise.all([loadMenu(), loadCart()]);
  if (state.user) {
    try {
      await loadAccount();
    } catch (error) {
      if (error.status === 401 || error.status === 404) {
        state.user = null;
        $("#account-panel").hidden = true;
        $("#auth-panel").hidden = false;
        message("#auth-message", "Your sign-in session expired. Please sign in again.", "error");
      } else {
        showError("#profile-message", error);
      }
    }
  }
  const customizeSubmit = $("#customize-form button[type=submit]");
  if (customizeSubmit) {
    customizeSubmit.disabled = !state.selectedItem?.availability_status;
    customizeSubmit.textContent = "Add to cart";
    message("#customize-message");
  }
  const menuMessage = $("#menu-message").textContent;
  if (menuMessage.startsWith("Menu preview only") || menuMessage.startsWith("Ordering service disconnected")) message("#menu-message");
  $("#live-site-link").hidden = true;
  $("#customize-live-link").hidden = true;
  if (!statusTimer) {
    statusTimer = setInterval(() => api.get("/config").then((updated) => {
      state.apiOnline = true;
      state.config = updated;
      updateHours();
    }).catch(() => {
      state.apiOnline = false;
      renderMenu();
      renderCart();
      const submit = $("#customize-form button[type=submit]");
      if (submit) {
        submit.disabled = !state.selectedItem?.availability_status;
        submit.textContent = "Add to cart";
        message("#customize-message", "Ordering service disconnected. Reconnecting now.", "error");
      }
      message("#menu-message", "Ordering service disconnected. Reconnecting now.", "error");
      startReconnectLoop();
    }), 60_000);
  }
}

function startReconnectLoop() {
  if (reconnectTimer || readOnlyPreview || window.location.protocol === "file:") return;
  reconnectTimer = setInterval(async () => {
    try {
      await connectToBackend();
      clearInterval(reconnectTimer);
      reconnectTimer = 0;
    } catch {
      state.apiOnline = false;
      renderMenu();
      renderCart();
      const submit = $("#customize-form button[type=submit]");
      if (submit) {
        submit.disabled = !state.selectedItem?.availability_status;
        submit.textContent = "Add to cart";
        message("#customize-message", "Ordering service disconnected. Reconnecting now.", "error");
      }
    }
  }, 5_000);
}

async function init() {
  bindEvents();
  renderCategories();
  try {
    await connectToBackend();
  } catch (error) {
    state.apiOnline = false;
    state.config = { currency: "PKR", minimum_subtotal: "500.00", store_timezone: "Asia/Karachi", opens_at: "11:00", closes_at: "24:00", is_open: false, payment_type: "COD" };
    state.categories = catalogCategories;
    state.items = catalogItems;
    $(".minimum-note").textContent = money(state.config.minimum_subtotal) + " minimum food subtotal";
    $(".cart-summary > div:nth-child(2) strong").textContent = money(state.config.minimum_subtotal);
    $("#store-state").textContent = "Ordering service offline";
    $(".hours-stamp").setAttribute("aria-label", "Ordering service unavailable");
    $("#place-order").disabled = true;
    renderCategories();
    fillZoneSelects();
    renderMenu();
    renderCart();
    const openedAsFile = window.location.protocol === "file:";
    const startupMessage = readOnlyPreview
      ? "Shared menu preview. Ordering and order tracking need the full ONO Food website."
      : openedAsFile
        ? "This HTML file was opened directly and cannot connect to the order database. Start ONO Food.cmd, then open the live website."
        : `Could not connect to the ONO Food database (${error.message}). Start ONO Food.cmd, then reload this page.`;
    message("#menu-message", startupMessage, "error");
    $("#live-site-link").hidden = !openedAsFile;
    startReconnectLoop();
  }
}

init();
