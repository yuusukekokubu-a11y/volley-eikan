// 育成の確認用：何年分かを自動で回して、卒業時の能力の分布と体育館レベルの推移を見る。
// 最初の部員：2・3年生を新入生の仕組みで作る（能力は入学時のまま）。
// 進め方：体力の平均が45を切ったら休む。それ以外は手札の1枚目。分かれ道は上の道。
// 合宿は毎回開催する。練習指示は月初めに変える。
// 機材：毎年4月1日に、お金があるだけ下位機材から買う（買い方は仮の作戦）。
//   npx tsx scripts/grow-career.ts [種の数] [年数]

import { Career } from '../src/grow/career';
import { EQUIPMENT } from '../src/grow/practice';
import { MONEY } from '../src/grow/constants';
import { enroll, type Graduate } from '../src/grow/roster';
import { Rng } from '../src/sim/rng';
import type { Role, Squad, TrainKey } from '../src/sim/types';

const SEEDS = Number(process.argv[2] || 20);
const YEARS = Number(process.argv[3] || 6);
const KEYS: TrainKey[] = ['jump', 'power', 'speed', 'technique', 'block', 'stamina'];
/** 指示ありの時、ポジションごとに伸ばす能力 */
const FOCUS: Record<Role, TrainKey> = { S: 'technique', OH: 'power', MB: 'block', OP: 'jump', L: 'speed' };
const RANKS = [{ at: 90, r: 'S' }, { at: 80, r: 'A' }, { at: 70, r: 'B' }, { at: 60, r: 'C' }, { at: 50, r: 'D' }, { at: 40, r: 'E' }, { at: 20, r: 'F' }, { at: -1, r: 'G' }];
const rank = (v: number) => RANKS.find(x => v >= x.at)!.r;

function startSquad(seed: number): Squad {
  const sq: Squad = { players: [], captainId: null };
  const rng = new Rng(seed * 17 + 5);
  enroll(sq, -1, 'male', rng);
  enroll(sq, 0, 'male', rng);
  return sq;
}

function buyAll(c: Career) {
  const s = c.season;
  for (const eq of [...EQUIPMENT].sort((a, b) => (a.equipment === 'basic' ? 0 : 1) - (b.equipment === 'basic' ? 0 : 1))) {
    if (!s.equipment.includes(eq.id) && s.money >= MONEY.price[eq.equipment as 'basic' | 'advanced']) s.buy(eq.id);
  }
}

function run(focus: boolean, buy: boolean) {
  const gym: number[][] = Array.from({ length: YEARS }, () => []);
  const grads: Graduate[][] = Array.from({ length: YEARS }, () => []);
  const members: number[][] = Array.from({ length: YEARS }, () => []);
  for (let seed = 1; seed <= SEEDS; seed++) {
    const c = new Career({ seed, squad: startSquad(seed) });
    for (let y = 0; y < YEARS; y++) {
      if (y > 0) c.nextYear();
      const s = c.season;
      if (buy) buyAll(c);
      let guard = 0;
      while (!s.over && guard++ < 1000) {
        // 練習指示は、変えられる日（月初め）に変える
        if (s.practiceOpen) for (const p of s.squad.players) if (focus && !p.retired && p.practice.focus === 'auto') s.setPractice(p.id, { focus: FOCUS[p.practice.position] });
        const avg = s.squad.players.reduce((a, p) => a + p.energy, 0) / Math.max(1, s.squad.players.length);
        const r = avg < 45 ? s.rest() : s.useCard(0);
        if (r.needBranch) s.chooseBranch(0);
        while (s.pending) s.choose(0);
        if (s.campOffer) s.decideCamp(true);
        if (s.date.month === 3 && s.date.day === 31) break;
      }
      gym[y].push(s.gym);
      grads[y].push(...s.graduates);
      members[y].push(s.squad.players.length);
    }
  }
  return { gym, grads, members };
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
function dist(vals: number[]): string {
  const n = vals.length;
  return RANKS.map(x => x.r).map(r => [r, vals.filter(v => rank(v) === r).length] as [string, number])
    .filter(([, k]) => k > 0).map(([r, k]) => `${r} ${Math.round(100 * k / n)}%`).join('・');
}

for (const [label, focus, buy] of [['おまかせ・機材を買う', false, true], ['指示あり・機材なし', true, false], ['指示あり・機材を買う', true, true]] as [string, boolean, boolean][]) {
  const r = run(focus, buy);
  console.log(`\n== ${label}（${SEEDS}チーム、${YEARS}年。新入生は能力の平均35）`);
  console.log(`体育館レベル（年度の終わり）：${r.gym.map((g, i) => `${i + 1}年目 ${mean(g).toFixed(1)}`).join('、')}`);
  console.log(`部員の数（年度の終わり）：${r.members.map((g, i) => `${i + 1}年目 ${mean(g).toFixed(1)}`).join('、')}`);
  // 1年目に入学した学年＝3年目の卒業生（入学から卒業まで3年間育てた選手）
  for (const y of [2, YEARS - 1]) {
    if (y >= YEARS) continue;
    const g = r.grads[y].filter(x => x.enrollYear === y - 1);
    if (!g.length) continue;
    const all = g.flatMap(x => KEYS.map(k => x.abilities[k]));
    console.log(`${y + 1}年目の卒業生（${y - 1}年目入学、${g.length}人）：6能力の平均 ${mean(all).toFixed(1)}`);
    console.log(`  6能力の分布：${dist(all)}`);
    if (focus) {
      const f = g.map(x => x.abilities[FOCUS[x.role]]);
      const o = g.flatMap(x => KEYS.filter(k => k !== FOCUS[x.role]).map(k => x.abilities[k]));
      console.log(`  指示した能力：平均 ${mean(f).toFixed(1)}（${dist(f)}）`);
      console.log(`  ほかの能力：平均 ${mean(o).toFixed(1)}（${dist(o)}）`);
    }
    const h = g.map(x => x.height);
    console.log(`  身長：平均 ${mean(h).toFixed(1)}cm`);
  }
}
