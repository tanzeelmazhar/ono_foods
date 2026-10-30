const requiredSecrets = ["SESSION_SECRET", "TRACKING_SECRET"];

export function loadConfig(env = process.env) {
  const missing = requiredSecrets.filter((name) => (env[name] || "").length < 32);
  if (missing.length) throw new Error(missing.join(" and ") + " must each contain at least 32 characters.");
  const minimum = Number(env.MIN_ORDER_SUBTOTAL ?? "500.00");
  if (!Number.isFinite(minimum) || minimum < 0) throw new Error("MIN_ORDER_SUBTOTAL must be non-negative.");
  const sameSite = (env.COOKIE_SAME_SITE || "lax").toLowerCase();
  if (!["lax", "strict", "none"].includes(sameSite)) throw new Error("COOKIE_SAME_SITE must be lax, strict, or none.");
  const nodeEnv = env.NODE_ENV || "development";
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const frontendOrigins = new Set((env.FRONTEND_ORIGINS || "http://localhost:3000").split(",").map((origin) => origin.trim()).filter(Boolean));
  if (env.RENDER_EXTERNAL_URL) frontendOrigins.add(env.RENDER_EXTERNAL_URL.replace(/\/$/, ""));
  return {
    port: Number(env.PORT || 3000), host: env.HOST || "127.0.0.1", nodeEnv, databaseUrl: env.DATABASE_URL,
    databaseSsl: env.DATABASE_SSL === "true", sessionSecret: env.SESSION_SECRET,
    trackingSecret: env.TRACKING_SECRET,
    frontendOrigins: [...frontendOrigins],
    cookieSameSite: sameSite, cookieSecure: env.COOKIE_SECURE === "true" || nodeEnv === "production",
    storeTimezone: env.STORE_TIMEZONE || "Asia/Karachi", storeOpenTime: env.STORE_OPEN_TIME || "11:00",
    storeCloseTime: env.STORE_CLOSE_TIME || "24:00", minimumSubtotalCents: Math.round(minimum * 100)
  };
}
