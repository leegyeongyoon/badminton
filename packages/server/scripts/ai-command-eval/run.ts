// AI 명령 평가 — 정답 세트(cases.json, 실제 문장이 쌓이면 prod-cases.json 도)를 지금 프롬프트·모델로 돌려 정답률을 낸다.
// 프롬프트(aiCommand.ts)나 OPENAI_MODEL 을 바꿀 때마다 돌려 숫자로 비교한다.
//   cd packages/server && npx ts-node --transpile-only scripts/ai-command-eval/run.ts [cases.json ...] [--repeat 2]
// 채점: 동작 이름·순서가 같고, 정답에 적힌 필드(names 는 순서 무관)가 같으면 정답. 정답에 없는 필드는 보지 않는다.
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { buildCommandPrompt, callCommandModel, normalizeActions, PROMPT_VERSION } from '../../src/modules/clubSession/aiCommand';

const args = process.argv.slice(2);
const repIdx = args.indexOf('--repeat');
const repeat = repIdx >= 0 ? Math.max(1, Number(args[repIdx + 1]) || 1) : 1;
const files = args.filter((a, i) => !a.startsWith('--') && (repIdx < 0 || i !== repIdx + 1));
const sets = (files.length ? files : [path.join(__dirname, 'cases.json')]).map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));

const same = (exp: any, got: any): string | null => {
  if (!got || exp.action !== got.action) return `동작 ${exp.action} ≠ ${got?.action}`;
  for (const k of Object.keys(exp)) {
    if (k === 'action') continue;
    const e = exp[k];
    const g = got[k];
    if (Array.isArray(e)) {
      const gs = Array.isArray(g) ? [...g].sort() : [];
      if (JSON.stringify([...e].sort()) !== JSON.stringify(gs)) return `${k} ${JSON.stringify(e)} ≠ ${JSON.stringify(g)}`;
    } else if (e && typeof e === 'object') {
      if (JSON.stringify(e) !== JSON.stringify(g ?? {})) return `${k} ${JSON.stringify(e)} ≠ ${JSON.stringify(g)}`;
    } else if (String(e) !== String(g)) return `${k} ${e} ≠ ${g}`;
  }
  return null;
};

(async () => {
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  console.log(`프롬프트 ${PROMPT_VERSION} · 모델 ${model} · 반복 ${repeat}`);
  let pass = 0;
  let total = 0;
  const lat: number[] = [];
  const byTag = new Map<string, { pass: number; total: number }>();
  for (const set of sets) {
    const system = buildCommandPrompt(set.context);
    for (const c of set.cases) {
      for (let r = 0; r < repeat; r++) {
        total++;
        const t = byTag.get(c.tag) ?? { pass: 0, total: 0 };
        t.total++;
        let why: string | null = null;
        let got: any[] = [];
        try {
          const res = await callCommandModel(system, c.text);
          lat.push(res.latencyMs);
          got = normalizeActions(res.raw, set.context.roster, c.text);
          if (got.length !== c.expect.length) why = `동작 수 ${c.expect.length} ≠ ${got.length}`;
          else for (let i = 0; i < got.length && !why; i++) why = same(c.expect[i], got[i]);
        } catch (e: any) {
          why = `호출 실패 ${e?.message}`;
        }
        if (!why) {
          pass++;
          t.pass++;
        } else console.log(`❌ [${c.tag}] ${c.text}\n   ${why}\n   → ${JSON.stringify(got)}`);
        byTag.set(c.tag, t);
      }
    }
  }
  lat.sort((a, b) => a - b);
  console.log(`\n정답률 ${pass}/${total} (${Math.round((pass / Math.max(1, total)) * 100)}%) · 응답 중앙값 ${lat[Math.floor(lat.length / 2)] ?? '-'}ms · p90 ${lat[Math.floor(lat.length * 0.9)] ?? '-'}ms`);
  console.log([...byTag].map(([k, v]) => `${k} ${v.pass}/${v.total}`).join(' · '));
})();
