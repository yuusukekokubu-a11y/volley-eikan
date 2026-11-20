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
  /** 練習1日あたりに減る量（練習の種類ごとの差は「練習」の段階で） */
  perPracticeDay: 4,
  /** 緑パネルで回復する量、休み1日で回復する量 */
  green: 25,
  rest: 15,
  /** 怪我のしやすさ：体力がこれより低いと、練習1日ごとに injuryPerPoint ×（基準−体力）の確率で怪我をする */
  injuryBelow: 40,
  injuryPerPoint: 0.0015,
  /** 怪我をした時の日数の範囲（怪我のイベントの中身は「最低限のイベント」の段階で） */
  injuryDays: [3, 14] as [number, number],
};

/** 黄パネル：練習の進行カードで止まると、その練習の経験値がこれだけ増える（倍率。練習の効果は「練習」の段階で） */
export const YELLOW_BONUS = 1.5;

/**
 * 決まった日の行事（定期イベントのパネル）。日付は仮。中身（文章・効果）は「イベントの中身の作り方」で入れる。
 * 大会の日程は第3段階の「大会」で決め直す
 */
export const FIXED_EVENTS: { id: string; name: string; month: number; day: number }[] = [
  { id: 'entrance', name: '入学式', month: 4, day: 7 },
  { id: 'physical', name: '身体測定', month: 4, day: 15 },
  { id: 'interhighPrelim', name: 'インターハイ予選', month: 6, day: 1 },
  { id: 'interhigh', name: 'インターハイ本戦', month: 7, day: 28 },
  { id: 'camp', name: '合宿', month: 8, day: 10 },
  { id: 'harukouPrelim', name: '春高予選', month: 11, day: 1 },
  { id: 'harukou', name: '春高本戦', month: 1, day: 5 },
  { id: 'graduation', name: '卒業式', month: 3, day: 1 },
];
