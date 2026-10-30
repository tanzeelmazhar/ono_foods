import { randomBytes, timingSafeEqual } from "node:crypto";
import { HttpError } from "./errors.js";

export function ensureCsrfToken(req, res) {
  if (!req.session.csrfToken) req.session.csrfToken = randomBytes(32).toString("base64url");
  res.json({ csrf_token: req.session.csrfToken });
}

export function csrfProtection(req, _res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const supplied = req.get("x-csrf-token") || "";
  const expected = req.session?.csrfToken || "";
  const received = Buffer.from(supplied);
  const stored = Buffer.from(expected);
  if (!supplied || received.length !== stored.length || !timingSafeEqual(received, stored)) {
    return next(new HttpError(403, "CSRF_VALIDATION_FAILED", "Refresh the page and try again."));
  }
  next();
}

export function guestCartToken(req, res, next) {
  let token = req.cookies?.ono_cart;
  if (!token || !/^[A-Za-z0-9_-]{40,}$/.test(token)) {
    token = randomBytes(32).toString("base64url");
    res.cookie("ono_cart", token, {
      httpOnly: true, secure: req.app.locals.config.cookieSecure,
      sameSite: req.app.locals.config.cookieSameSite, maxAge: 30 * 24 * 60 * 60 * 1000,
      path: "/api/v1"
    });
  }
  req.cartToken = token;
  next();
}

export function requireUser(req, _res, next) {
  if (!req.session?.user) return next(new HttpError(401, "AUTHENTICATION_REQUIRED", "Sign in to continue."));
  next();
}

export function requireAdmin(req, _res, next) {
  if (req.session?.user?.role !== "admin") {
    return next(new HttpError(req.session?.user ? 403 : 401, "ADMIN_ACCESS_REQUIRED", "Admin access is required."));
  }
  next();
}
