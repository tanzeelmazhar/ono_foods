export class HttpError extends Error {
  constructor(status, code, message, fieldErrors = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export function notFound(_req, res) {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "That page or resource was not found." } });
}

export function errorHandler(error, req, res, _next) {
  const status = error.status || 500;
  if (status >= 500) {
    console.error(JSON.stringify({
      requestId: req.requestId, method: req.method, path: req.path,
      code: error.code || "INTERNAL_ERROR"
    }));
  }
  res.status(status).json({
    error: {
      code: error.code || "INTERNAL_ERROR",
      message: status >= 500 ? "Something went wrong. Please try again." : error.message,
      field_errors: error.fieldErrors || {}, request_id: req.requestId
    }
  });
}
