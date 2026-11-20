// 相手チームの采配（監督の判断）。毎ラリーの後に、点差・連続失点・直近の失点の理由・選手の疲れから決める。
// こちらと同じルール（タイムアウト1セット2回・5ラリーで切れる監督特能・交代6回まで）を守る。描画は知らない。

import { COACH, MATCH } from './constants';
import { MANAGER_SKILLS } from './manager';
import type { SetGame } from './match';
import type { Player, Role, Tactics, TeamId } from './types';

/** 失点の記録（相手の判断に使う） */
export interface PointLog {
  winner: TeamId;
  reason: string;
  /** 得点した選手（スパイク・フェイント・サービスエースなど） */
  key?: string;
  /** 最後の攻撃のトスの種類（速攻に決められたかを見る） */
  setType?: string;
}

export interface CoachDecision {
  timeout?: { skillId: string; tactics?: Partial<Tactics> };
  subs: { outId: string; inId: string; pinch?: boolean; reason: 'fatigue' | 'return' | 'pinch' }[];
}

const other = (t: TeamId): TeamId => (t === 'A' ? 'B' : 'A');
const SCORED = new Set(['kill', 'tipKill', 'blockOut', 'ace', 'blockKill']);

/** 直近の失点（そのチームが失った点）から、取られ方を数える */
export function lostSummary(log: PointLog[], team: TeamId, recent: number = COACH.recentLost) {
  const lost = log.filter(p => p.winner !== team).slice(-recent);
  const byKey = new Map<string, number>();
  for (const p of lost) if (p.key && SCORED.has(p.reason)) byKey.set(p.key, (byKey.get(p.key) ?? 0) + 1);
  return {
    aces: lost.filter(p => p.reason === 'ace').length,
    quick: lost.filter(p => p.reason === 'kill' && (p.setType === 'quick' || p.setType === 'timeDiff' || p.setType === 'broad')).length,
    tips: lost.filter(p => p.reason === 'tipKill').length,
    hard: lost.filter(p => p.reason === 'kill').length,
    sameScorer: Math.max(0, ...byKey.values()),
  };
}

/** 取られ方に合わせた方針の変え方（変えるものだけ返す） */
export function tacticsFor(sum: ReturnType<typeof lostSummary>, cur: Tactics): Partial<Tactics> {
  const t: Partial<Tactics> = {};
  if (!COACH.changeTactics) return t;
  if (sum.quick >= COACH.quickKills && cur.block !== 'bunch') t.block = 'bunch';
  else if (sum.sameScorer >= COACH.sameScorer && cur.block !== 'dedicate') t.block = 'dedicate';
  if (sum.tips >= COACH.tipKills && cur.receive !== 'front') t.receive = 'front';
  else if (sum.hard >= 3 && sum.tips === 0 && cur.receive !== 'back') t.receive = 'back';
  return t;
}

/** タイムアウトで使う監督特能：取られ方に合うものを、持っている中から */
export function skillFor(sum: ReturnType<typeof lostSummary>, owned: string[]): string {
  const has = (id: string) => owned.includes(id) && MANAGER_SKILLS[id]?.kind === 'timeout';
  const wants = sum.aces >= 1 ? ['tatenaoshi', 'serveKuzushi'] : sum.sameScorer >= COACH.sameScorer ? ['aceTaisaku'] : [];
  for (const id of [...wants, 'geki', ...owned]) if (has(id)) return id;
  return 'basic';
}

/** サーブの強さの目安（ピンチサーバーを入れるかの判断） */
function serveScore(p: Player): number {
  return p.technique * 0.6 + p.power * 0.4 + (p.traits.includes('pinchServer') ? 10 : 0)
    + (p.traits.some(id => id === 'jumpFloat' || id === 'spikeServe' || id === 'jumpFloatPro' || id === 'spikeServePro') ? 6 : 0);
}

const roleOf = (p: Player): Role => (Object.entries(p.aptitude) as [Role, number][]).sort((a, b) => b[1] - a[1])[0][0];

/** 毎ラリーの後の判断。タイムアウトは、そのラリーを失った時だけ考える */
export function coachDecide(g: SetGame, team: TeamId, lastWinner: TeamId): CoachDecision {
  const dec: CoachDecision = { subs: [] };
  if (g.over) return dec;
  const me = g.score[team], opp = g.score[other(team)];
  const lead = me - opp;
  const top = Math.max(me, opp);

  // ---- タイムアウト ----
  if (lastWinner !== team && g.canTimeout(team) && lead < COACH.noTimeoutLead) {
    const streak = g.lostStreak[team] > 0 && g.lostStreak[team] === g.streakNeeded(team);
    const late = top >= (g.finalSet ? COACH.lateFrom.final : COACH.lateFrom.normal)
      && -lead >= COACH.lateBehind && g.timeoutsLeft[team] === MATCH.timeouts;
    if (streak || late) {
      const sum = lostSummary(g.log, team);
      const tactics = tacticsFor(sum, g.teams[team].tactics);
      dec.timeout = { skillId: skillFor(sum, g.managerSkillsOf(team)), tactics: Object.keys(tactics).length ? tactics : undefined };
    }
  }

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
