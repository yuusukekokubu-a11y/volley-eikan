// 大会の確認用：何年分かを自動で回して、予選の勝ち上がり率と本戦の成績を見る。
// 最初の部員：2・3年生を新入生の仕組みで作る（能力は入学時のまま）。県内の学校は毎年同じ。
// 進め方：grow-career.ts と同じ（体力が減ったら休む、練習指示は月初めにポジションの能力へ、毎年お金があるだけ機材を買う）。
// 試合は全部「結果だけ」（自チームも采配なし）。他校同士の試合も試合の計算で決める。
//   npx tsx scripts/tournament-check.ts [種の数] [年数]

import { Career } from '../src/grow/career';
import { EQUIPMENT } from '../src/grow/practice';
import { MONEY, REPUTATION, ROUND_NAMES } from '../src/grow/constants';
import { rankOf } from '../src/grow/reputation';
import { enroll } from '../src/grow/roster';
import { finishStep } from '../src/grow/season';
import { Rng } from '../src/sim/rng';
import type { Role, Squad, TrainKey } from '../src/sim/types';

const SEEDS = Number(process.argv[2] || 8);
const YEARS = Number(process.argv[3] || 5);
const FOCUS: Record<Role, TrainKey> = { S: 'technique', OH: 'power', MB: 'block', OP: 'jump', L: 'speed' };

function startSquad(seed: number): Squad {
  const sq: Squad = { players: [], captainId: null };
  const rng = new Rng(seed * 17 + 5);
  enroll(sq, -1, 'male', rng);
  enroll(sq, 0, 'male', rng);
  return sq;
}

interface YearRow { rep: number[]; skills: number[]; strength: number[]; prefTop: number[]; prelim: number[]; qualified: number; national: number[]; nationals: number; practice: [number, number] }
const rows: YearRow[] = Array.from({ length: YEARS }, () => ({ rep: [], skills: [], strength: [], prefTop: [], prelim: [], qualified: 0, national: [], nationals: 0, practice: [0, 0] }));
const t0 = Date.now();

for (let seed = 1; seed <= SEEDS; seed++) {
  const c = new Career({ seed, squad: startSquad(seed) });
  for (let y = 0; y < YEARS; y++) {
    if (y > 0) c.nextYear();
    const s = c.season;
    for (const eq of [...EQUIPMENT].sort((a, b) => (a.equipment === 'basic' ? 0 : 1) - (b.equipment === 'basic' ? 0 : 1))) {
      if (!s.equipment.includes(eq.id) && s.money >= MONEY.price[eq.equipment as 'basic' | 'advanced']) s.buy(eq.id);
    }
    let guard = 0;
    while (!s.over && guard++ < 2000) {
      if (s.practiceOpen) for (const p of s.squad.players) if (!p.retired && p.practice.focus === 'auto') s.setPractice(p.id, { focus: FOCUS[p.practice.position] });
      const avg = s.squad.players.reduce((a, p) => a + p.energy, 0) / Math.max(1, s.squad.players.length);
      finishStep(s, avg < 45 ? s.rest() : s.useCard(s.firstUsable()));
      for (let k = 0; k < 20 && (s.pending || s.pendingMatch || s.matchChoices || s.matchInvite || s.skillOffer); k++) {
        while (s.pending) s.choose(0);
        if (s.skillOffer) s.answerSkill(null);
        if (s.matchChoices) s.chooseMatch(0);
        if (s.matchInvite) s.answerInvite(true);
        while (s.pendingMatch) {
          const practice = s.pendingMatch.kind === 'practice';
          const r = s.playMatch();
          if (practice) rows[y].practice[r.notes[0].includes('勝ち') ? 0 : 1]++;
        }
      }
    }
    const row = rows[y];
    row.strength.push(s.ownStrength());
    row.rep.push(c.reputation.points);
    row.skills.push(c.managerSkills.length);
    row.prefTop.push(Math.max(...c.schools.map(x => x.strength)));
    for (const id of ['interhighPrelim', 'harukouPrelim'] as const) {
      const t = s.tournaments[id];
      if (!t) continue;
      row.prelim.push(t.ownResult().wins);
      if (t.ownResult().text === '優勝') row.qualified++;
    }
    for (const id of ['interhigh', 'harukou'] as const) {
      const t = s.tournaments[id];
      if (!t) continue;
      row.nationals++;
      row.national.push(t.ownResult().wins);
    }
  }
  process.stderr.write(`.`);
}
process.stderr.write(`\n${((Date.now() - t0) / 1000).toFixed(0)}秒\n`);

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const reach = (wins: number[]) => ROUND_NAMES.map((n, i) => `${n}${Math.round(100 * wins.filter(w => w >= i).length / Math.max(1, wins.length))}%`).join('・');
console.log(`== ${SEEDS}チーム × ${YEARS}年（予選は32校、本戦は32校。予選は年2回）`);
rows.forEach((r, y) => {
  console.log(`${y + 1}年目：自チームの強さ ${mean(r.strength).toFixed(1)}（県内1位の学校 ${mean(r.prefTop).toFixed(1)}）、年度の終わりの評判 ${mean(r.rep).toFixed(1)}点（${REPUTATION.ranks.map((n, i) => [n, r.rep.filter(p => rankOf(p) === i).length] as [string, number]).filter(([, k]) => k).map(([n, k]) => `${n}${Math.round(100 * k / r.rep.length)}%`).join('・')}）、監督特能 ${mean(r.skills).toFixed(1)}個`);
  console.log(`  予選：各回戦に進んだ割合 ${reach(r.prelim)}、優勝（本戦へ） ${Math.round(100 * r.qualified / Math.max(1, r.prelim.length))}%`);
  if (r.nationals) console.log(`  本戦（${r.nationals}回出場）：各回戦に進んだ割合 ${reach(r.national)}、優勝 ${Math.round(100 * r.national.filter(w => w === 5).length / r.nationals)}%`);
  else console.log('  本戦：出場なし');
  const pm = r.practice[0] + r.practice[1];
  if (pm) console.log(`  練習試合：${pm}試合、勝率 ${Math.round(100 * r.practice[0] / pm)}%`);
});
