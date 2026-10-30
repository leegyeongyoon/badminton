// ─── 운영판 AI 명령 (자유 문장 → 동작 목록) ───
// 원칙: LLM은 '무엇을 하라는지'만 뽑는다. 편성에서 누구를 넣을지는 편성 엔진이 정한다 — 쉬던 사람 먼저·
// 급수 규칙·같은 4명 피하기·파트너/떼기 요청을 LLM이 우회하지 않게(예전엔 LLM이 나머지 3명을 직접 골랐다).
// 이름은 서버가 명단에 맞춰 확정하고, 애매하면 되묻는다(clarify). 모든 호출은 AiCommandLog 에 남겨
// 실제 문장 평가 세트(scripts/ai-command-eval)로 프롬프트·모델 변경을 숫자로 비교한다.

export const PROMPT_VERSION = 'v2.1-2026-10-30';

export interface RosterPlayer {
  userId: string;
  userName: string;
  skillLevel?: string | null;
  gender?: string | null;
  gamesPlayedToday?: number | null;
  isInLesson?: boolean;
}

export interface CommandContext {
  roster: RosterPlayer[];
  courtNames: string[];
  queueLines: string[];
}

const ACTIONS = [
  'compose', 'assign', 'addToGame', 'reorder', 'swap', 'remove', 'end', 'delete', 'editSkill', 'editName',
  'checkInAll', 'checkout', 'lesson', 'addGuest', 'autoFill', 'pairTogether', 'pairApart', 'unknown',
] as const;

export function buildCommandPrompt(ctx: CommandContext): string {
  const roster = ctx.roster
    .map(
      (p) =>
        `${p.userName}(${p.skillLevel || '-'},${p.gender === 'M' ? '남' : p.gender === 'F' ? '여' : '?'},${p.gamesPlayedToday ?? 0}판${p.isInLesson ? ',레슨중' : ''})`,
    )
    .join(', ');
  return [
    '너는 배드민턴 정모 운영판의 명령 해석기다. 운영자의 한국어 문장을 실행할 동작 목록으로 바꿔 JSON 하나로만 출력한다.',
    '출력: {"actions":[{"action":"...", ...필드}, ...]} — 문장에 동작이 여럿이면 말한 순서대로 여러 개. 필드는 action 과 같은 레벨(중첩 금지).',
    `출석자(이름·급수·성별·오늘 판수): ${roster || '(없음)'}`,
    `코트: ${ctx.courtNames.join(', ') || '(없음)'}`,
    `대기 게임: ${ctx.queueLines.join(' | ') || '(없음)'}`,
    '동작과 필드:',
    '- compose {names:[], want?}          // 새 게임 편성(대기 맨 뒤)',
    '- assign {court:번호, names:[], want?} // 편성해서 그 코트에 바로 투입. names 와 want 가 모두 비면 "다음 대기 게임"을 그 코트에 투입',
    '- addToGame {gameNo, names:[]}       // N번 대기 게임으로 사람 이동/추가("1번에 넣어/1번으로 옮겨")',
    '- reorder {from, to}                 // 대기 게임 순서 이동("3번 맨 앞으로" → from 3, to 1)',
    '- swap {out, in}                     // 선수 교체(게임에 있는 사람 out ↔ 넣을 사람 in)',
    '- remove {name}                      // 대기 게임에서 빼기',
    '- end {court}                        // 코트 게임 종료 — "끝내/종료/끝났어"라고 말했을 때만. "다음 게임 넣어"만으로는 end 아님',
    '- delete {gameNo}                    // N번 대기 게임 삭제',
    '- editSkill {name, skill}            // 급수 변경(S/A/B/C/D/E/F)',
    '- editName {name, newName}           // 이름 변경',
    '- checkInAll {} · lesson {name}(레슨 토글) · addGuest {guestName, skill?} · autoFill {}(자동 편성)',
    '- checkout {name}                    // 정모에서 퇴장("먼저 갔어/집에 갔어/퇴장/오늘 끝"). 대기 게임에서만 빼는 건 remove',
    '- pairTogether {names:[2명], games?} // 두 사람을 같은 팀으로("대회 파트너", "같이 2게임" → games 2, 판수 말 없으면 생략)',
    '- pairApart {names:[2명]}            // 두 사람을 같은 게임에 넣지 않기("같이 안 짜줘/떼어줘/붙이지 마")',
    '- unknown {reason}                   // 못 알아듣거나 명단에 없는 사람',
    '편성(compose/assign) 규칙 — 가장 중요:',
    '· names 에는 문장에서 운영자가 "직접 말한 사람만" 넣는다. 말하지 않은 사람을 네가 골라 채우지 마라. 빈자리는 편성 엔진이',
    '  공정 규칙(쉬던 사람 먼저·급수·같은 4명 피하기·요청)으로 채운다. 아무도 안 말했으면 names 는 [].',
    '· 조건은 want 로만 전한다: gameType = "mixed"(혼복) | "men"(남복) | "women"(여복) | "same"(남복이나 여복, "동성끼리"),',
    '  level = "up"(빡세게·잘하는 사람들로·세게) | "down"(가볍게·덜 빡세게·초심/입문이랑·살살). 말 안 한 조건은 넣지 않는다.',
    '이름: 명단의 정확한 이름으로 쓴다. 성을 빼고 부르거나("민준이", "지민씨") 호칭이 붙어도 명단에서 그 사람을 찾아 정확한 이름으로.',
    '  명단에 같은 이름 후보가 여럿이면 말한 그대로 두어라(서버가 되묻는다). 명단에 없으면 unknown.',
    'court·gameNo·from·to·games 는 숫자. "2코트/코트2/2번 코트" → court 2.',
    '예) "안지민 게임 짜줘" → {"actions":[{"action":"compose","names":["안지민"]}]}',
    '예) "혼복 한 판 가볍게" → {"actions":[{"action":"compose","names":[],"want":{"gameType":"mixed","level":"down"}}]}',
    '예) "철수랑 영희 넣고 빡세게 3코트에" → {"actions":[{"action":"assign","court":3,"names":["철수","영희"],"want":{"level":"up"}}]}',
    '예) "2코트 다음 게임 넣어" → {"actions":[{"action":"assign","court":2,"names":[]}]}',
    '예) "2코트 끝내고 다음 게임 넣어" → {"actions":[{"action":"end","court":2},{"action":"assign","court":2,"names":[]}]}',
    '예) "1번에서 민수 빼고 지훈 넣어" → {"actions":[{"action":"swap","out":"민수","in":"지훈"}]}',
    '예) "3번 게임 지우고 자동으로 채워" → {"actions":[{"action":"delete","gameNo":3},{"action":"autoFill"}]}',
    '예) "철수 영희 대회 파트너 2게임, 민수 지훈은 떼어줘" → {"actions":[{"action":"pairTogether","names":["철수","영희"],"games":2},{"action":"pairApart","names":["민수","지훈"]}]}',
    '설명 없이 JSON 객체 하나만 출력.',
  ].join('\n');
}

// 호칭·조사 떼기: "민준이", "지민씨", "수아님", "영희랑" → 이름 줄기
const SUFFIX = /(이|님|씨|형|누나|언니|오빠|쌤|선생님|랑|이랑|하고|도|는|은|을|를)$/;
function stems(raw: string): string[] {
  const t = raw.trim();
  const out = [t];
  let cur = t;
  for (let i = 0; i < 2; i++) {
    const n = cur.replace(SUFFIX, '');
    if (n === cur || n.length < 1) break;
    out.push(n);
    cur = n;
  }
  return out;
}

export type NameMatch = { name: string } | { ambiguous: RosterPlayer[] } | { missing: true };

/** 말한 이름 → 명단의 정확한 이름. 완전일치 → 호칭 뗀 완전일치 → 성 빼고 부른 이름(끝이 같음) → 부분일치. */
export function resolveName(raw: string, roster: RosterPlayer[]): NameMatch {
  if (!raw) return { missing: true };
  for (const s of stems(raw)) {
    const ex = roster.filter((p) => p.userName === s);
    if (ex.length === 1) return { name: ex[0].userName };
    if (ex.length > 1) return { ambiguous: ex };
  }
  for (const s of stems(raw)) {
    if (s.length < 2) continue;
    const tail = roster.filter((p) => p.userName.length > s.length && p.userName.endsWith(s));
    if (tail.length === 1) return { name: tail[0].userName };
    if (tail.length > 1) return { ambiguous: tail };
    const part = roster.filter((p) => p.userName.includes(s));
    if (part.length === 1) return { name: part[0].userName };
    if (part.length > 1) return { ambiguous: part };
  }
  return { missing: true };
}

const NAME_LIST_FIELDS = ['names'] as const;
const NAME_FIELDS = ['name', 'out', 'in'] as const;

/**
 * LLM 출력 → 실행할 동작 목록. 이름을 명단에 맞춰 확정하고, 애매하면 그 자리에서 멈추고 되묻는다.
 * 반환 actions 의 마지막이 clarify/unknown 이면 앞 동작만 실행하고 운영자에게 묻는다(모바일).
 */
export function normalizeActions(raw: any, roster: RosterPlayer[], text = ''): any[] {
  let list: any[] = [];
  if (raw && Array.isArray(raw.actions)) list = raw.actions;
  else if (raw && typeof raw.action === 'string') list = [raw];
  else if (raw && typeof raw === 'object') {
    // {"compose":{"names":[]}} 처럼 중첩으로 주면 평탄화
    const keys = Object.keys(raw);
    if (keys.length === 1 && (ACTIONS as readonly string[]).includes(keys[0])) {
      const inner = raw[keys[0]];
      list = [inner && typeof inner === 'object' ? { action: keys[0], ...inner } : { action: keys[0] }];
    }
  }
  const out: any[] = [];
  for (const a0 of list.slice(0, 6)) {
    if (!a0 || typeof a0 !== 'object' || !(ACTIONS as readonly string[]).includes(a0.action)) {
      out.push({ action: 'unknown', reason: '알아듣지 못했어요' });
      break;
    }
    // 게임 종료는 되돌리기 어렵다 — 문장에 끝내라는 말이 없으면 LLM이 덧붙여도 뺀다.
    if (a0.action === 'end' && text && !/(끝|종료|마치|마감|그만)/.test(text)) continue;
    const a = { ...a0 };
    let stop: any = null;
    const fix = (v: any): string | null => {
      let r = resolveName(String(v ?? ''), roster);
      let said = String(v ?? '');
      // LLM이 '민준이'를 김민준으로 골라 줘도, 문장에 성까지는 없고 같은 이름(민준)이 여럿이면 되묻는다.
      if ('name' in r && text && !text.includes(r.name)) {
        const given = r.name.length >= 3 ? r.name.slice(1) : r.name;
        if (text.includes(given)) {
          const same = roster.filter((p) => p.userName.endsWith(given));
          if (same.length > 1) {
            r = { ambiguous: same };
            said = given;
          }
        }
      }
      if ('name' in r) return r.name;
      if (!stop) {
        stop =
          'ambiguous' in r
            ? {
                action: 'clarify',
                reason: `'${said}' 누구요? ${r.ambiguous.slice(0, 5).map((p) => `${p.userName}(${p.skillLevel || '-'})`).join(' · ')}`,
                options: r.ambiguous.slice(0, 5).map((p) => p.userName),
              }
            : { action: 'unknown', reason: `'${v}' 님이 출석 명단에 없어요` };
      }
      return null;
    };
    for (const f of NAME_LIST_FIELDS) {
      if (Array.isArray(a[f])) a[f] = Array.from(new Set(a[f].map(fix).filter(Boolean)));
    }
    for (const f of NAME_FIELDS) {
      if (a[f] != null && a.action !== 'addGuest') a[f] = fix(a[f]);
    }
    if (a.want && typeof a.want === 'object') {
      const w: any = {};
      if (['mixed', 'men', 'women', 'same'].includes(a.want.gameType)) w.gameType = a.want.gameType;
      if (['up', 'down'].includes(a.want.level)) w.level = a.want.level;
      if (Object.keys(w).length) a.want = w;
      else delete a.want;
    }
    // 편성은 '말한 사람'까지만 — 엔진이 채운다. 4명 넘게 말하면 앞 4명.
    if ((a.action === 'compose' || a.action === 'assign') && Array.isArray(a.names)) a.names = a.names.slice(0, 4);
    if (stop) {
      out.push(stop);
      break;
    }
    out.push(a);
    if (a.action === 'unknown') break;
  }
  if (out.length === 0) out.push({ action: 'unknown', reason: '알아듣지 못했어요' });
  return out;
}

export async function callCommandModel(system: string, text: string): Promise<{ raw: any; model: string; latencyMs: number }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw Object.assign(new Error('AI 명령이 설정되지 않았어요 (OPENAI_API_KEY 없음)'), { status: 503 });
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const t0 = Date.now();
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: text },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 400,
    }),
  }).catch(() => {
    throw Object.assign(new Error('AI 호출에 실패했어요'), { status: 502 });
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw Object.assign(new Error(`AI 해석 실패 (${res.status})${t ? `: ${t.slice(0, 120)}` : ''}`), { status: 502 });
  }
  const data: any = await res.json();
  let raw: any;
  try {
    raw = JSON.parse(data?.choices?.[0]?.message?.content || '{}');
  } catch {
    throw Object.assign(new Error('AI 응답 형식 오류'), { status: 502 });
  }
  return { raw, model: data?.model || model, latencyMs: Date.now() - t0 };
}
