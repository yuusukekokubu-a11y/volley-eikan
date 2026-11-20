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
import { TRAIT_EXTRA } from './constants';
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
  /** チームにかける一時的な上下（監督特能）で、その選手1人だけに効かせる時（エース対策） */
  playerId?: string;
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
  /** その動作も解禁する（ジャンフロ◎などの上位版は◯を持っていなくても打てる） */
  alsoUnlocks?: UnlockAction;
  /** 5段階で表せない効き（相談して決めたものだけ） */
  extra?: {
    /** 疲れのたまり方の倍率（全力・サボり屋） */
    fatigueMul?: number;
    /** スパイクミスのうち、アウト／ネットに寄せる（アウト多め・ネットにかける） */
    attackMissSide?: 'out' | 'net';
  };
  /** 能力の上下で表せない独自の効果（金特のエースの風格） */
  special?: 'aceAura';
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

const SERVERS: AbilityKey[] = ['power', 'technique'];

const LIST: TraitDef[] = [
  // ================= 解禁 =================
  unlock('jumpFloat', 'ジャンフロ◯', 'jumpFloat'),
  unlock('spikeServe', 'スパイクサーブ◯', 'spikeServe'),
  unlock('backAttack', 'バックアタック', 'backAttack', ['OH', 'OP']),
  unlock('dump', 'ツーアタック', 'dump', ['S']),
  unlock('rebound', 'リバウンド', 'rebound', ['OH', 'OP', 'MB']),
  unlock('broad', 'ブロード', 'broad', ['MB']),

  // ================= 青：全プレー =================
  blue('clutch', '勝負強い', each('clutch', ALL5, 5)),
  blue('stable', '安定感', each('slump', ALL5, 3)),

  // ================= 青：サーブ =================
  blue('weakSnipe', '弱点狙撃', each('serveAim', ['technique'], 10)),
  blue('pinchServer', 'ピンチサーバー', each('pinchServe', SERVERS, 5)),
  blue('jumpFloatPro', 'ジャンフロ◎', each('serveJumpFloat', ['technique'], 10), { alsoUnlocks: 'jumpFloat' }),
  blue('spikeServePro', 'スパイクサーブ◎', each('serveSpike', ['power'], 10), { alsoUnlocks: 'spikeServe' }),
  blue('serveStreak', '連続サーブ', each('serveStreak', SERVERS, 5)),

  // ================= 青：攻撃 =================
  blue('straightHit', 'ストレート◯', each('attackStraight', ['power', 'technique'], 5)),
  blue('crossHit', 'クロス◯', each('attackCross', ['power', 'technique'], 5)),
  blue('feint', 'フェイント', each('tip', ['technique'], 10)),
  blue('blockOutHit', 'ブロックアウト', each('blockOut', ['technique'], 10)),
  blue('secondHit', '二段打ち', each('attackSecondary', ['power', 'technique'], 5)),
  blue('direct', 'ダイレクト', each('direct', ['power', 'technique'], 10)),

  // ================= 青：ブロック =================
  blue('courseRead', 'コース読み', each('blockRead', ['block'], 10)),
  blue('reaction', '反応', each('blockQuick', ['block', 'speed'], 10)),
  blue('oneTouch', 'ワンタッチ', each('blockTouch', ['block'], 10)),
  blue('killBlock', 'キルブロック', each('blockKill', ['block'], 10)),
  blue('blockFollow', 'ブロックフォロー', each('blockFollow', ['technique', 'speed'], 10)),

  // ================= 青：レシーブ =================
  blue('tipPick', 'フェイント拾い', each('digTip', ['technique', 'speed'], 10)),
  blue('receiveMaster', 'サーブレシーブ職人', each('serveReceive', ['technique'], 10)),
  blue('digger', 'ディグ', each('dig', ['technique'], 10)),
  blue('pancake', 'パンケーキ◯', each('dive', ['technique', 'speed'], 10)),
  blue('shakeOk', '揺れ球◯', each('receiveFloat', ['technique'], 10)),
  blue('softReceive', 'ソフトレシーブ', [...each('serveReceive', ['technique'], 5), ...each('dig', ['technique'], 5)]),

  // ================= 青：トス =================
  blue('secondSet', '二段トス◯', each('setSecondary', ['technique'], 10)),

  // ================= 青：セッター =================
  blue('tossMaster', 'トス回し', each('set', ['technique'], 5), { roles: ['S'] }),
  blue('combo', 'コンビ◯', each('setQuick', ['technique'], 10), { roles: ['S'] }),
  blue('setEye', '配球眼', each('setChoice', ['technique'], 10), { roles: ['S'] }),
  blue('backSetPro', 'バックトス◯', each('setBack', ['technique'], 10), { roles: ['S'] }),
  blue('badPassSet', '乱れ玉セット', each('setBadPass', ['technique'], 10), { roles: ['S'] }),
  blue('handling', 'ハンドリング◯', each('setSpin', ['technique'], 10), { roles: ['S'] }),

  // ================= 青：ミドル =================
  blue('quickHit', '速攻', each('attackQuick', ['speed', 'technique'], 5), { roles: ['MB'] }),
  blue('timeDiff', '時間差', each('attackTimeDiff', ['speed'], 10), { roles: ['MB'] }),
  blue('command', '号令', each('block', ['block'], 5, 'frontRow'), { roles: ['MB'] }),

  // ================= 青：リベロ =================
  blue('underToss', 'アンダートス', each('setSecondary', ['technique'], 10), { roles: ['L'] }),
  blue('defenseCore', '守備の要', [
    ...each('serveReceive', ['technique'], 5, 'backRow'), ...each('dig', ['technique'], 5, 'backRow'),
  ], { roles: ['L'] }),

  // ================= 赤 =================
  red('pressureWeak', 'プレッシャーに弱い', each('clutch', ALL5, -5)),
  red('moody', 'ムラっ気', [...each('goodForm', ALL5, 3), ...each('slump', ALL5, -3)]),
  red('serveMiss', 'サーブミス', each('serve', ['technique'], -5)),
  red('serveTossBad', 'サーブトス×', [...each('serveJumpFloat', ['technique'], -10), ...each('serveSpike', ['technique'], -10)]),
  red('badSetBad', '悪球打ち×', each('attackBadSet', ['power', 'technique'], -10)),
  red('outMany', 'アウト多め', each('attack', ['technique'], -5), { extra: { attackMissSide: 'out' } }),
  red('netMany', 'ネットにかける', each('attack', ['technique'], -5), { extra: { attackMissSide: 'net' } }),
  red('fastSetBad', '速いトス×', each('attackQuick', ['technique'], -10)),
  red('repeatBad', '連続トス×', each('attackRepeat', ['power', 'technique'], -5)),
  red('feintObvious', 'フェイント見え見え', each('tip', ['technique'], -10)),
  red('suckedIn', '吸い込まれ', each('blockKill', ['block'], -5)),
  red('blockOutWeak', 'ブロックアウトされやすい', each('blockOutGuard', ['block'], -10)),
  red('receiveBad', 'レシーブ苦手', [...each('serveReceive', ['technique'], -5), ...each('dig', ['technique'], -5)]),
  red('serveReceiveBad', 'サーブレシーブ×', each('serveReceive', ['technique'], -10)),
  red('hardBad', '強打レシーブ×', each('receiveHard', ['technique'], -10)),
  red('shakeWeak', '揺れ球×', each('receiveFloat', ['technique'], -10)),
  // 配球バレ：相手ブロッカーがトスを読む時に、相手のブロックが上がる（効く相手はプラスだが、持ち主にとってはマイナス）
  red('setTell', '配球バレ', each('blockRead', ['block'], 10, 'opponent')),
  red('backSetBad', 'バックトス×', each('setBack', ['technique'], -10)),
  red('badPassBad', '乱れ玉×', each('setBadPass', ['technique'], -10), { roles: ['S'] }),
  red('handlingBad', 'ハンドリング×', each('setSpin', ['technique'], -10), { roles: ['S'] }),

  // ================= その他 =================
  other_('brute', '力任せ', [...each('all', ['power'], 5), ...each('all', ['technique'], -5)]),
  other_('finesse', '技巧派', [...each('all', ['power'], -5), ...each('all', ['technique'], 5)]),
  other_('allOut', '全力', each('all', ALL5, 1), { extra: { fatigueMul: TRAIT_EXTRA.fatigueAllOut } }),
  other_('slacker', 'サボり屋', each('all', ALL5, -1), { extra: { fatigueMul: TRAIT_EXTRA.fatigueSlacker } }),

  // ================= 緑 =================
  style('aggressiveServe', '強気サーブ', 'serveRisk', 'aggressive'),
  style('safeServe', '安全サーブ', 'serveRisk', 'safe'),
  style('shortServe', 'ショート多め', 'serveLength', 'short'),
  style('longServe', 'ロング多め', 'serveLength', 'long'),
  style('personServe', '人狙い', 'serveTarget', 'person'),
  style('seamServe', 'つなぎ目狙い', 'serveTarget', 'seam'),
  style('straightPref', 'ストレート好み', 'course', 'straight'),
  style('crossPref', 'クロス好み', 'course', 'cross'),
  style('hardHitter', '強打志向', 'hitting', 'hard'),
  style('softHitter', '軟打志向', 'hitting', 'soft'),
  style('commitBlock', 'コミット寄り', 'blocking', 'commit'),
  style('readBlock', 'リード寄り', 'blocking', 'read'),
  style('activeDefense', '積極守備', 'defense', 'active'),
  style('passiveDefense', '消極守備', 'defense', 'passive'),
  style('overhandPass', 'オーバー派', 'receiving', 'overhand'),
  style('underhandPass', 'アンダー派', 'receiving', 'underhand'),
  style('aceSetter', 'エース頼み', 'setting', 'ace', ['S']),
  style('spreadSetter', '散らし好き', 'setting', 'spread', ['S']),

  // ================= 金（元の青から1段上。元の青と置き換わる） =================
  gold('magicBall', '魔球', 'jumpFloatPro', each('serveJumpFloat', ['technique'], 15), { alsoUnlocks: 'jumpFloat' }),
  gold('cannonServe', '大砲サーブ', 'spikeServePro', each('serveSpike', ['power'], 15), { alsoUnlocks: 'spikeServe' }),
  gold('ironWall', '鉄壁', 'killBlock', each('blockKill', ['block'], 15)),
  gold('readAll', '読み切り', 'courseRead', each('blockRead', ['block'], 15)),
  gold('guardian', '守護神', 'digger', each('dig', ['technique'], 15)),
  gold('perfectCut', '完璧カット', 'receiveMaster', each('serveReceive', ['technique'], 15)),
  gold('commander', '司令塔', 'setEye', each('setChoice', ['technique'], 15), { roles: ['S'] }),
  gold('godSpeed', '神速', 'quickHit', each('attackQuick', ['speed', 'technique'], 10), { roles: ['MB'] }),
  gold('showman', '千両役者', 'clutch', each('clutch', ALL5, 10)),
  // 独自：自分が決めると、チーム全体に小さな上乗せ（数ラリーで切れる。試合の側で扱う）
  gold('aceAura', 'エースの風格', undefined, [], { special: 'aceAura' }),
];

export const TRAITS: Record<string, TraitDef> = Object.fromEntries(LIST.map(d => [d.id, d]));

/** 選手が持つ特能の定義。金特を持っていれば、元の青は置き換わる（効かない） */
export function traitDefs(p: Player): TraitDef[] {
  const defs = p.traits.map(id => TRAITS[id]).filter((d): d is TraitDef => !!d);
  const replaced = new Set(defs.map(d => (d.kind === 'stat' ? d.upgradeOf : undefined)).filter(Boolean));
  return defs.filter(d => !replaced.has(d.id));
}

export function canDo(p: Player, action: UnlockAction): boolean {
  return p.traits.map(id => TRAITS[id]).some(d => !!d && ((d.kind === 'unlock' && d.unlocks === action) || (d.kind === 'stat' && d.alsoUnlocks === action)));
}

/** その特能（または、それを置き換えた金特）を持っているか */
export function hasTrait(p: Player, id: string): boolean {
  return traitDefs(p).some(d => d.id === id || (d.kind === 'stat' && d.upgradeOf === id));
}

export function styleOf<A extends StyleAxis>(p: Player, axis: A): StyleAxes[A] | undefined {
  const d = traitDefs(p).find(x => x.kind === 'style' && x.axis === axis) as StyleTrait<A> | undefined;
  return d?.value;
}

/** 定義が型の決まりを守っているか（段階が5段階のどれか、など） */
export function validateTrait(def: TraitDef): string[] {
  const errs: string[] = [];
  if (def.kind === 'stat') {
    if (!def.effects.length && !def.special) errs.push(`${def.id}: 効果がない`);
    for (const e of def.effects) {
      if (!TRAIT_STAGES.includes(Math.abs(e.delta) as Stage)) errs.push(`${def.id}: 段階 ${e.delta} は使えない`);
      // 赤はマイナスが主。ムラっ気のように好調の時だけ上がるもの（マイナスも持つ）と、相手に効くもの（配球バレ）は例外
      if (def.color === 'red' && e.delta > 0 && e.target !== 'opponent' && !def.effects.some(x => x.delta < 0)) errs.push(`${def.id}: 赤なのにプラスだけ`);
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

/**
 * その特能が効く位置（確認用の一覧と確認用の画面で、誰に持たせるかに使う）。
 * ポジション専用ならその位置。ほかは効く場面から決める
 */
export function defaultHolders(d: TraitDef): Role[] {
  if (d.roles) return d.roles;
  if (d.kind === 'style') {
    const a = d.axis;
    if (a.startsWith('serve')) return ['S', 'OH', 'MB', 'OP'];
    if (a === 'course' || a === 'hitting') return ['OH', 'OP', 'MB'];
    if (a === 'blocking') return ['MB', 'OH', 'OP'];
    if (a === 'defense' || a === 'receiving') return ['OH', 'L'];
    return ['S'];
  }
  if (d.kind === 'unlock') return d.unlocks === 'jumpFloat' || d.unlocks === 'spikeServe' ? ['S', 'OH', 'MB', 'OP'] : ['OH', 'OP'];
  // 相手に効くもの（配球バレ）は、トスを上げるセッター
  if (d.effects.some(e => e.target === 'opponent')) return ['S'];
  const scenes = new Set<Scene>(d.effects.map(e => e.scene));
  const has = (...xs: Scene[]) => xs.some(x => scenes.has(x));
  if (has('serve', 'serveAim', 'serveChoice', 'serveFloat', 'serveJumpFloat', 'serveSpike', 'serveStreak', 'pinchServe')) return ['S', 'OH', 'MB', 'OP'];
  if (has('serveReceive', 'receiveFloat', 'receiveHard', 'dig', 'digTip', 'dive', 'freeball', 'blockFollow')) return ['OH', 'L'];
  if (has('set', 'setChoice', 'setBadPass', 'setSpin', 'setQuick', 'setBack')) return ['S'];
  if (has('setSecondary')) return ['OH', 'OP', 'L'];
  if (has('block', 'blockRead', 'blockQuick', 'blockTouch', 'blockKill', 'blockOutGuard')) return ['MB', 'OH', 'OP'];
  if (has('attack', 'attackBadSet', 'attackQuick', 'attackSecondary', 'attackRepeat', 'attackStraight', 'attackCross',
    'attackTimeDiff', 'blockOut', 'tip', 'direct', 'cover')) return ['OH', 'OP', 'MB'];
  return ['S', 'OH', 'MB', 'OP', 'L']; // 全般
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
