/**
 * Rate-limit sanity: POST /auth/login must return 429 after the per-IP threshold
 * (loginLimiter: max 10 per 15-min window). Uses a THROWAWAY phone so we never
 * lock out a real/seed account that other steps depend on. The account need not
 * exist — failed logins (401) still consume the rate-limit budget because the
 * limiter runs BEFORE the handler.
 */
const BASE = process.env.BASE || 'http://localhost:3100/api/v1';
const THROWAWAY = `019${(Date.now() % 100000000).toString().padStart(8, '0')}`.slice(0, 11);

async function login() {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: THROWAWAY, password: 'definitely-wrong' }),
  });
  return res.status;
}

async function main() {
  console.log(`\n=== Rate-limit sanity: /auth/login (throwaway ${THROWAWAY}) ===`);
  const statuses = [];
  let got429 = false;
  // The limiter allows max=10 then 429s. Fire up to 15 to cross the threshold.
  for (let i = 1; i <= 15; i++) {
    const s = await login();
    statuses.push(s);
    if (s === 429) { got429 = true; console.log(`  request ${i}: ${s}  <-- threshold hit`); break; }
    console.log(`  request ${i}: ${s}`);
  }
  if (got429) {
    console.log(`\n  PASS  /auth/login returns 429 after threshold`);
    process.exit(0);
  } else {
    console.log(`\n  FAIL  never saw 429 in 15 attempts (statuses: ${statuses.join(',')})`);
    process.exit(1);
  }
}

main();
