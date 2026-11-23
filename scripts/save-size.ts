// セーブの大きさの確認用：何十年分かを回して、セーブ（文字列）の大きさを測る。
// ブラウザの保存領域（localStorage）は、ふつう1つのサイトで約500万文字（5MB）まで。
// 他校同士の試合は強さの差の確率で決める（速く回すため。セーブの大きさには関係しない）。
//   npx tsx scripts/save-size.ts [年数]

import { Career } from '../src/grow/career';
import { enroll } from '../src/grow/roster';
import { serialize } from '../src/grow/save';
import { finishStep, useQuickBouts } from '../src/grow/season';
import { Rng } from '../src/sim/rng';
import type { Squad } from '../src/sim/types';
useQuickBouts();

const YEARS = Number(process.argv[2] || 50);
const sq: Squad = { players: [], captainId: null };
const rng = new Rng(1);
enroll(sq, -1, 'male', rng);
enroll(sq, 0, 'male', rng);
const c = new Career({ seed: 1, squad: sq });

const parts = (c: Career) => {
  const d = c.toData();
  const len = (v: unknown) => JSON.stringify(v).length;
  return `卒業生の名簿 ${(len(d.graduates) / 1000).toFixed(0)}千・部員 ${(len(d.season.squad) / 1000).toFixed(0)}千・盤面 ${(len(d.season.board) / 1000).toFixed(0)}千・大会 ${(len(d.season.tournaments) / 1000).toFixed(0)}千・大会の成績 ${(len(d.history) / 1000).toFixed(0)}千`;
};

for (let y = 1; y <= YEARS; y++) {
  if (y > 1) c.nextYear();
  const s = c.season;
  let guard = 0;
  while (!s.over && guard++ < 3000) {
    if (s.pending) { s.choose(0); continue; }
    if (s.skillOffer) { s.answerSkill(null); continue; }
    if (s.matchChoices) { s.chooseMatch(0); continue; }
    if (s.matchInvite) { s.answerInvite(true); continue; }
    if (s.pendingMatch) { s.playMatch(); continue; }
    const avg = s.squad.players.reduce((a, p) => a + p.energy, 0) / s.squad.players.length;
    finishStep(s, avg < 45 ? s.rest() : s.useCard(s.firstUsable()));
  }
  if ([1, 5, 10, 20, 30, 40, 50, YEARS].includes(y)) {
    const text = serialize(c);
    console.log(`${y}年目の終わり：${(text.length / 1000).toFixed(0)}千文字（${parts(c)}）`);
  }
}
