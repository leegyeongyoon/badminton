/**
 * Global setup (runs ONCE before the whole suite):
 *  1. Load .env.test so DATABASE_URL points at the isolated badminton_test DB.
 *  2. Hard-guard that we are NOT pointed at the dev DB.
 *  3. Run `prisma migrate deploy` against the test DB so its schema matches the
 *     committed migrations. Idempotent: re-running applies nothing new.
 *
 * The seed is intentionally NOT run — each test suite seeds the minimal,
 * deterministic data it needs (see tests/helpers.ts) so tests don't depend on
 * shared fixture state.
 */
import { config as loadEnv } from 'dotenv';
import { execSync } from 'child_process';
import { resolve } from 'path';

export default async function globalSetup() {
  const envPath = resolve(__dirname, '../.env.test');
  loadEnv({ path: envPath, override: true });

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || !/\/badminton_test(\?|$)/.test(dbUrl)) {
    throw new Error(
      `globalSetup: DATABASE_URL must target badminton_test, got "${dbUrl}". Aborting to protect the dev DB.`,
    );
  }

  const serverDir = resolve(__dirname, '..');
  // eslint-disable-next-line no-console
  console.log(`\n[jest globalSetup] migrate deploy → ${dbUrl}`);
  execSync('npx prisma migrate deploy', {
    cwd: serverDir,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: dbUrl },
  });
}
