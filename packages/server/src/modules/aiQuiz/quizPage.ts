// AI 편성 퀴즈 화면(로그인 없는 단독 페이지) — 서버가 그대로 내려준다. helmet 기본 CSP(script-src 'self')라
// 스크립트는 같은 서버의 /ai-quiz/quiz.js 로 따로 싣는다. 이 파일 안 HTML·JS에는 백틱과 ${ 를 쓰지 않는다.

export const QUIZ_HTML = String.raw`<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>콕고 편성 퀴즈</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500&display=swap">
<style>
:root {
  --bg: #f5f7f5; --surface: #ffffff; --ink: #18211d; --muted: #5d6a63; --line: #dfe5e1;
  --court: #1f7a5a; --court-soft: #e3f1ea; --warn: #b26a00; --warn-soft: #fbf0dc; --play: #6b7280; --play-soft: #eef0f2;
  --pick: #1f4f9a; --pick-soft: #e6eefa;
  --sans: "IBM Plex Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, Menlo, monospace;
}
@media (prefers-color-scheme: dark) { :root {
  --bg: #111614; --surface: #19201c; --ink: #e8eeea; --muted: #9aa8a0; --line: #2a332e;
  --court: #4cc08f; --court-soft: #1c3a2d; --warn: #f0b04a; --warn-soft: #3a2c14; --play: #9ca3af; --play-soft: #252a2e;
  --pick: #8db4f2; --pick-soft: #1d2a40; color-scheme: dark } }
* { box-sizing: border-box }
body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--sans); font-size: 15px; line-height: 1.55 }
.wrap { max-width: 1040px; margin: 0 auto; padding-block: 20px 48px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); display: grid; gap: 16px }
header { display: grid; gap: 10px }
h1 { font-size: 22px; font-weight: 700; margin: 0; letter-spacing: -0.01em }
.lead { color: var(--muted); margin: 0; max-width: 64ch }
.bar { height: 8px; background: var(--line); border-radius: 4px; overflow: hidden }
.bar > i { display: block; height: 100%; background: var(--court); width: 0; transition: width .3s }
.progress { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 18px; display: grid; gap: 14px; min-width: 0 }
.qhead { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap }
.qno { font-family: var(--mono); font-size: 13px; color: var(--court); letter-spacing: .04em }
.qwhen { font-weight: 600 }
.ctx { color: var(--muted); font-size: 14px }
.ask { font-size: 17px; font-weight: 600; margin: 0 }
.cols { display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr) }
@media (min-width: 820px) { .cols { grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr) } }
.tablebox { overflow-x: auto; border: 1px solid var(--line); border-radius: 10px }
table { border-collapse: collapse; width: 100%; font-size: 14px }
th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--line); white-space: nowrap }
th { font-size: 12px; color: var(--muted); font-weight: 500; background: var(--bg) }
tr:last-child td { border-bottom: 0 }
td.num { font-family: var(--mono); font-size: 13px }
tr.inA td:first-child { box-shadow: inset 3px 0 0 var(--court) }
tr.inB td:first-child { box-shadow: inset 3px 0 0 var(--pick) }
tr.inA.inB td:first-child { box-shadow: inset 3px 0 0 var(--court), inset 6px 0 0 var(--pick) }
.who { font-weight: 600 }
.chip { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12.5px; background: var(--court-soft); color: var(--court) }
.chip.just { background: var(--warn-soft); color: var(--warn); font-weight: 600 }
.chip.playing { background: var(--play-soft); color: var(--play) }
.opts { display: grid; gap: 12px; align-content: start }
.opt { border: 1.5px solid var(--line); border-radius: 12px; padding: 14px; display: grid; gap: 8px; background: var(--surface); cursor: pointer; text-align: left; font: inherit; color: inherit }
.opt:hover { border-color: var(--muted) }
.opt:focus-visible, button:focus-visible, textarea:focus-visible, input:focus-visible { outline: 2px solid var(--pick); outline-offset: 2px }
.opt[data-k="A"] .tag { background: var(--court-soft); color: var(--court) }
.opt[data-k="B"] .tag { background: var(--pick-soft); color: var(--pick) }
.opt.chosen[data-k="A"] { border-color: var(--court); box-shadow: 0 0 0 2px var(--court-soft) }
.opt.chosen[data-k="B"] { border-color: var(--pick); box-shadow: 0 0 0 2px var(--pick-soft) }
.tag { font-family: var(--mono); font-size: 13px; padding: 1px 8px; border-radius: 6px; justify-self: start }
.four { display: flex; flex-wrap: wrap; gap: 6px }
.p { border: 1px solid var(--line); border-radius: 8px; padding: 4px 8px; font-size: 14px; display: grid; line-height: 1.3 }
.p small { color: var(--muted); font-size: 12px }
.p.just { border-color: var(--warn) }
.reveal { font-size: 13px; color: var(--muted) }
.reveal b { color: var(--ink) }
.answer { display: grid; gap: 10px }
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center }
.btn { font: inherit; font-size: 14px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); border-radius: 8px; padding: 8px 14px; cursor: pointer }
.btn:hover { border-color: var(--muted) }
.btn:disabled { opacity: .45; cursor: default }
.btn.primary { background: var(--court); border-color: var(--court); color: var(--surface); font-weight: 600 }
.btn.on { background: var(--ink); color: var(--surface); border-color: var(--ink) }
.reason { font-size: 13px; padding: 5px 11px; border-radius: 999px }
textarea, input[type=text] { font: inherit; font-size: 14px; width: 100%; border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; background: var(--surface); color: var(--ink) }
textarea { min-height: 64px; resize: vertical }
.label { font-size: 12.5px; color: var(--muted) }
.nav { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap }
.status { font-size: 13px; color: var(--muted); min-height: 1.4em }
.status.err { color: var(--warn) }
.empty { text-align: center; color: var(--muted); padding: 32px 8px }
.jump { display: flex; flex-wrap: wrap; gap: 4px }
.jump button { width: 32px; height: 26px; font: 500 12px var(--mono); border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--muted); cursor: pointer; padding: 0 }
.jump button.done { background: var(--court-soft); color: var(--court); border-color: transparent }
.jump button.cur { outline: 2px solid var(--ink); outline-offset: 1px; color: var(--ink) }
.namebox { display: grid; gap: 8px; max-width: 360px }
@media (prefers-reduced-motion: reduce) { .bar > i { transition: none } }
</style></head><body>
<div class="wrap">
  <header>
    <h1 id="title">콕고 편성 퀴즈</h1>
    <p class="lead">실제 정모에서 운영진이 직접 짠 판과 AI 안이 갈렸던 순간이에요. 그때 상황을 보고 다음 판으로 더 나은 4명을 골라 주세요. 고른 답과 이유는 편성 AI 학습에 그대로 쓰여요.</p>
    <div class="bar" aria-hidden="true"><i id="barFill"></i></div>
    <div class="progress"><span id="progText">문제를 불러오는 중이에요</span><span>초록 줄 = 보기 A에 든 사람 · 파랑 줄 = 보기 B</span></div>
    <div class="jump" id="jump" aria-label="문제 바로 가기"></div>
  </header>
  <main id="main"><div class="card empty">문제를 불러오는 중이에요.</div></main>
</div>
<script src="/api/v1/ai-quiz/quiz.js"></script>
</body></html>`;

export const QUIZ_JS = String.raw`(function () {
  var REASONS = ['막 끝난 사람은 쉬게', '오래 쉰 사람 먼저', '판수 공평', '급수 비슷하게', '팀 실력 균형', '남복·여복 구성', '혼복 구성', '오늘 같이 친 사람 겹침', '실력 섞어치기(빡겜/연습)'];
  var qs = new URLSearchParams(location.search);
  var C = qs.get('c') || '', K = qs.get('k') || '';
  var me = '';
  try { me = localStorage.getItem('cockgo_quiz_name') || ''; } catch (e) {}
  var questions = [], cur = 0, draft = null, saving = false;
  function $(id) { return document.getElementById(id); }
  function el(tag, attrs) {
    var e = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') e.className = v;
      else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), v);
      else if (k === 'disabled') e.disabled = true;
      else e.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      [].concat(c).forEach(function (x) { if (x != null) e.append(x); });
    }
    return e;
  }
  function mine(q) { return q.answers.filter(function (a) { return a.name === me; })[0]; }
  function chip(s) { return el('span', { class: 'chip' + (s === '방금 끝남' ? ' just' : s.indexOf('코트') === 0 ? ' playing' : '') }, s); }
  function srcKey(q, src) { return q.options.filter(function (o) { return o.src === src; })[0].key; }

  function askName() {
    var input = el('input', { type: 'text', id: 'name', maxlength: '20', placeholder: '예) 총무 지훈', 'aria-label': '이름' });
    input.value = me;
    var go = el('button', { class: 'btn primary', type: 'button', onclick: function () {
      var v = input.value.trim();
      if (!v) { input.focus(); return; }
      me = v; try { localStorage.setItem('cockgo_quiz_name', v); } catch (e) {}
      var first = questions.findIndex(function (q) { return !mine(q); });
      cur = first >= 0 ? first : 0; render();
    } }, '시작하기');
    $('main').replaceChildren(el('div', { class: 'card' }, el('div', { class: 'namebox' },
      el('span', { class: 'label' }, '누가 답했는지 구분하려고 이름만 받아요. 여러 운영진이 같은 문제에 각자 답할 수 있어요.'), input, go)));
  }

  function render() {
    var n = questions.length;
    var done = questions.filter(mine).length;
    $('barFill').style.width = n ? (done / n * 100) + '%' : '0';
    $('progText').textContent = n ? (me + ' · ' + done + ' / ' + n + ' 답함') : '아직 문제가 없어요';
    $('jump').replaceChildren.apply($('jump'), questions.map(function (q, i) {
      return el('button', { class: (mine(q) ? 'done' : '') + (i === cur ? ' cur' : ''), 'aria-label': (i + 1) + '번 문제', onclick: function () { go(i); } }, String(i + 1));
    }));
    if (!n) { $('main').replaceChildren(el('div', { class: 'card empty' }, '아직 문제가 없어요. 정모에서 운영진이 직접 짠 판이 쌓이면 여기에 나타나요.')); return; }
    var q = questions[cur];
    var a = mine(q);
    if (!draft || draft.qid !== q.id) draft = { qid: q.id, choice: a ? a.choice : null, reasons: (a && a.reasons) || [], note: (a && a.note) || '' };
    var inOpt = function (k, label) { return q.options.filter(function (o) { return o.key === k; })[0].players.indexOf(label) >= 0; };
    var info = {}; q.people.forEach(function (p) { info[p.label] = p; });
    var rows = q.people.map(function (p) {
      return el('tr', { class: (inOpt('A', p.label) ? 'inA ' : '') + (inOpt('B', p.label) ? 'inB' : '') },
        el('td', { class: 'who' }, p.label), el('td', { class: 'num' }, p.games + '판'), el('td', {}, chip(p.state)));
    });
    var optCard = function (o) {
      return el('button', { class: 'opt' + (draft.choice === o.src ? ' chosen' : ''), 'data-k': o.key, type: 'button', 'aria-pressed': String(draft.choice === o.src), onclick: function () { draft.choice = o.src; render(); } },
        el('span', { class: 'tag' }, '보기 ' + o.key),
        el('div', { class: 'four' }, o.players.map(function (l) {
          var p = info[l];
          return el('span', { class: 'p' + (p && p.state === '방금 끝남' ? ' just' : '') }, l, el('small', {}, p ? p.games + '판 · ' + p.state : ''));
        })));
    };
    var others = q.answers.filter(function (x) { return x.name !== me; });
    var reveal = a ? el('div', { class: 'reveal' }, '실제로는 ', el('b', {}, '운영진이 ' + srcKey(q, 'OPERATOR')), ', ', el('b', {}, 'AI가 ' + srcKey(q, 'AI')), '를 골랐어요.' +
      (others.length ? ' 다른 사람 답: ' + others.map(function (x) { return x.name + ' ' + (x.choice === 'NEITHER' ? '둘 다 별로' : srcKey(q, x.choice)); }).join(', ') : '')) : null;
    var reasonBtns = REASONS.map(function (r) {
      var on = draft.reasons.indexOf(r) >= 0;
      return el('button', { type: 'button', class: 'btn reason' + (on ? ' on' : ''), 'aria-pressed': String(on), onclick: function () {
        draft.reasons = on ? draft.reasons.filter(function (x) { return x !== r; }) : draft.reasons.concat([r]); render();
      } }, r);
    });
    var note = el('textarea', { id: 'note', placeholder: '예) 남C 셋이 방금 끝났으니 한 판 쉬게 하고, 오래 쉰 남E를 넣는 게 맞아요', 'aria-label': '이유 직접 쓰기' });
    note.value = draft.note;
    note.addEventListener('input', function () { draft.note = note.value; });
    $('main').replaceChildren(el('div', { class: 'card' },
      el('div', { class: 'qhead' }, el('span', { class: 'qno' }, '문제 ' + (cur + 1)), el('span', { class: 'qwhen' }, q.when)),
      el('div', { class: 'ctx' }, q.context),
      el('p', { class: 'ask' }, '빈 코트에 다음으로 넣을 4명, 어느 쪽이 더 나을까요?'),
      el('div', { class: 'cols' },
        el('div', { class: 'tablebox' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, '사람'), el('th', {}, '오늘 판수'), el('th', {}, '지금'))), el('tbody', {}, rows))),
        el('div', { class: 'opts' }, q.options.map(optCard),
          el('button', { type: 'button', class: 'btn' + (draft.choice === 'NEITHER' ? ' on' : ''), 'aria-pressed': String(draft.choice === 'NEITHER'), onclick: function () { draft.choice = 'NEITHER'; render(); } }, '둘 다 별로예요 (아래에 어떻게 짤지 적어 주세요)'),
          reveal)),
      el('div', { class: 'answer' },
        el('span', { class: 'label' }, '왜 그렇게 골랐나요? (여러 개 가능)'),
        el('div', { class: 'row' }, reasonBtns),
        note,
        el('div', { class: 'nav' },
          el('div', { class: 'row' },
            el('button', { type: 'button', class: 'btn', disabled: cur === 0, onclick: function () { go(cur - 1); } }, '이전'),
            el('button', { type: 'button', class: 'btn', disabled: cur >= n - 1, onclick: function () { go(cur + 1); } }, '건너뛰기'),
            el('button', { type: 'button', class: 'btn', onclick: askName }, '이름 바꾸기')),
          el('button', { type: 'button', class: 'btn primary', disabled: !draft.choice || saving, onclick: save }, a ? '답 고치고 다음' : '저장하고 다음')),
        el('div', { class: 'status', id: 'status', role: 'status' }))));
  }
  function go(i) { if (i < 0 || i >= questions.length) return; cur = i; draft = null; render(); window.scrollTo(0, 0); }
  function save() {
    if (!draft || !draft.choice || saving) return;
    saving = true; render();
    var q = questions[cur];
    var body = { c: C, k: K, qid: q.id, name: me, choice: draft.choice, reasons: draft.reasons, note: draft.note };
    fetch('/api/v1/ai-quiz/answers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || j.message || '저장하지 못했어요'); return j; }); })
      .then(function () {
        saving = false;
        q.answers = q.answers.filter(function (x) { return x.name !== me; }).concat([{ name: me, choice: draft.choice, reasons: draft.reasons, note: draft.note }]);
        var next = questions.findIndex(function (x, i) { return i > cur && !mine(x); });
        if (next >= 0) go(next); else { draft = null; render(); $('status').textContent = '저장했어요. 남은 문제가 없어요. 고맙습니다!'; }
      })
      .catch(function (e) { saving = false; render(); var s = $('status'); s.className = 'status err'; s.textContent = e.message + ' — 잠시 뒤 다시 눌러 주세요.'; });
  }
  fetch('/api/v1/ai-quiz/questions?c=' + encodeURIComponent(C) + '&k=' + encodeURIComponent(K))
    .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || j.message || '문제를 불러오지 못했어요'); return j; }); })
    .then(function (j) {
      questions = j.questions || [];
      if (j.club) { $('title').textContent = j.club + ' 편성 퀴즈'; document.title = j.club + ' 편성 퀴즈'; }
      if (!me) askName(); else { var first = questions.findIndex(function (q) { return !mine(q); }); cur = first >= 0 ? first : 0; render(); }
    })
    .catch(function (e) { $('main').replaceChildren(el('div', { class: 'card empty' }, e.message)); });
})();`;
