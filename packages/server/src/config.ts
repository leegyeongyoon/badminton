import { logger } from './utils/logger';

/**
 * Startup configuration & secret validation.
 *
 * The JWT secrets and DATABASE_URL are read from the environment. In
 * development we tolerate (but warn about) weak/default secrets so local dev
 * "just works". In production we refuse to boot with a missing or known-weak
 * secret — a leaked default secret lets anyone forge access/refresh tokens.
 *
 * Call validateConfig() once at process startup (see index.ts), BEFORE the
 * HTTP server starts listening.
 */

// Known weak/default values that must never be used in production. Includes the
// hard-coded fallbacks scattered through the codebase plus the placeholders
// shipped in .env.example so a copy-pasted example file can't reach prod.
const WEAK_SECRETS = new Set<string>([
  'dev-secret',
  'dev-refresh-secret',
  'your-jwt-secret-change-me',
  'your-jwt-refresh-secret-change-me',
  'change-me-strong-secret',
  'change-me-strong-refresh-secret',
  'secret',
  'changeme',
]);

const MIN_SECRET_LENGTH = 16;

function isWeakSecret(value: string | undefined): boolean {
  if (!value) return true;
  if (WEAK_SECRETS.has(value)) return true;
  if (value.length < MIN_SECRET_LENGTH) return true;
  return false;
}

interface SecretCheck {
  name: string;
  value: string | undefined;
}

/**
 * Validate required secrets/env at boot. In production a missing or weak
 * secret (or missing DATABASE_URL) is fatal: log and process.exit(1). In
 * non-production we only warn so local development is not blocked.
 */
export function validateConfig(): void {
  const isProd = process.env.NODE_ENV === 'production';

  const secrets: SecretCheck[] = [
    { name: 'JWT_SECRET', value: process.env.JWT_SECRET },
    { name: 'JWT_REFRESH_SECRET', value: process.env.JWT_REFRESH_SECRET },
  ];

  const problems: string[] = [];

  for (const { name, value } of secrets) {
    if (isWeakSecret(value)) {
      const reason = !value
        ? `${name} is not set`
        : `${name} is set to a weak/default/too-short value`;
      problems.push(reason);
    }
  }

  if (!process.env.DATABASE_URL) {
    problems.push('DATABASE_URL is not set');
  }

  if (problems.length === 0) {
    return;
  }

  if (isProd) {
    for (const p of problems) {
      logger.error(`FATAL config error: ${p}`);
    }
    logger.error(
      'Refusing to start in production with insecure/missing configuration. ' +
        'Set strong, unique JWT_SECRET / JWT_REFRESH_SECRET (>= ' +
        `${MIN_SECRET_LENGTH} chars) and a valid DATABASE_URL.`,
    );
    process.exit(1);
  } else {
    for (const p of problems) {
      logger.warn(
        `Insecure config (allowed in ${process.env.NODE_ENV || 'development'}): ${p}. ` +
          'This WOULD be fatal in production.',
      );
    }
  }
}
