/**
 * Jest config for the backend integration suite.
 *
 * - ts-jest preset, node environment.
 * - globalSetup loads .env.test (isolated badminton_test DB) and runs
 *   `prisma migrate deploy` against it ONCE per run.
 * - setupFiles loads .env.test into every worker BEFORE the modules under test
 *   (which read process.env at import time) are loaded.
 * - runInBand is enforced via the npm script; tests share one DB and seed
 *   their own isolated data per suite.
 */
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  globalSetup: '<rootDir>/tests/jest.globalSetup.ts',
  setupFiles: ['<rootDir>/tests/jest.setup.ts'],
  testTimeout: 30000,
  // ts-node-dev style transpile-only: skip type errors during test transform
  // (we verify types separately via `tsc --noEmit`).
  transform: {
    '^.+\\.ts$': ['ts-jest', { isolatedModules: true }],
  },
  // Surface open handles but don't fail the run on them.
  forceExit: true,
};
