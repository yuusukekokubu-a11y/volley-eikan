// 育成（双六）の数値。仕様の「案」や数値は試作で調整する前提なので、ここにまとめる。

import type { PanelKind } from './board';

/** 1年は4月1日から3月31日まで（1マス＝1日） */
export const YEAR_START = { month: 4, day: 1 };
export const DAYS_IN_YEAR = 365;

/** 進行カード：手札の枚数と、進む日数の範囲 */
export const HAND = { size: 5, minDays: 1, maxDays: 5 };

/**
 * パネルの出やすさ（色のパネルの重み）。月ごとに変えられる（今は1年同じ）。
 * 青＝いいイベント、赤＝悪いイベント、白＝ランダムなイベント、緑＝体力の回復、黄＝練習の進行カードで止まると経験値が増える、特訓
 */
export const PANEL_WEIGHTS: Record<'default', Partial<Record<PanelKind, number>>> = {
  default: { blue: 22, red: 14, white: 26, green: 14, yellow: 18, training: 6 },
};

/** ルート分岐：分かれ道が出る割合（1日あたり）と、分かれている日数 */
export const BRANCH = { chance: 0.03, minDays: 3, maxDays: 6 };

/** 育成用の体力（0〜100） */
export const ENERGY = {
  max: 100,
  /** 練習1日あたりに減る量 */
  perPracticeDay: 4,
  /** 緑パネルで回復する量、休み1日で回復する量 */
  green: 25,
  rest: 15,
  /**
   * 体力が低いほど練習の伸びが落ちる：体力が lowFrom より低いと、経験 ×（1 − lowPenalty ×（lowFrom − 体力）/ lowFrom）。
   * プレイヤーが過度に意識しなくてよい程度（体力0でも経験は7割）
   */
  lowFrom: 50,
  lowPenalty: 0.3,
  /** イベントの怪我：体力が低いほど起きやすい（体力0で確率が injuryLowMul 倍。lowFrom 以上なら1倍） */
  injuryLowMul: 2,
};

/** 黄パネル：練習の進行カードで止まると、その練習の経験値がこれだけ増える（倍率。練習の効果は「練習」の段階で） */
export const YELLOW_BONUS = 1.5;

/**
 * 決まった日の行事（定期イベントのパネル）。日付は仮。中身（文章・効果）は「イベントの中身の作り方」で入れる。
 * stop：大会は試合をするので必ず止まる。それ以外の行事は止まらず、通り過ぎても起きる。
 * 大会の日程は第3段階の「大会」で決め直す
 */
export const FIXED_EVENTS: { id: string; name: string; month: number; day: number; stop: boolean }[] = [
  { id: 'entrance', name: '入学式', month: 4, day: 7, stop: false },
  { id: 'physical', name: '身体測定', month: 4, day: 15, stop: false },
  { id: 'interhighPrelim', name: 'インターハイ予選', month: 6, day: 1, stop: true },
  { id: 'interhigh', name: 'インターハイ本戦', month: 7, day: 28, stop: true },
  { id: 'camp', name: '合宿', month: 8, day: 10, stop: false },
  { id: 'harukouPrelim', name: '春高予選', month: 11, day: 1, stop: true },
  { id: 'harukou', name: '春高本戦', month: 1, day: 5, stop: true },
  { id: 'graduation', name: '卒業式', month: 3, day: 1, stop: false },
];

/**
 * 練習の経験（1日あたり）。経験は能力ごとの端数にたまり、1たまると能力が1上がる。
 * 経験＝ base × 体育館レベルの倍率 × 体力による落ち方 × 伸びにくさ（× 黄パネルの倍率）。練習指示は経験を指示した能力へ寄せる
 */
export const PRACTICE_GAIN = {
  /** 1つの能力を伸ばす練習の、1日あたりの経験の基本量 */
  base: 0.19,
  /**
   * 練習指示は「伸びる量を寄せる」選択：指示した能力と違う能力の練習では、その経験の focusShift の割合が
   * 指示した能力に回る（回る量は元の能力の伸びにくさで決まるので、合計はおまかせと同じ）。指示した能力の練習では、そのまま入る
   */
  focusShift: 0.07,
  /** 総合練習・紅白戦：6能力それぞれに入る割合 */
  generalShare: 0.25,
  /** 高効率カード：2つの能力それぞれに入る倍率 */
  efficient: 1.6,
  /** 伸びにくさ：能力が高いほど伸びにくい（倍率＝ pivot − 能力 × slope。下限 min） */
  pivot: 1.3,
  slope: 0.01,
  min: 0.2,
  /** 練習するポジションの適性の経験（1日あたり） */
  aptitude: 0.1,
};

/** 体育館レベル：持っている機材で決まる（下位機材 basic 点・上位機材 advanced 点）。機材は壊れない */
export const GYM = {
  points: { basic: 1, advanced: 2 },
  /** レベル＝ 1 ＋ 点の合計 ÷ perLevel（切り捨て） */
  perLevel: 1,
  /** 1レベルあたり、すべての練習の経験が増える割合 */
  perLevelGain: 0.06,
  /** 上限。機材を全部そろえた時（下位6点＋上位12点＝18点）のレベル。経験は 1 ＋ 18 × perLevelGain 倍 */
  maxLevel: 19,
};

/** お金（単位：円）。部費（年度の初めに入る）と、試合の勝利の報奨（後援会・OB会からの支援） */
export const MONEY = {
  /** 部費：年度の初めに入る額（評判による増減は第3段階で） */
  budget: 150000,
  /** 勝利の報奨：練習試合1勝、大会1勝（大会は勝ち進むほど roundMul 倍ずつ増える） */
  winPractice: 5000,
  winTournament: 10000,
  roundMul: 1.3,
  /** 機材の値段 */
  price: { basic: 40000, advanced: 120000 },
};

/** 調子（-2〜+2）の日々の変わり方 */
export const CONDITION = {
  /** 1日に調子が変わる確率：普通の時 leaveNormal、それ以外の時 dailyChance */
  leaveNormal: 0.04,
  dailyChance: 0.1,
  /** 変わる時に、普通（0）の方へ戻る確率 */
  towardNormal: 0.75,
  /** 安定感：普通から外れにくい（leaveNormal の倍率） */
  stableLeave: 0.4,
  /** ムラっ気：普通から外れやすく（leaveNormal の倍率）、戻りにくい（普通の方へ戻る確率） */
  moodyLeave: 2.5,
  moodyToward: 0.6,
};

/** 部員の入れ替わり（新入生・卒業・身体測定）。本家と同じく人数と能力はランダム。評判による増減は第3段階で */
export const ROSTER = {
  /** 新入生の人数（毎年この範囲で決まる） */
  newcomers: { min: 4, max: 7 },
  /** 新入生の能力の平均とばらつき */
  newcomerAvg: 35,
  newcomerSpread: 8,
  /** 新入生の本職の出やすさ */
  roleWeights: { S: 2, OH: 4, MB: 3, OP: 2, L: 2 } as Record<'S' | 'OH' | 'MB' | 'OP' | 'L', number>,
  /** 新入生が特能を1つ持って入ってくる確率（青・赤。サーブの解禁・金・緑は持たない） */
  traitChance: { blue: 0.12, red: 0.1 },
  /** 身体測定：身長の伸びしろのうち、2年の4月に伸びる割合（残りは3年の4月）。1年は入学したばかりで伸びない */
  heightShareSecond: 0.6,
};
