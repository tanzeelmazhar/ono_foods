const baseUrl = (window.ONO_CONFIG?.apiBaseUrl || "/api/v1").replace(/\/$/, "");
let csrfToken = "";

async function readCsrf(refresh = false) {
  if (csrfToken && !refresh) return csrfToken;
  const response = await fetch(baseUrl + "/security/csrf", { credentials: "include" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || "Unable to start a secure session.");
  csrfToken = body.csrf_token;
  return csrfToken;
}

async function request(path, options = {}, retried = false) {
  const method = (options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers || {});
  if (options.body !== undefined && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (!(["GET", "HEAD", "OPTIONS"].includes(method))) headers.set("X-CSRF-Token", await readCsrf());
  const response = await fetch(baseUrl + path, {
    ...options, method, headers, credentials: "include",
    body: options.body instanceof FormData ? options.body : options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const body = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 403 && body.error?.code === "CSRF_VALIDATION_FAILED" && !retried) {
      await readCsrf(true);
      return request(path, options, true);
    }
    const error = new Error(body.error?.message || "The request could not be completed.");
    error.status = response.status;
    error.code = body.error?.code;
    error.fields = body.error?.field_errors || {};
    throw error;
  }
  return body;
}

export const api = {
  get: (path) => request(path),
  post: (path, body, headers) => request(path, { method: "POST", body, headers }),
  patch: (path, body) => request(path, { method: "PATCH", body }),
  delete: (path) => request(path, { method: "DELETE" })
};
