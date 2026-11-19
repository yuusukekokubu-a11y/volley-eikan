// 試合計算の調整用の数値。試作で変える前提なので、計算式の係数はここに集める。
// 長さはメートル（打点・到達点のみ cm）、時間は秒、能力は 0〜100。

import type { AttackTactic, Gender, ServeType, SetType } from './types';

// ---------------- コート ----------------
export const COURT = {
  halfLength: 9,
  halfWidth: 4.5,
  attackLine: 3,
  /** ネットの高さ（m）。高校男子2.40、高校女子2.20 */
  netHeight: { male: 2.4, female: 2.2 } as Record<Gender, number>,
};

// ---------------- 男女の重み ----------------
// 能力値は同じ尺度のまま、試合計算で「どれだけ効くか」を変える。
export const GENDER_WEIGHTS: Record<Gender, { physical: number; skill: number; tactic: number }> = {
  male: { physical: 1.0, skill: 1.0, tactic: 1.0 },
  female: { physical: 0.75, skill: 1.35, tactic: 1.4 },
};

// ---------------- 体と能力 ----------------
export const BODY = {
  /** 指高（立った状態で手が届く高さ）＝身長×この値 */
  standingReachRatio: 1.33,
  /** 跳躍0→最低の跳び上がり（cm）、跳躍100→最高 */
  jumpMinCm: 45,
  jumpMaxCm: 100,
  /** ブロックは助走がないので跳び上がりがこの割合になる */
  blockJumpRatio: 0.78,
  /** 調子1段階あたりの能力の増減（割合） */
  conditionStep: 0.04,
  /** 疲れ1.0の時の能力低下（割合） */
  fatigueMaxDrop: 0.15,
  /** ポジション適性0の時の効き（適性100で1.0） */
  aptitudeMin: 0.6,
  /** 走る速さ（m/s）：スピード0→min、100→max */
  runSpeedMin: 3.0,
  runSpeedMax: 6.0,
  /** 横移動（ブロック）の速さ */
  sideSpeedMin: 2.0,
  sideSpeedMax: 4.5,
  /** 打球を読んで動き出すまでの時間：テクニック0→readMax、100→readMin（下限 readFloor） */
  readMax: 0.36,
  readMin: 0.08,
  readFloor: 0.05,
  /** 飛びつきで届く追加の距離 */
  lunge: 1.0,
  /** 跳んで着地した後、次に動き出せるまでの時間 */
  landingRecovery: 0.45,
};

// ---------------- 基本の配置（自コート基準 u=ネットからの距離, v=自分から見て左が＋） ----------------
export const SET_TARGET = { u: 0.7, v: -0.8 };

export const LANE_V = {
  left: 3.6,     // レフト（OH）
  right: -3.6,   // ライト（OP）
  quick: -0.1,   // 速攻（セッターのすぐ前）
  timeDiff: 0.9, // 時間差
};
export const HIT_U = 0.6;

export const BLOCK_BASE_V = {
  bunch: { left: 1.0, mid: 0, right: -1.0 },
  spread: { left: 3.0, mid: 0, right: -3.0 },
  dedicate: { left: 2.2, mid: 0, right: -2.2, shift: 1.2 },
};

export const DEFENSE_POS = {
  back: { right: { u: 6.8, v: -3.6 }, mid: { u: 8.0, v: 0 }, left: { u: 6.8, v: 3.6 } },
  front: { right: { u: 5.6, v: -3.4 }, mid: { u: 4.6, v: 0 }, left: { u: 5.6, v: 3.4 } },
  /** ブロックに跳ばない前衛はここまで下がる */
  offBlockerU: 3.2,
};

export const RECEIVE_FORMATION = {
  u: 6.0, spread3: [-3, 0, 3], spread2: [-2.2, 2.2],
  /** 後衛のセッターがサーブレシーブの時に立つ位置（ネットからの距離） */
  backSetterU: 5.0,
};

// ---------------- 時間 ----------------
export const TIMING = {
  serveContact: 0.9,
  serveFlight: { float: 1.35, jumpFloat: 1.2, spike: 0.9 } as Record<ServeType, number>,
  passFlight: 1.1,
  passFlightPerOffset: 0.08,
  setFlight: { quick: 0.35, timeDiff: 0.7, fast: 0.55, high: 1.35 } as Record<SetType, number>,
  secondarySetExtra: 0.2,
  /** トスの最高点が打点よりどれだけ上か（m） */
  setApexAbove: { quick: 0.25, timeDiff: 0.7, fast: 0.6, high: 3.0 } as Record<SetType, number>,
  tipFlight: 0.95,
  freeballFlight: 1.5,
  overpassFlight: 1.2,
  oneTouchFlight: 1.0,
  blockReboundFlight: 0.45,
  /** スパイクのボールの速さ（m/s）＝base＋パワー（男女の重みあり）×perPower */
  spikeSpeedBase: 6,
  spikeSpeedPerPower: 0.3,
  jumpRise: 0.35,
  jumpTotal: 0.75,
  /** スパイクの助走の長さ（動き出しから踏み切りの着地まで）。記録の見た目だけで結果には影響しない */
  approach: 1.05,
  blockRise: 0.3,
  blockTotal: 0.65,
  endPause: 1.0,
};

// ---------------- サーブ ----------------
export const SERVE = {
  /** 基本のミス率（テクニック50の時）。テクニックで増減 */
  faultRate: { float: 0.05, jumpFloat: 0.09, spike: 0.17 } as Record<ServeType, number>,
  faultTechSlope: 0.01, // テクニック1あたり減る割合（50基準）
  /** 威力＝base＋各能力×係数（phys は男女の重みが掛かる部分） */
  pressure: {
    float: { base: 25, tech: 0.35, power: 0.05, jump: 0 },
    jumpFloat: { base: 30, tech: 0.3, power: 0.1, jump: 0.1 },
    spike: { base: 25, tech: 0.1, power: 0.45, jump: 0.2 },
  } as Record<ServeType, { base: number; tech: number; power: number; jump: number }>,
  /** 揺れ（レシーブのばらつきが増える） */
  shake: { float: 0.35, jumpFloat: 0.55, spike: 0 } as Record<ServeType, number>,
  targetU: [1.5, 8.6],
  targetV: [-4.2, 4.2],
  serverU: 9.8,
  /** 狙いの判断：比べる候補の数 = 1 + テクニック/aimTechDiv */
  aimTechDiv: 30,
  /** 狙いのずれ（m）＝aimErrBase - テクニック×aimErrTech（下限0.25） */
  aimErrBase: 1.4,
  aimErrTech: 0.01,
};

// ---------------- レシーブ・ディグ（1本目） ----------------
export const PASS = {
  /** 質の計算 z = (技量 - 威力)/scale + base + ばらつき。質 p = sigmoid(z) */
  scale: 18,
  base: { serve: -0.3, spike: -1.3, tip: 1.2, oneTouch: 0.6, freeball: 2.4, overpass: 2.0, cover: 0 },
  noise: 1.2,
  /** p がこれ未満ならボールを上げられない */
  failBelow: 0.1,
  /** 位置のずれ＝maxOffset×(1-p)^offsetPow×ランダム */
  maxOffset: 4.5,
  offsetPow: 2.0,
  /** 回転・勢い＝威力/100×(1-p)×spinScale */
  spinScale: 1.4,
  /** ずれがこれ以上で、相手コートへ返ってしまうことがある */
  overpassOffset: 3.8,
  overpassChance: 0.5,
  /** これ以上の威力のサーブ・強打を受ける時は場面 receiveHard */
  hardPressure: 60,
  /** 技量＝テクニック×tech（skill重み）＋スピード×speed（phys重み）＋base */
  skill: { base: 15, tech: 0.75, speed: 0.15 },
  contactZ: { receive: 0.8, dig: 0.5, dive: 0.25 },
};

// ---------------- トス ----------------
export const SET = {
  /** セッターが届くずれの上限。超えたら他の選手が二段トス */
  setterReach: 3.5,
  /** 攻撃の種類ごとの、使えるずれの上限 */
  maxOffset: { quick: 1.0, timeDiff: 0.8, fast: 2.0, high: 99 } as Record<SetType, number>,
  /** トスのずれ（m）＝|N|×base×(1+offset×offsetK+spin×spinK)×(skillPivot - 技量/100) */
  errBase: 0.28,
  errOffsetK: 0.35,
  errSpinK: 0.8,
  skillPivot: 1.6,
  /** セッター以外が上げる時の技量の掛け率 */
  secondarySkill: 0.6,
  /** 回転・勢いがこれ以上のパスからのトスは場面 setSpin */
  spinScene: 0.4,
  /** これ以上ずれると打てない（つなぎで返す） */
  unhittable: 1.6,
  /** これ以上ずれるとトスミス（ボールが続かない） */
  setFault: 3.2,
  /** 作戦ごとの攻撃の種類の重み */
  tacticWeights: {
    ace: { quick: 0.12, timeDiff: 0.04, fast: 0.14, high: 0.7 },
    balance: { quick: 0.25, timeDiff: 0.1, fast: 0.3, high: 0.35 },
    quick: { quick: 0.42, timeDiff: 0.25, fast: 0.2, high: 0.13 },
  } as Record<AttackTactic, Record<SetType, number>>,
  /** 配球の判断：ブロックが薄そうな攻撃ほど選びやすくなる強さ（テクニック100で最大） */
  choiceK: 0.9,
  /** サイドへのトスがエースに行く確率 */
  aceShare: { ace: 0.85, balance: 0.55, quick: 0.5 } as Record<AttackTactic, number>,
};

// ---------------- スパイク ----------------
export const ATTACK = {
  /** 攻撃力 = power×power(phys) + tech×tech(skill) + (打点-ネット)cm×height(phys) - ずれの罰 */
  power: 0.5,
  tech: 0.3,
  height: 0.25,
  /** トスのずれ1mあたりの罰（攻撃の種類で速いほど大きい） */
  tempoPenalty: { quick: 20, timeDiff: 15, fast: 10, high: 8 } as Record<SetType, number>,
  /** 速攻・時間差でスピードが足りない時の罰（quickSpeedPivot 基準、1あたり） */
  quickSpeedPivot: 65,
  quickSpeedPenalty: 0.3,
  /** 同じく、ミス率の増え方（1あたり） */
  quickSpeedErr: 0.004,
  errBase: 0.06,
  errPerSetError: 0.12,
  errTechSlope: 0.0012,
  softErrRatio: 0.4,
  /** ダイレクトはトスに合わせて打つより難しい分の罰 */
  directPenalty: 6,
  /** 軟打・フェイントを選ぶ確率 */
  softBase: 0.08,
  softBadSet: 0.3,
  softBadSetFrom: 0.9,
  /** ブロックの壁を読んで軟打に切り替える強さ：+ softRead × min(壁, softReadWallMax) × テクニック/100 */
  softRead: 0.22,
  softReadWallMax: 1.2,
  /** 軟打の攻撃力の割合 */
  softPowerRatio: 0.35,
  /** ネットを越えるために必要な余裕（m） */
  netClearance: 0.12,
  /** 打ち分け：狙いの候補数 = 1 + テクニック/aimTechDiv */
  aimTechDiv: 35,
  /** 狙いのずれ（m）＝aimErrBase - テクニック×aimErrTech */
  aimErrBase: 1.0,
  aimErrTech: 0.006,
  hardTargetU: [2.0, 8.6] as [number, number],
  tipTargetU: [0.5, 3.2] as [number, number],
  targetV: [-4.2, 4.2],
};

// ---------------- ブロック ----------------
export const BLOCK = {
  /** ブロックの上から打ち抜いたとみなす差（cm） */
  overMarginCm: 30,
  /** 間に合わなさ（秒）がこれ以上なら跳べない */
  lateLimit: 0.3,
  latePenalty: 0.8,
  readExtra: 0.1,
  spotSpacing: 0.7,
  maxBlockers: 3,
  /** ブロックの読み：トスを見て動き出すまでの時間（ブロック0→max、100→min） */
  readReactionMax: 0.32,
  readReactionMin: 0.12,
  /** 時間差のフェイクに跳んでしまう確率（ブロック50の時）。読みが良いほど減る */
  timeDiffBite: 0.45,
  biteReadSlope: 0.006,
  /** 壁の強さ W = Σ 間に合い×(ブロック/100)×高さ係数。触る確率 = 1-exp(-W×touchK) */
  touchK: 1.3,
  heightFactorDivCm: 50,
  /** 打ち手のテクニックで触られにくくなる */
  touchTechPivot: 1.45,
  touchTechDiv: 110,
  /** 触った時：シャット確率 = sigmoid((ブロック力-攻撃力)/killScale + killBase) */
  killScale: 12,
  killBase: 0.65,
  /** シャットの勝負で、打ち手のテクニック（ずらして当てる上手さ）が攻撃力に足される量 */
  killTech: 0.45,
  power: { base: 30, block: 0.5, height: 0.4, extra: 5 },
  /** ブロックアウトの確率（打ち手テクニック50の時） */
  blockOutBase: 0.12,
  /** ワンタッチの後、攻撃側に戻る割合（それ以外は守備側コートへ） */
  oneTouchBackChance: 0.25,
  oneTouchPressure: 0.45,
  /** シャットされたボールを味方が拾う確率 */
  coverChance: 0.18,
};

// ---------------- ダイレクト（相手の返球を直接打つ） ----------------
export const DIRECT = {
  /** ネットからこの距離以内に返ってきたボールを打てる */
  maxU: 1.5,
  /** 返ってくるボールの着地点の範囲（ネットからの距離） */
  overpassU: [0.3, 4.5] as [number, number],
  /** トスほど合わせられないので、トスのずれに相当する値（m）の上限 */
  maxError: 0.7,
  /** 相手ブロックが反応できる時間 */
  blockTime: 0.3,
};

// ---------------- 作戦が合っている時の補正 ----------------
export const TACTIC_FIT = {
  /** レシーブ前寄りでフェイント、後ろ寄りで強打を拾う時の技量補正 */
  receiveMatch: 10,
  receiveMismatch: -4,
};

// ---------------- 負荷（疲れの元） ----------------
export const LOAD = {
  jump: 1,
  dig: 0.5,
  set: 0.3,
  perMeter: 0.05,
};

// ---------------- 記録の書き方（結果には影響しない） ----------------
export const RECORD = {
  /** レシーブ・ディグで、触る点から体の立ち位置をずらす距離（腕の長さ分） */
  standOffset: 0.5,
  /** 飛びつきの時（体が前に倒れ込むので長め） */
  diveStandOffset: 0.9,
  /** 立ち位置はネットからこの距離より手前にしない */
  minU: 0.3,
};

/** 安全のための打数の上限（無限ラリー防止） */
export const MAX_CONTACTS = 60;
