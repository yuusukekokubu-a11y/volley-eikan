// 選手のデータを扱う関数（学年、信頼度の上乗せ、経験による能力・適性の伸び、試合の後の更新）。描画は知らない。

import { ABILITY, APTITUDE, HEIGHT_GROWTH, LEFT_HANDED_RATE, LOOKS, TRUST } from './constants';
import type { Rng } from './rng';
import type { AptStage, CareerStats, Gender, Hand, Looks, Player, Role, TrainKey } from './types';

export const ROLES: Role[] = ['S', 'OH', 'MB', 'OP', 'L'];
export const TRAIN_KEYS: TrainKey[] = ['jump', 'power', 'speed', 'technique', 'block', 'stamina'];

/** 学年（1〜3）。year はいまの年度 */
export function gradeOf(p: Player, year: number): number {
  return year - p.enrollYear + 1;
}

/** 信頼度による全能力の上乗せ（試合中だけ。特能と同じ段階の値） */
export function trustDelta(p: Player): number {
  for (const b of TRUST.bonus) if (p.trust >= b.at) return b.delta;
  return 0;
}

/** 能力の経験を足す。端数が1たまるごとに能力が1上がる（上限まで） */
export function addAbilityExp(p: Player, key: TrainKey, amount: number) {
  let e = p.exp[key] + amount;
  while (e >= 1 && p[key] < ABILITY.max) { p[key]++; e -= 1; }
  p.exp[key] = p[key] >= ABILITY.max ? 0 : e;
}

/** 適性の経験を足す。たまると1段階上がる（◎まで） */
export function addAptitudeExp(p: Player, role: Role, amount: number) {
  let e = p.aptExp[role] + amount;
  while (p.aptitude[role] < 3 && e >= APTITUDE.expToNext[p.aptitude[role]]) {
    e -= APTITUDE.expToNext[p.aptitude[role]];
    p.aptitude[role] = (p.aptitude[role] + 1) as AptStage;
  }
  p.aptExp[role] = p.aptitude[role] >= 3 ? 0 : e;
}

/** 1試合で選手ごとに集めたもの（試合の側が作る） */
export interface MatchLine {
  /** 出たセットの数と、そのうち各位置で出た数 */
  sets: number;
  roles: Partial<Record<Role, number>>;
  kills: number;
  blockPoints: number;
  aces: number;
}

/** 試合の後に、出た選手の通算成績・信頼度・適性の経験を更新する */
export function applyMatch(players: Player[], lines: Record<string, MatchLine>) {
  for (const p of players) {
    const l = lines[p.id];
    if (!l || l.sets === 0) continue;
    p.stats.matches++;
    p.stats.sets += l.sets;
    p.stats.kills += l.kills;
    p.stats.blockPoints += l.blockPoints;
    p.stats.aces += l.aces;
    p.trust = Math.min(TRUST.max, p.trust + TRUST.perSet * l.sets);
    for (const r of ROLES) if (l.roles[r]) addAptitudeExp(p, r, APTITUDE.expPerSet * l.roles[r]!);
  }
}

// ---------------- 作る時に使うもの ----------------

export function emptyStats(): CareerStats {
  return { matches: 0, sets: 0, kills: 0, blockPoints: 0, aces: 0 };
}

export function emptyExp(): Record<TrainKey, number> {
  return { jump: 0, power: 0, speed: 0, technique: 0, block: 0, stamina: 0 };
}

export function emptyAptExp(): Record<Role, number> {
  return { S: 0, OH: 0, MB: 0, OP: 0, L: 0 };
}

/** 身長の伸びしろ（cm） */
export function rollHeightPotential(rng: Rng, gender: Gender): number {
  const b = rng.weighted(HEIGHT_GROWTH.bands.map(x => ({ item: x, w: x.w })))!;
  return Math.round((b.min + rng.range(0, b.max - b.min)) * HEIGHT_GROWTH.scale[gender]);
}

export function rollLooks(rng: Rng): Looks {
  const pick = (n: number) => Math.min(n - 1, Math.floor(rng.range(0, n)));
  return { hairStyle: pick(LOOKS.hairStyles), hairColor: pick(LOOKS.hairColors), skin: pick(LOOKS.skins) };
}

export function rollHand(rng: Rng): Hand {
  return rng.chance(LEFT_HANDED_RATE) ? 'left' : 'right';
}
