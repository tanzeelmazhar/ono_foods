import { readFile, writeFile, copyFile, mkdir, rename, cp } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { promisify } from "node:util";

const runFile = promisify(execFile);

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const frontendRoot = path.join(projectRoot, "frontend");
const backendRoot = path.join(projectRoot, "backend");
const outputRoot = path.join(projectRoot, "outputs");
const shareRoot = path.join(outputRoot, "ONO-Food-Website");
const resolvedOutputRoot = path.resolve(outputRoot);
const resolvedShareRoot = path.resolve(shareRoot);
if (path.dirname(resolvedShareRoot) !== resolvedOutputRoot || path.basename(resolvedShareRoot) !== "ONO-Food-Website") {
  throw new Error("Refusing to write to an unexpected share output folder.");
}
const source = (await readFile(path.join(frontendRoot, "js", "catalog-data.js"), "utf8"))
  .replace(/^export const /gm, "const ") + "\nglobalThis.catalogCategories = catalogCategories; globalThis.catalogItems = catalogItems;";
const catalog = {};
runInNewContext(source, catalog);

const imageNames = new Set(["ono-profile.jpg", "ono-catalog-cover.jpg"]);
const videoNames = new Set(["tango-zinger-burger.mp4"]);
for (const item of catalog.catalogItems) imageNames.add(path.basename(item.image_url));
let [html, css, store, adminHtml, adminCss, adminJs, apiJs, heroVideoJs] = await Promise.all([
  readFile(path.join(frontendRoot, "index.html"), "utf8"),
  readFile(path.join(frontendRoot, "css", "styles.css"), "utf8"),
  readFile(path.join(frontendRoot, "js", "store.js"), "utf8"),
  readFile(path.join(frontendRoot, "admin.html"), "utf8"),
  readFile(path.join(frontendRoot, "css", "admin.css"), "utf8"),
  readFile(path.join(frontendRoot, "js", "admin.js"), "utf8"),
  readFile(path.join(frontendRoot, "js", "api.js"), "utf8"),
  readFile(path.join(frontendRoot, "js", "hero-video.js"), "utf8")
]);

html = html
  .replace('<link rel="stylesheet" href="/css/styles.css">', '<link rel="stylesheet" href="./styles.css">')
  .replace('src="/videos/', 'src="./videos/')
  .replace('src="/js/hero-video.js"', 'src="./hero-video.js"')
  .replace(/  <script src="\/js\/config\.js" defer><\/script>\r?\n/, "")
  .replace(/  <script type="module" src="\/js\/store\.js"><\/script>\r?\n/, '  <script src="./catalog-data.js" defer></script>\n  <script src="./app.js" defer></script>\n')
  .replace(/(?:src|poster)="\/images\/([^"]+)"/g, (_match, filename) => _match.startsWith("poster") ? 'poster="./images/' + filename + '"' : 'src="./images/' + filename + '"')
  .replace('href="/"', 'href="#top"')
  .replace("<body>", '<body id="top">');
adminHtml = adminHtml
  .replace('<link rel="stylesheet" href="/css/styles.css">', '<link rel="stylesheet" href="./styles.css">')
  .replace('<link rel="stylesheet" href="/css/admin.css">', '<link rel="stylesheet" href="./admin.css">')
  .replace('<script src="/js/config.js" defer></script>', '<script src="./config.js" defer></script>')
  .replace('<script type="module" src="/js/admin.js"></script>', '<script type="module" src="./admin.js"></script>')
  .replace('href="/"', 'href="./index.html"')
  .replace(/(?:src|poster)="\/images\/([^\"]+)"/g, (_match, filename) => _match.startsWith("poster") ? 'poster="./images/' + filename + '"' : 'src="./images/' + filename + '"');
const adminInlineScript = (apiJs.replace(/^export const api =/m, "const api =") + "\n" + adminJs.replace(/^import .*;\r?\n/gm, ""))
  .replace(/<\/script/gi, "<\\/script");
const adminLogoDataUri = "data:image/jpeg;base64," + (await readFile(path.join(frontendRoot, "images", "ono-profile.jpg"))).toString("base64");
const adminInlineCss = (css + "\n" + adminCss).replace(/<\/style/gi, "<\\/style");
const standaloneAdminHtml = adminHtml
  .replace('<link rel="stylesheet" href="./styles.css">', '<style nonce="__CSP_NONCE__">\n' + adminInlineCss + "\n</style>")
  .replace('<link rel="stylesheet" href="./admin.css">', "")
  .replace('<script src="./config.js" defer></script>', '<script type="module" nonce="__CSP_NONCE__">window.ONO_CONFIG = { apiBaseUrl: "/api/v1" }; if (location.protocol === "file:") { document.addEventListener("DOMContentLoaded", () => { document.getElementById("admin-file-notice").hidden = false; document.getElementById("admin-login-form").hidden = true; }); }\n' + adminInlineScript + "</script>")
  .replace('<script type="module" src="./admin.js"></script>', "")
  .replace('src="./images/ono-profile.jpg"', 'src="' + adminLogoDataUri + '"');
if (/(?:href|src)="(?:\.\/)?(?:styles\.css|admin\.css|(?:admin|api|config)\.js|images\/)/i.test(standaloneAdminHtml)) {
  throw new Error("The standalone admin still contains a local asset reference.");
}
if (!standaloneAdminHtml.includes('location.protocol === "file:"') || !standaloneAdminHtml.includes('id="admin-file-notice"')) {
  throw new Error("The standalone admin must explain that file:// pages need the live dashboard.");
}
await writeFile(path.join(frontendRoot, "admin-standalone.html"), standaloneAdminHtml, "utf8");
store = store.replace(/^import .*;\r?\n/gm, "");
await mkdir(shareRoot, { recursive: true });
const safeSourcePath = (sourcePath) => {
  const segments = path.relative(projectRoot, sourcePath).split(path.sep);
  return path.basename(sourcePath) !== ".env" && !segments.includes(".git");
};
const sourcePostgres = await readFile(path.join(projectRoot, ".tools", "pgsql", "bin", "postgres.exe"));
const targetPostgres = await readFile(path.join(shareRoot, "database", "postgresql", "bin", "postgres.exe")).catch(() => null);
const copyPortableRuntime = !targetPostgres || !sourcePostgres.equals(targetPostgres);
await Promise.all([
  cp(frontendRoot, path.join(shareRoot, "frontend"), { recursive: true, filter: safeSourcePath }),
  cp(backendRoot, path.join(shareRoot, "backend"), { recursive: true, filter: safeSourcePath }),
  ...(copyPortableRuntime ? [cp(path.join(projectRoot, ".tools", "pgsql"), path.join(shareRoot, "database", "postgresql"), { recursive: true })] : []),
  mkdir(path.join(shareRoot, "scripts"), { recursive: true })
]);
await Promise.all([
  copyFile(path.join(projectRoot, "scripts", "start-ono-food.ps1"), path.join(shareRoot, "scripts", "start-ono-food.ps1")),
  copyFile(path.join(projectRoot, "scripts", "stop-ono-food.ps1"), path.join(shareRoot, "scripts", "stop-ono-food.ps1"))
]);
await copyFile(path.join(projectRoot, ".env.example"), path.join(shareRoot, ".env.example"));
await copyFile(path.join(projectRoot, ".env.example"), path.join(shareRoot, "backend", ".env.example"));
await copyFile(path.join(projectRoot, ".gitignore"), path.join(shareRoot, ".gitignore"));
const imageDataUris = new Map(await Promise.all([...imageNames].map(async (filename) => {
  const bytes = await readFile(path.join(frontendRoot, "images", filename));
  return [filename, "data:image/jpeg;base64," + bytes.toString("base64")];
})));
const embeddedCatalog = {
  categories: catalog.catalogCategories,
  items: catalog.catalogItems.map((item) => ({ ...item, image_url: imageDataUris.get(path.basename(item.image_url)) }))
};
const embeddedCss = css.replace(/url\((['"]?)(?:\.\/)?images\/([^)'\"]+)\1\)/g, (_match, _quote, filename) => {
  return "url(\"" + (imageDataUris.get(filename) || "") + "\")";
}).replace(/<\/style/gi, "<\\/style");
const embeddedStore = [
  'window.ONO_CONFIG = { apiBaseUrl: "/api/v1" };',
  "const catalogCategories = window.ONO_CATALOG.categories;",
  "const catalogItems = window.ONO_CATALOG.items;",
  apiJs.replace(/^export const api =/m, "const api ="),
  store
].join("\n").replace(/<\/script/gi, "<\\/script");
const embeddedVideo = "data:video/mp4;base64," + (await readFile(path.join(frontendRoot, "videos", "tango-zinger-burger.mp4"))).toString("base64");
const singleFileHtml = html
  .replace('<link rel="stylesheet" href="./styles.css">', '<style nonce="__CSP_NONCE__">\n' + embeddedCss + "\n</style>")
  .replace('<script src="./hero-video.js" defer></script>', '<script type="module" nonce="__CSP_NONCE__">' + heroVideoJs.replace(/<\/script/gi, "<\\/script") + "</script>")
  .replace('<script src="./catalog-data.js" defer></script>', '<script nonce="__CSP_NONCE__">window.ONO_CATALOG = ' + JSON.stringify(embeddedCatalog).replace(/</g, "\\u003c") + ";</script>")
  .replace('<script src="./app.js" defer></script>', '<script type="module" nonce="__CSP_NONCE__">' + embeddedStore + "</script>")
  .replace(/(src|poster)="\.\/images\/([^"]+)"/g, (_match, attribute, filename) => attribute + '="' + (imageDataUris.get(filename) || "") + '"')
  .replace(/src="\.\/videos\/([^"]+)"/g, 'src="' + embeddedVideo + '"');
if (/(?:href|src|poster)="(?:\.\/)?(?:styles\.css|(?:app|api|catalog-data|config|hero-video)\.js|images\/|videos\/)/i.test(singleFileHtml)) {
  throw new Error("The single-file menu still contains an external local asset reference.");
}
if (singleFileHtml.includes("offlinePreview: true") || singleFileHtml.includes("This shared menu is a preview")) {
  throw new Error("The single-file menu must use the live ordering API, not the offline preview.");
}
await writeFile(path.join(frontendRoot, "storefront-standalone.html"), singleFileHtml, "utf8");
await copyFile(path.join(frontendRoot, "storefront-standalone.html"), path.join(shareRoot, "frontend", "storefront-standalone.html"));
const indexShortcut = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=ONO-Food-Menu.html"><title>ONO Food</title></head><body><a href="ONO-Food-Menu.html">Open the ONO Food menu</a></body></html>\n';
const projectReadme = [
  "# ONO Food Website - Full Project",
  "",
  "ONO-Food-Menu.html and ONO-Food-Admin.html are single-file browser clients. Their cart, checkout, order tracking, reviews, admin login, and dashboard features connect to the included backend and PostgreSQL database when the website is running. Editable source is included in frontend/ and backend/.",
  "",
  "## Included",
  "",
  "- frontend/: single-file customer and admin pages, plus editable HTML, CSS, JavaScript, catalog photos, and the supplied video.",
  "- backend/src/: REST API, authentication, security, order, catalog, admin, and review logic.",
  "- backend/migrations/: all numbered PostgreSQL schema migrations.",
  "- backend/scripts/ and backend/tests/: migrations, catalog and delivery-area seed, admin setup, package build, and tests.",
  "- backend/node_modules/ and backend/package-lock.json: ready-to-run Node.js dependencies plus the pinned dependency graph.",
  "- render.yaml: optional temporary Render preview deployment using a fresh online PostgreSQL database.",
  "- database/postgresql/: portable PostgreSQL 18 runtime. The private database data is created on first run and is not included.",
  "- scripts/: first-run setup, server launch, and shutdown helpers.",
  "",
  "## Requirements",
  "",
  "Install Node.js 22 or later. PostgreSQL is included; no separate PostgreSQL installation is needed.",
  "",
  "## First setup",
  "",
  "1. Install Node.js 22 or later if it is not already installed.",
  "2. Double-click Start Full Website.cmd. The first run creates the local PostgreSQL database, applies migrations, loads the 8 catalog items and 7 configured delivery areas, and asks you to create the owner email, name, phone, and a private 12+ character password. Separate random session and tracking secrets are generated automatically.",
  "3. The customer website opens at http://localhost:3000 and the admin dashboard is at http://localhost:3000/admin. Use the owner login you just created. Do not open the HTML files directly from File Explorer; file:// pages cannot connect to the database-backed API.",
  "4. Double-click Stop ONO Food.cmd to stop the site and local database. The database remains in database/data, so future launches keep orders, reviews, and admin changes.",
  "",
  "## Tests and edits",
  "",
  "Run npm test from backend/ for unit and catalog tests. For a full customer-to-admin HTTP test, set ONO_E2E_BASE_URL, ONO_E2E_ADMIN_EMAIL, and ONO_E2E_ADMIN_PASSWORD, then run npm run test:e2e against a disposable database; it creates a test order, delivery area, and review. Edit customer-facing files in frontend/ and API/database behavior in backend/.",
  "",
  "## Temporary Render preview",
  "",
  "The root render.yaml creates a fresh test database and seeds the current menu and first owner. Keep the source repository private. Provide the owner bootstrap values when Render prompts during Blueprint creation, then remove the ADMIN_BOOTSTRAP_* variables after the initial setup hook succeeds. This preview does not copy local customer/order records. Render's free web service sleeps while idle and the free PostgreSQL expires after 30 days, so it is for sharing/testing only, not ongoing orders. See https://render.com/docs/free.",
  "",
  "## Not included",
  "",
  "For privacy, this bundle does not include backend/.env, live database files, existing owner credentials, or customer/order records. The first-run setup creates a private local database and your own owner login. The bundled PostgreSQL server listens only on this computer (127.0.0.1)."
].join("\n") + "\n";
const fullStartCommand = [
  "@echo off",
  "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"%~dp0scripts\\start-ono-food.ps1\" -OpenBrowser",
  "if errorlevel 1 pause",
  ""
].join("\r\n");
const fullStopCommand = [
  "@echo off",
  "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"%~dp0scripts\\stop-ono-food.ps1\"",
  "pause",
  ""
].join("\r\n");
await Promise.all([
  copyFile(path.join(frontendRoot, "admin-standalone.html"), path.join(outputRoot, "ONO-Food-Admin.html")),
  copyFile(path.join(frontendRoot, "storefront-standalone.html"), path.join(outputRoot, "ONO-Food-Menu.html")),
  writeFile(path.join(shareRoot, "index.html"), indexShortcut, "utf8"),
  writeFile(path.join(shareRoot, "ONO-Food-Menu.html"), singleFileHtml, "utf8"),
  writeFile(path.join(shareRoot, "ONO-Food-Admin.html"), standaloneAdminHtml, "utf8"),
  writeFile(path.join(shareRoot, "PROJECT-README.md"), projectReadme, "utf8"),
  copyFile(path.join(projectRoot, "render.yaml"), path.join(shareRoot, "render.yaml")),
  writeFile(path.join(shareRoot, "Start Full Website.cmd"), fullStartCommand, "utf8"),
  writeFile(path.join(shareRoot, "Stop ONO Food.cmd"), fullStopCommand, "utf8"),
  writeFile(path.join(shareRoot, "database", "README.txt"), "PostgreSQL 18 portable runtime. On first launch, ONO Food creates its local database in data/. The server listens only on 127.0.0.1:55434. Do not copy database/data into a public/shared ZIP; it may contain private customer and order records.\n", "utf8"),
  writeFile(path.join(shareRoot, "README.txt"), "ONO FOOD WEBSITE BUNDLE\n\nDouble-click Start Full Website.cmd. First run creates the private local PostgreSQL database, sets up the menu and delivery areas, and asks you to make the owner login. The customer website opens at http://localhost:3000/ and the owner dashboard is at http://localhost:3000/admin.\n\nUse Stop ONO Food.cmd to stop both services. Do not open the HTML files directly from File Explorer for ordering or admin access. Do not share backend/.env or database/data; those contain private secrets or customer/order records. Read PROJECT-README.md for details.\n", "utf8")
]);
const archivePath = path.join(outputRoot, "ONO-Food-Website.zip");
if (process.platform === "win32") {
  const nextArchivePath = path.join(outputRoot, "ONO-Food-Website.next.zip");
  await runFile("tar.exe", [
    "-a", "-c", "-f", nextArchivePath, "-C", outputRoot,
    "--exclude=ONO-Food-Website/backend/.env",
    "--exclude=ONO-Food-Website/backend/.ono-food-api.pid",
    "--exclude=ONO-Food-Website/database/data",
    "--exclude=ONO-Food-Website/database/data/*",
    "--exclude=ONO-Food-Website/database/logs",
    "--exclude=ONO-Food-Website/database/logs/*",
    "--exclude=ONO-Food-Website/ONO-Food-Website",
    "--exclude=ONO-Food-Website/ONO-Food-Website/*",
    "ONO-Food-Website"
  ], { windowsHide: true });
  await rename(nextArchivePath, archivePath);
} else {
  await runFile("zip", ["-qr", archivePath, "ONO-Food-Website", "-x", "ONO-Food-Website/backend/.env", "ONO-Food-Website/backend/.ono-food-api.pid", "ONO-Food-Website/database/data/*", "ONO-Food-Website/database/logs/*", "ONO-Food-Website/ONO-Food-Website/*"], { cwd: outputRoot });
}
console.log("Built ONO Food project and ZIP: " + shareRoot + " (" + catalog.catalogItems.length + " menu listings, local PostgreSQL setup, admin dashboard, " + imageNames.size + " image files, " + videoNames.size + " video)");
