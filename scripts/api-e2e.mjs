/**
 * Final E2E regression against the DEV stack (NODE_ENV=development, DB badminton)
 * on http://localhost:3100. Uses global fetch (Node 22). Asserts each step.
 *
 * Flow:
 *   1. leader login (김대표 / seed)
 *   2. resolve/active session (start one if none) — one-click start
 *   3. member register + geofenced check-in (in-range pass, out-range reject)
 *   4. guest check-in (in range)
 *   5. suggest
 *   6. createQueueGame
 *   7. assign to an empty court → court IN_USE
 *   8. getSummary
 *   9. getMatchups
 *  10. end session
 *
 * Designed to do exactly ONE leader login and ONE member register so it stays
 * well within the rate limits (login 10/15min, register 5/hr per IP).
 */

const BASE = process.env.BASE || 'http://localhost:3100/api/v1';
const LEADER_PHONE = process.env.LEADER_PHONE || '01000000002';
const LEADER_PW = process.env.LEADER_PW || 'password123';

let pass = 0;
let fail = 0;
const results = [];

function ok(name, extra = '') {
  pass++;
  results.push(`PASS  ${name}${extra ? ' — ' + extra : ''}`);
  console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`);
}
function bad(name, detail) {
  fail++;
  results.push(`FAIL  ${name} — ${detail}`);
  console.log(`  FAIL  ${name} — ${detail}`);
}
function assert(cond, name, detail) {
  if (cond) ok(name, typeof detail === 'string' ? detail : '');
  else bad(name, typeof detail === 'string' ? detail : JSON.stringify(detail));
  return cond;
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  const text = await res.text();
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
}

function uniqueDigits(n) {
  return (Date.now().toString() + Math.floor(Math.random() * 1e6)).slice(-n);
}

async function main() {
  console.log(`\n=== API E2E against ${BASE} ===`);

  // ---- Step 1: leader login -------------------------------------------------
  const login = await api('POST', '/auth/login', { body: { phone: LEADER_PHONE, password: LEADER_PW } });
  if (!assert(login.status === 200 && login.body?.tokens?.accessToken, 'step1 leader login', login.status === 200 ? '' : JSON.stringify(login.body))) {
    return finish();
  }
  const leaderTok = login.body.tokens.accessToken;
  const leaderId = login.body.user.id;

  // ---- Step 2: resolve facility/club, ensure an ACTIVE session --------------
  const facRes = await api('GET', '/facilities');
  const facility = facRes.body?.[0];
  assert(facility?.id, 'step2a facilities list', facility?.name);
  const qrData = facility.qrCodeData;
  const facLat = facility.latitude;
  const facLng = facility.longitude;

  const clubsRes = await api('GET', '/clubs', { token: leaderTok });
  const clubs = Array.isArray(clubsRes.body) ? clubsRes.body : (clubsRes.body?.clubs ?? []);
  const club = clubs.find((c) => c.homeFacilityId === facility.id) || clubs[0];
  assert(club?.id, 'step2b leader clubs', club?.name);
  const clubId = club.id;

  // Active session? If none, one-click start (no pre-open facility session needed).
  let sessionId;
  const active = await api('GET', `/clubs/${clubId}/sessions/active`, { token: leaderTok });
  if (active.status === 200 && active.body?.id) {
    sessionId = active.body.id;
    ok('step2c resolve active session', `reused ${sessionId}`);
  } else {
    const start = await api('POST', `/clubs/${clubId}/sessions`, { token: leaderTok, body: { facilityId: facility.id } });
    if (!assert(start.status === 201 && start.body?.status === 'ACTIVE', 'step2c one-click start session', start.status === 201 ? '' : JSON.stringify(start.body))) {
      return finish();
    }
    sessionId = start.body.id;
    assert(!!start.body.facilitySessionId, 'step2d facility session auto-created', start.body.facilitySessionId);
  }

  // Session courts (so we can find an EMPTY one later).
  const sessionInfo = await api('GET', `/club-sessions/${sessionId}`, { token: leaderTok });
  const sessionCourtIds = sessionInfo.body?.courtIds ?? [];

  // Seed the session pool deterministically: the operator adds 4 guests to the
  // session (each becomes a checked-in, eligible player scoped to THIS session).
  // This makes suggest / createQueueGame work regardless of how seed check-ins
  // were scoped, and needs no extra logins (stays within rate limits).
  const poolGuestIds = [];
  for (let i = 0; i < 4; i++) {
    const g = await api('POST', `/club-sessions/${sessionId}/guests`, {
      token: leaderTok,
      body: { name: `E2E풀게스트${i}-${uniqueDigits(3)}`, skillLevel: 'C', gender: i % 2 ? 'F' : 'M' },
    });
    if (g.status === 201 && g.body?.guest?.id) poolGuestIds.push(g.body.guest.id);
  }
  assert(poolGuestIds.length === 4, 'step2e seed 4 session players (operator guests)', `added ${poolGuestIds.length}`);

  // ---- Step 3: member register + geofenced check-in -------------------------
  const memberPhone = `010${uniqueDigits(8)}`;
  const reg = await api('POST', '/auth/register', {
    body: { phone: memberPhone, password: 'password123', name: `E2E멤버${uniqueDigits(4)}`, skillLevel: 'C', gender: 'M' },
  });
  if (!assert(reg.status === 201 && reg.body?.tokens?.accessToken, 'step3a member register', reg.status === 201 ? memberPhone : JSON.stringify(reg.body))) {
    return finish();
  }
  const memberTok = reg.body.tokens.accessToken;
  const memberId = reg.body.user.id;
  // Make the new member a club member so they can be staged on the board.
  // (Done via API where possible; otherwise the suggest pool still works with seed members.)

  // in-range check-in → 201
  const inRange = await api('POST', '/checkin', {
    token: memberTok,
    body: { qrData, clubSessionId: sessionId, latitude: facLat, longitude: facLng },
  });
  assert(inRange.status === 201, 'step3b member check-in IN range → 201', inRange.status === 201 ? '' : JSON.stringify(inRange.body));

  // Check out so we can re-attempt OUT of range with the same member (avoids
  // the duplicate-checkin guard masking the geofence rejection).
  await api('POST', '/checkin/checkout', { token: memberTok });

  // out-of-range check-in → 400 with details.distanceM
  const outRange = await api('POST', '/checkin', {
    token: memberTok,
    body: { qrData, clubSessionId: sessionId, latitude: facLat + 0.05, longitude: facLng },
  });
  assert(
    outRange.status === 400 && typeof outRange.body?.details?.distanceM === 'number' && outRange.body.details.distanceM > 0,
    'step3c member check-in OUT of range → 400 + distanceM',
    outRange.status === 400 ? `distanceM=${outRange.body?.details?.distanceM}` : JSON.stringify(outRange.body),
  );

  // Re-check-in in range so this member is present in the pool again.
  await api('POST', '/checkin', { token: memberTok, body: { qrData, clubSessionId: sessionId, latitude: facLat, longitude: facLng } });

  // ---- Step 4: guest check-in (in range) ------------------------------------
  const guest = await api('POST', '/checkin/guest', {
    body: { qrData, clubSessionId: sessionId, name: `E2E게스트${uniqueDigits(4)}`, skillLevel: 'D', gender: 'F', latitude: facLat, longitude: facLng },
  });
  assert(guest.status === 201 && !!guest.body?.token, 'step4 guest check-in IN range → 201 + token', guest.status === 201 ? '' : JSON.stringify(guest.body));

  // ---- Step 5: suggest ------------------------------------------------------
  const suggest = await api('POST', `/club-sessions/${sessionId}/suggest`, { token: leaderTok, body: { count: 1 } });
  // suggest needs >=4 eligible; the seeded session may already have many checked-in players.
  assert(suggest.status === 200 && Array.isArray(suggest.body?.suggestions), 'step5 suggest returns suggestions[]', suggest.status === 200 ? `n=${suggest.body?.suggestions?.length}` : JSON.stringify(suggest.body));

  // ---- Step 6: createQueueGame ----------------------------------------------
  // Need a board + 4 checked-in eligible players. Pull the available players for
  // this session and pick 4 AVAILABLE ones to compose a foursome.
  const boardRes = await api('POST', `/club-sessions/${sessionId}/game-board`, { token: leaderTok });
  assert(boardRes.status === 201 || boardRes.status === 200, 'step6a create/get game board', JSON.stringify({ s: boardRes.status }));
  const boardId = boardRes.body.id;

  // Use the 4 session guests we added as the eligible foursome (all checked in,
  // AVAILABLE, not queued/in-turn). Fall back to suggest output if needed.
  let foursome = poolGuestIds.slice(0, 4);
  if (foursome.length < 4 && suggest.body?.suggestions?.[0]?.playerIds?.length === 4) {
    foursome = suggest.body.suggestions[0].playerIds;
  }

  let queueEntryId = null;
  if (foursome.length === 4) {
    const queue = await api('POST', `/game-boards/${boardId}/queue`, { token: leaderTok, body: { playerIds: foursome } });
    if (assert(queue.status === 201 && queue.body?.status === 'QUEUED', 'step6b createQueueGame (4 players)', queue.status === 201 ? '' : JSON.stringify(queue.body))) {
      queueEntryId = queue.body.id;
    }
  } else {
    bad('step6b createQueueGame (4 players)', `could not assemble an eligible foursome (pool=${pool.length})`);
  }

  // ---- Step 7: assign to an empty court → court IN_USE ----------------------
  let createdCourtId = null;
  let assignedTurnId = null;
  if (queueEntryId) {
    // Prefer a TRULY EMPTY existing court (status EMPTY *and* no WAITING/PLAYING
    // turn). The dev DB often carries orphaned turns on EMPTY-status courts from
    // prior interrupted sessions; assignEntry correctly rejects those. When none
    // is free we create a fresh throwaway court via the leader API (additive,
    // legitimate) so the assign→IN_USE path is always exercised, then clean it up.
    const courtsRes = await api('GET', `/facilities/${facility.id}/courts`);
    const courts = courtsRes.body ?? [];
    const isFree = (c) =>
      c.status === 'EMPTY' &&
      !(c.turns ?? []).some((t) => t.status === 'WAITING' || t.status === 'PLAYING');
    const inSession = (c) => sessionCourtIds.length === 0 || sessionCourtIds.includes(c.id);
    let targetCourt = courts.find((c) => inSession(c) && isFree(c)) || courts.find(isFree);

    if (!targetCourt) {
      const made = await api('POST', `/facilities/${facility.id}/courts`, {
        token: leaderTok,
        body: { name: `E2E코트-${uniqueDigits(4)}`, gameType: 'DOUBLES' },
      });
      if (made.status === 201 && made.body?.id) {
        createdCourtId = made.body.id;
        targetCourt = made.body;
        // The session's courtIds must include the court for the operate board, but
        // assignEntry itself only needs the court to be empty — add it to the session.
        await api('PATCH', `/club-sessions/${sessionId}/courts`, { token: leaderTok, body: { courtIds: [...sessionCourtIds, createdCourtId] } });
        ok('step7a0 created fresh empty court for assign', targetCourt.name);
      }
    }

    if (targetCourt) {
      const assign = await api('POST', `/game-boards/${boardId}/entries/${queueEntryId}/assign`, { token: leaderTok, body: { courtId: targetCourt.id } });
      const assignOk = assert(assign.status === 200 && assign.body?.status === 'MATERIALIZED', 'step7a assign queued game to EMPTY court', assign.status === 200 ? '' : JSON.stringify(assign.body));
      if (assignOk) assignedTurnId = assign.body.turnId;
      // Verify court is now IN_USE.
      const courtsAfter = await api('GET', `/facilities/${facility.id}/courts`);
      const nowCourt = (courtsAfter.body ?? []).find((c) => c.id === targetCourt.id);
      assert(nowCourt?.status === 'IN_USE', 'step7b court becomes IN_USE', `court ${targetCourt.name} → ${nowCourt?.status}`);
    } else {
      bad('step7a assign queued game to EMPTY court', 'no EMPTY court available and could not create one');
    }
  } else {
    bad('step7 assign', 'skipped (no queued entry)');
  }

  // ---- Step 8: getSummary ---------------------------------------------------
  const summary = await api('GET', `/club-sessions/${sessionId}/summary`, { token: leaderTok });
  assert(
    summary.status === 200 && summary.body?.attendance && summary.body?.games && summary.body?.guestFees,
    'step8 getSummary (attendance/games/guestFees)',
    summary.status === 200 ? `members=${summary.body.attendance.memberCount} guests=${summary.body.attendance.guestCount} games=${summary.body.games.total}` : JSON.stringify(summary.body),
  );

  // ---- Step 9: getMatchups --------------------------------------------------
  // Use a player who played a game: take one from the foursome if assigned.
  const matchupUser = foursome[0] || memberId;
  const matchups = await api('GET', `/club-sessions/${sessionId}/players/${matchupUser}/matchups`, { token: leaderTok });
  assert(matchups.status === 200 && Array.isArray(matchups.body?.partners), 'step9 getMatchups returns partners', matchups.status === 200 ? `totalGames=${matchups.body.totalGames} partners=${matchups.body.partners.length}` : JSON.stringify(matchups.body));

  // ---- Step 10: end session -------------------------------------------------
  const end = await api('POST', `/club-sessions/${sessionId}/end`, { token: leaderTok });
  assert(end.status === 200 && end.body?.status === 'ENDED', 'step10 end session → ENDED', end.status === 200 ? '' : JSON.stringify(end.body));

  // ---- Cleanup (best effort): leave the dev DB as we found it ----------------
  // Complete the turn we materialized (frees the court), then delete the
  // throwaway court we created. Failures here don't affect the pass/fail tally.
  try {
    if (assignedTurnId) await api('POST', `/turns/${assignedTurnId}/complete`, { token: leaderTok });
    if (createdCourtId) {
      const del = await api('DELETE', `/courts/${createdCourtId}`, { token: leaderTok });
      console.log(`  cleanup: deleted throwaway court ${createdCourtId} → ${del.status}`);
    }
  } catch (e) {
    console.log(`  cleanup: non-fatal — ${e?.message || e}`);
  }

  finish();
}

function finish() {
  console.log(`\n=== API E2E: ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  bad('UNCAUGHT', e?.stack || String(e));
  finish();
});
