// 育成の確認用：1年分を自動で回して、能力の伸びを見る。
// 進め方：選手の体力の平均が下がったら休む。それ以外は手札の1枚目を使う。分かれ道は上の道。
//   npx tsx scripts/grow-year.ts [種の数]

import { Season, finishStep, useQuickBouts } from '../src/grow/season';
import { EQUIPMENT } from '../src/grow/practice';
import { MONEY } from '../src/grow/constants';
import { makeBench, makeTeam } from '../src/sim/sample';
import type { Player, Role, Squad, TrainKey } from '../src/sim/types';

// 他校同士の試合は強さの差の確率で決める（速く回すため。自チームの試合は試合の計算）
useQuickBouts();
const SEEDS = Number(process.argv[2] || 20);
const KEYS: TrainKey[] = ['jump', 'power', 'speed', 'technique', 'block', 'stamina'];
const NAME: Record<TrainKey, string> = { jump: '跳躍', power: 'パワー', speed: 'スピード', technique: 'テクニック', block: 'ブロック', stamina: 'スタミナ' };
/** 指示ありの時、ポジションごとに伸ばす能力 */
const FOCUS: Record<Role, TrainKey> = { S: 'technique', OH: 'power', MB: 'block', OP: 'jump', L: 'speed' };

function squad(seed: number): Squad {
  const t = makeTeam(seed, 'A', 'male', 45);
  return { players: [...t.rotation.map(s => s.player), t.libero!, ...makeBench(seed, 'A', 'male', 45)], captainId: null };
}

interface Result { gain: Record<TrainKey, number[]>; focusGain: number[]; otherGain: number[]; total: number[]; rests: number; gym: number; money: number; cond: number[] }

function run(focus: boolean, buy: boolean): Result {
  const r: Result = { gain: Object.fromEntries(KEYS.map(k => [k, []])) as unknown as Record<TrainKey, number[]>, focusGain: [], otherGain: [], total: [], rests: 0, gym: 0, money: 0, cond: [0, 0, 0, 0, 0] };
  for (let seed = 1; seed <= SEEDS; seed++) {
    const sq = squad(seed);
    if (focus) for (const p of sq.players) p.practice.focus = FOCUS[p.practice.position];
    const before = new Map(sq.players.map(p => [p.id, { ...p }] as [string, Player]));
    const s = new Season({ seed, squad: sq });
    // 機材を買う：下位機材から、お金があるだけ（買い方は仮の作戦）
    if (buy) {
      for (const eq of [...EQUIPMENT].sort((a, b) => (a.equipment === 'basic' ? 0 : 1) - (b.equipment === 'basic' ? 0 : 1))) {
        if (s.money >= MONEY.price[eq.equipment as 'basic' | 'advanced']) s.buy(eq.id);
      }
    }
    let guard = 0;
    while (!s.over && guard++ < 1000) {
      const avg = sq.players.reduce((a, p) => a + p.energy, 0) / sq.players.length;
      finishStep(s, avg < 45 ? (r.rests++, s.rest()) : s.useCard(s.firstUsable()));
      while (s.pending) s.choose(0);
      if (s.skillOffer) s.answerSkill(null);
      while (s.pendingMatch) { s.playMatch(); while (s.pending) s.choose(0); if (s.skillOffer) s.answerSkill(null); }
      if (s.matchChoices) s.chooseMatch(0);
        if (s.matchInvite) s.answerInvite(true);
      for (const p of sq.players) r.cond[p.condition + 2]++;
    }
    for (const p of sq.players) {
      const b = before.get(p.id)!;
      r.total.push(KEYS.reduce((a, k) => a + p[k] - b[k], 0));
      for (const k of KEYS) {
        const g = p[k] - b[k];
        r.gain[k].push(g);
        if (focus) (k === FOCUS[p.practice.position] ? r.focusGain : r.otherGain).push(g);
      }
    }
    r.gym += s.gym;
    r.money += s.money;
  }
  r.gym /= SEEDS;
  r.money /= SEEDS;
  return r;
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
for (const [label, focus, buy] of [['おまかせ・機材なし', false, false], ['指示あり・機材なし', true, false], ['指示あり・機材を買う', true, true]] as [string, boolean, boolean][]) {
  const r = run(focus, buy);
  console.log(`\n== ${label}（${SEEDS}チーム×11人、1年間。最初の能力は平均45）`);
  console.log(`1人の合計の伸び（平均）：+${mean(r.total).toFixed(1)}`);
  console.log(`能力ごとの伸び（平均）：${KEYS.map(k => `${NAME[k]} +${mean(r.gain[k]).toFixed(1)}`).join('、')}`);
  if (focus) console.log(`指示した能力 +${mean(r.focusGain).toFixed(1)}（最大 +${Math.max(...r.focusGain)}）、ほかの能力 +${mean(r.otherGain).toFixed(1)}`);
  const total = r.cond.reduce((a, b) => a + b, 0);
  console.log(`休んだ日 ${(r.rests / SEEDS).toFixed(0)}日/年、体育館レベル ${r.gym.toFixed(1)}、残ったお金 ${Math.round(r.money)}円`);
  console.log(`調子の割合：絶不調 ${(100 * r.cond[0] / total).toFixed(0)}%・不調 ${(100 * r.cond[1] / total).toFixed(0)}%・普通 ${(100 * r.cond[2] / total).toFixed(0)}%・好調 ${(100 * r.cond[3] / total).toFixed(0)}%・絶好調 ${(100 * r.cond[4] / total).toFixed(0)}%`);
}
