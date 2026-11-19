// 1セットの試合（試作）。試合の計算（SetGame）で1ラリーずつ進め、記録を3Dで再生する。
// 止まる場面では試合を止めて、仮の停止画面（タイムアウト・選手交代・試合に戻る）を出す。
// 停止画面の見た目は「試合前画面・停止画面」の段階で作り込む。

import { FATIGUE } from '../sim/constants';
import { OWN, SetGame, type StopInfo } from '../sim/match';
import { makeBench, makeTeam } from '../sim/sample';
import { TRAITS } from '../sim/traits';
import type { AttackTactic, BlockTactic, Gender, Player, RallyRecord, ReceiveTactic, Role, Tactics, TeamId } from '../sim/types';
import { PLAYBACK_RATE } from './common';
import { Playback, pointText } from './playback';
import { Render3D } from './render3d';

const SPEEDS = [1, 2, 4];
const TEAM_NAME: Record<TeamId, string> = { A: '赤', B: '青' };
/** 見せ方の段階：フル（全ラリーを再生）／結果のみ（止まる場面まで一気に進む）。ハイライトは次の段階で */
type ShowMode = 'full' | 'result';
/** 試作用：自チームの監督が持っている監督特能（仮） */
const DEMO_MANAGER_SKILLS = ['geki', 'tatenaoshi', 'serveKuzushi'];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const r3 = new Render3D($('view').querySelector('canvas')!, 'male');
const params = new URLSearchParams(location.search);

let gender: Gender = params.get('gender') === 'female' ? 'female' : 'male';
let mode: ShowMode = params.get('mode') === 'result' ? 'result' : 'full';
let speedIdx = 0;
let playing = true;
let setSeed = Number(params.get('seed') || 1);
let game!: SetGame;
let pb: Playback | null = null;
let t = 0;
let shownScore: Record<TeamId, number> = { A: 0, B: 0 };
let stopAfter: StopInfo | null = null;
let stopped = false;
let counted = false;

function newSet() {
  game = new SetGame({
    gender, seed: setSeed++, serving: 'A', managerSkills: DEMO_MANAGER_SKILLS,
    teams: { A: makeTeam(1, 'A', gender, 55), B: makeTeam(2, 'B', gender, 55) },
    bench: { A: makeBench(1, 'A', gender, 55), B: makeBench(2, 'B', gender, 55) },
  });
  r3.setGender(gender);
  shownScore = { A: 0, B: 0 };
  pb = null;
  $('msg').classList.remove('show');
  updateHud();
  const first = game.takePendingStop();
  if (first) openStop(first);
}

/** 次のラリーへ。結果のみの時は、止まる場面かセットの終わりまで一気に進める */
function advance() {
  if (game.over) { openSetEnd(); return; }
  if (mode === 'result') {
    let last: RallyRecord | null = null;
    let stop: StopInfo | null = null;
    while (!game.over && !stop) ({ rec: last, stop } = game.next());
    shownScore = { ...game.score };
    pb = null;
    if (last) showMessage(pointText(last, x => TEAM_NAME[x]));
    updateHud();
    if (stop) openStop(stop);
    else openSetEnd();
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
  $('msg').classList.remove('show');
  updateHud();
}

function showMessage(text: string) {
  $('msg').textContent = text;
  $('msg').classList.add('show');
}

function updateHud() {
  $('sa').textContent = String(shownScore.A);
  $('sb').textContent = String(shownScore.B);
  $('setInfo').textContent = `第${game.setNumber}セット（${game.target}点）`;
  const dots = (n: number) => '●'.repeat(n) + '○'.repeat(Math.max(0, 2 - n));
  $('toA').textContent = `赤 TO ${dots(game.timeoutsLeft.A)}`;
  $('toB').textContent = `青 TO ${dots(game.timeoutsLeft.B)}`;
  $('btnMode').textContent = mode === 'full' ? 'フル' : '結果のみ';
}

// ---------------- 停止画面（仮） ----------------

const ROLE_NAME: Record<Role, string> = { S: 'セッター', OH: 'アウトサイド', MB: 'ミドル', OP: 'オポジット', L: 'リベロ' };
const COND = ['絶不調', '不調', '普通', '好調', '絶好調'];
let currentStop: StopInfo | null = null;

function openStop(stop: StopInfo) {
  stopped = true;
  currentStop = stop;
  $('stop').classList.remove('hidden');
  renderStopMain();
}

function closeStop() {
  stopped = false;
  currentStop = null;
  $('stop').classList.add('hidden');
  advance();
}

function playerLine(p: Player, role: Role, bench = false): string {
  const traits = p.traits.map(id => TRAITS[id]?.name).filter(Boolean).join('・') || '－';
  const f = game.fatigue[p.id] ?? 0;
  const tired = f >= FATIGUE.tiredNote ? '<span class="tired">足が止まってきた</span>' : '';
  return `<tr class="${bench ? 'bench' : ''}"><td>${p.number}</td><td>${ROLE_NAME[role]}</td><td>${COND[p.condition + 2]}</td><td>${traits}</td><td>${tired}</td></tr>`;
}

function rotationHtml(): string {
  const r = game.teams[OWN].rotation;
  const z = (i: number) => `<div>${r[i].player.number}<br><small>${ROLE_NAME[r[i].role].slice(0, 3)}</small></div>`;
  // 前衛：ゾーン4・3・2、後衛：ゾーン5・6・1
  return `<div class="rot"><div class="net">ネット</div>${z(3)}${z(2)}${z(1)}${z(4)}${z(5)}${z(0)}</div>`;
}

function renderStopMain() {
  const s = currentStop!;
  $('stopLeft').innerHTML = `
    <div class="card"><div class="big">赤 ${game.score.A} - ${game.score.B} 青</div><div class="reason">${s.label}</div></div>
    <div class="card">タイムアウト 残り：赤 ${game.timeoutsLeft.A}回・青 ${game.timeoutsLeft.B}回<br>選手交代：${game.subsUsed.A} / 6回</div>
    <div class="card">${rotationHtml()}</div>`;
  const team = game.teams[OWN];
  const rows = team.rotation.map(sl => playerLine(sl.player, sl.role)).join('')
    + (team.libero ? playerLine(team.libero, 'L') : '')
    + game.bench[OWN].map(p => playerLine(p, p.aptitude ? bestRole(p) : 'OH', true)).join('');
  $('stopRight').innerHTML = `<table class="roster"><tr><th>背番号</th><th>ポジション</th><th>調子</th><th>主な特能</th><th></th></tr>${rows}</table>
    <div class="hint">薄い行は控え</div>`;
  const btn = (label: string, on: () => void, disabled = false, cls = '') => {
    const b = document.createElement('button');
    b.textContent = label;
    b.disabled = disabled;
    if (cls) b.className = cls;
    b.onclick = on;
    return b;
  };
  const box = $('stopButtons');
  box.innerHTML = '';
  box.append(
    btn(`タイムアウト（残り${game.timeoutsLeft[OWN]}）`, chooseSkill, !game.canTimeout()),
    btn('選手交代', chooseOut, game.validSubs().length === 0),
    btn('試合に戻る', closeStop, false, 'sub'),
    btn(`見せ方：${mode === 'full' ? 'フル' : '結果のみ'}`, () => { toggleMode(); renderStopMain(); }, false, 'sub'),
  );
}

function bestRole(p: Player): Role {
  return (Object.entries(p.aptitude) as [Role, number][]).sort((a, b) => b[1] - a[1])[0][0];
}

/** タイムアウト：監督特能を1つ選ぶ → 方針を変える */
function chooseSkill() {
  $('stopRight').innerHTML = `<div class="hint">監督特能を1つ選ぶ（効果は次の5ラリー）</div><div class="picklist" id="skills"></div>`;
  for (const s of game.timeoutChoices()) {
    const b = document.createElement('button');
    b.className = 'pick';
    b.innerHTML = `${s.name}<br><small>${s.desc}</small>`;
    b.onclick = () => chooseTactics(s.id);
    $('skills').appendChild(b);
  }
  setButtons([['やめる', renderStopMain]]);
}

function chooseTactics(skillId: string) {
  const cur: Tactics = { ...game.teams[OWN].tactics };
  const opts: { key: keyof Tactics; label: string; items: [string, string][] }[] = [
    { key: 'attack', label: '攻撃', items: [['ace', 'エース中心'], ['balance', 'バランス'], ['quick', '速攻中心']] },
    { key: 'block', label: 'ブロック', items: [['bunch', 'バンチ'], ['spread', 'スプレッド'], ['dedicate', 'デディケート']] },
    { key: 'receive', label: 'レシーブ', items: [['front', '前寄り'], ['back', '後ろ寄り']] },
  ];
  const draw = () => {
    $('stopRight').innerHTML = '<div class="hint">方針を変える（変えなければそのまま）</div>' + opts.map(o =>
      `<div>${o.label}：<span class="picklist">${o.items.map(([v, n]) =>
        `<button class="pick ${cur[o.key] === v ? 'on' : ''}" data-k="${o.key}" data-v="${v}">${n}</button>`).join('')}</span></div>`).join('');
    for (const b of Array.from($('stopRight').querySelectorAll('button'))) {
      (b as HTMLButtonElement).onclick = () => {
        const k = b.getAttribute('data-k') as keyof Tactics;
        (cur as unknown as Record<string, string>)[k] = b.getAttribute('data-v')!;
        draw();
      };
    }
  };
  draw();
  setButtons([
    ['決定', () => {
      game.timeout(skillId, {
        attack: cur.attack as AttackTactic, block: cur.block as BlockTactic, receive: cur.receive as ReceiveTactic,
      });
      updateHud();
      renderStopMain();
    }],
    ['やめる', renderStopMain],
  ]);
}

/** 選手交代：下がる選手 → 入る選手（できない組み合わせは出さない） */
function chooseOut() {
  const subs = game.validSubs();
  const outs = [...new Set(subs.map(s => s.outId))];
  const team = game.teams[OWN];
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
  const ins = game.validSubs().filter(s => s.outId === outId).map(s => s.inId);
  $('stopRight').innerHTML = '<div class="hint">入る選手を選ぶ</div><div class="picklist" id="ins"></div>';
  for (const id of ins) {
    const p = game.bench[OWN].find(x => x.id === id)!;
    const b = document.createElement('button');
    b.className = 'pick';
    b.textContent = `${p.number} ${ROLE_NAME[bestRole(p)]}`;
    b.onclick = () => { game.substitute(outId, id); renderStopMain(); };
    $('ins').appendChild(b);
  }
  setButtons([['戻る', chooseOut], ['やめる', renderStopMain]]);
}

function setButtons(list: [string, () => void][]) {
  const box = $('stopButtons');
  box.innerHTML = '';
  for (const [label, on] of list) {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = on;
    box.appendChild(b);
  }
}

function openSetEnd() {
  stopped = true;
  $('stop').classList.remove('hidden');
  const w = game.winner!;
  $('stopLeft').innerHTML = `<div class="card"><div class="big">赤 ${game.score.A} - ${game.score.B} 青</div>
    <div class="reason">セット終了：${TEAM_NAME[w]}の勝ち</div></div>`;
  $('stopRight').innerHTML = `<div class="card">ラリー ${game.rallies}本・タイムアウト 赤${2 - game.timeoutsLeft.A}回・交代 赤${game.subsUsed.A}回</div>`;
  setButtons([
    ['新しいセット', () => { $('stop').classList.add('hidden'); stopped = false; newSet(); }],
    [`見せ方：${mode === 'full' ? 'フル' : '結果のみ'}`, () => { toggleMode(); openSetEnd(); }],
  ]);
}

// ---------------- 再生 ----------------

function layout() {
  r3.resize(window.innerWidth, window.innerHeight);
}

let last = performance.now();
function tick(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (pb) {
    if (playing && !stopped) t += dt * SPEEDS[speedIdx] * PLAYBACK_RATE;
    const fr = pb.frame(Math.min(t, pb.duration));
    if (fr.point && !counted) {
      counted = true;
      shownScore = { ...game.score };
      showMessage(pointText(pb.rec, x => TEAM_NAME[x]));
      updateHud();
    }
    r3.draw(fr);
    if (!stopped && t > pb.duration + 0.8) {
      if (stopAfter) { const s = stopAfter; stopAfter = null; openStop(s); }
      else advance();
    }
  } else if (!stopped && game && !game.over) {
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
  $('stop').classList.add('hidden');
  stopped = false;
  newSet();
};
$('btnGender').textContent = gender === 'male' ? '男子' : '女子';
window.addEventListener('resize', layout);

layout();
newSet();
requestAnimationFrame(tick);
