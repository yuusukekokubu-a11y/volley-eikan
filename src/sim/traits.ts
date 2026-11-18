// 特殊能力の差し込み口。
// 今の段階では特能は1つも登録していない。各判定は計算に使う値を values にまとめて
// applyTraits() を呼ぶので、特能はその値を書き換える形で後から足せる。
// 特能同士の組み合わせボーナス表は作らない（CLAUDE.md）。各特能は自分の判定だけを触る。

import type { Player, RallyContext, TeamId } from './types';

export type JudgeName = 'serve' | 'pass' | 'set' | 'attack' | 'block' | 'cover';

/** 判定に関わる立場。actor＝その動作をする選手、opponent＝受ける側の選手 */
export type Side = 'actor' | 'opponent' | 'teammate';

export interface TraitCall {
  judge: JudgeName;
  side: Side;
  player: Player;
  team: TeamId;
  context?: RallyContext;
}

export type TraitHook = (values: Record<string, number>, call: TraitCall) => void;

/** 特能ID → 判定ごとの処理 */
export const TRAIT_REGISTRY: Record<string, Partial<Record<JudgeName, TraitHook>>> = {};

export function applyTraits(
  values: Record<string, number>,
  judge: JudgeName,
  involved: { player: Player; team: TeamId; side: Side }[],
  context?: RallyContext,
): void {
  for (const inv of involved) {
    for (const id of inv.player.traits) {
      const hook = TRAIT_REGISTRY[id]?.[judge];
      if (hook) hook(values, { judge, side: inv.side, player: inv.player, team: inv.team, context });
    }
  }
}

export function hasTrait(p: Player, id: string): boolean {
  return p.traits.includes(id);
}
