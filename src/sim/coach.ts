// 相手チームの采配（監督の判断）。栄冠ナインと同じく、相手は交代だけをする（疲れた選手の交代、ピンチサーバー）。
// タイムアウト・監督特能・方針の変更はしない（spec.md「相手チームの采配」）。こちらと同じ交代のルールを守る。描画は知らない。

import { COACH, MATCH } from './constants';
import type { SetGame } from './match';
import type { Player, Role, TeamId } from './types';

export interface CoachDecision {
  subs: { outId: string; inId: string; pinch?: boolean; reason: 'fatigue' | 'return' | 'pinch' }[];
}

/** サーブの強さの目安（ピンチサーバーを入れるかの判断） */
function serveScore(p: Player): number {
  return p.technique * 0.6 + p.power * 0.4 + (p.traits.includes('pinchServer') ? 10 : 0)
    + (p.traits.some(id => id === 'jumpFloat' || id === 'spikeServe' || id === 'jumpFloatPro' || id === 'spikeServePro') ? 6 : 0);
}

const roleOf = (p: Player): Role => (Object.entries(p.aptitude) as [Role, number][]).sort((a, b) => b[1] - a[1])[0][0];

/** 毎ラリーの後の判断（交代だけ） */
export function coachDecide(g: SetGame, team: TeamId): CoachDecision {
  const dec: CoachDecision = { subs: [] };
  if (g.over) return dec;
  const top = Math.max(g.score.A, g.score.B);

  // ---- 交代 ----
  const subs = g.validSubs(team);
  const left = MATCH.substitutions - g.subsUsed[team];
  // 疲れた先発を同じポジションの控えと交代し、回復したら戻す
  for (const slot of g.teams[team].rotation) {
    const id = slot.player.id;
    const pair = g.pairs[team].find(p => p.subId === id && p.status === 'in' && !p.pinch);
    if (pair) {
      if ((g.fatigue[pair.starterId] ?? 0) <= COACH.fatigueReturn && subs.some(s => s.outId === id && s.inId === pair.starterId)) {
        dec.subs.push({ outId: id, inId: pair.starterId, reason: 'return' });
      }
      continue;
    }
    if ((g.fatigue[id] ?? 0) < COACH.fatigueSub || left - dec.subs.length < 2) continue;
    const cand = subs.filter(s => s.outId === id).map(s => g.bench[team].find(b => b.id === s.inId)!)
      .filter(b => roleOf(b) === slot.role && (g.fatigue[b.id] ?? 0) < COACH.fatigueReturn);
    if (cand.length) dec.subs.push({ outId: id, inId: cand[0].id, reason: 'fatigue' });
  }
  // ピンチサーバー：終盤、次に自分たちがサーブする時、サーバーよりサーブのうまい控えがいれば入れる
  const server = g.teams[team].rotation[0].player;
  if (g.serving === team && top >= (g.finalSet ? COACH.lateFrom.final : COACH.lateFrom.normal) - 2 && !dec.subs.some(s => s.outId === server.id)) {
    const best = g.validPinch(team)
      .map(s => ({ s, b: g.bench[team].find(x => x.id === s.inId)! }))
      .filter(x => serveScore(x.b) >= serveScore(server) + COACH.pinchMargin)
      .sort((a, b) => serveScore(b.b) - serveScore(a.b))[0];
    if (best && left - dec.subs.length >= 2) dec.subs.push({ outId: server.id, inId: best.b.id, pinch: true, reason: 'pinch' });
  }
  return dec;
}
