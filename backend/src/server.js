import "dotenv/config";
import http from "node:http";
import { createApp } from "./app.js";
import { pool } from "./db.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = createApp(config);
const hosts = config.host === "127.0.0.1" ? ["127.0.0.1", "::1"] : [config.host];
const servers = hosts.map((host) => {
  const server = http.createServer(app);
  server.on("error", (error) => {
    console.error("ONO Food API listener error on " + host + ":" + config.port + ": " + error.message);
    if (host !== "::1") shutdown();
  });
  server.listen(config.port, host, () => {
    console.log("ONO Food API listening at http://" + (host.includes(":") ? "[" + host + "]" : host) + ":" + config.port);
  });
  return server;
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await Promise.all(servers.map((server) => new Promise((resolve) => {
    if (!server.listening) return resolve();
    server.close(resolve);
  })));
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
