// 試合（3セットマッチ・5セットマッチ、試作）。試合の計算（Match / SetGame）で1ラリーずつ進め、記録を3Dで再生する。
// 試合の前とセットの間に止まり、先発メンバーと並び・方針を変える仮の画面を出す。
// セットの中で止まる場面では、仮の停止画面（タイムアウト・選手交代・試合に戻る）を出す。
// 画面の見た目は第4段階（デザイン）で作り込む。

import { FATIGUE } from '../sim/constants';
import { Match, type BestOf, type MatchOptions } from '../sim/game';
import { aceOf, MANAGER_MAX, MANAGER_SKILL_IDS, MANAGER_SKILLS } from '../sim/manager';
import { OWN, SetGame, type StopInfo } from '../sim/match';
import { makeBench, makeTeam } from '../sim/sample';
import { TRAITS } from '../sim/traits';
import type { AttackTactic, BlockTactic, Gender, Player, RallyRecord, ReceiveTactic, Role, Tactics, TeamId, TeamState } from '../sim/types';
import { PLAYBACK_RATE } from './common';
import { Playback, pointText } from './playback';
import { bindRows, playerRowHtml, rowHeadHtml, showPlayerDetail, type RowContext } from './parts/player';
import { Render3D } from './render3d';

const SPEEDS = [1, 2, 4];
const TEAM_NAME: Record<TeamId, string> = { A: '赤', B: '青' };
/** 見せ方の段階：フル（全ラリーを再生）／結果のみ（止まる場面まで一気に進む）。ハイライトは次の段階で */
type ShowMode = 'full' | 'result';
/** 試作用：自チームの監督が持っている監督特能（試合前の画面で3つまで選ぶ。獲得・失効は育成の段階で） */
let managerSkills = ['geki', 'tatenaoshi', 'shoubukan'];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const r3 = new Render3D($('view').querySelector('canvas')!, 'male');
const params = new URLSearchParams(location.search);

let gender: Gender = params.get('gender') === 'female' ? 'female' : 'male';
let mode: ShowMode = params.get('mode') === 'result' ? 'result' : 'full';
let bestOf: BestOf = params.get('sets') === '5' ? 5 : 3;
let speedIdx = 0;
let playing = true;
let matchSeed = Number(params.get('seed') || 1);
let match!: Match;
/** 今のセット（試合の前・セットの間は null） */
let game: SetGame | null = null;
let pb: Playback | null = null;
let t = 0;
let shownScore: Record<TeamId, number> = { A: 0, B: 0 };
/** 画面に見せているコートの向き。最終セットの8点のコートチェンジは、そのラリーの再生が終わってから反映する */
let viewSwapped = false;
let stopAfter: StopInfo | null = null;
/**
 * 育成から開いた時（?embed=1）：親の画面から試合の設定（MatchOptions）を受け取って試合をし、終わったら結果を親へ返す。
 * 試合の形・男女・監督特能は親の設定のまま（変えられない）
 */
const embed = params.get('embed') === '1';
let embedOptions: MatchOptions | null = null;
/** 第1セットの始まりのコート上の選手とリベロ（試合の経験の「スタメン」） */
let starters: string[] = [];
let stopped = false;
let counted = false;

function newMatch() {
  match = embedOptions ? new Match({ ...embedOptions, managerSkills }) : new Match({
    gender, bestOf, seed: matchSeed++, managerSkills,
    teams: { A: makeTeam(1, 'A', gender, 55), B: makeTeam(2, 'B', gender, 55) },
    bench: { A: makeBench(1, 'A', gender, 55), B: makeBench(2, 'B', gender, 55) },
  });
  r3.setGender(gender);
  game = null;
  pb = null;
  r3.reset();
  shownScore = { A: 0, B: 0 };
  viewSwapped = match.swapped;
  $('msg').classList.remove('show');
  updateHud();
  openLineup();
}

/** 次のセットを始める */
function beginSet() {
  if (match.results.length === 0) {
    const a = match.lineups.A;
    starters = [...a.rotation.map(s => s.player.id), ...(a.libero ? [a.libero.id] : [])];
  }
  game = match.startSet();
  closePanel();
  shownScore = { A: 0, B: 0 };
  viewSwapped = match.swapped;
  pb = null;
  r3.reset();
  $('msg').classList.remove('show');
  updateHud();
  // セットの始まりの停止は、直前の「試合前・セット間」の画面と同じ役目なので出さない
  game.takePendingStop();
}

/** セットが終わった：試合の終わりか、セットの間へ */
function endSet() {
  match.finishSet();
  game = null;
  viewSwapped = match.swapped;
  updateHud();
  if (match.phase === 'over') openMatchOver();
  else openLineup();
}

/** 次のラリーへ。結果のみの時は、止まる場面かセットの終わりまで一気に進める */
function advance() {
  if (!game) return;
  if (game.over) { endSet(); return; }
  viewSwapped = match.swapped;
  if (mode === 'result') {
    let last: RallyRecord | null = null;
    let stop: StopInfo | null = null;
    while (!game.over && !stop) ({ rec: last, stop } = game.next());
    shownScore = { ...game.score };
    viewSwapped = match.swapped;
    pb = null;
    collectNotices();
    if (last) showMessage(pointMessage(last));
    updateHud();
    if (stop) openStop(stop);
    else endSet();
    return;
  }
  const before = { ...game.score };
  const { rec, stop } = game.next();
  shownScore = before;
  pb = new Playback(rec);
  r3.reset();
  t = 0;
  counted = false;
  stopAfter = stop;
  collectNotices();
  $('msg').classList.remove('show');
  updateHud();
}

/** 直前のラリーの後に起きた出来事の一言（相手の交代・ピンチサーバー、ピンチサーバーが戻った） */
let lastNotices: string[] = [];
function collectNotices() {
  lastNotices = (game?.notices ?? []).map(n => `${TEAM_NAME[n.team]}：${n.text}`);
}
function pointMessage(rec: RallyRecord): string {
  return [pointText(rec, x => TEAM_NAME[x]), ...lastNotices].join('　／　');
}

function showMessage(text: string) {
  $('msg').textContent = text;
  $('msg').classList.add('show');
}

function setsText(): string {
  return `セット 赤${match.setsWon.A}-${match.setsWon.B}青`;
}

function updateHud() {
  $('sa').textContent = String(shownScore.A);
  $('sb').textContent = String(shownScore.B);
  const setPart = game ? `第${game.setNumber}セット（${game.target}点）` : match.phase === 'over' ? '試合終了' : '試合前・セット間';
  $('setInfo').textContent = `${setPart}　${setsText()}（${match.bestOf}セットマッチ）`;
  const dots = (n: number) => '●'.repeat(n) + '○'.repeat(Math.max(0, 2 - n));
  $('toA').textContent = game ? `赤 TO ${dots(game.timeoutsLeft.A)}` : '';
  $('toB').textContent = '';
  $('btnMode').textContent = mode === 'full' ? 'フル' : '結果のみ';
}

// ---------------- 共通 ----------------

const ROLE_NAME: Record<Role, string> = { S: 'セッター', OH: 'アウトサイド', MB: 'ミドル', OP: 'オポジット', L: 'リベロ' };

function openPanel() {
  stopped = true;
  $('stop').classList.remove('hidden');
}

function closePanel() {
  stopped = false;
  $('stop').classList.add('hidden');
}

function bestRole(p: Player): Role {
  return (Object.entries(p.aptitude) as [Role, number][]).sort((a, b) => b[1] - a[1])[0][0];
}

function tiredHtml(p: Player, fatigue: Record<string, number>): string {
  const f = fatigue[p.id] ?? 0;
  return f >= FATIGUE.tiredNote ? '<span class="tired">足が止まってきた</span>' : '';
}

/** 自チームの一覧（共通部品の行）：コート・リベロ・控え。行を押すと詳細を真ん中に出す */
function rosterParts(team: TeamState, bench: Player[], fatigue: Record<string, number>, mode: 'pregame' | 'stop'): { html: string; find: (id: string) => [Player, RowContext] | undefined } {
  const items: [Player, RowContext][] = [
    ...team.rotation.map(sl => [sl.player, { mode, role: sl.role, where: 'コート' }] as [Player, RowContext]),
    ...(team.libero ? [[team.libero, { mode, role: 'L' as Role, where: 'リベロ' }] as [Player, RowContext]] : []),
    ...bench.map(p => [p, { mode, where: '控え', dim: true }] as [Player, RowContext]),
  ];
  for (const [p, ctx] of items) if ((fatigue[p.id] ?? 0) >= FATIGUE.tiredNote) ctx.tired = '足が止まってきた';
  return {
    html: `<div class="plist">${rowHeadHtml(mode)}${items.map(([p, ctx]) => playerRowHtml(p, ctx)).join('')}</div>`,
    find: id => items.find(([p]) => p.id === id),
  };
}

/** 一覧を入れて、行を押すと詳細を出すようにする */
function mountRoster(el: HTMLElement, r: ReturnType<typeof rosterParts>, extra = '') {
  el.insertAdjacentHTML('beforeend', r.html + extra);
  bindRows(el, id => { const it = r.find(id); if (it) showPlayerDetail($('app'), it[0], it[1]); });
}

function btn(label: string, on: () => void, disabled = false, cls = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.disabled = disabled;
  if (cls) b.className = cls;
  b.onclick = on;
  return b;
}

function setButtons(list: [string, () => void][]) {
  const box = $('stopButtons');
  box.innerHTML = '';
  for (const [label, on] of list) box.appendChild(btn(label, on));
}

function modeButton(redraw: () => void): HTMLButtonElement {
  return btn(`見せ方：${mode === 'full' ? 'フル' : '結果のみ'}`, () => { toggleMode(); redraw(); }, false, 'sub');
}

/** 各セットの得点 */
function resultsHtml(): string {
  if (!match.results.length) return '';
  return match.results.map((r, i) =>
    `<div>第${i + 1}セット　赤 ${r.A} - ${r.B} 青　<small>（${TEAM_NAME[r.winner]}）</small></div>`).join('');
}

const TACTIC_OPTS: { key: keyof Tactics; label: string; items: [string, string][] }[] = [
  { key: 'attack', label: '攻撃', items: [['ace', 'エース中心'], ['balance', 'バランス'], ['quick', '速攻中心']] },
  { key: 'block', label: 'ブロック', items: [['bunch', 'バンチ'], ['spread', 'スプレッド'], ['dedicate', 'デディケート']] },
  { key: 'receive', label: 'レシーブ', items: [['front', '前寄り'], ['back', '後ろ寄り']] },
];

/** 方針（作戦3項目）のボタン。押すと on(key, value) */
function tacticsHtml(cur: Tactics): string {
  return TACTIC_OPTS.map(o =>
    `<div class="trow"><span class="label">${o.label}</span><span class="picklist">${o.items.map(([v, n]) =>
      `<button class="pick ${cur[o.key] === v ? 'on' : ''}" data-k="${o.key}" data-v="${v}">${n}</button>`).join('')}</span></div>`).join('');
}

function bindTactics(root: HTMLElement, on: (k: keyof Tactics, v: string) => void) {
  for (const b of Array.from(root.querySelectorAll<HTMLButtonElement>('button[data-k]'))) {
    b.onclick = () => on(b.getAttribute('data-k') as keyof Tactics, b.getAttribute('data-v')!);
  }
}

function toTactics(cur: Tactics): Tactics {
  return { attack: cur.attack as AttackTactic, block: cur.block as BlockTactic, receive: cur.receive as ReceiveTactic };
}

// ---------------- 試合の前・セットの間（先発と並び・方針） ----------------

/** 選んでいるもの：並びの位置（0〜5＝ゾーン1〜6）、リベロ、控えの選手 */
type Pick = { kind: 'slot'; i: number } | { kind: 'libero' } | { kind: 'bench'; id: string } | null;
let pick: Pick = null;

function openLineup() {
  pick = null;
  openPanel();
  renderLineup();
}

const TACTIC_NAME: Record<string, string> = Object.fromEntries(TACTIC_OPTS.flatMap(o => o.items));

/** データ分析（監督特能）：相手の方針・エース・主な選手の緑（行動の傾向）を見せる */
function scoutingHtml(): string {
  if (!managerSkills.includes('dataBunseki')) return '';
  const opp = match.lineups.B;
  const ace = aceOf(opp);
  const players = [...opp.rotation.map(s => s.player), ...(opp.libero ? [opp.libero] : [])];
  const styles = players.flatMap(p => {
    const names = p.traits.map(id => TRAITS[id]).filter(d => d?.kind === 'style').map(d => d!.name);
    return names.length ? [`${p.number}番 ${names.join('・')}`] : [];
  });
  const t = opp.tactics;
  return `<div class="card scout"><b>相手の傾向（データ分析）</b><br>
    方針：攻撃 ${TACTIC_NAME[t.attack]}・ブロック ${TACTIC_NAME[t.block]}・レシーブ ${TACTIC_NAME[t.receive]}<br>
    エース：${ace ? `${ace.number}番` : '－'}<br>
    選手の傾向：${styles.join('／') || '目立った傾向なし'}</div>`;
}

function renderLineup() {
  const team = match.lineups[OWN];
  const pre = match.phase === 'pregame';
  const r = team.rotation;
  const sel = (p: Pick) => JSON.stringify(p) === JSON.stringify(pick) ? 'on' : '';
  const zone = (i: number) => {
    const p = r[i].player;
    return `<button class="zone ${sel({ kind: 'slot', i })}" data-slot="${i}">${p.number}<br><small>${ROLE_NAME[r[i].role].slice(0, 3)}</small>${tiredHtml(p, match.fatigue) ? '<br><small class="tired">疲れ</small>' : ''}</button>`;
  };
  const lib = team.libero;
  const next = match.results.length + 1;
  const head = pre && embed
    ? `<div class="reason">試合前（${bestOf}セットマッチ）</div>`
    : pre
    ? `<div class="reason">試合前</div><div class="hint">試合の形</div>
       <span class="picklist">${([3, 5] as BestOf[]).map(n => `<button class="pick ${bestOf === n ? 'on' : ''}" data-best="${n}">${n}セットマッチ</button>`).join('')}</span>`
    : `<div class="big">${setsText()}</div><div class="reason">セット間（次は第${next}セット${match.nextIsFinal ? '・最終' : ''}）</div>${resultsHtml()}`;
  $('stopLeft').innerHTML = `
    <div class="card">${head}</div>
    <div class="card"><div class="rot pickable"><div class="net">ネット（左からゾーン4・3・2／下の段はゾーン5・6・1）</div>
      ${zone(3)}${zone(2)}${zone(1)}${zone(4)}${zone(5)}${zone(0)}</div>
      <div class="librow"><button class="zone ${sel({ kind: 'libero' })}" data-lib="1">リベロ ${lib ? lib.number : '－'}</button>
      <button class="zone" data-rot="1">並びを回す</button></div></div>`;
  const benchRows = match.bench[OWN].map(p =>
    `<button class="pick ${sel({ kind: 'bench', id: p.id })}" data-bench="${p.id}">${p.number} ${ROLE_NAME[bestRole(p)]}${tiredHtml(p, match.fatigue) ? '（疲れ）' : ''}</button>`).join('');
  const skillRow = pre && !embed
    ? `<div class="brow"><span class="label">監督特能</span><span class="picklist">${MANAGER_SKILL_IDS.map(id =>
      `<button class="pick ${managerSkills.includes(id) ? 'on' : ''}" data-ms="${id}">${MANAGER_SKILLS[id].name}</button>`).join('')}</span></div>
      <div class="hint">監督特能は試作用に3つまで選べる（獲得・失効は育成の段階で作る）</div>`
    : `<div class="hint">監督特能：${managerSkills.map(id => MANAGER_SKILLS[id].name).join('・') || 'なし'}</div>`;
  $('stopRight').innerHTML = `${skillRow}${scoutingHtml()}
    <div class="hint">2か所を続けて押すと入れ替え（控え→位置・リベロで先発と交代）</div>
    <div class="brow"><span class="label">控え</span><span class="picklist">${benchRows || '－'}</span></div>
    ${tacticsHtml(team.tactics)}`;
  mountRoster($('stopRight'), rosterParts(team, match.bench[OWN], match.fatigue, 'pregame'), '<div class="hint">行を押すと選手の詳細</div>');

  // 試合の形（試合前だけ）。並びを保ったまま作り直す
  for (const b of Array.from($('stopLeft').querySelectorAll<HTMLButtonElement>('button[data-best]'))) {
    b.onclick = () => {
      bestOf = Number(b.getAttribute('data-best')) as BestOf;
      match = new Match({
        gender, bestOf, seed: matchSeed++, managerSkills,
        teams: { ...match.lineups }, bench: { ...match.bench },
      });
      updateHud();
      renderLineup();
    };
  }
  for (const b of Array.from($('stopLeft').querySelectorAll<HTMLButtonElement>('button[data-slot]'))) {
    b.onclick = () => tapLineup({ kind: 'slot', i: Number(b.getAttribute('data-slot')) });
  }
  ($('stopLeft').querySelector('button[data-lib]') as HTMLButtonElement).onclick = () => tapLineup({ kind: 'libero' });
  ($('stopLeft').querySelector('button[data-rot]') as HTMLButtonElement).onclick = () => {
    match.rotateLineup();
    pick = null;
    renderLineup();
  };
  for (const b of Array.from($('stopRight').querySelectorAll<HTMLButtonElement>('button[data-bench]'))) {
    b.onclick = () => tapLineup({ kind: 'bench', id: b.getAttribute('data-bench')! });
  }
  bindTactics($('stopRight'), (k, v) => {
    match.setTactics(toTactics({ ...match.lineups[OWN].tactics, [k]: v }));
    renderLineup();
  });
  // 監督特能（試作用）：押すと持つ／外す。3つまで
  for (const b of Array.from($('stopRight').querySelectorAll<HTMLButtonElement>('button[data-ms]'))) {
    b.onclick = () => {
      const id = b.getAttribute('data-ms')!;
      if (managerSkills.includes(id)) managerSkills = managerSkills.filter(x => x !== id);
      else if (managerSkills.length < MANAGER_MAX) managerSkills = [...managerSkills, id];
      match.setManagerSkills(managerSkills);
      renderLineup();
    };
  }

  const box = $('stopButtons');
  box.innerHTML = '';
  box.append(
    btn(pre ? '試合開始' : `第${next}セットへ`, beginSet),
    modeButton(renderLineup),
  );
}

/** 並びの編集：1つ目を選び、2つ目で入れ替える */
function tapLineup(p: Exclude<Pick, null>) {
  const a = pick;
  if (!a || JSON.stringify(a) === JSON.stringify(p)) {
    pick = a ? null : p;
    renderLineup();
    return;
  }
  const benchOf = a.kind === 'bench' ? a : p.kind === 'bench' ? p : null;
  const other = benchOf === a ? p : a;
  if (a.kind === 'slot' && p.kind === 'slot') match.swapSlots(a.i, p.i);
  else if (benchOf && other.kind === 'slot') match.replaceStarter(other.i, benchOf.id);
  else if (benchOf && other.kind === 'libero') match.replaceLibero(benchOf.id);
  else { pick = p; renderLineup(); return; } // 組み合わせにならない時は選び直し
  pick = null;
  renderLineup();
}

function openMatchOver() {
  openPanel();
  const w = match.winner!;
  $('stopLeft').innerHTML = `<div class="card"><div class="big">${setsText()}</div>
    <div class="reason">試合終了：${TEAM_NAME[w]}の勝ち</div></div>`;
  $('stopRight').innerHTML = `<div class="card">${resultsHtml()}</div>`;
  const box = $('stopButtons');
  box.innerHTML = '';
  if (embed) {
    // 育成へ戻る：結果を親へ返す
    box.append(btn('育成に戻る', () => {
      window.parent.postMessage({
        type: 'matchResult',
        outcome: { win: match.winner === 'A', sets: match.results.map(r => ({ own: r.A, opp: r.B })), lines: match.lines, starters },
      }, '*');
    }), modeButton(openMatchOver));
    return;
  }
  box.append(btn('新しい試合', newMatch), modeButton(openMatchOver));
}

// ---------------- セットの中の停止画面（仮） ----------------

let currentStop: StopInfo | null = null;

function openStop(stop: StopInfo) {
  currentStop = stop;
  openPanel();
  renderStopMain();
}

function closeStop() {
  currentStop = null;
  closePanel();
  advance();
}

function rotationHtml(g: SetGame): string {
  const r = g.teams[OWN].rotation;
  const z = (i: number) => `<div>${r[i].player.number}<br><small>${ROLE_NAME[r[i].role].slice(0, 3)}</small></div>`;
  // 前衛：ゾーン4・3・2、後衛：ゾーン5・6・1
  return `<div class="rot"><div class="net">ネット</div>${z(3)}${z(2)}${z(1)}${z(4)}${z(5)}${z(0)}</div>`;
}

function renderStopMain() {
  const g = game!;
  const s = currentStop!;
  $('stopLeft').innerHTML = `
    <div class="card"><div class="big">赤 ${g.score.A} - ${g.score.B} 青</div><div class="reason">${s.label}</div>
      <div>第${g.setNumber}セット・${setsText()}</div>
      ${lastNotices.length ? `<div class="hint">${lastNotices.join('<br>')}</div>` : ''}</div>
    <div class="card">タイムアウト 残り：${g.timeoutsLeft.A}回<br>選手交代：${g.subsUsed.A} / 6回
      <br>監督特能：${managerSkills.map(id => MANAGER_SKILLS[id].name).join('・') || 'なし'}${buffsHtml(g)}</div>
    <div class="card">${rotationHtml(g)}</div>`;
  const team = g.teams[OWN];
  $('stopRight').innerHTML = '';
  mountRoster($('stopRight'), rosterParts(team, g.bench[OWN], g.fatigue, 'stop'), '<div class="hint">薄い行は控え。行を押すと選手の詳細</div>');
  const box = $('stopButtons');
  box.innerHTML = '';
  box.append(
    btn(`タイムアウト（残り${g.timeoutsLeft[OWN]}）`, chooseSkill, !g.canTimeout()),
    btn('選手交代', chooseOut, g.validSubs().length === 0),
    ...(g.canInstinct() ? [btn('勝負勘', chooseInstinct)] : []),
    btn('試合に戻る', closeStop, false, 'sub'),
    modeButton(renderStopMain),
  );
}

/** いま効いている監督特能（タイムアウトの効果は残りラリー数、エース対策は相手） */
function buffsHtml(g: SetGame): string {
  if (!g.buffs.length) return '';
  const list = g.buffs.map(b => {
    // かかっている側：自分たちへの上乗せは使った側、相手へのものは使われた側
    const user = MANAGER_SKILLS[Object.keys(MANAGER_SKILLS).find(id => MANAGER_SKILLS[id].name === b.name) ?? '']?.opp ? (b.team === 'A' ? 'B' : 'A') : b.team;
    const target = b.targetId ? `→${TEAM_NAME[b.team]}${[...g.teams[b.team].rotation.map(s => s.player)].find(p => p.id === b.targetId)?.number ?? ''}番` : '';
    const left = Number.isFinite(b.left) ? `（残り${b.left}ラリー）` : '（このセットの間）';
    return `${TEAM_NAME[user as TeamId]}の${b.name}${target}${left}`;
  });
  return `<br><span class="hint">効いている：${list.join('・')}</span>`;
}

/** 勝負勘：次の1ラリーだけ方針を変える（1試合1回。タイムアウトの回数は使わない） */
function chooseInstinct() {
  const cur: Tactics = { ...game!.teams[OWN].tactics };
  const draw = () => {
    $('stopRight').innerHTML = '<div class="hint">勝負勘：次の1ラリーだけ方針を変える（1試合1回）</div>' + tacticsHtml(cur);
    bindTactics($('stopRight'), (k, v) => {
      (cur as unknown as Record<string, string>)[k] = v;
      draw();
    });
  };
  draw();
  setButtons([
    ['決定', () => { game!.instinct(toTactics(cur)); renderStopMain(); }],
    ['やめる', renderStopMain],
  ]);
}

/** タイムアウト：監督特能を1つ選ぶ → 方針を変える */
function chooseSkill() {
  $('stopRight').innerHTML = `<div class="hint">監督特能を1つ選ぶ（効果は次の5ラリー）</div><div class="picklist" id="skills"></div>`;
  for (const s of game!.timeoutChoices()) {
    const b = document.createElement('button');
    b.className = 'pick';
    const ace = s.oppAceOnly ? aceOf(game!.teams.B) : undefined;
    b.innerHTML = `${s.name}<br><small>${s.desc}${ace ? `（今なら青${ace.number}番）` : ''}</small>`;
    b.onclick = () => chooseTactics(s.id);
    $('skills').appendChild(b);
  }
  setButtons([['やめる', renderStopMain]]);
}

function chooseTactics(skillId: string) {
  const cur: Tactics = { ...game!.teams[OWN].tactics };
  const draw = () => {
    $('stopRight').innerHTML = '<div class="hint">方針を変える（変えなければそのまま）</div>' + tacticsHtml(cur);
    bindTactics($('stopRight'), (k, v) => {
      (cur as unknown as Record<string, string>)[k] = v;
      draw();
    });
  };
  draw();
  setButtons([
    ['決定', () => {
      game!.timeout(skillId, toTactics(cur));
      updateHud();
      renderStopMain();
    }],
    ['やめる', renderStopMain],
  ]);
}

/** 選手交代：下がる選手 → 入る選手（できない組み合わせは出さない） */
function chooseOut() {
  const g = game!;
  const outs = [...new Set(g.validSubs().map(s => s.outId))];
  const team = g.teams[OWN];
  $('stopRight').innerHTML = '<div class="hint">下がる選手を選ぶ</div><div class="picklist" id="outs"></div>';
  for (const id of outs) {
    const sl = team.rotation.find(s => s.player.id === id)!;
    const b = document.createElement('button');
    b.className = 'pick';
    b.textContent = `${sl.player.number} ${ROLE_NAME[sl.role]}`;
    b.onclick = () => chooseIn(id);
    $('outs').appendChild(b);
  }
  setButtons([['やめる', renderStopMain]]);
}

function chooseIn(outId: string) {
  const g = game!;
  const ins = g.validSubs().filter(s => s.outId === outId).map(s => s.inId);
  const pinch = new Set(g.validPinch().filter(s => s.outId === outId).map(s => s.inId));
  $('stopRight').innerHTML = `<div class="hint">入る選手を選ぶ</div><div class="picklist" id="ins"></div>
    ${pinch.size ? '<div class="hint">サーブの間だけ（ピンチサーバー）：サイドアウトしたら自動で戻る。交代は2回分</div><div class="picklist" id="pins"></div>' : ''}`;
  for (const id of ins) {
    const p = g.bench[OWN].find(x => x.id === id)!;
    const b = document.createElement('button');
    b.className = 'pick';
    b.textContent = `${p.number} ${ROLE_NAME[bestRole(p)]}`;
    b.onclick = () => { g.substitute(outId, id); renderStopMain(); };
    $('ins').appendChild(b);
    if (pinch.has(id)) {
      const pb2 = document.createElement('button');
      pb2.className = 'pick';
      pb2.textContent = `${p.number}（サーブの間だけ）`;
      pb2.onclick = () => { g.pinchServe(outId, id); renderStopMain(); };
      $('pins').appendChild(pb2);
    }
  }
  setButtons([['戻る', chooseOut], ['やめる', renderStopMain]]);
}

// ---------------- 再生 ----------------

function layout() {
  r3.resize(window.innerWidth, window.innerHeight);
}

let last = performance.now();
function tick(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  r3.setSwapped(viewSwapped);
  if (pb && game) {
    if (playing && !stopped) t += dt * SPEEDS[speedIdx] * PLAYBACK_RATE;
    const fr = pb.frame(Math.min(t, pb.duration));
    if (fr.point && !counted) {
      counted = true;
      shownScore = { ...game.score };
      showMessage(pointMessage(pb.rec));
      updateHud();
    }
    r3.draw(fr);
    if (!stopped && t > pb.duration + 0.8) {
      if (stopAfter) {
        const s = stopAfter;
        stopAfter = null;
        viewSwapped = match.swapped; // 最終セットの8点のコートチェンジは、ここで見せる
        openStop(s);
      } else advance();
    }
  } else if (!stopped && game) {
    advance();
  }
  requestAnimationFrame(tick);
}

$('btnPlay').onclick = () => {
  playing = !playing;
  $('btnPlay').textContent = playing ? '❚❚' : '▶';
};
$('btnSpeed').onclick = () => {
  speedIdx = (speedIdx + 1) % SPEEDS.length;
  $('btnSpeed').textContent = `${SPEEDS[speedIdx]}倍`;
};
function toggleMode() {
  mode = mode === 'full' ? 'result' : 'full';
  updateHud();
}
$('btnMode').onclick = toggleMode;
$('btnGender').onclick = () => {
  gender = gender === 'male' ? 'female' : 'male';
  $('btnGender').textContent = gender === 'male' ? '男子' : '女子';
  closePanel();
  newMatch();
};
$('btnGender').textContent = gender === 'male' ? '男子' : '女子';
window.addEventListener('resize', layout);

layout();
if (embed) {
  // 試合の形・男女の切り替えと、試作用の監督特能はなし（育成の設定のまま）
  managerSkills = [];
  $('btnGender').style.display = 'none';
  window.addEventListener('message', ev => {
    if (ev.source !== window.parent || ev.data?.type !== 'matchSetup') return;
    embedOptions = ev.data.options as MatchOptions;
    // 監督特能は育成で持っているもの
    managerSkills = embedOptions.managerSkills ?? [];
    gender = embedOptions.gender;
    bestOf = embedOptions.bestOf;
    newMatch();
  });
  window.parent.postMessage({ type: 'matchReady' }, '*');
} else newMatch();
requestAnimationFrame(tick);
