import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";

test("Render's assigned HTTPS origin is accepted for same-origin API requests", () => {
  const config = loadConfig({
    DATABASE_URL: "postgres://ono_app:secret@localhost/ono_food",
    SESSION_SECRET: "s".repeat(32),
    TRACKING_SECRET: "t".repeat(32),
    RENDER_EXTERNAL_URL: "https://ono-food-preview.onrender.com/"
  });

  assert.ok(config.frontendOrigins.includes("https://ono-food-preview.onrender.com"));
});

test("configured trusted origins remain available alongside Render's origin", () => {
  const config = loadConfig({
    DATABASE_URL: "postgres://ono_app:secret@localhost/ono_food",
    SESSION_SECRET: "s".repeat(32),
    TRACKING_SECRET: "t".repeat(32),
    FRONTEND_ORIGINS: "https://menu.example.test,https://admin.example.test",
    RENDER_EXTERNAL_URL: "https://ono-food-preview.onrender.com"
  });

  assert.deepEqual(config.frontendOrigins, [
    "https://menu.example.test",
    "https://admin.example.test",
    "https://ono-food-preview.onrender.com"
  ]);
});
