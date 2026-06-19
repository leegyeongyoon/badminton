/**
 * Final web smoke (Playwright + chromium from honbabnono's install).
 *
 *  - API-login the leader ONCE (global fetch) and ensure a CURRENT active
 *    club session exists (start one if none). Seed a couple of guests so the
 *    operate board isn't empty.
 *  - Inject the leader's tokens into the web app's localStorage (the RN-web
 *    storage layer reads `accessToken`/`refreshToken` from localStorage), so we
 *    skip the fragile RN-web login form and don't spend an extra UI login.
 *  - Open /session/<id>/operate at 768x1024 and /session/<id>/summary.
 *  - Assert 0 pageerrors and a non-blank body. Screenshot both.
 *
 * Run with honbabnono's node_modules on the resolution path so @playwright/test
 * (chromium) is found:  node scripts/web-smoke.mjs
 */
import pw from '/Users/igyeong-yun/Desktop/gylee/honbabnono/node_modules/@playwright/test/index.js';
const { chromium } = pw;

const API = process.env.BASE || 'http://localhost:3100/api/v1';
const WEB = process.env.WEB || 'http://localhost:8081';
const LEADER_PHONE = process.env.LEADER_PHONE || '01000000002';
const LEADER_PW = process.env.LEADER_PW || 'password123';

let pass = 0, fail = 0;
const ok = (n, x = '') => { pass++; console.log(`  PASS  ${n}${x ? ' — ' + x : ''}`); };
const bad = (n, d = '') => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
}

async function main() {
  console.log(`\n=== Web smoke: ${WEB} (API ${API}) ===`);

  // 1) leader login (one API login)
  const login = await api('POST', '/auth/login', { body: { phone: LEADER_PHONE, password: LEADER_PW } });
  if (login.status !== 200 || !login.body?.tokens?.accessToken) {
    bad('leader login', `status ${login.status} ${JSON.stringify(login.body)}`);
    return finish();
  }
  ok('leader login');
  const tokens = login.body.tokens;
  const user = login.body.user;

  // 2) ensure an ACTIVE club session for the leader's club
  const facs = await api('GET', '/facilities');
  const facility = facs.body[0];
  const clubsRes = await api('GET', '/clubs', { token: tokens.accessToken });
  const clubs = Array.isArray(clubsRes.body) ? clubsRes.body : (clubsRes.body?.clubs ?? []);
  const club = clubs.find((c) => c.homeFacilityId === facility.id) || clubs[0];

  let sessionId;
  const active = await api('GET', `/clubs/${club.id}/sessions/active`, { token: tokens.accessToken });
  if (active.status === 200 && active.body?.id) {
    sessionId = active.body.id;
    ok('resolve active session', `reused ${sessionId}`);
  } else {
    const start = await api('POST', `/clubs/${club.id}/sessions`, { token: tokens.accessToken, body: { facilityId: facility.id } });
    if (start.status !== 201) { bad('start session', JSON.stringify(start.body)); return finish(); }
    sessionId = start.body.id;
    ok('start active session', sessionId);
  }
  // seed a couple guests so the board has content
  for (let i = 0; i < 2; i++) {
    await api('POST', `/club-sessions/${sessionId}/guests`, { token: tokens.accessToken, body: { name: `스모크게스트${i}`, skillLevel: 'C' } });
  }

  // 3) browser
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 768, height: 1024 } });

  // Seed localStorage BEFORE any app script runs on every page in this context:
  //  - accessToken/refreshToken: the RN-web storage layer reads these to auth.
  //  - badminton_onboarding_completed=true: skip the first-run onboarding gate
  //    in app/_layout.tsx that otherwise redirects deep links to /onboarding.
  await context.addInitScript(({ t }) => {
    try {
      localStorage.setItem('accessToken', t.accessToken);
      localStorage.setItem('refreshToken', t.refreshToken);
      localStorage.setItem('badminton_onboarding_completed', 'true');
    } catch { /* noop */ }
  }, { t: tokens });

  const page = await context.newPage();

  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  // Warm up: load the app once so it boots already authenticated + past onboarding.
  await page.goto(WEB, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  async function visit(label, path, shot) {
    const before = pageErrors.length;
    await page.goto(`${WEB}${path}`, { waitUntil: 'domcontentloaded' });
    // Let the SPA hydrate + fetch.
    await page.waitForTimeout(3500);
    const bodyText = (await page.evaluate(() => document.body?.innerText || '')).trim();
    const newErrors = pageErrors.slice(before);
    await page.screenshot({ path: shot, fullPage: false });
    if (newErrors.length > 0) {
      bad(`${label} 0 pageerrors`, newErrors.slice(0, 3).join(' | '));
    } else {
      ok(`${label} 0 pageerrors`);
    }
    if (bodyText.length > 0) ok(`${label} non-blank body`, `${bodyText.length} chars`);
    else bad(`${label} non-blank body`, 'body was blank');
    console.log(`        screenshot → ${shot}`);
  }

  await visit('operate', `/session/${sessionId}/operate`, '/tmp/final-operate.png');
  await visit('summary', `/session/${sessionId}/summary`, '/tmp/final-summary.png');

  await browser.close();
  finish();
}

function finish() {
  console.log(`\n=== Web smoke: ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { bad('UNCAUGHT', e?.stack || String(e)); finish(); });
