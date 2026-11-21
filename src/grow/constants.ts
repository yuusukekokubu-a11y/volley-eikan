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
export interface FixedEvent {
  id: string;
  name: string;
  month: number;
  day: number;
  stop: boolean;
  /** 同じ種類の行事が何回かある時の種類（練習試合）。イベントのきっかけはこの種類で見る */
  kind?: string;
}

export const FIXED_EVENTS: FixedEvent[] = [
  { id: 'entrance', name: '入学式', month: 4, day: 7, stop: false },
  { id: 'physical', name: '身体測定', month: 4, day: 15, stop: false },
  { id: 'interhighPrelim', name: 'インターハイ予選', month: 6, day: 1, stop: true },
  { id: 'interhigh', name: 'インターハイ本戦', month: 7, day: 28, stop: true },
  { id: 'campSummer', name: '夏合宿', month: 7, day: 20, stop: false },
  { id: 'harukouPrelim', name: '春高予選', month: 11, day: 1, stop: true },
  { id: 'campWinter', name: '冬合宿', month: 12, day: 15, stop: false },
  { id: 'harukou', name: '春高本戦', month: 1, day: 5, stop: true },
  { id: 'retire', name: '3年生の引退', month: 1, day: 15, stop: false },
  { id: 'graduation', name: '卒業式', month: 3, day: 1, stop: false },
];

/**
 * 合宿：夏（7月下旬）と冬（12月中旬）の年2回、days 日間。開催は自動（選ぶ場面はない）。日付は仮。
 * 合宿中は手札が練習カードだけになり（ほかのカードは練習カードに入れ替わる）、緑パネルはない。
 * 合宿の間は、練習の経験が expMul 倍、体力の減りが energyMul 倍。
 * 練習ごと（カード1枚ごと）に traitRolls 回、traitChance の確率で、ランダムな選手1人がその練習の種類に合った特能を覚える（1回の合宿で2〜3個が目安）
 */
export const CAMP = {
  summer: { name: '夏合宿', start: { month: 7, day: 20 } },
  winter: { name: '冬合宿', start: { month: 12, day: 15 } },
  days: 5,
  expMul: 2,
  energyMul: 2,
  traitRolls: 3,
  traitChance: 0.5,
};

/**
 * 練習試合（本家と同じく3つの入り口）。試合そのもの・相手校の自動生成・評判は第3段階でつなぐ
 * ・練習試合申し込みカード：まれに手札に来る。使うと3校から相手を選び、次の土曜日に試合
 * ・白パネルでまれに他校から申し込み（受ける／断る）。次の土曜日に試合
 * ・1年目の6月に1回、マネージャーが組む（6月に入って最初に止まった時に知らせ、firstYear 以降の最初の土曜日に試合）
 * 大会の closeDays 日前からは申し込めない（カードは使えず、白パネルの申し込みも来ない）
 */
export const PRACTICE_MATCH = {
  cardChance: 0.02,
  whiteInviteChance: 0.08,
  candidates: 3,
  closeDays: 20,
  firstYear: { month: 6, day: 20 },
};

/** 曜日：1年目の4月1日の曜日（0＝日曜 … 6＝土曜）。1年は365日なので、年度ごとに1つずれる。仮 */
export const FIRST_WEEKDAY = 1;
export const SATURDAY = 6;

/** 練習指示：変えられるのは毎月1日（通り過ぎても止まる）と、練習指示カードを使った時。カードが手札に来る確率（1枚引くごと） */
export const INSTRUCTION_CARD_CHANCE = 0.03;


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

/** 大会の登録：人数と、そのうちリベロ（一番適性の高い位置がリベロの選手）の人数の上限 */
export const SQUAD_LIMIT = { size: 12, libero: 2 };

/**
 * 相手校。県内は31校（自チームと合わせて32校）で毎年同じ。強さ＝選手の能力の平均の目安。
 * 名門が少なく、中堅・弱小が多い（bands）。本戦の相手（他県の代表）は national の範囲で、その都度作る
 */
export const SCHOOLS = {
  bands: [
    { count: 2, strength: 66 },
    { count: 4, strength: 58 },
    { count: 8, strength: 50 },
    { count: 10, strength: 43 },
    { count: 7, strength: 36 },
  ],
  spread: 2,
  national: { min: 56, max: 72 },
  nationalPrefix: ['', '県立', '私立', '第一', '附属'],
  /** 控え（8人目から）は先発より少し弱い */
  benchGap: 4,
  /** 青特能の数：(強さ − traitFrom) ÷ traitPer 個くらい。赤は1人ごとに redChance */
  traitFrom: 40,
  traitPer: 16,
  /** 部員ごとの6能力の平均のばらつき */
  playerSpread: 3,
  redChance: 0.1,
  /** 年度の終わりの強さの動き：成績（勝った試合の数）で上下し、作った時の強さへ少し戻る。ばらつき */
  drift: { perWin: 0.15, expectedWins: 1, toBase: 0.3, noise: 1.2, min: 30, max: 76 },
  /** 練習試合の相手の強さ：自チームの強さとの差（格上・同格・格下） */
  practiceGap: { above: 6, equal: 0, below: -6, noise: 2 },
  names: [
    '青葉', '若葉', '桜ヶ丘', '緑ヶ丘', '港南', '川北', '山手', '城南', '城北', '旭', '朝日', '白鷺', '清風', '明誠', '東陽', '西陵',
    '南台', '北斗', '中央', '富士見', '泉', '松陰', '紅葉', '翠嶺', '光陽', '大和', '常盤', '湊', '鶴見', '高台', '丘陵', '浜風',
    '霞ヶ丘', '天神', '水城', '春日', '若松', '日向', '八幡', '新町', '栄町', '本郷', '桜台', '弥生', '千歳', '長浜', '岬', '藤ヶ丘',
    '星ヶ丘', '竹園', '梅林', '杉並', '野田', '田原', '森山', '岩倉', '宮前', '秋津', '飛鳥', '睦', '高砂', '有明', '磯辺', '一宮',
  ],
};

/** 大会の日程。予選は1回戦ごとに数日あけ（その日に止まる）、本戦は続けて試合をする（間に練習なし） */
export interface TournamentDef {
  id: 'interhighPrelim' | 'interhigh' | 'harukouPrelim' | 'harukou';
  name: string;
  kind: 'prelim' | 'national';
  /** 1回戦ごとの日付（本戦は最初の日だけ。そこから1日ずつ） */
  dates: { month: number; day: number }[];
  /** 1回戦ごとのセット数（32校で5回戦：1回戦・2回戦・準々決勝・準決勝・決勝） */
  bestOf: (3 | 5)[];
  /** 予選なら、勝ち抜くと出られる本戦 */
  next?: 'interhigh' | 'harukou';
}

export const TOURNAMENTS: Record<TournamentDef['id'], TournamentDef> = {
  interhighPrelim: { id: 'interhighPrelim', name: 'インターハイ予選', kind: 'prelim', dates: [{ month: 6, day: 1 }, { month: 6, day: 4 }, { month: 6, day: 7 }, { month: 6, day: 10 }, { month: 6, day: 13 }], bestOf: [3, 3, 3, 3, 3], next: 'interhigh' },
  interhigh: { id: 'interhigh', name: 'インターハイ本戦', kind: 'national', dates: [{ month: 7, day: 28 }], bestOf: [3, 3, 3, 3, 5] },
  harukouPrelim: { id: 'harukouPrelim', name: '春高予選', kind: 'prelim', dates: [{ month: 11, day: 1 }, { month: 11, day: 4 }, { month: 11, day: 7 }, { month: 11, day: 10 }, { month: 11, day: 13 }], bestOf: [3, 3, 3, 3, 3], next: 'harukou' },
  harukou: { id: 'harukou', name: '春高本戦', kind: 'national', dates: [{ month: 1, day: 5 }], bestOf: [3, 3, 3, 5, 5] },
};

export const ROUND_NAMES = ['1回戦', '2回戦', '準々決勝', '準決勝', '決勝'];

/**
 * 試合の経験：練習何日分か（練習指示の能力に入る。おまかせなら6能力に等分）。
 * スタメン＞途中出場＞ベンチ入り（登録されたが出ていない）＞ベンチ外（登録されていない）
 */
export const MATCH_EXP = { starter: 3, sub: 2, bench: 1, out: 0.5 };
