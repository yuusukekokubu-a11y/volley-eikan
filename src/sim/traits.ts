// 特殊能力の受け皿（spec.md「特能の数値と型」）。
//
// 型は3つ：
//   stat   … 青・赤・金。「どの場面で・どの能力が・何段階上下するか」だけを持つ。
//             確率や距離を直接いじる特能は作らず、その場面での能力値の上下に置き換える。
//   unlock … 解禁型。特能がないとその動作自体が出ない。
//   style  … 緑。数値は持たず、行動の傾向を変える。
//
// 判断を表す能力は作らない。判断の正確さは既存の能力で決まる
// （ボールに関わる判断はテクニック、ブロックの読みはブロック能力）。
// 判断を良くする特能は「その判断の場面（serveAim / setChoice / blockRead など）で能力が上がる」形で書く。

import type { AbilityKey } from './ability';
import type { Player, Role } from './types';

/** 上下する値は固定の5段階（赤は同じ段階のマイナス） */
export const TRAIT_STAGES = [1, 3, 5, 10, 15] as const;
export type Stage = (typeof TRAIT_STAGES)[number];
export type StageDelta = Stage | -1 | -3 | -5 | -10 | -15;

/**
 * 場面。計算側は判定のたびに、その時に当てはまる場面の一覧を作って能力を引く。
 * 「計算で使用」と書いたものは今の計算が実際に渡している場面。
 */
export type Scene =
  // 全般
  | 'all'            // 計算で使用（すべての判定）
  | 'clutch'         // 計算で使用（セット終盤：20点以降、最終セットは10点以降）
  // サーブ
  | 'serve'          // 計算で使用
  | 'serveAim'       // 計算で使用（狙いを決める判断）
  | 'serveFloat' | 'serveJumpFloat' | 'serveSpike' // 計算で使用（その種類を打つ時）
  | 'serveStreak'    // 自分のサーブで連続得点中（試合側の情報が要るので未使用）
  // レシーブ（1本目）
  | 'serveReceive'   // 計算で使用
  | 'receiveFloat'   // 計算で使用（揺れるサーブを受ける）
  | 'receiveHard'    // 計算で使用（強いサーブ・強打を受ける）
  | 'dig'            // 計算で使用（スパイク・フェイント・ワンタッチを受ける）
  | 'digTip'         // 計算で使用（フェイント・軟打を受ける）
  | 'dive'           // 計算で使用（飛びつき・床すれすれ）
  | 'freeball'       // 計算で使用（チャンスボール・返球を受ける）
  | 'cover'          // 計算で使用（ブロックされたボールのフォロー）
  // トス
  | 'set'            // 計算で使用
  | 'setChoice'      // 計算で使用（配球の判断）
  | 'setBadPass'     // 計算で使用（ずれの大きいパスから上げる）
  | 'setSpin'        // 計算で使用（回転・勢いの残ったパスから上げる）
  | 'setQuick'       // 計算で使用（速攻・時間差のトス）
  | 'setBack'        // 計算で使用（バックトス）
  | 'setSecondary'   // 計算で使用（セッター以外が上げる二段トス）
  // 攻撃
  | 'attack'         // 計算で使用
  | 'attackBadSet'   // 計算で使用（崩れたトスを打つ）
  | 'attackQuick'    // 計算で使用（速攻・時間差を打つ）
  | 'attackSecondary'// 計算で使用（二段トスを打つ）
  | 'attackRepeat'   // 計算で使用（同じラリーで続けて自分にトスが来た）
  | 'attackStraight' | 'attackCross' // コース別（未使用。緑のコースの好みと一緒に入れる）
  | 'tip'            // 計算で使用（フェイント・軟打）
  | 'direct'         // 計算で使用（相手の返球を直接打つ）
  // ブロック
  | 'block'          // 計算で使用
  | 'blockRead'      // 計算で使用（トスを読んで動き出す判断）
  | 'blockQuick';    // 計算で使用（速攻・時間差に跳ぶ）

/** 効く範囲。self 以外は「持っている選手がその位置にいる時、同じ列の味方にも効く」 */
export type EffectTarget = 'self' | 'frontRow' | 'backRow';

export interface StatEffect {
  scene: Scene;
  ability: AbilityKey;
  delta: StageDelta;
  target?: EffectTarget;
}

export type TraitColor = 'blue' | 'red' | 'gold' | 'other';

export interface StatTrait {
  kind: 'stat';
  id: string;
  name: string;
  color: TraitColor;
  effects: StatEffect[];
  /** 持てるポジション（未指定ならどこでも） */
  roles?: Role[];
  /** 金特の場合、元になる青特能の ID（金を取ると青は置き換わる） */
  upgradeOf?: string;
}

export type UnlockAction = 'jumpFloat' | 'spikeServe' | 'backAttack' | 'broad' | 'dump';

export interface UnlockTrait {
  kind: 'unlock';
  id: string;
  name: string;
  unlocks: UnlockAction;
  roles?: Role[];
}

/** 緑の軸と値。同じ軸の緑は1つしか持てない */
export interface StyleAxes {
  serveRisk: 'aggressive' | 'safe';
  serveLength: 'short' | 'long';
  serveTarget: 'person' | 'seam';
  course: 'straight' | 'cross';
  hitting: 'hard' | 'soft';
  blocking: 'commit' | 'read';
  defense: 'active' | 'passive';
  receiving: 'overhand' | 'underhand';
  setting: 'ace' | 'spread';
}
export type StyleAxis = keyof StyleAxes;

export interface StyleTrait<A extends StyleAxis = StyleAxis> {
  kind: 'style';
  id: string;
  name: string;
  axis: A;
  value: StyleAxes[A];
  roles?: Role[];
}

export type TraitDef = StatTrait | UnlockTrait | StyleTrait;

// ---------------------------------------------------------------
// 登録
// 今は解禁型のサーブ2つだけ（数値を持たず、サーブの種類を決めるのに必要なため）。
// バックアタック・ブロード・ツーアタックは型だけ用意し、動作は特能の実装時に入れる。
// ---------------------------------------------------------------

export const TRAITS: Record<string, TraitDef> = {
  jumpFloat: { kind: 'unlock', id: 'jumpFloat', name: 'ジャンフロ◯', unlocks: 'jumpFloat' },
  spikeServe: { kind: 'unlock', id: 'spikeServe', name: 'スパイクサーブ◯', unlocks: 'spikeServe' },
};

export function traitDefs(p: Player): TraitDef[] {
  return p.traits.map(id => TRAITS[id]).filter((d): d is TraitDef => !!d);
}

export function canDo(p: Player, action: UnlockAction): boolean {
  return traitDefs(p).some(d => d.kind === 'unlock' && d.unlocks === action);
}

export function styleOf<A extends StyleAxis>(p: Player, axis: A): StyleAxes[A] | undefined {
  const d = traitDefs(p).find(x => x.kind === 'style' && x.axis === axis) as StyleTrait<A> | undefined;
  return d?.value;
}

/** 定義が型の決まりを守っているか（段階が5段階のどれか、など） */
export function validateTrait(def: TraitDef): string[] {
  const errs: string[] = [];
  if (def.kind === 'stat') {
    if (!def.effects.length) errs.push(`${def.id}: 効果がない`);
    for (const e of def.effects) {
      if (!TRAIT_STAGES.includes(Math.abs(e.delta) as Stage)) errs.push(`${def.id}: 段階 ${e.delta} は使えない`);
      if (def.color === 'red' && e.delta > 0) errs.push(`${def.id}: 赤なのにプラス`);
      if ((def.color === 'blue' || def.color === 'gold') && e.delta < 0) errs.push(`${def.id}: 青・金なのにマイナス`);
    }
  }
  return errs;
}

/**
 * ある選手の、指定した場面での能力の上下の合計。
 * teammates を渡すと、味方の特能のうち frontRow / backRow に効くものも足す。
 */
export function traitDelta(
  p: Player, ability: AbilityKey, scenes: ReadonlySet<Scene>,
  row?: { front: boolean; teammates: { p: Player; front: boolean }[] },
): number {
  let sum = 0;
  const add = (owner: Player, ownerFront: boolean | undefined) => {
    for (const d of traitDefs(owner)) {
      if (d.kind !== 'stat') continue;
      for (const e of d.effects) {
        if (e.ability !== ability || !scenes.has(e.scene)) continue;
        const t = e.target ?? 'self';
        const ok = t === 'self'
          ? owner === p
          : !!row && ownerFront !== undefined && ownerFront === row.front && (t === 'frontRow') === row.front;
        if (ok) sum += e.delta;
      }
    }
  };
  add(p, row?.front);
  if (row) for (const m of row.teammates) if (m.p !== p) add(m.p, m.front);
  return sum;
}
