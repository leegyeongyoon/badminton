import { Router, Request, Response } from 'express';
import { rateLimit } from '../../middleware/rateLimit';
import { logger } from '../../utils/logger';

/**
 * Client crash/error sink. The mobile/web app fire-and-forgets runtime errors
 * (e.g. from its ErrorBoundary) here so production client crashes are persisted
 * server-side instead of being lost in the device console.
 *
 * - No auth: a crashing client may not have a valid session, and we still want
 *   the report. Abuse is bounded by a per-IP rate limit + a payload size cap.
 * - Logs at `warn` (client problem, not a server fault) and returns 204.
 */
const router = Router();

const clientErrorLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyPrefix: 'client:error',
});

// Defensive bounds so a malformed/huge payload can't bloat the logs.
const MAX_FIELD_LEN = 4000;

function clamp(value: unknown, max = MAX_FIELD_LEN): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

router.post('/errors', clientErrorLimiter, (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;

  logger.warn('client_error', {
    message: clamp(body.message) ?? '(no message)',
    stack: clamp(body.stack),
    // context can be an object; stringify defensively and clamp.
    context:
      body.context === undefined
        ? undefined
        : clamp(
            typeof body.context === 'string'
              ? body.context
              : JSON.stringify(body.context),
          ),
    platform: clamp(body.platform, 64),
    ip: req.ip,
    userAgent: clamp(req.get('user-agent'), 256),
  });

  res.status(204).end();
});

export default router;
