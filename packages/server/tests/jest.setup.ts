/**
 * Per-worker setup: load .env.test into process.env BEFORE any module under
 * test is imported. The app reads JWT_SECRET / DATABASE_URL from process.env at
 * import time (auth.service, prisma client), so this MUST run as a setupFile
 * (which runs before the test module graph is loaded), not setupFilesAfterEnv.
 *
 * Hard guard: refuse to run unless DATABASE_URL targets the isolated test DB,
 * so an integration run can never wipe the dev database.
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';

loadEnv({ path: resolve(__dirname, '../.env.test'), override: true });

if (!process.env.DATABASE_URL || !/\/badminton_test(\?|$)/.test(process.env.DATABASE_URL)) {
  throw new Error(
    `Refusing to run integration tests: DATABASE_URL must point at the badminton_test DB, got "${process.env.DATABASE_URL}"`,
  );
}
