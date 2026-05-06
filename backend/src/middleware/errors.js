// Throw HttpError from anywhere in the request path. The error middleware
// turns it into a JSON response. Anything else becomes a 500.

export class HttpError extends Error {
  constructor(status, message, details = undefined) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest    = (msg, details) => new HttpError(400, msg, details);
export const unauthorized  = (msg = 'Not authenticated')         => new HttpError(401, msg);
export const forbidden     = (msg = 'Not allowed')               => new HttpError(403, msg);
export const notFound      = (msg = 'Not found')                 => new HttpError(404, msg);
export const conflict      = (msg, details)                       => new HttpError(409, msg, details);
