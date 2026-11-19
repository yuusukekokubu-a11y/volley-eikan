// 試作・テスト用のチームを作る。ゲーム本編の選手生成（新入生の仕組み）とは別物。

import { Rng } from './rng';
import type { Gender, LineupSlot, Player, Role, Tactics, TeamState } from './types';

type Strength = number; // 能力の平均の目安（0〜100）

const ROLE_HEIGHT: Record<Gender, Record<Role, number>> = {
  male: { S: 176, OH: 182, MB: 188, OP: 183, L: 170 },
  female: { S: 163, OH: 168, MB: 174, OP: 169, L: 158 },
};

export function makePlayer(rng: Rng, id: string, number: number, role: Role, gender: Gender, avg: Strength): Player {
  const n = (spread = 10) => Math.round(Math.min(99, Math.max(1, avg + rng.normal() * spread)));
  const apt: Record<Role, number> = { S: 20, OH: 30, MB: 30, OP: 30, L: 20 };
  apt[role] = 70 + Math.round(rng.range(0, 30));
  // サーブは解禁特能で決まる（試作用に適当に持たせる）
  const serve = rng.weighted([
    { item: [] as string[], w: 3 }, { item: ['jumpFloat'], w: 3 }, { item: ['spikeServe'], w: role === 'OH' || role === 'OP' ? 3 : 1 },
  ])!;
  return {
    id, name: `${id}`, number,
    height: Math.round(ROLE_HEIGHT[gender][role] + rng.normal() * 4),
    jump: n() + (role === 'MB' || role === 'OH' || role === 'OP' ? 5 : 0),
    power: n() + (role === 'OH' || role === 'OP' ? 5 : 0),
    speed: n(),
    technique: n() + (role === 'S' || role === 'L' ? 8 : 0),
    block: n() + (role === 'MB' ? 8 : 0),
    stamina: n(),
    aptitude: apt,
    traits: [...serve],
    condition: 0,
  };
}

/** 一般的な 5-1 の並び：S, OH, MB, OP, OH, MB（ゾーン1から順に） */
export function makeTeam(seed: number, name: string, gender: Gender, avg: Strength, tactics?: Partial<Tactics>): TeamState {
  const rng = new Rng(seed);
  const roles: Exclude<Role, 'L'>[] = ['S', 'OH', 'MB', 'OP', 'OH', 'MB'];
  const rotation: LineupSlot[] = roles.map((role, i) => ({
    role, player: makePlayer(rng, `${name}${i + 1}`, i + 1, role, gender, avg),
  }));
  return {
    name,
    rotation,
    libero: makePlayer(rng, `${name}L`, 7, 'L', gender, avg),
    tactics: { attack: 'balance', block: 'spread', receive: 'back', ...tactics },
  };
}

/** ローテーションを1つ回す（ゾーン2の選手がゾーン1へ） */
export function rotate(team: TeamState): TeamState {
  const r = team.rotation;
  return { ...team, rotation: [...r.slice(1), r[0]] };
}

/** 控えの選手（各ポジション1人ずつ、計4人）。背番号は8〜11 */
export function makeBench(seed: number, name: string, gender: Gender, avg: Strength): Player[] {
  const rng = new Rng(seed * 7 + 3);
  const roles: Exclude<Role, 'L'>[] = ['S', 'OH', 'MB', 'OP'];
  return roles.map((role, i) => makePlayer(rng, `${name}${8 + i}`, 8 + i, role, gender, avg - 3));
}
