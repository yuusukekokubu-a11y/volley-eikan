// 監督特能の取りやすさの確認用：評判の段階を固定して3年間回し、監督特能を覚えた回数（入れ替えの機会も含む）を数える。
// 他校同士の試合は強さの差の確率で決める（速く回すため）。
//   npx tsx scripts/reputation-check.ts [種の数]

import { Career } from '../src/grow/career';
import { REPUTATION } from '../src/grow/constants';
import { enroll } from '../src/grow/roster';
import { finishStep, useQuickBouts } from '../src/grow/season';
import { Rng } from '../src/sim/rng';
import type { Squad } from '../src/sim/types';
useQuickBouts();

const SEEDS = Number(process.argv[2] || 10);
const YEARS = 3;

function startSquad(seed: number): Squad {
  const sq: Squad = { players: [], captainId: null };
  const rng = new Rng(seed * 17 + 5);
  enroll(sq, -1, 'male', rng);
  enroll(sq, 0, 'male', rng);
  return sq;
}

console.log(`== 評判を固定して${YEARS}年（${SEEDS}チーム）：監督特能を覚えた回数（入れ替えの機会を含む）`);
for (let rank = 0; rank < REPUTATION.ranks.length; rank++) {
  let got = 0;
  const by: Record<string, number> = {};
  for (let seed = 1; seed <= SEEDS; seed++) {
    const c = new Career({ seed, squad: startSquad(seed) });
    for (let y = 0; y < YEARS; y++) {
      if (y > 0) c.nextYear();
      const s = c.season;
      let guard = 0;
      while (!s.over && guard++ < 2000) {
        c.reputation.points = REPUTATION.at[rank];
        const res = [finishStep(s, s.useCard(s.firstUsable()))];
        for (let k = 0; k < 30 && (s.pending || s.pendingMatch || s.matchChoices || s.matchInvite || s.skillOffer); k++) {
          while (s.pending) s.choose(0);
          if (s.skillOffer) s.answerSkill(null);
          if (s.matchChoices) s.chooseMatch(0);
          if (s.matchInvite) s.answerInvite(true);
          if (s.pendingMatch) res.push(s.playMatch());
        }
        for (const r of res) for (const n of r.notes) {
          const m = n.match(/^(.+)：監督特能「.+」を(覚えた|覚えられる|磨き直した)/);
          if (m) { got++; by[m[1]] = (by[m[1]] ?? 0) + 1; }
        }
      }
    }
  }
  console.log(`${REPUTATION.ranks[rank]}：3年で ${(got / SEEDS).toFixed(1)}回（${Object.entries(by).map(([k, v]) => `${k} ${(v / SEEDS).toFixed(1)}`).join('・')}）`);
}
