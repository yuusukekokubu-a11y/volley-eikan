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
  | 'slump'          // 計算で使用（調子が不調・絶不調）
  | 'goodForm'       // 計算で使用（調子が好調・絶好調）
  // サーブ
  | 'serve'          // 計算で使用
  | 'serveAim'       // 計算で使用（狙いを決める判断）
  | 'serveFloat' | 'serveJumpFloat' | 'serveSpike' // 計算で使用（その種類を打つ時）
  | 'serveChoice'    // 計算で使用（打つサーブの種類を選ぶ判断）
  | 'serveStreak'    // 計算で使用（自分のサーブで連続得点中）
  | 'pinchServe'     // 計算で使用（途中から入った選手のサーブ）
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
  | 'attackStraight' | 'attackCross' // 計算で使用（そのコースに打つ時）
  | 'attackTimeDiff' // 計算で使用（時間差を打つ。フェイクの掛かり方）
  | 'blockOut'       // 計算で使用（ブロックに当てて外に出す）
  | 'tip'            // 計算で使用（フェイント・軟打）
  | 'direct'         // 計算で使用（相手の返球を直接打つ）
  // ブロック
  | 'block'          // 計算で使用
  | 'blockRead'      // 計算で使用（トスを読んで動き出す判断）
  | 'blockQuick'     // 計算で使用（速攻・時間差に跳ぶ）
  | 'blockTouch'     // 計算で使用（ブロックで触る判定）
  | 'blockKill'      // 計算で使用（ブロックで止める判定）
  | 'blockOutGuard'  // 計算で使用（相手にブロックアウトを狙われた時）
  | 'blockFollow';   // 計算で使用（自分のブロックに当たって自コートに落ちたボール）

/**
 * 効く範囲。frontRow / backRow は「持っている選手がその列にいる時、同じ列の味方（自分を含む）にも効く」。
 * opponent は「持っている選手と向き合っている相手の選手に効く」（配球バレ：トスを上げた選手の相手ブロッカー）
 */
export type EffectTarget = 'self' | 'frontRow' | 'backRow' | 'opponent';

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
  /** 5段階で表せない効き（相談して決めたものだけ） */
  extra?: {
    /** 疲れのたまり方の倍率（全力・サボり屋） */
    fatigueMul?: number;
    /** スパイクミスのうち、アウト／ネットに寄せる（アウト多め・ネットにかける） */
    attackMissSide?: 'out' | 'net';
  };
  /** 説明（数字は出さず、言葉で表す） */
  desc?: string;
}

export type UnlockAction = 'jumpFloat' | 'spikeServe' | 'backAttack' | 'broad' | 'dump' | 'rebound';

export interface UnlockTrait {
  kind: 'unlock';
  id: string;
  name: string;
  unlocks: UnlockAction;
  roles?: Role[];
  desc?: string;
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
  desc?: string;
}

export type TraitDef = StatTrait | UnlockTrait | StyleTrait;

// ---------------------------------------------------------------
// 登録
// 段階の付け方（spec.md）：場面が狭い特能は+10、場面が広いものや常に効くものは+5。
// 赤は同じ基準でマイナス。金は元の青から1段上。
// ---------------------------------------------------------------

/** 全能力（身長・スタミナを除く5つ） */
const ALL5: AbilityKey[] = ['jump', 'power', 'speed', 'technique', 'block'];
const each = (scene: Scene, abilities: AbilityKey[], delta: StageDelta, target?: EffectTarget): StatEffect[] =>
  abilities.map(ability => ({ scene, ability, delta, ...(target ? { target } : {}) }));

type StatInit = Omit<StatTrait, 'kind' | 'id' | 'name' | 'color' | 'effects'>;
const blue = (id: string, name: string, effects: StatEffect[], o: StatInit = {}): StatTrait =>
  ({ kind: 'stat', id, name, color: 'blue', effects, ...o });
const red = (id: string, name: string, effects: StatEffect[], o: StatInit = {}): StatTrait =>
  ({ kind: 'stat', id, name, color: 'red', effects, ...o });
const gold = (id: string, name: string, upgradeOf: string | undefined, effects: StatEffect[], o: StatInit = {}): StatTrait =>
  ({ kind: 'stat', id, name, color: 'gold', effects, upgradeOf, ...o });
const other_ = (id: string, name: string, effects: StatEffect[], o: StatInit = {}): StatTrait =>
  ({ kind: 'stat', id, name, color: 'other', effects, ...o });
const style = <A extends StyleAxis>(id: string, name: string, axis: A, value: StyleAxes[A], roles?: Role[]): StyleTrait<A> =>
  ({ kind: 'style', id, name, axis, value, ...(roles ? { roles } : {}) });
const unlock = (id: string, name: string, unlocks: UnlockAction, roles?: Role[]): UnlockTrait =>
  ({ kind: 'unlock', id, name, unlocks, ...(roles ? { roles } : {}) });

const LIST: TraitDef[] = [
  // ---- 解禁 ----
  unlock('jumpFloat', 'ジャンフロ◯', 'jumpFloat'),
  unlock('spikeServe', 'スパイクサーブ◯', 'spikeServe'),

  // ---- 青：全プレー ----
  blue('clutch', '勝負強い', each('clutch', ALL5, 5)),

  // ---- 青：レシーブ ----
  blue('receiveMaster', 'サーブレシーブ職人', each('serveReceive', ['technique'], 10)),

  // ---- 青：セッター ----
  blue('setEye', '配球眼', each('setChoice', ['technique'], 10), { roles: ['S'] }),

  // ---- 青：リベロ ----
  blue('defenseCore', '守備の要', [
    ...each('serveReceive', ['technique'], 5, 'backRow'), ...each('dig', ['technique'], 5, 'backRow'),
  ], { roles: ['L'] }),

  // ---- 赤 ----
  red('shakeWeak', '揺れ球×', each('receiveFloat', ['technique'], -10)),

  // ---- その他（能力の偏り） ----
  other_('brute', '力任せ', [...each('all', ['power'], 5), ...each('all', ['technique'], -5)]),
  other_('finesse', '技巧派', [...each('all', ['power'], -5), ...each('all', ['technique'], 5)]),

  // ---- 緑 ----
  style('aggressiveServe', '強気サーブ', 'serveRisk', 'aggressive'),
  style('safeServe', '安全サーブ', 'serveRisk', 'safe'),

  // ---- 金 ----
  gold('perfectCut', '完璧カット', 'receiveMaster', each('serveReceive', ['technique'], 15)),
];

export const TRAITS: Record<string, TraitDef> = Object.fromEntries(LIST.map(d => [d.id, d]));

/** 選手が持つ特能の定義。金特を持っていれば、元の青は置き換わる（効かない） */
export function traitDefs(p: Player): TraitDef[] {
  const defs = p.traits.map(id => TRAITS[id]).filter((d): d is TraitDef => !!d);
  const replaced = new Set(defs.map(d => (d.kind === 'stat' ? d.upgradeOf : undefined)).filter(Boolean));
  return defs.filter(d => !replaced.has(d.id));
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
 * facing を渡すと、向き合っている相手の特能のうち opponent に効くものも足す。
 */
export function traitDelta(
  p: Player, ability: AbilityKey, scenes: ReadonlySet<Scene>,
  row?: { front: boolean; teammates: { p: Player; front: boolean }[] },
  facing?: Player,
): number {
  let sum = 0;
  const add = (owner: Player, ownerFront: boolean | undefined, asOpponent = false) => {
    for (const d of traitDefs(owner)) {
      if (d.kind !== 'stat') continue;
      for (const e of d.effects) {
        if (e.ability !== ability || !scenes.has(e.scene)) continue;
        const t = e.target ?? 'self';
        if (asOpponent) { if (t === 'opponent') sum += e.delta; continue; }
        if (t === 'opponent') continue;
        const ok = t === 'self'
          ? owner === p
          : !!row && ownerFront !== undefined && ownerFront === row.front && (t === 'frontRow') === row.front;
        if (ok) sum += e.delta;
      }
    }
  };
  add(p, row?.front);
  if (row) for (const m of row.teammates) if (m.p !== p) add(m.p, m.front);
  if (facing) add(facing, undefined, true);
  return sum;
}

/** 5段階で表せない効き（extra）を選手の特能から集める */
export function traitExtra(p: Player): { fatigueMul: number; attackMissSide?: 'out' | 'net' } {
  let fatigueMul = 1;
  let attackMissSide: 'out' | 'net' | undefined;
  for (const d of traitDefs(p)) {
    if (d.kind !== 'stat' || !d.extra) continue;
    if (d.extra.fatigueMul) fatigueMul *= d.extra.fatigueMul;
    if (d.extra.attackMissSide) attackMissSide = d.extra.attackMissSide;
  }
  return { fatigueMul, attackMissSide };
}
