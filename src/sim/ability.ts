// 能力値から試合で使う値を出す。

import { BODY } from './constants';
import type { Abilities, Player, Role } from './types';

export type AbilityKey = Exclude<keyof Abilities, 'height' | 'stamina'>;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 調子と疲れを反映した能力値（身長は変わらない） */
export function effective(p: Player, key: AbilityKey, fatigue = 0): number {
  const cond = 1 + p.condition * BODY.conditionStep;
  const tired = 1 - clamp(fatigue, 0, 1) * BODY.fatigueMaxDrop;
  return clamp(p[key] * cond * tired, 0, 120);
}

/** 指高（cm） */
export function standingReachCm(heightCm: number): number {
  return heightCm * BODY.standingReachRatio;
}

/** 跳び上がりの高さ（cm）。跳躍の値だけで決まる */
export function jumpHeightCm(jump: number): number {
  return BODY.jumpMinCm + ((BODY.jumpMaxCm - BODY.jumpMinCm) * clamp(jump, 0, 120)) / 100;
}

/** スパイクの打点（cm）。身長と跳躍だけから計算する */
export function hitHeightCm(heightCm: number, jump: number): number {
  return standingReachCm(heightCm) + jumpHeightCm(jump);
}

/** ブロックの到達点（cm）。身長と跳躍だけから計算する */
export function blockReachCm(heightCm: number, jump: number): number {
  return standingReachCm(heightCm) + jumpHeightCm(jump) * BODY.blockJumpRatio;
}

/** ポジション適性による効きの割合 */
export function aptitudeFactor(p: Player, role: Role): number {
  return BODY.aptitudeMin + ((1 - BODY.aptitudeMin) * clamp(p.aptitude[role], 0, 100)) / 100;
}

export function runSpeed(speed: number): number {
  return BODY.runSpeedMin + ((BODY.runSpeedMax - BODY.runSpeedMin) * clamp(speed, 0, 120)) / 100;
}

export function sideSpeed(speed: number): number {
  return BODY.sideSpeedMin + ((BODY.sideSpeedMax - BODY.sideSpeedMin) * clamp(speed, 0, 120)) / 100;
}
