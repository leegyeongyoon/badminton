// 편성 판정 체계 — 엔진을 고친 뒤 '배포해도 되는 변화인가'를 같은 기준으로 판정한다.
//
// 모든 기준을 다 만족시킬 수는 없으니, 우선순위를 정하고 위 단계부터 본다:
//   0 절대 규칙  — 하나라도 늘면 보류
//   1 공정       — 기다림·판수. 나빠지면 보류
//   2 판 품질    — 실력이 맞는 판. 나빠지면 보류
//   3 다양성     — 같은 사람 반복. 위가 안 나빠질 때만 '좋아짐'으로 인정
// 같은 시나리오를 수정 전·후로 돌린 결과를 시나리오마다 짝지어 비교하고(차이의 평균과 95% 구간, 부트스트랩),
// 구간이 0을 넘어가면 '진짜 나빠짐/좋아짐', 0을 걸치면 '차이 없음(출렁임)'으로 본다.
// 전체가 괜찮아도 조건(규모·여자 비율·급수 분포·설정·오고 가기) 하나에서 0~2단계가 크게 나빠지면 보류.
//
// 사용: node scripts/match-eval/judge.js <전 결과 json들(,로)> <후 결과 json들(,로)>
//       (bank.js --out 으로 저장한 파일. 서버 여러 개로 나눠 돌렸으면 조각 파일을 ,로 이어서)
const fs = require('fs');

// [지표, 단계, 방향(작을수록 좋으면 -1, 클수록 좋으면 +1), 이 크기보다 작은 변화는 무시(실질 차이 아님)]
const METRICS = [
  ['못 칠 사람(휴식·레슨·퇴장) 투입', 0, -1, 0],
  ['떼기 요청 어김', 0, -1, 0],
  ['30분+ 있었는데 0판', 1, -1, 0.05],
  ['쉬던 사람 두고 연속', 1, -1, 0.2],
  ['최장 대기(분)', 1, -1, 1.5],
  ['판수 공평(하위10%/중앙값)', 1, +1, 0.02],
  ['팀 힘 차이 2+ 판%', 2, -1, 0.5],
  ['같은 성별 3단계+ 판%', 2, -1, 0.5],
  ['같은 4명 다시', 3, -1, 0.3],
  ['같은 짝 하루 3번+(쌍)', 3, -1, 1],
  ['혼복 몰린 사람', 3, -1, 0.3],
];
const TIER = ['절대 규칙', '공정', '판 품질', '다양성'];

const load = (arg) => {
  const out = new Map();
  for (const f of arg.split(',')) for (const r of JSON.parse(fs.readFileSync(f, 'utf8'))) if (r.checks) out.set(r.name, r);
  return out;
};

// 결정적 난수(같은 입력이면 같은 판정).
let seed = 12345;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
// 짝지은 차이(후 − 전)의 평균과 95% 부트스트랩 구간.
function pairedCI(diffs, B = 2000) {
  const n = diffs.length;
  const mean = diffs.reduce((a, b) => a + b, 0) / n;
  const ms = [];
  for (let b = 0; b < B; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += diffs[Math.floor(rand() * n)];
    ms.push(s / n);
  }
  ms.sort((a, b) => a - b);
  return { mean, lo: ms[Math.floor(B * 0.025)], hi: ms[Math.floor(B * 0.975)] };
}
// 좋아짐(+1)·나빠짐(−1)·차이 없음(0) — '좋은 방향' 기준, 실질 차이(min) 아래는 0.
function verdictOf(ci, dir, min) {
  const good = { mean: ci.mean * dir, lo: Math.min(ci.lo * dir, ci.hi * dir), hi: Math.max(ci.lo * dir, ci.hi * dir) };
  if (good.lo > 0 && good.mean >= min) return { v: 1, good };
  if (good.hi < 0 && -good.mean >= min) return { v: -1, good };
  return { v: 0, good };
}
const fmt = (x) => (Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2));

const [A, Bf] = process.argv.slice(2);
if (!A || !Bf) {
  console.log('사용: node scripts/match-eval/judge.js <전 결과 json들> <후 결과 json들>');
  process.exit(2);
}
const before = load(A);
const after = load(Bf);
const names = [...before.keys()].filter((n) => after.has(n));
console.log(`짝지은 시나리오 ${names.length}개 (전 ${before.size} · 후 ${after.size})\n`);

const results = [];
console.log('단계  지표                          전 평균   후 평균   차이(95% 구간)            판정');
for (const [k, tier, dir, min] of METRICS) {
  const pairs = names.filter((n) => before.get(n).checks[k] != null && after.get(n).checks[k] != null);
  if (!pairs.length) continue;
  const diffs = pairs.map((n) => after.get(n).checks[k] - before.get(n).checks[k]);
  const ci = pairedCI(diffs);
  const { v } = verdictOf(ci, dir, min);
  const avg = (m) => pairs.reduce((s, n) => s + m.get(n).checks[k], 0) / pairs.length;
  results.push({ k, tier, v });
  console.log(
    `${tier} ${TIER[tier].padEnd(5)} ${k.padEnd(26)} ${fmt(avg(before)).padStart(7)}  ${fmt(avg(after)).padStart(7)}   ${(ci.mean >= 0 ? '+' : '') + fmt(ci.mean)} (${fmt(ci.lo)}~${fmt(ci.hi)})`.padEnd(92) +
      (v > 0 ? '좋아짐' : v < 0 ? '나빠짐' : '차이 없음'),
  );
}

// 조건별 — 0~2단계 지표가 그 조건에서 진짜로, 크게(실질 차이의 2배 이상) 나빠졌는지.
const dimBad = [];
const dims = Array.from(new Set(names.flatMap((n) => Object.keys(before.get(n).dims ?? {}))));
for (const d of dims) {
  const vals = Array.from(new Set(names.map((n) => before.get(n).dims?.[d])));
  for (const val of vals) {
    const g = names.filter((n) => before.get(n).dims?.[d] === val);
    if (g.length < 15) continue; // 표본이 적은 조건은 출렁임이 커서 판정하지 않는다
    for (const [k, tier, dir, min] of METRICS) {
      if (tier > 2) continue;
      const diffs = g.map((n) => after.get(n).checks[k] - before.get(n).checks[k]).filter((x) => !Number.isNaN(x));
      const ci = pairedCI(diffs, 1000);
      const { v } = verdictOf(ci, dir, min * 2);
      if (v < 0) dimBad.push(`${d}=${val} (n=${g.length}) · ${k} ${(ci.mean >= 0 ? '+' : '') + fmt(ci.mean)}`);
    }
  }
}

console.log('');
let decision = '판단 보류 — 위 단계는 그대로고 좋아진 것도 뚜렷하지 않아요(배포 이득 없음)';
const worse = results.filter((r) => r.v < 0 && r.tier <= 2);
const better = results.filter((r) => r.v > 0);
if (results.some((r) => r.tier === 0 && r.v < 0)) decision = '보류 — 절대 규칙이 나빠졌어요';
else if (worse.length) decision = `보류 — ${worse.map((r) => `${TIER[r.tier]}: ${r.k}`).join(', ')} 나빠짐`;
else if (dimBad.length) decision = '보류 — 전체는 괜찮지만 특정 조건에서 위 단계가 크게 나빠졌어요';
else if (better.length) decision = `채택 — 위 단계는 안 나빠지고 ${better.map((r) => r.k).join(', ')} 좋아짐`;
if (dimBad.length) {
  console.log('조건별로 크게 나빠진 곳:');
  for (const x of dimBad) console.log('  ' + x);
  console.log('');
}
console.log(`판정: ${decision}`);
process.exitCode = decision.startsWith('채택') ? 0 : 1;
