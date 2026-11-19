// 試合の描画の試作ページ。試合計算で1ラリーずつ記録を作り、3Dで再生する。

import { simulateRally } from '../sim/rally';
import { makeTeam, rotate } from '../sim/sample';
import type { Gender, TeamId, TeamState } from '../sim/types';
import { PLAYBACK_RATE } from './common';
import { Playback, pointText } from './playback';
import { Render3D } from './render3d';

const SPEEDS = [1, 2, 4];
const TEAM_NAME: Record<TeamId, string> = { A: '赤', B: '青' };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const r3 = new Render3D($('view').querySelector('canvas')!, 'male');

const params = new URLSearchParams(location.search);
let gender: Gender = params.get('gender') === 'female' ? 'female' : 'male';
let seed = Number(params.get('seed') || 1);
let speedIdx = 0;
let playing = true;
let teams: Record<TeamId, TeamState>;
let serving: TeamId = 'A';
let score: Record<TeamId, number> = { A: 0, B: 0 };
let pb: Playback;
let t = 0;
let counted = false;

function resetMatch() {
  teams = { A: makeTeam(1, 'A', gender, 55), B: makeTeam(2, 'B', gender, 55) };
  serving = 'A';
  score = { A: 0, B: 0 };
  r3.setGender(gender);
  newRally();
}

function newRally() {
  const rec = simulateRally({ gender, teams, serving, seed });
  pb = new Playback(rec);
  r3.reset();
  t = 0;
  counted = false;
  $('msg').classList.remove('show');
  $('info').textContent = '';
  updateScore();
}

/** ラリーが終わった時：得点を足し、サイドアウトならローテーションを回す */
function finishRally() {
  const w = pb.rec.winner;
  score[w]++;
  if (w !== serving) {
    teams[w] = rotate(teams[w]);
    serving = w;
  }
  seed++;
}

function updateScore() {
  $('sa').textContent = String(score.A + (counted && pb.rec.winner === 'A' ? 1 : 0));
  $('sb').textContent = String(score.B + (counted && pb.rec.winner === 'B' ? 1 : 0));
}

function layout() {
  r3.resize(window.innerWidth, window.innerHeight);
}

let last = performance.now();
function tick(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  // 「1倍」は現実の速さ×PLAYBACK_RATE（少しゆっくり）。2倍・4倍もこれが基準
  if (playing) t += dt * SPEEDS[speedIdx] * PLAYBACK_RATE;
  const fr = pb.frame(Math.min(t, pb.duration));
  if (fr.point && !counted) {
    counted = true;
    $('msg').textContent = pointText(pb.rec, x => TEAM_NAME[x]);
    $('msg').classList.add('show');
    updateScore();
  }
  if (fr.lastAttack?.info?.hitHeight) {
    const i = fr.lastAttack.info;
    const parts = [`打点 ${Math.round(i.hitHeight!)}cm`];
    if (i.blockReach) parts.push(`ブロック ${Math.round(i.blockReach)}cm（${i.blockers?.length}枚）`);
    else parts.push('ブロックなし');
    if (i.overBlock) parts.push('ブロックの上から');
    if (i.direct) parts.push('ダイレクト');
    $('info').textContent = parts.join(' / ');
  }
  r3.draw(fr);
  if (t > pb.duration + 0.8) {
    finishRally();
    newRally();
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
$('btnNext').onclick = () => {
  finishRally();
  newRally();
};
$('btnGender').onclick = () => {
  gender = gender === 'male' ? 'female' : 'male';
  $('btnGender').textContent = gender === 'male' ? '男子' : '女子';
  resetMatch();
};
$('btnGender').textContent = gender === 'male' ? '男子' : '女子';
window.addEventListener('resize', layout);

resetMatch();
layout();
requestAnimationFrame(tick);

// 確認用：?t=秒 で、その時刻で止めた絵にする（スクリーンショット用）
if (params.get('t')) {
  t = Number(params.get('t'));
  playing = false;
  $('btnPlay').textContent = '▶';
}
