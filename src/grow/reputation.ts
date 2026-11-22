// 評判と、監督特能の獲得・失効。描画は知らない。

import { MANAGER_GAIN, REPUTATION } from './constants';
import { MANAGER_SKILL_IDS } from '../sim/manager';
import type { Rng } from '../sim/rng';

/** 評判（点）。育成全体で持ち、年度をまたいで引き継ぐ */
export interface Reputation {
  points: number;
}

/** 段階の番号（0＝弱小 … 5＝超名門） */
export function rankOf(points: number): number {
  let r = 0;
  REPUTATION.at.forEach((v, i) => { if (points >= v) r = i; });
  return r;
}

export const rankName = (points: number): string => REPUTATION.ranks[rankOf(points)];

/** 相手校の評判（強さから） */
export function schoolRankName(strength: number): string {
  let r = 0;
  REPUTATION.schoolAt.forEach((v, i) => { if (strength >= v) r = i; });
  return REPUTATION.ranks[r];
}

export function addReputation(rep: Reputation, delta: number) {
  rep.points = Math.max(0, Math.min(REPUTATION.max, rep.points + delta));
}

/** 年度の終わり：その年に得た点が今の段階に見合わなければ、足りない分だけ少し下がる */
export function closeReputation(rep: Reputation, gained: number) {
  const need = REPUTATION.expected[rankOf(rep.points)];
  if (gained < need) addReputation(rep, -(need - gained) * REPUTATION.fall);
}

/** 持っている監督特能。until の年度の終わりで失効する */
export interface OwnedSkill {
  id: string;
  until: number;
}

export type SkillSource = keyof typeof MANAGER_GAIN.chance;

/** 獲得の機会：獲得の場と評判から確率で、覚える特能を選ぶ（取れなければ null） */
export function rollSkill(rng: Rng, source: SkillSource, points: number): string | null {
  const p = MANAGER_GAIN.chance[source] * MANAGER_GAIN.rankMul[rankOf(points)];
  if (!rng.chance(Math.min(1, p))) return null;
  const ids = MANAGER_SKILL_IDS.filter(id => id !== 'basic');
  return rng.weighted(ids.map(id => ({ item: id, w: MANAGER_GAIN.weights[id] ?? 1 })))!;
}

/** 覚える：持っていれば期限が延び、空きがあれば加わる。3つ持っていれば false（入れ替えか見送りを選ぶ） */
export function learnSkill(owned: OwnedSkill[], id: string, year: number): boolean {
  const until = year + MANAGER_GAIN.years - 1;
  const have = owned.find(s => s.id === id);
  if (have) { have.until = Math.max(have.until, until); return true; }
  if (owned.length >= MANAGER_GAIN.max) return false;
  owned.push({ id, until });
  return true;
}

/** 年度の初め：期限の切れた特能を外す。外した ID を返す */
export function expireSkills(owned: OwnedSkill[], year: number): string[] {
  const gone = owned.filter(s => s.until < year).map(s => s.id);
  for (const id of gone) owned.splice(owned.findIndex(s => s.id === id), 1);
  return gone;
}
