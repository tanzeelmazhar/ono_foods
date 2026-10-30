import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { pool } from "./db.js";
import { loadConfig } from "./config.js";
import { HttpError, errorHandler, notFound } from "./middleware/errors.js";
import { csrfProtection } from "./middleware/security.js";
import { customerRouter } from "./routes/customer.js";
import { orderRouter } from "./routes/orders.js";
import { adminRouter } from "./routes/admin.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendPath = process.env.VERCEL
  ? path.resolve(here, "../runtime-frontend")
  : path.resolve(here, "../../frontend");
const PgStore = connectPgSimple(session);

function standalonePage(filename, fallback) {
  return async (_req, res, next) => {
    try {
      let html;
      try {
        html = await readFile(path.join(frontendPath, filename), "utf8");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        return res.sendFile(path.join(frontendPath, fallback));
      }
      const nonce = randomBytes(18).toString("base64");
      res.setHeader("Content-Security-Policy", [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}'`,
        `style-src 'self' 'nonce-${nonce}'`,
        "img-src 'self' https: data:",
        "connect-src 'self' https: http:",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'"
      ].join("; "));
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.type("html").send(html.replaceAll("__CSP_NONCE__", nonce));
    } catch (error) {
      next(error);
    }
  };
}

export function createApp(config = loadConfig()) {
  const app = express();
  app.locals.config = config;
  if (config.nodeEnv === "production") app.set("trust proxy", 1);

  app.use((req, _res, next) => {
    req.requestId = randomUUID();
    next();
  });
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"],
        imgSrc: ["'self'", "https:", "data:"], connectSrc: ["'self'", "https:", "http:"],
        objectSrc: ["'none'"], baseUri: ["'self'"], frameAncestors: ["'none'"]
      }
    },
    crossOriginResourcePolicy: { policy: "cross-origin" }
  }));
  app.use(cors({
    origin(origin, callback) {
      if (!origin || config.frontendOrigins.includes(origin)) return callback(null, true);
      callback(new HttpError(403, "ORIGIN_NOT_ALLOWED", "This site is not allowed to access the API."));
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-CSRF-Token", "Idempotency-Key"]
  }));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());
  const sessionMiddleware = session({
    name: "ono.sid",
    store: new PgStore({ pool, tableName: "user_sessions", createTableIfMissing: false, pruneSessionInterval: 60 }),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true, secure: config.cookieSecure, sameSite: config.cookieSameSite,
      maxAge: 7 * 24 * 60 * 60 * 1000, path: "/"
    }
  });

  const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: "draft-8", legacyHeaders: false });
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: "draft-8", legacyHeaders: false });
  app.get("/api/v1/health", async (_req, res) => {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  });
  app.use("/api/v1", sessionMiddleware, apiLimiter, csrfProtection);
  app.use("/api/v1/auth/login", authLimiter);
  app.use("/api/v1/auth/register", authLimiter);
  app.use("/api/v1", customerRouter);
  app.use("/api/v1", orderRouter);
  app.use("/api/v1/admin", adminRouter);

  app.get(["/", "/index.html"], standalonePage("storefront-standalone.html", "index.html"));
  app.get(["/admin", "/admin-standalone.html"], standalonePage("admin-standalone.html", "admin.html"));

  app.use(express.static(frontendPath, {
    extensions: ["html"],
    setHeaders(res, filePath) {
      if (/\.(?:html|js)$/i.test(filePath)) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      }
    }
  }));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
