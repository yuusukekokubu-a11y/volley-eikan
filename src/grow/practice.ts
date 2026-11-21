// 練習（spec.md「練習の仕組み」）。選手ごとの練習指示と、進行カードの練習の種類の組み合わせで経験が入る。
// 体育館レベル（持っている機材で決まる）が高いほど、すべての練習の経験が増える。機材そのものの倍率はない（体育館レベルに1つにまとめる）。
// 調子は日々少しずつ変わる（安定感は波が小さく、ムラっ気は波が大きい）。

import { addAbilityExp, addAptitudeExp } from '../sim/player';
import type { Rng } from '../sim/rng';
import { hasTrait } from '../sim/traits';
import type { Player, TrainKey } from '../sim/types';
import { PRACTICE, PRACTICES, type Equipment, type PracticeDef } from './cards';
import { CONDITION, ENERGY, GYM, PRACTICE_GAIN } from './constants';

/** 機材（練習の種類のうち、機材を使うもの）。持っていると、その練習のカードが手札に出る */
export const EQUIPMENT: PracticeDef[] = PRACTICES.filter(p => p.equipment !== 'none');

/** 体育館レベル：持っている機材の数と種類で決まる（上位機材ほど多く上がる）。機材は壊れない */
export function gymLevel(owned: string[]): number {
  const points = owned.reduce((s, id) => s + (PRACTICE[id] ? GYM.points[PRACTICE[id].equipment as Exclude<Equipment, 'none'>] ?? 0 : 0), 0);
  return Math.min(GYM.maxLevel, 1 + Math.floor(points / GYM.perLevel));
}

/** 体育館レベルによる経験の倍率 */
export function gymMul(level: number): number {
  return 1 + (level - 1) * GYM.perLevelGain;
}

/** 能力が高いほど伸びにくい（上限100は全員同じ） */
function growth(v: number): number {
  return Math.max(PRACTICE_GAIN.min, PRACTICE_GAIN.pivot - v * PRACTICE_GAIN.slope);
}

/** 体力が低いほど練習の伸びが落ちる（体力0でも 1 − lowPenalty） */
export function energyMul(energy: number): number {
  return 1 - ENERGY.lowPenalty * Math.max(0, ENERGY.lowFrom - energy) / ENERGY.lowFrom;
}

/**
 * 1日の練習で入る経験（能力ごと）。mul は黄パネルの倍率など。
 * 練習指示は「伸びる量を寄せる」：指示した能力と違う能力の練習では、経験の一部が指示した能力に回る（合計は変わらない）
 */
export function practiceGain(p: Player, practice: PracticeDef, level: number, mul = 1): Partial<Record<TrainKey, number>> {
  const out: Partial<Record<TrainKey, number>> = {};
  const g = gymMul(level) * energyMul(p.energy) * mul;
  const focus = p.practice.focus;
  const share = practice.kind === 'general' ? PRACTICE_GAIN.generalShare : practice.kind === 'efficient' ? PRACTICE_GAIN.efficient : 1;
  const add = (k: TrainKey, v: number) => { out[k] = (out[k] ?? 0) + v; };
  for (const a of practice.abilities) {
    const amount = PRACTICE_GAIN.base * share * g;
    if (focus === 'auto' || focus === a) { add(a, amount * growth(p[a])); continue; }
    add(a, amount * (1 - PRACTICE_GAIN.focusShift) * growth(p[a]));
    add(focus, amount * PRACTICE_GAIN.focusShift * growth(p[a]));
  }
  return out;
}

/** 練習する。days 日分の経験と、練習するポジションの適性の経験を足す */
export function applyPractice(players: Player[], practice: PracticeDef, days: number, level: number, mul = 1) {
  for (const p of players) {
    for (let d = 0; d < days; d++) {
      const gain = practiceGain(p, practice, level, mul);
      for (const [k, v] of Object.entries(gain)) addAbilityExp(p, k as TrainKey, v!);
    }
    addAptitudeExp(p, p.practice.position, PRACTICE_GAIN.aptitude * days * mul);
  }
}

/** 1日ごとの調子の変化。安定感は普通から外れにくく、ムラっ気は外れやすく戻りにくい。変わる時は普通の方へ戻りやすい */
export function dailyCondition(p: Player, rng: Rng) {
  const stable = hasTrait(p, 'stable'), moody = hasTrait(p, 'moody');
  let chance = p.condition === 0 ? CONDITION.leaveNormal : CONDITION.dailyChance;
  if (p.condition === 0 && stable) chance *= CONDITION.stableLeave;
  if (p.condition === 0 && moody) chance *= CONDITION.moodyLeave;
  if (!rng.chance(chance)) return;
  const toward = p.condition === 0 ? (rng.chance(0.5) ? 1 : -1) : -Math.sign(p.condition);
  const back = moody ? CONDITION.moodyToward : CONDITION.towardNormal;
  const dir = p.condition === 0 || rng.chance(back) ? toward : -toward;
  p.condition = Math.max(-2, Math.min(2, p.condition + dir));
}
