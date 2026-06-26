import { ZodError } from 'zod';

/** Wrap an async route handler so thrown errors hit the error middleware. */
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/** Throw this for expected, client-facing errors. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function notFound(_req, res) {
  res.status(404).json({ error: 'Not found.' });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Invalid request.',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  // Postgres unique violation
  if (err?.code === '23505') {
    return res.status(409).json({ error: 'That item already exists or was just taken.' });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Something went wrong on our end.' });
}
