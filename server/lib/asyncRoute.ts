/**
 * Route helpers shared by server routes.
 *
 * `apiRoute` wraps a handler (sync or async) so that thrown errors become a
 * uniform JSON error response, removing the boilerplate
 * `try { ... } catch (err) { res.status(400)... }` block duplicated across many
 * route handlers.
 */
import type express from 'express'

/** Thrown to produce a 400 response. */
export class BadRequest extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BadRequest'
  }
}

type RouteHandler = (req: express.Request, res: express.Response) => unknown | Promise<unknown>

function respondError(res: express.Response, error: unknown, fallback: string) {
  const message = error instanceof Error && error.message ? error.message : fallback
  const status = error instanceof BadRequest ? 400 : 500
  res.status(status).json({ error: message })
}

/**
 * Wrap a route handler. Throws become JSON errors automatically.
 * @param fallback message used when the error has no usable message
 */
export function apiRoute(
  handler: RouteHandler,
  fallback = '请求处理失败',
): express.RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res)).catch((error) => {
      if (res.headersSent) {
        next(error)
        return
      }
      respondError(res, error, fallback)
    })
  }
}
