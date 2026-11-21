// 試作・テスト用のチームを作る。ゲーム本編の選手生成（新入生の仕組み）とは別物。

import { Rng } from './rng';
import { emptyAptExp, emptyExp, emptyStats, rollHand, rollHeightPotential, rollLooks } from './player';
import type { AptStage, Gender, LineupSlot, Player, Role, Tactics, TeamState } from './types';

/** 試作用の年度（学年は 1〜3 をばらけさせる） */
export const SAMPLE_YEAR = 1;

/** 本職ごとの、ほかの位置の適性の目安（3＝◎、2＝○、1＝△、0＝－） */
const APT_BASE: Record<Role, Record<Role, AptStage>> = {
  S: { S: 3, OH: 1, MB: 0, OP: 1, L: 1 },
  OH: { S: 0, OH: 3, MB: 1, OP: 2, L: 1 },
  MB: { S: 0, OH: 1, MB: 3, OP: 1, L: 0 },
  OP: { S: 0, OH: 2, MB: 1, OP: 3, L: 0 },
  L: { S: 1, OH: 1, MB: 0, OP: 0, L: 3 },
};

type Strength = number; // 能力の平均の目安（0〜100）

const ROLE_HEIGHT: Record<Gender, Record<Role, number>> = {
  male: { S: 176, OH: 182, MB: 188, OP: 183, L: 170 },
  female: { S: 163, OH: 168, MB: 174, OP: 169, L: 158 },
};

export function makePlayer(rng: Rng, id: string, number: number, role: Role, gender: Gender, avg: Strength): Player {
  const n = (spread = 10) => Math.round(Math.min(99, Math.max(1, avg + rng.normal() * spread)));
  // 本職は◎、ほかの位置は目安から1段階ずれることがある
  const apt = { ...APT_BASE[role] };
  for (const r of Object.keys(apt) as Role[]) {
    if (r !== role && rng.chance(0.25)) apt[r] = Math.max(0, Math.min(2, apt[r] + (rng.chance(0.5) ? 1 : -1))) as AptStage;
  }
  // サーブは解禁特能で決まる（試作用に適当に持たせる）
  const serve = rng.weighted([
    { item: [] as string[], w: 3 }, { item: ['jumpFloat'], w: 3 }, { item: ['spikeServe'], w: role === 'OH' || role === 'OP' ? 3 : 1 },
  ])!;
  const grade = 1 + Math.min(2, Math.floor(rng.range(0, 3)));
  return {
    id, name: `${id}`, number,
    enrollYear: SAMPLE_YEAR - grade + 1,
    heightPotential: grade === 3 ? 0 : rollHeightPotential(rng, gender),
    hand: rollHand(rng),
    looks: rollLooks(rng),
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
    // 試作用：学年が上ほど試合に出てきた分だけ信頼度が高い
    trust: Math.round(Math.min(100, (grade - 1) * 35 + rng.range(0, 30))),
    energy: 100,
    exp: emptyExp(),
    aptExp: emptyAptExp(),
    traitProgress: {},
    stats: emptyStats(),
    career: null,
    practice: { focus: 'auto', position: role },
    personality: null,
    middleSchool: null,
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
