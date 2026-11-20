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
  serveFlight: { float: 1.35, jumpFloat: 1.2, spike: 0.9 } as Record<ServeType, number>,
  passFlight: 1.1,
  passFlightPerOffset: 0.08,
  setFlight: { quick: 0.35, timeDiff: 0.7, fast: 0.55, high: 1.65, back: 0.95, broad: 0.6 } as Record<SetType, number>,
  secondarySetExtra: 0.2,
  /** トスの最高点が打点よりどれだけ上か（m） */
  setApexAbove: { quick: 0.25, timeDiff: 0.7, fast: 0.6, high: 3.0, back: 1.2, broad: 0.45 } as Record<SetType, number>,
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
  blockRise: 0.3,
  blockTotal: 0.65,
  endPause: 1.0,
};

// ---------------- サーブ ----------------
export const SERVE = {
  /** 基本のミス率（テクニック50の時）。テクニックで増減。これに、トスと助走で直しきれなかったずれによるミスが加わる */
  faultRate: { float: 0.042, jumpFloat: 0.058, spike: 0.111 } as Record<ServeType, number>,
  faultTechSlope: 0.01, // テクニック1あたり減る割合（50基準）
  /** 威力＝base＋各能力×係数（phys は男女の重みが掛かる部分） */
  pressure: {
    float: { base: 25.5, tech: 0.35, power: 0.05, jump: 0 },
    jumpFloat: { base: 31, tech: 0.3, power: 0.1, jump: 0.1 },
    spike: { base: 27, tech: 0.1, power: 0.45, jump: 0.2 },
  } as Record<ServeType, { base: number; tech: number; power: number; jump: number }>,
  /** 揺れ（レシーブのばらつきが増える） */
  shake: { float: 0.35, jumpFloat: 0.55, spike: 0 } as Record<ServeType, number>,
  targetU: [1.5, 8.6] as [number, number],
  targetV: [-4.2, 4.2],
  /** フローターを打つ位置（ネットからの距離） */
  serverU: 9.8,
  /** 狙いの判断：比べる候補の数 = 1 + テクニック/aimTechDiv */
  aimTechDiv: 30,
  /** 狙いのずれ（m）＝aimErrBase - テクニック×aimErrTech（下限0.25） */
  aimErrBase: 1.4,
  aimErrTech: 0.01,
};

// ---------------- サーブのトスと助走 ----------------
// 構える → サーブトスを上げる → 助走 → 踏み切り → 打つ。フローターは助走なしでその場で打つ。
export const SERVE_RUN = {
  /** 構えてからサーブトスを上げるまで（秒） */
  tossAt: 0.6,
  /** サーブトスを上げてから打つまで（秒）。スパイクサーブほど高く上げる */
  tossFlight: { float: 0.55, jumpFloat: 0.95, spike: 1.25 } as Record<ServeType, number>,
  /** トスの最高点が、打つ高さよりどれだけ上か（m） */
  tossApexAbove: { float: 0.5, jumpFloat: 1.2, spike: 2.0 } as Record<ServeType, number>,
  /** 踏み切る位置（ネットからの距離。エンドラインの後ろ） */
  takeoffU: 9.3,
  /** 助走の長さ（m）と時間（秒）。助走を始める位置＝踏み切る位置＋長さ */
  approachLen: { float: 0, jumpFloat: 1.5, spike: 2.6 } as Record<ServeType, number>,
  approachDur: { float: 0, jumpFloat: 0.55, spike: 0.8 } as Record<ServeType, number>,
  /** 空中で前へ流れる分（触る点は踏み切りより前） */
  drift: { float: 0, jumpFloat: 0.4, spike: 0.7 } as Record<ServeType, number>,
  /** 跳躍に対する跳ぶ高さの割合 */
  jumpRatio: { float: 0, jumpFloat: 0.5, spike: 0.9 } as Record<ServeType, number>,
  /** トスのずれ（m）の大きさ（テクニック50の時）＝ 正規乱数 × err × (techPivot − テクニック/100) */
  tossErr: { float: 0.1, jumpFloat: 0.25, spike: 0.4 } as Record<ServeType, number>,
  techPivot: 1.5,
  /** トスを見てから直せる時間（秒）。直す速さはスパイクの助走と同じ（スピード） */
  adjustTime: { float: 0.04, jumpFloat: 0.11, spike: 0.14 } as Record<ServeType, number>,
  /** 直す時間が十分あっても残るずれの割合 */
  minResidual: 0.3,
  /** 踏み切りのタイミングのずれ（秒）の大きさ（テクニック50、トスのずれ0の時） */
  timingSigma: { float: 0, jumpFloat: 0.04, spike: 0.05 } as Record<ServeType, number>,
  /** タイミングのずれ1秒を、位置のずれ何mに相当させるか */
  timingToMiss: 2.0,
  /** 直しきれなかったずれ1mあたり：威力の低下、ミス率の増加、狙いのずれの増加（m） */
  pressurePerMiss: 12,
  faultPerMiss: 0.25,
  aimPerMiss: 0.8,
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
  /** セッターがパスの落下点まで走って、最後に手を伸ばして届く追加の距離（m）。届かなければ他の選手が二段トス */
  setterLunge: 0.5,
  /** 攻撃の種類ごとの、使えるずれの上限 */
  maxOffset: { quick: 1.0, timeDiff: 0.8, fast: 2.0, high: 99, back: 1.5, broad: 0.9 } as Record<SetType, number>,
  /** トスのずれ（m）＝|N|×base×(1+offset×offsetK+spin×spinK)×(skillPivot - 技量/100) */
  errBase: 0.28,
  errOffsetK: 0.9,
  /** パスがネットから離れた距離1mあたり、打つ位置がネットから離れる量（m） */
  offNetCarry: 0.4,
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
    ace: { quick: 0.12, timeDiff: 0.04, fast: 0.14, high: 0.7, back: 0.1, broad: 0.04 },
    balance: { quick: 0.25, timeDiff: 0.1, fast: 0.3, high: 0.35, back: 0.12, broad: 0.1 },
    quick: { quick: 0.42, timeDiff: 0.25, fast: 0.2, high: 0.13, back: 0.08, broad: 0.2 },
  } as Record<AttackTactic, Record<SetType, number>>,
  /** 配球の判断：ブロックが薄そうな攻撃ほど選びやすくなる強さ（テクニック100で最大） */
  choiceK: 0.9,
  /** 配球の判断：アタッカーの助走の準備ができていない攻撃ほど避ける強さ（テクニック100で最大） */
  readyK: 1.5,
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
  /** 助走で直しきれなかったトスのずれ（m）1mあたりの攻撃力の罰 */
  missPenalty: 16,
  /** 速攻・時間差でスピードが足りない時の罰（quickSpeedPivot 基準、1あたり）。テンポの速い攻撃に求められる速さ */
  quickSpeedPivot: 65,
  quickSpeedPenalty: 0.3,
  /** 同じく、ミス率の増え方（1あたり） */
  quickSpeedErr: 0.004,
  errBase: 0.06,
  /** 直しきれなかったトスのずれ1mあたりのミス率の増え方 */
  errPerMiss: 0.12,
  errTechSlope: 0.0012,
  softErrRatio: 0.4,
  /** ダイレクトはトスに合わせて打つより難しい分の罰 */
  directPenalty: 6,
  /** 守る側が打球を読みにくい分の遅れ（秒）。トスが速いほど構え直す時間がない（オープンは0） */
  readDelay: { quick: 0.17, timeDiff: 0.14, fast: 0.12, high: 0, back: 0.06, broad: 0.14 } as Record<SetType, number>,
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
  /** コースを決めて打つ時、ストレート・クロスそれぞれの内側の端（|v|）。ここから外側を狙う */
  courseInnerV: -0.5,
  targetV: [-4.2, 4.2] as [number, number],
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
  killBase: 0.1,
  /** シャットの勝負で、打ち手のテクニック（ずらして当てる上手さ）が攻撃力に足される量 */
  killTech: 0.45,
  power: { base: 30, block: 0.5, height: 0.4, extra: 5 },
  /** ブロックアウトの確率（打ち手テクニック50の時） */
  blockOutBase: 0.12,
  /** ワンタッチの後、攻撃側に戻る割合（それ以外は守備側コートへ） */
  oneTouchBackChance: 0.25,
  oneTouchPressure: 0.45,
  /** シャットされたボールを味方が拾う確率 */
  coverChance: 0.16,
};

// ---------------- スパイクの助走 ----------------
// 助走を始める位置からの数歩で加速し、最後に踏み込んで沈み、踏み切る。
// 最高の打点は身長と跳躍だけで決まり、実際に跳ぶ高さは助走の長さで下がる。
export const APPROACH = {
  /** 助走を始める位置（ネットからの距離 m）。アタッカーは攻撃の準備でここへ下がる */
  startU: { wing: 4.0, middle: 2.6 },
  /** アウトサイド・オポジットは、打つレーンより外側（サイドライン寄り）から斜めに入る */
  wingOutside: 0.6,
  /** 十分な助走の長さ（m）。これより短いと跳ぶ高さが下がる */
  fullLen: { quick: 1.6, timeDiff: 1.6, fast: 2.6, high: 2.9, back: 2.6, broad: 2.4 } as Record<SetType, number>,
  /** 助走の平均の速さ（m/s）＝ base ＋ スピード × per */
  speedBase: 1.7,
  speedPer: 0.024,
  /** 助走なしで跳んだ時の跳び上がりの割合（十分な助走で1） */
  standingRatio: 0.75,
  /** 踏み切る位置：打つ点よりこれだけネットから離れた所で踏み切り、空中で前へ流れる */
  takeoffBack: 0.4,
  /** 平行はトスの少し前から助走を始める（秒） */
  fastLead: 0.85,
  /** 助走の途中で踏み切る位置を直す速さ（m/s）＝ base ＋ スピード × per */
  adjustBase: 1.4,
  adjustPer: 0.02,
  /** 直す時間が十分あっても残るずれの割合 */
  minResidual: 0.3,
  /** 踏み切りのタイミングのずれ（秒）＝ 正規乱数 × sigma × (pivot − テクニック/100)。トスのずれが大きいほど増える */
  timingSigma: 0.06,
  timingTechPivot: 1.5,
  timingPerSetError: 0.5,
  /** 空中のこの割合より前・後で触ると、強打できない（頂点は0.5） */
  minAirPhase: 0.08,
  /** ネットよりこれだけ高く触れないと強打できない（cm） */
  minOverNetCm: 15,
  /** 時間差：打つミドルが速いほど、速攻のフェイクが本物らしく見えて相手が跳ばされやすい（スピード50基準、1あたり） */
  fakeSpeedSlope: 0.004,
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
  /** ネット際から跳ぶので助走は短い（十分な助走に対する割合） */
  approachQ: 0.4,
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

// ---------------- スパイクのフォロー（味方が打つ時に寄る位置） ----------------
export const COVER = {
  /** アタッカーの打つ点から見た [距離 m, 角度°]（0°＝ネットから離れる向き）。近い順に埋める */
  slots: [[1.4, -50], [1.4, 50], [2.8, -70], [2.8, 0], [2.8, 70]] as [number, number][],
  minU: 0.8,
  maxU: 8.5,
};

// ---------------- 記録の書き方（結果には影響しない） ----------------
export const RECORD = {
  /** レシーブ・ディグで、触る点から体の立ち位置をずらす距離（腕の長さ分） */
  standOffset: 0.5,
  /** 飛びつきの時（体が前に倒れ込むので長め） */
  diveStandOffset: 0.9,
  /** 立ち位置はネットからこの距離より手前にしない */
  minU: 0.3,
  /**
   * 片手で打つ時（スパイク・サーブ・ツーアタック）、ボールは打つ腕の側の肩の上で打つ。
   * 記録の体の位置を、打つ腕と反対側へこれだけずらす（m）。判定の位置は変えない
   */
  hitSide: 0.22,
  /** トス：ボールは額の上の少し前で触る。記録の体の位置を、トスを上げる向きと反対へずらす（m） */
  setBehind: 0.12,
  /** ブロック：手はネットの上へ少し突き出す。手の位置（ネットからの距離 m） */
  blockHandsU: 0.12,
};

/** 安全のための打数の上限（無限ラリー防止） */
export const MAX_CONTACTS = 60;

// ---------------- 1セットの進行（仕様「試合の采配」） ----------------
export const MATCH = {
  /** セットの点数（最終セットは15点）。2点差がつくまで続く */
  setPoints: 25,
  finalSetPoints: 15,
  winBy: 2,
  /** 1セットのタイムアウトと交代の回数 */
  timeouts: 2,
  substitutions: 6,
  /** タイムアウトの効果が続くラリー数 */
  timeoutRallies: 5,
  /** 定期の停止（どちらかの点数がこの点に達した時。0は試合開始時） */
  periodicStops: [0, 10, 20],
  /** 最終セットの定期の停止（8点はコートチェンジと同時） */
  finalPeriodicStops: [0, 8],
  finalCourtChange: 8,
  /** 連続失点での停止：点数帯（両チームの高い方）ごとの、止まる連続失点 */
  streakStops: [
    { from: 0, streak: 4 }, { from: 10, streak: 3 }, { from: 20, streak: 2 },
  ],
  finalStreakStops: [
    { from: 0, streak: 3 }, { from: 8, streak: 2 },
  ],
  /** 自チームがこれ以上リードしている時は、止まる連続失点を1つ増やす */
  leadForLooserStop: 5,
  /** 何セット先取で勝ちか（3セットマッチ・5セットマッチ） */
  setsToWin: { 3: 2, 5: 3 } as Record<3 | 5, number>,
};

// ---------------- 疲れ（スタミナ） ----------------
export const FATIGUE = {
  /** 1ラリーの負荷1あたりの疲れ＝ perLoad × (pivot − スタミナ/100) */
  perLoad: 0.006,
  pivot: 1.5,
  /** ベンチにいる選手は1ラリーごとにこれだけ回復する */
  benchRecover: 0.01,
  /** セットの間に全員がこれだけ回復する（疲れは次のセットに持ち越す） */
  setBreakRecover: 0.08,
  /** 停止画面で「足が止まってきた」と出す疲れ */
  tiredNote: 0.45,
};

/** ポジション適性（4段階：0＝－ほぼできない、1＝△不慣れ、2＝○こなせる、3＝◎本職） */
export const APTITUDE = {
  /** 段階ごとの効きの割合（－・△・○・◎） */
  factor: [0.6, 0.75, 0.9, 1.0],
  /** その位置で1セット出るとたまる経験 */
  expPerSet: 1,
  /** 次の段階に上がるのに要る経験（－→△、△→○、○→◎）。ゆっくり上がる */
  expToNext: [20, 40, 80],
};

/** 能力（身長以外）の範囲。練習で伸びるのは上限まで（全員100まで伸びる） */
export const ABILITY = { min: 1, max: 100 };

/** 信頼度（見えない値 0〜100）。試合に出るほど上がり、試合中だけ全能力が上がる */
export const TRUST = {
  max: 100,
  /** 1セット出るごとに上がる量 */
  perSet: 1,
  /** この値以上で全能力にこの段階を足す（特能と同じ5段階の値）。高い方から見る */
  bonus: [{ at: 80, delta: 3 }, { at: 40, delta: 1 }] as { at: number; delta: 1 | 3 | 5 | 10 | 15 }[],
};

/** 身長の伸びしろ（cm）。男子：ほとんど0〜3、たまに5〜8、まれに10〜15。女子は scale を掛けて小さめ */
export const HEIGHT_GROWTH = {
  bands: [
    { w: 85, min: 0, max: 3 },
    { w: 12, min: 5, max: 8 },
    { w: 3, min: 10, max: 15 },
  ],
  scale: { male: 1, female: 0.6 } as Record<Gender, number>,
};

/** 見た目の候補の数（描画側が色や形に直す） */
export const LOOKS = { hairStyles: 4, hairColors: 3, skins: 3 };

/** 左利きの割合 */
export const LEFT_HANDED_RATE = 0.1;

/** 緑（行動の傾向）の効き。5段階の対象外で、緑ごとにここで決める */
export const STYLE = {
  /** 強気サーブ／安全サーブ：ミスの率の倍率と、サーブの強さ（レシーブへの圧）の増減 */
  serveRisk: {
    aggressive: { fault: 1.5, pressure: 5 },
    safe: { fault: 0.55, pressure: -5 },
  },
  /** ショート多め／ロング多め：サーブの狙う深さ（u の範囲） */
  serveLength: { short: [1.5, 5.0], long: [5.5, 8.6] } as Record<'short' | 'long', [number, number]>,
  /** ショートはネットにかけやすい（ミスの率の倍率）。ロングは深く押し込む分、強さが少し増える */
  serveLengthFault: { short: 1.15, long: 1 },
  serveLengthPressure: { short: 0, long: 3 },
  /** 人狙い：一番レシーブの弱い選手の正面を狙う。つなぎ目狙い：選手と選手の間を強く狙う（候補を増やす） */
  seamExtraCandidates: 2,
  /** スパイクのコース：ストレートに打つ割合（好みなし・ストレート好み・クロス好み）。サイドから打つ時だけ */
  straightShare: { none: 0.4, straight: 0.7, cross: 0.15 },
  /**
   * コースごとの性質。ストレートはサイドライン際でアウトしやすく、ブロックの外の手で止められやすい。
   * ブロックが強いほど止められ、弱い・遅れたブロックは抜きやすい（ブロックの弱い相手に得）。
   * クロスはコートが長く入りやすい（ブロックの強い相手に得）。
   * 触る判定の壁の倍率＝（ブロック能力/blockPivot）^blockPow（間に合っていなければ × lateK）
   */
  course: {
    straight: { err: 1.2, blockPivot: 50, blockPow: 1.5, lateK: 0.7 },
    cross: { err: 0.88, blockPivot: 50, blockPow: 0, lateK: 1 },
  },
  /** ストレートのアウトしやすさの男女の重み（女子は打球が遅くクロスが拾われやすい分、ストレートが得になりすぎるため） */
  straightErrK: { male: 1, female: 1.6 } as Record<Gender, number>,
  /** クロスはコートが長い分、思い切り打てる（打球の強さの倍率）。女子は打球が遅く拾われやすいので重みを大きく */
  crossPower: { male: 1.0, female: 1.15 } as Record<Gender, number>,
  /** サイドから打つとみなすレーンの |v| */
  sideLaneV: 1.5,
  /** コース読み：相手アタッカーのコースの好みが当たると、ブロックの壁がこの倍率で厚くなる */
  courseReadWall: 1.3,
  /** 強打志向／軟打志向：軟打に切り替える割合の倍率 */
  softRate: { hard: 0.65, soft: 1.3 },
  /** 強打志向の軟打の減らし方の男女の重み（女子は強打志向が得になりすぎるため、1に近づける割合） */
  hardSoftRateK: { male: 1, female: 0.5 } as Record<Gender, number>,
  /** 軟打志向は軟打の落とし所がうまい（この割合で、狙いの候補を1つ増やす）。女子は軟打の質が効くので大きく */
  softTipExtraChance: { male: 0.5, female: 1 } as Record<Gender, number>,
  /**
   * コミット寄り／リード寄り：時間差のフェイクに掛かる割合の倍率と、反応の早さ（秒、マイナスほど早い）。
   * コミットは速攻に早いがサイドに遅れる（速攻の多い相手に得）。リードはその逆（エース中心の相手に得）
   */
  blocking: {
    commit: { bite: 1.5, quickReact: -0.06, sideReact: 0.08 },
    read: { bite: 0.6, quickReact: 0.03, sideReact: -0.07 },
  },
  /**
   * 積極守備／消極守備：届く距離（m）、打球の強さに比例した技量の増減（強さ1あたり）、ばらつきの倍率。
   * 積極は届く範囲が広いが強打を弾きやすい（フェイントの多い相手に得）。消極は範囲が狭いが強打も確実に上げる（強打の多い相手に得）
   */
  defense: {
    active: { reach: 0.3, skillPerPressure: -0.12, noise: 1.2 },
    passive: { reach: -0.2, skillPerPressure: 0.12, noise: 0.8 },
  },
  /** 届く距離の増減の男女の重み（女子は軟打が多く、届く範囲の差が効きすぎるため小さくする） */
  defenseReachK: { male: 1, female: 0.5 } as Record<Gender, number>,
  /** オーバー派／アンダー派：サーブレシーブの技量の増減（揺れるサーブ・強いサーブ） */
  receiving: {
    overhand: { float: 6, hard: -6 },
    underhand: { float: -3, hard: 3 },
  },
  /** エース頼み／散らし好き：エースに集める割合の倍率（散らし好きは均等に寄せる） */
  setting: { aceMul: 1.3, aceMax: 0.9, spreadMix: 0.5 },
};

/** 特能の 5段階で表せない効き（相談して決めたもの） */
export const TRAIT_EXTRA = {
  /** スパイクミスのうちネットにかかる割合（ふつうは0.45）。アウト多め／ネットにかける */
  attackMissNet: { normal: 0.45, out: 0.2, net: 0.75 },
  /** 疲れのたまり方の倍率：全力／サボり屋 */
  fatigueAllOut: 1.3,
  fatigueSlacker: 0.7,
};

/** サーブの選び方：持っているサーブ（フローターは全員）から、見積もりで選ぶ。判断はテクニック（場面 serveChoice） */
export const SERVE_CHOICE = {
  /** パスが良い時・悪い時のサイドアウトの目安（見積もり用） */
  sideoutGood: 0.62,
  sideoutBad: 0.42,
  /** 見積もりのぶれ＝ noise ×（pivot − 判断/100）。テクニックが低いほどぶれる */
  noise: 0.01,
  pivot: 1.4,
  /** 緑：強気サーブはミスを軽く、安全サーブは重く見る（ミスの見積もりに掛ける） */
  faultWeight: { aggressive: 0.7, safe: 1.4 },
};

/** 金特「エースの風格」：持ち主が決めると、チーム全体の全能力にこの段階を足す（ラリー数で切れる） */
export const ACE_AURA = { delta: 1 as const, rallies: 3 };

/** バックアタック（解禁型）：後衛のアウトサイド・オポジットが、アタックラインの後ろから踏み切って打つ */
export const BACK_ATTACK = {
  /** 打つ点のネットからの距離（踏み切りはこれより takeoffBack だけ後ろ。アタックライン3mより後ろ） */
  hitU: 2.9,
  /** 踏み切りの位置の下限（アタックラインを踏まない） */
  minTakeoffU: 3.1,
  /** 助走を始める位置（ネットからの距離） */
  startU: 6.0,
  /** レーン：アウトサイドはコートの真ん中（パイプ）、オポジットはライト側 */
  laneOH: 0.6,
  laneOP: -2.8,
  /** トスより少し前から助走を始める（秒） */
  lead: 0.5,
  /** 回転をかけて弧を描く分、強打できるかの判定でこれだけネットに近い所から打つとみなす（m） */
  arcU: 2.3,
  /** 遠くから打つ分、打球の強さが下がる割合 */
  powerRatio: 0.9,
  /** ネットから離れて打つので、ブロックの手に当たりにくい（触る判定の壁の倍率） */
  wallRatio: 0.6,
};

/** ツーアタック（解禁型）：前衛のセッターが、パスが良い時に2本目を片手で相手コートに落とす */
export const DUMP = {
  /** パスのずれがこれ以下の時だけ */
  maxOffset: 0.8,
  /** 条件を満たした時にツーアタックを選ぶ割合（判断＝テクニック50で） */
  rate: 0.1,
  /** 小さく跳ぶ高さ（m） */
  jumpM: 0.3,
  /** 落とす所（相手コートのネットからの距離） */
  targetU: [0.5, 3.0] as [number, number],
  flight: 0.55,
  /** 相手はトスだと思って構えているので、読むのが遅れる（秒） */
  readDelay: 0.2,
  pressure: 15,
  /** セッターの正面（この距離以内）にいる相手の前衛は、ブロックで止めることがある（ブロック能力50でこの確率） */
  blockRange: 1.5,
  blockChance: 0.15,
};

/** リバウンド（解禁型）：ブロックの壁が厚い時、わざと軟らかくブロックに当てて自分のコートに戻し、攻撃をやり直す */
export const REBOUND = {
  /** 軟打を選んだ時、壁がこれ以上厚ければリバウンドを狙う */
  minWall: 0.5,
  rate: 0.6,
  /** うまく当てて拾いやすいボールにできる確率＝ okBase ＋（テクニック−50）× okTech */
  okBase: 0.75,
  okTech: 0.006,
  /** 戻ってくるボールの落ちる所（自分のコートのネットからの距離）と、飛んでいる時間・強さ */
  landU: [1.0, 3.0] as [number, number],
  flight: 0.8,
  pressure: 8,
};

/** ブロード（解禁型）：ミドルがセッターの後ろへ横に走り、片足で踏み切って空中で横に流れて打つ移動攻撃 */
export const BROAD = {
  /** 打つレーン（攻撃側の自コートの v。セッターの後ろ、ライト寄り） */
  lane: -2.7,
  /** 踏み切る位置：打つ点よりコートの中央寄り（v）に、ネットから少し離れて */
  driftV: 1.0,
  takeoffBackU: 0.25,
  /** 空中で横に流れる時間（ジャンプ全体に対する割合） */
  driftDurRatio: 0.55,
};

/**
 * 攻撃を終えた側が守備の持ち場へ集まり始める時刻。ボールがネットを越えた時点（打った時刻からの秒）。
 * 返球・つなぎ（ゆっくり飛ぶボール）は、飛んでいる時間のこの割合でネットを越える
 */
export const DEFENSE_RETURN = { fastCross: 0.08, slowCrossRatio: 0.45 };

/** リベロ：フロントゾーンで2本目を上げる時はアンダーハンド（公式ルール）。精度が少し落ち、触る高さは腰の前 */
export const LIBERO = { underhandErr: 1.15, underhandZ: 0.8 };

/** 相手チームの采配（監督の判断）。学校ごとの采配の上手さの差は第3段階で */
export const COACH = {
  /** 終盤（この点数以降）で、この点差以上負けていて、そのセットでまだ取っていなければタイムアウト */
  lateFrom: { normal: 20, final: 10 },
  lateBehind: 2,
  /** この点差以上リードしている時はタイムアウトを取らない */
  noTimeoutLead: 5,
  /** 判断に使う、直近の失点の数（タイムアウトの時）と、セットを落とした時に振り返る失点の数 */
  recentLost: 6,
  setReviewLost: 10,
  /** 同じ選手にこの回数以上決められたら「エースに決められている」 */
  sameScorer: 2,
  /** 速攻・フェイントにこの回数以上決められたら方針を変える */
  quickKills: 2,
  tipKills: 2,
  /** 疲れがこれ以上の先発は控えと交代し、この値まで回復したら先発に戻す */
  fatigueSub: 0.45,
  fatigueReturn: 0.25,
  /** ピンチサーバー：サーブの強さの目安がこれだけ上の控えがいれば、終盤にサーブの間だけ入れる */
  pinchMargin: 8,
  /**
   * 相手が取られ方に合わせて方針を変えるか。今の計算では、方針を変えるとかえって弱くなる
   * （相手への対策の効きより、自分たちに合った方針から外れる損の方が大きい）ので、いったん止めている
   */
  changeTactics: false,
};
