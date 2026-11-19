// 動きの確認用の画面（ゲームの機能ではない）。
// 選手を1人選ぶとカメラがその選手を追いかけ、ほかの選手を薄く（または消して）表示する。
// ゆっくり再生・一時停止・コマ送り・コマ戻し、見たい動作のある場面から再生ができる。

import { simulateRally } from '../sim/rally';
import { makeTeam, rotate } from '../sim/sample';
import type { ActionType, Gender, RallyEvent, RallyRecord, TeamId, TeamState } from '../sim/types';
import { Playback } from './playback';
import { Render3D, type FollowView } from './render3d';

type ActionEv = Extract<RallyEvent, { type: 'action' }>;

/** 見たい動作：記録の動作の種類と、見始める時刻（動作の何秒前から） */
const WANTED: { key: string; label: string; match: (e: ActionEv) => boolean; lead: number }[] = [
  { key: 'spike', label: 'スパイク', match: e => e.action === 'spike' && !e.info?.direct, lead: 2.0 },
  { key: 'jserve', label: 'ジャンプサーブ', match: e => e.action === 'serve' && e.info?.serveType !== 'float', lead: 1.5 },
  { key: 'block', label: 'ブロック', match: e => e.action === 'block', lead: 1.6 },
  { key: 'receive', label: 'レシーブ', match: e => (e.action === 'receive' || e.action === 'dig') && e.pos.z > 0.3, lead: 1.8 },
  { key: 'dive', label: '飛びつき', match: e => (e.action === 'receive' || e.action === 'dig' || e.action === 'cover') && e.pos.z <= 0.3, lead: 1.6 },
  { key: 'set', label: 'トス', match: e => e.action === 'set', lead: 1.6 },
];
/** 再生の速さ（現実の速さの何倍か） */
const SPEEDS = [0.1, 0.25, 0.5, 1];
const VIEWS: { v: FollowView; label: string }[] = [
  { v: 'side', label: '横から' }, { v: 'back', label: '後ろから' }, { v: 'front', label: '前から' },
];
const DIMS = [
  { dim: true, label: '他を薄く' }, { dim: false, label: '全員表示' },
];
const FRAME = 1 / 30;
const ACTION_NAME: Partial<Record<ActionType, string>> = {
  serve: 'サーブ', receive: 'レシーブ', dig: 'ディグ', set: 'トス', spike: 'スパイク', tip: 'フェイント',
  block: 'ブロック', freeball: 'つなぎ', cover: 'フォロー', fakeJump: '時間差のフェイク',
};
const SET_NAME: Record<string, string> = { quick: '速攻', timeDiff: '時間差', fast: '平行', high: 'オープン' };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const r3 = new Render3D($('view').querySelector('canvas')!, 'male');

let gender: Gender = params.get('gender') === 'female' ? 'female' : 'male';
let seed = Number(params.get('seed') || 1);
let rec!: RallyRecord;
let pb!: Playback;
let t = 0;
let playing = false;
let speedIdx = 1;
let viewIdx = 0;
let dimIdx = 0;
let focus: string | null = null;

function teams(s: number): Record<TeamId, TeamState> {
  let A = makeTeam(1, 'A', gender, 55), B = makeTeam(2, 'B', gender, 55);
  for (let i = 0; i < s % 6; i++) A = rotate(A);
  for (let i = 0; i < (s >> 3) % 6; i++) B = rotate(B);
  return { A, B };
}

function rally(s: number): RallyRecord {
  return simulateRally({ gender, teams: teams(s), serving: s % 2 ? 'A' : 'B', seed: s });
}

function load(s: number, keepFocus = false) {
  seed = s;
  rec = rally(s);
  pb = new Playback(rec);
  r3.setGender(gender);
  r3.reset();
  t = 0;
  if (!keepFocus || !rec.placements.some(p => p.playerId === focus)) focus = null;
  $('seedLabel').textContent = `種${seed}`;
  ($('seek') as HTMLInputElement).max = String(rec.duration);
  buildPlayers();
  applyFollow();
}

function buildPlayers() {
  const box = $('players');
  box.innerHTML = '';
  for (const pl of [...rec.placements].sort((a, b) => (a.team + a.number).localeCompare(b.team + b.number))) {
    const b = document.createElement('button');
    b.className = pl.team + (pl.playerId === focus ? ' on' : '');
    b.textContent = `${pl.team === 'A' ? '赤' : '青'}${pl.number} ${roleName(pl.role)}`;
    b.onclick = () => {
      focus = focus === pl.playerId ? null : pl.playerId;
      buildPlayers();
      applyFollow();
    };
    box.appendChild(b);
  }
}

function roleName(r: string) {
  return r === 'S' ? 'セッター' : r === 'OH' ? 'アウトサイド' : r === 'MB' ? 'ミドル' : r === 'OP' ? 'オポジット' : 'リベロ';
}

function applyFollow() {
  r3.setFollow(focus, VIEWS[viewIdx].v, DIMS[dimIdx].dim);
}

/** 見たい動作のある場面を、今の場面の後ろから探す */
function findNext(key: string) {
  const w = WANTED.find(x => x.key === key)!;
  const after = (s: number) => (s === seed ? t + 0.05 : -1);
  for (let s = seed; s < seed + 400; s++) {
    const r = s === seed ? rec : rally(s);
    const e = r.events.find((x): x is ActionEv => x.type === 'action' && x.t > after(s) && w.match(x));
    if (!e) continue;
    if (s !== seed) load(s);
    focus = e.playerId;
    buildPlayers();
    applyFollow();
    // スパイクは助走を始める前から見る
    let start = e.t - w.lead;
    if (key === 'spike') {
      const jump = rec.events.filter(x => x.type === 'jump' && x.playerId === e.playerId && x.t < e.t).pop();
      const move = jump && rec.events.filter(x => x.type === 'move' && x.playerId === e.playerId && x.t <= jump.t).pop();
      if (move) start = Math.min(start, move.t - 0.6);
    }
    t = Math.max(0, start);
    playing = true;
    $('play').textContent = '❚❚';
    return;
  }
  $('info').textContent = '見つかりませんでした';
}

function buildActions() {
  const box = $('actions');
  for (const w of WANTED) {
    const b = document.createElement('button');
    b.textContent = w.label;
    b.onclick = () => {
      for (const c of Array.from(box.children)) c.classList.toggle('on', c === b);
      findNext(w.key);
    };
    box.appendChild(b);
  }
}

function infoText(): string {
  const fr = pb.frame(t);
  const lines = [`種${seed}  ${t.toFixed(2)}秒 / ${rec.duration.toFixed(2)}秒  ×${SPEEDS[speedIdx]}`];
  if (focus) {
    const pl = fr.players.find(p => p.id === focus)!;
    const name = `${pl.team === 'A' ? '赤' : '青'}${pl.number}（${roleName(pl.role)}・${Math.round(pl.height * 100)}cm）`;
    const move = pl.moveKind === 'approach' ? `助走 ${Math.round(pl.moveT * 100)}%` : pl.moveKind === 'dive' ? '飛びつきの走り込み' : pl.speed > 0.5 ? '移動' : '止まっている';
    const jump = pl.jumpPhase === 'prep' ? '踏み込み' : pl.jumpPhase === 'air' ? `空中 ${Math.round(pl.jumpT * 100)}%` : pl.jumpPhase === 'land' ? '着地' : '';
    lines.push(`${name}  ${move}${jump ? '・' + jump : ''}  速さ ${pl.speed.toFixed(1)}m/s`);
    // 近くの動作（前後1.5秒）
    const near = rec.events.filter((e): e is ActionEv => e.type === 'action' && e.playerId === focus && Math.abs(e.t - t) < 1.5);
    for (const e of near) {
      let s = `${e.t.toFixed(2)}秒 ${ACTION_NAME[e.action] ?? e.action}`;
      if (e.info?.setType) s += `（${SET_NAME[e.info.setType]}）`;
      if (e.info?.hitHeight) s += ` 最高の打点 ${Math.round(e.info.hitHeight)}cm・触った高さ ${Math.round(e.info.contactHeight ?? e.info.hitHeight)}cm`;
      if (e.info?.serveType) s += `（${e.info.serveType === 'float' ? 'フローター' : e.info.serveType === 'jumpFloat' ? 'ジャンフロ' : 'スパイクサーブ'}）`;
      lines.push(s);
    }
  } else lines.push('選手を選ぶと、その選手をカメラで追いかけます');
  return lines.join('\n');
}

let last = performance.now();
function tick(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (playing) {
    t += dt * SPEEDS[speedIdx];
    if (t >= rec.duration) { t = rec.duration; playing = false; $('play').textContent = '▶'; }
  }
  r3.draw(pb.frame(t));
  ($('seek') as HTMLInputElement).value = String(t);
  $('info').textContent = infoText();
  requestAnimationFrame(tick);
}

function step(d: number) {
  playing = false;
  $('play').textContent = '▶';
  t = Math.min(rec.duration, Math.max(0, t + d));
}

$('play').onclick = () => {
  if (!playing && t >= rec.duration) t = 0;
  playing = !playing;
  $('play').textContent = playing ? '❚❚' : '▶';
};
$('back1').onclick = () => step(-FRAME);
$('fwd1').onclick = () => step(FRAME);
$('back10').onclick = () => step(-0.1);
$('fwd10').onclick = () => step(0.1);
$('speed').onclick = () => {
  speedIdx = (speedIdx + 1) % SPEEDS.length;
  $('speed').textContent = `×${SPEEDS[speedIdx]}`;
};
$('angle').onclick = () => {
  viewIdx = (viewIdx + 1) % VIEWS.length;
  $('angle').textContent = VIEWS[viewIdx].label;
  applyFollow();
};
$('dim').onclick = () => {
  dimIdx = (dimIdx + 1) % DIMS.length;
  $('dim').textContent = DIMS[dimIdx].label;
  applyFollow();
};
$('seedPrev').onclick = () => load(Math.max(1, seed - 1), true);
$('seedNext').onclick = () => load(seed + 1, true);
$('gender').onclick = () => {
  gender = gender === 'male' ? 'female' : 'male';
  $('gender').textContent = gender === 'male' ? '男子' : '女子';
  load(seed);
};
($('seek') as HTMLInputElement).oninput = e => {
  playing = false;
  $('play').textContent = '▶';
  t = Number((e.target as HTMLInputElement).value);
};
window.addEventListener('resize', () => r3.resize(window.innerWidth, window.innerHeight));

$('gender').textContent = gender === 'male' ? '男子' : '女子';
$('speed').textContent = `×${SPEEDS[speedIdx]}`;
buildActions();
r3.resize(window.innerWidth, window.innerHeight);
load(seed);
const want = params.get('action');
if (want) findNext(want);
if (params.get('player')) { focus = params.get('player'); buildPlayers(); applyFollow(); }
if (params.get('t')) t = Number(params.get('t'));
if (params.get('view')) { viewIdx = Math.max(0, VIEWS.findIndex(v => v.v === params.get('view'))); $('angle').textContent = VIEWS[viewIdx].label; applyFollow(); }
if (params.get('play') === '0') { playing = false; $('play').textContent = '▶'; }
requestAnimationFrame(tick);
