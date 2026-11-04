// 실제 정모 재현 — 실제 참석자(성별·급수·도착/퇴장 분)·코트 수·모임 설정으로 엔진이 정모 전체를 짜게 하고,
// 운영진이 그날 실제로 짠 판과 비교한다(판수 고르기·혼복·급수 폭·같은 짝 반복·누구와 쳤는지).
// 재현 데이터(replay.json)는 운영 데이터 기반이라 저장소 밖에서 만든다 — 이름·ID 없이 'M C' 같은 급수 코드와 번호만.
//
// 사용: node scripts/match-eval/replay.js <replay.json> [--settings settings.json] [--par 4] [--slot-base 100] [--out 결과.md]
//   replay.json: [{ name, courts, minutes, people:[{code:'MC', in, out}], games:[{s, e, p:[번호×4]}] }]
const fs = require('fs');
const { runScenario } = require('./sim');

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const replays = JSON.parse(fs.readFileSync(args[0], 'utf8'));
const settings = opt('settings') ? JSON.parse(fs.readFileSync(opt('settings'), 'utf8')) : {};
const par = Number(opt('par', 4));
const slotBase = Number(opt('slot-base', 100));
const slot = (i) => ({
  club: `cc2112ad-3e60-45e3-9b3d-${String(i).padStart(12, '0')}`,
  facility: `cf36ec5f-d6a8-4cbd-aa19-${String(i).padStart(12, '0')}`,
});
const SK = { S: 7, A: 6, B: 5, C: 4, D: 3, E: 2, F: 1 };
const label = (people, i) => `${people[i].code[0] === 'M' ? '남' : '여'}${people[i].code[1]}-${String(i + 1).padStart(2, '0')}`;

// 정모 한 번의 판 목록(사람 번호 4명씩) → 지표.
function measure(people, games, minutes) {
  const n = people.length;
  const g = Array(n).fill(0);
  const mixed = Array(n).fill(0);
  const partners = Array.from({ length: n }, () => new Map());
  const pairN = new Map();
  let mixedGames = 0;
  let threeOne = 0;
  let spread2 = 0;
  let spread3 = 0;
  const sp = (xs) => {
    const v = xs.map((i) => (people[i].code[1] === 'F' ? 0 : SK[people[i].code[1]])); // F–E는 2단계
    return xs.length > 1 ? Math.max(...v) - Math.min(...v) : 0;
  };
  for (const gm of games) {
    const p = gm.p;
    const men = p.filter((i) => people[i].code[0] === 'M');
    const women = p.filter((i) => people[i].code[0] === 'F');
    const isMix = men.length > 0 && women.length > 0;
    if (isMix) mixedGames++;
    if (men.length === 3 || women.length === 3) threeOne++;
    const s = Math.max(sp(men), sp(women));
    if (s >= 2) spread2++;
    if (s >= 3 && !(isMix && women.some((i) => people[i].code[1] === 'F'))) spread3++;
    for (const i of p) {
      g[i]++;
      if (isMix) mixed[i]++;
      for (const j of p) if (j !== i) partners[i].set(j, (partners[i].get(j) ?? 0) + 1);
    }
    for (let a = 0; a < 4; a++)
      for (let b = a + 1; b < 4; b++) {
        const k = Math.min(p[a], p[b]) + '|' + Math.max(p[a], p[b]);
        pairN.set(k, (pairN.get(k) ?? 0) + 1);
      }
  }
  // 판수 고르기 — 30분 넘게 있었던 사람의 '있던 시간 대비 판수'(시간당)
  const stay = people.map((p) => Math.max(0, (p.out ?? minutes) - p.in));
  const stayed = people.map((_, i) => i).filter((i) => stay[i] >= 30);
  const rate = stayed.map((i) => (g[i] / stay[i]) * 60);
  const mean = rate.reduce((a, b) => a + b, 0) / Math.max(1, rate.length);
  const sd = Math.sqrt(rate.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rate.length));
  const full = stayed.filter((i) => people[i].in <= 15 && (people[i].out == null || people[i].out >= minutes - 15)); // 처음부터 끝까지 있던 사람
  const fg = full.map((i) => g[i]);
  return {
    games: games.length,
    perHour: mean,
    perHourSd: sd,
    fullMin: fg.length ? Math.min(...fg) : null,
    fullMax: fg.length ? Math.max(...fg) : null,
    mixedPct: (100 * mixedGames) / Math.max(1, games.length),
    threeOnePct: (100 * threeOne) / Math.max(1, games.length),
    spread2Pct: (100 * spread2) / Math.max(1, games.length),
    spread3Pct: (100 * spread3) / Math.max(1, games.length),
    pair3: [...pairN.values()].filter((v) => v >= 3).length,
    g,
    mixed,
    partners,
  };
}
const jaccard = (a, b) => {
  const A = new Set(a.keys());
  const B = new Set(b.keys());
  const inter = [...A].filter((x) => B.has(x)).length;
  return A.size + B.size - inter ? inter / (A.size + B.size - inter) : 1;
};

(async () => {
  const results = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: par }, async (_, w) => {
      while (next < replays.length) {
        const rp = replays[next++];
        // 도착 분마다 묶기 — sim은 pop 순서대로 도착시킨다(재현 데이터는 도착 순으로 정렬돼 있음).
        const arr = new Map();
        for (const p of rp.people) arr.set(p.in, (arr.get(p.in) ?? 0) + 1);
        const events = rp.people
          .map((p, i) => ({ p, i }))
          .filter(({ p }) => p.out != null && p.out < rp.minutes - 5 && p.out > p.in + 10)
          .map(({ p, i }) => ({ t: p.out, type: 'leave', who: [i] }));
        const durs = rp.games.map((x) => x.e - x.s).filter((x) => x > 3 && x < 40).sort((a, b) => a - b);
        const sc = {
          name: rp.name,
          courts: rp.courts,
          minutes: rp.minutes,
          pop: rp.people.map((p) => p.code),
          arrivals: [...arr.entries()].sort((a, b) => a[0] - b[0]),
          events,
          settings,
          gameMin: durs.length ? durs[Math.floor(durs.length / 2)] : 12,
        };
        try {
          const r = await runScenario(sc, 1, slot(slotBase + w + 1));
          const engineGames = r.games.map((x) => ({ p: x.ids.map((id) => r.info[id].idx) }));
          await require('./db').dropSession(r.sid);
          results.push({ rp, engine: measure(rp.people, engineGames, rp.minutes), real: measure(rp.people, rp.games, rp.minutes), engineGames });
        } catch (e) {
          results.push({ rp, error: String(e?.message ?? e) });
        }
        process.stdout.write(`\r${results.length}/${replays.length}`);
      }
    }),
  );
  console.log('\n');
  const ok = results.filter((x) => !x.error).sort((a, b) => a.rp.name.localeCompare(b.rp.name));
  for (const x of results.filter((x) => x.error)) console.log(`오류 ${x.rp.name}: ${x.error}`);
  const f1 = (v) => (v == null ? '-' : Number.isInteger(v) ? String(v) : v.toFixed(1));
  const lines = [];
  lines.push('| 정모 | 인원·코트 | 판 수 (운영진/엔진) | 시간당 판수 편차 | 처음~끝 있던 사람 판수 최소~최대 | 혼복 % | 3:1 % | 같은 성별 2단계+ % | 3단계+ % | 같은 짝 3번+ | 같이 친 사람 겹침 |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
  const sum = { real: {}, engine: {} };
  for (const x of ok) {
    const { rp, real, engine } = x;
    const overlap = rp.people.map((_, i) => jaccard(real.partners[i], engine.partners[i]));
    x.overlap = overlap.reduce((a, b) => a + b, 0) / overlap.length;
    lines.push(
      `| ${rp.name} | ${rp.people.length}명·${rp.courts}코트 | ${real.games} / ${engine.games} | ${f1(real.perHourSd)} / ${f1(engine.perHourSd)} | ${f1(real.fullMin)}~${f1(real.fullMax)} / ${f1(engine.fullMin)}~${f1(engine.fullMax)} | ${f1(real.mixedPct)} / ${f1(engine.mixedPct)} | ${f1(real.threeOnePct)} / ${f1(engine.threeOnePct)} | ${f1(real.spread2Pct)} / ${f1(engine.spread2Pct)} | ${f1(real.spread3Pct)} / ${f1(engine.spread3Pct)} | ${real.pair3} / ${engine.pair3} | ${(x.overlap * 100).toFixed(0)}% |`,
    );
    for (const k of ['games', 'perHourSd', 'mixedPct', 'threeOnePct', 'spread2Pct', 'spread3Pct', 'pair3']) {
      sum.real[k] = (sum.real[k] ?? 0) + real[k] / ok.length;
      sum.engine[k] = (sum.engine[k] ?? 0) + engine[k] / ok.length;
    }
  }
  const avgOverlap = ok.reduce((a, x) => a + x.overlap, 0) / Math.max(1, ok.length);
  lines.push(
    `| **평균** | | ${f1(sum.real.games)} / ${f1(sum.engine.games)} | ${f1(sum.real.perHourSd)} / ${f1(sum.engine.perHourSd)} | | ${f1(sum.real.mixedPct)} / ${f1(sum.engine.mixedPct)} | ${f1(sum.real.threeOnePct)} / ${f1(sum.engine.threeOnePct)} | ${f1(sum.real.spread2Pct)} / ${f1(sum.engine.spread2Pct)} | ${f1(sum.real.spread3Pct)} / ${f1(sum.engine.spread3Pct)} | ${f1(sum.real.pair3)} / ${f1(sum.engine.pair3)} | ${(avgOverlap * 100).toFixed(0)}% |`,
  );
  console.log('(각 칸: 운영진 / 엔진)\n' + lines.join('\n'));
  // 사람별 — 판수·혼복·가장 많이 같이 친 사람(운영진 vs 엔진)
  const detail = [];
  for (const x of ok) {
    const { rp, real, engine } = x;
    detail.push(`\n### ${rp.name} (${rp.people.length}명 · ${rp.courts}코트 · ${rp.minutes}분)\n`);
    detail.push('| 사람 | 있던 시간 | 판수 운영진/엔진 | 혼복 운영진/엔진 | 운영진과 많이 친 사람 | 엔진과 많이 친 사람 |');
    detail.push('|---|---|---|---|---|---|');
    const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([j, c]) => `${label(rp.people, j)}×${c}`).join(' ');
    rp.people.forEach((p, i) => {
      const stay = (p.out ?? rp.minutes) - p.in;
      detail.push(`| ${label(rp.people, i)} | ${p.in}~${p.out ?? rp.minutes}분(${stay}) | ${real.g[i]} / ${engine.g[i]} | ${real.mixed[i]} / ${engine.mixed[i]} | ${top(real.partners[i]) || '-'} | ${top(engine.partners[i]) || '-'} |`);
    });
  }
  if (opt('out')) fs.writeFileSync(opt('out'), '# 실제 정모 재현 — 운영진 vs 엔진\n\n(각 칸: 운영진 / 엔진)\n\n' + lines.join('\n') + '\n' + detail.join('\n') + '\n');
  await require('./db').prisma.$disconnect();
})();
