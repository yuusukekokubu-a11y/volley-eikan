// 共通部品の見本ページ（parts.html）。見本用のデータで、画面ごとの出し分けと色の案を並べる。ゲームからは開かない。

import { Rng } from '../../sim/rng';
import { makePlayer } from '../../sim/sample';
import { TRAITS } from '../../sim/traits';
import type { Player, Role } from '../../sim/types';
import { abilityHtml, bindRows, conditionHtml, playerRowHtml, rowHeadHtml, showPlayerDetail, traitChip, type RowContext, type RowMode } from './player';

const $ = (id: string) => document.getElementById(id)!;
const rng = new Rng(7);
const NAMES = ['佐藤', '高橋', '田中', '伊藤', '渡辺', '山本', '中村', '小林', '加藤', '吉田', '山田', '佐々木'];
const ROLES: Role[] = ['S', 'OH', 'MB', 'OP', 'OH', 'MB', 'L', 'OH', 'MB', 'S', 'OP', 'L'];
// 段階がいろいろ出るように、強さをばらけさせる
const AVG = [78, 72, 66, 60, 55, 50, 70, 45, 40, 35, 30, 62];
const TRAIT_SETS: string[][] = [
  ['tossMaster', 'combo', 'setEye'], ['spikeServe', 'straightHit', 'aceAura', 'aggressiveServe'], ['quickHit', 'timeDiff', 'shortServe'], ['secondHit'],
  ['receiveMaster', 'stable'], ['command', 'killBlock', 'moody'], ['defenseCore', 'pancake'], ['jumpFloat'], ['courseRead'], ['badPassSet'], [], ['digger', 'feint', 'tipPick', 'shakeOk'],
];

const players: Player[] = ROLES.map((role, i) => {
  const p = makePlayer(rng, `s${i}`, i + 1, role, 'male', AVG[i]);
  p.name = NAMES[i];
  p.enrollYear = 1 - (i % 3);
  p.traits = TRAIT_SETS[i].filter(id => TRAITS[id]);
  p.condition = [2, 1, 0, 0, -1, 0, 1, -2, 0, 0, 1, 0][i];
  p.energy = [90, 70, 45, 100, 20, 60, 80, 35, 100, 55, 15, 75][i];
  p.stats = { matches: 20 - i, sets: 50 - i * 3, kills: 80 - i * 6, blockPoints: 20 - i, aces: 10 - Math.min(9, i) };
  return p;
});
// 赤特能も見せる
players[4].traits.push(...['attackOut', 'serveMiss'].filter(id => TRAITS[id]));
players[9].traits.push(...Object.values(TRAITS).filter(t => t.kind === 'stat' && t.color === 'red').slice(0, 1).map(t => t.id));

// ---- 色の案 ----
$('legend').innerHTML = `
  <div class="legend"><b>能力の段階</b>${[95, 85, 75, 65, 55, 45, 30, 15].map(v => abilityHtml(v)).join('')}</div>
  <div class="legend" style="margin-top:6px"><b>調子</b>${[2, 1, 0, -1, -2].map(conditionHtml).join('')}</div>
  <div class="legend" style="margin-top:6px"><b>特能</b>${['aceAura', 'straightHit', 'spikeServe', 'aggressiveServe', 'moody'].filter(id => TRAITS[id]).map(id => traitChip(TRAITS[id]!)).join('')}
    <small>（金・青・解禁・緑・赤。主な特能は この順に2つまで、残りは「＋n」）</small></div>`;

// ---- 画面ごとの出し分け ----
const where = (i: number) => (i < 6 ? 'コート' : i === 6 ? 'リベロ' : '控え');
const TIRED = ['', '', '足が止まってきた', '', '', '足が止まってきた', '', '', '', '', '', ''];
const FOCUS = ['おまかせ', 'パワー', 'ブロック', '跳躍', 'おまかせ', 'ブロック', 'スピード', 'おまかせ', 'ブロック', 'テクニック', 'パワー', 'スピード'];
const sections: { mode: RowMode; title: string; note: string; ctx: (p: Player, i: number) => RowContext }[] = [
  { mode: 'pregame', title: '試合前（自チーム）', note: '区分・番・名前・ポジション・身長・調子・6能力・主な特能', ctx: (_, i) => ({ mode: 'pregame', where: where(i), selected: i === 2, dim: i > 6 }) },
  { mode: 'stop', title: '停止画面', note: '番・名前・ポジション・調子・主な特能・疲れの一言', ctx: (_, i) => ({ mode: 'stop', tired: TIRED[i], dim: i > 6 }) },
  { mode: 'opponent', title: '相手の一覧（試合前）', note: '番・名前・ポジション・身長・6能力・主な特能', ctx: () => ({ mode: 'opponent' }) },
  { mode: 'grow', title: '育成のステータス', note: '番・名前・学年・ポジション・身長・調子・6能力・体力・練習指示・主な特能', ctx: (_, i) => ({ mode: 'grow', year: 1, practice: `${FOCUS[i]}`, practiceButton: true, isNew: i === 9, }) },
];

$('sections').innerHTML = sections.map((s, i) => `<h2>${s.title}</h2><p class="note">${s.note}</p>
  <div class="phone" id="phone${i}"><div class="list" id="list${i}"></div></div>`).join('');
sections.forEach((s, i) => {
  const list = $(`list${i}`);
  const ps = s.mode === 'grow' ? players.map((p, k) => (k === 11 ? Object.assign(p, { retired: true }) : p)) : players;
  list.innerHTML = rowHeadHtml(s.mode) + ps.map((p, k) => playerRowHtml(p, s.ctx(p, k))).join('');
  bindRows(list, id => {
    const k = players.findIndex(p => p.id === id);
    showPlayerDetail($(`phone${i}`), players[k], s.ctx(players[k], k));
  });
});
// 最初に1つ、詳細を開いた状態を見せる
// （最初は閉じておく。行を押すと開く）
