// 部員の入れ替わり：新入生（4月の入学式）・卒業（3月の卒業式）・身体測定（4月）。描画は知らない。
// 本家と同じく、新入生の人数と能力はランダムに決まる（評判による増減は第3段階で）。

import { ROSTER } from './constants';
import { gradeOf, ROLES, rollHeightPotential } from '../sim/player';
import type { Rng } from '../sim/rng';
import { makePlayer } from '../sim/sample';
import { TRAITS } from '../sim/traits';
import type { Gender, Player, Role, Squad, TrainKey } from '../sim/types';
import { SURNAMES } from './names';

/** 卒業生の名簿の1行（後で作るOBパネル用） */
export interface Graduate {
  id: string;
  name: string;
  number: number;
  /** 一番適性の高いポジション */
  role: Role;
  enrollYear: number;
  gradYear: number;
  height: number;
  abilities: Record<TrainKey, number>;
  traits: string[];
  stats: Player['stats'];
}

const KEYS: TrainKey[] = ['jump', 'power', 'speed', 'technique', 'block', 'stamina'];

export const bestRole = (p: Player): Role => (Object.entries(p.aptitude) as [Role, number][]).sort((a, b) => b[1] - a[1])[0][0];

/** 卒業：3年生が部員から外れ、卒業生の名簿の行を返す */
export function graduate(squad: Squad, year: number): Graduate[] {
  const out: Graduate[] = [];
  squad.players = squad.players.filter(p => {
    if (gradeOf(p, year) < 3) return true;
    out.push({
      id: p.id, name: p.name, number: p.number, role: bestRole(p), enrollYear: p.enrollYear, gradYear: year,
      height: p.height, abilities: Object.fromEntries(KEYS.map(k => [k, p[k]])) as Record<TrainKey, number>,
      traits: [...p.traits], stats: { ...p.stats },
    });
    return false;
  });
  if (squad.captainId && !squad.players.some(p => p.id === squad.captainId)) squad.captainId = null;
  return out;
}

/** 新入生が特能を持って入ってくる時の候補（青・赤の能力系。サーブの解禁・金・緑は持たない） */
function traitPool(color: 'blue' | 'red', role: Role): string[] {
  return Object.values(TRAITS)
    .filter(t => t.kind === 'stat' && t.color === color && !t.alsoUnlocks && !t.upgradeOf && (!t.roles || t.roles.includes(role)))
    .map(t => t.id);
}

/** 空いている背番号のうち、小さいもの */
function freeNumber(squad: Squad): number {
  const used = new Set(squad.players.map(p => p.number));
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

/** 名字（部員の中でかぶらないものを優先） */
function pickName(squad: Squad, rng: Rng): string {
  const used = new Set(squad.players.map(p => p.name));
  for (let i = 0; i < 20; i++) {
    const n = rng.pick(SURNAMES);
    if (!used.has(n)) return n;
  }
  return rng.pick(SURNAMES);
}

/** 新入生を1人作る */
export function makeNewcomer(rng: Rng, squad: Squad, year: number, gender: Gender, serial: number): Player {
  const role = rng.weighted(ROLES.map(r => ({ item: r, w: ROSTER.roleWeights[r] })))!;
  const p = makePlayer(rng, `y${year}-${serial}`, freeNumber(squad), role, gender, ROSTER.newcomerAvg);
  // 試作用の作り方から、新入生の決まりに合わせて直す
  const spread = ROSTER.newcomerSpread;
  for (const k of KEYS) p[k] = Math.round(Math.min(99, Math.max(1, ROSTER.newcomerAvg + (p[k] - ROSTER.newcomerAvg) * spread / 10)));
  p.name = pickName(squad, rng);
  p.enrollYear = year;
  p.heightPotential = rollHeightPotential(rng, gender);
  p.trust = 0;
  p.traits = [];
  for (const color of ['blue', 'red'] as const) {
    if (p.traits.length === 0 && rng.chance(ROSTER.traitChance[color])) {
      const pool = traitPool(color, role);
      if (pool.length) p.traits.push(rng.pick(pool));
    }
  }
  return p;
}

/** 入学式：新入生が入部する（人数は毎年ランダム）。入った選手を返す */
export function enroll(squad: Squad, year: number, gender: Gender, rng: Rng): Player[] {
  const n = ROSTER.newcomers.min + Math.floor(rng.range(0, ROSTER.newcomers.max - ROSTER.newcomers.min + 1));
  const out: Player[] = [];
  for (let i = 0; i < Math.min(n, ROSTER.newcomers.max); i++) {
    const p = makeNewcomer(rng, squad, year, gender, i + 1);
    squad.players.push(p);
    out.push(p);
  }
  return out;
}

/**
 * 身体測定：身長の伸びしろ（残り）から身長を伸ばす。2年は伸びしろの heightShareSecond、3年は残り全部。
 * 入学したばかりの1年は伸びない。heightPotential は「残りの伸びしろ」として減っていく
 */
export function measure(squad: Squad, year: number): { id: string; cm: number }[] {
  const out: { id: string; cm: number }[] = [];
  for (const p of squad.players) {
    const g = gradeOf(p, year);
    if (g < 2 || p.heightPotential <= 0) continue;
    const cm = g === 2 ? Math.round(p.heightPotential * ROSTER.heightShareSecond) : p.heightPotential;
    p.height += cm;
    p.heightPotential -= cm;
    if (cm > 0) out.push({ id: p.id, cm });
  }
  return out;
}
