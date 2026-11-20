// 双六の盤面（1マス＝1日）。1年分の日付にパネルを並べる。決まった日の行事は日付に固定し、ほかは色のパネルを重みで並べる。
// ルート分岐：分かれ道のパネルの次の数日は2つの道に分かれ、どちらを通るかを選ぶ（終わるとまた1本に戻る）。

import { Rng } from '../sim/rng';
import { BRANCH, DAYS_IN_YEAR, FIXED_EVENTS, PANEL_WEIGHTS, YEAR_START } from './constants';

export type PanelKind = 'blue' | 'red' | 'white' | 'green' | 'yellow' | 'training' | 'branch' | 'fixed';

export interface Panel {
  kind: PanelKind;
  /** 定期イベントのパネル：行事の ID */
  fixedId?: string;
}

/** 1日分のマス。分かれている日は lanes が2つ */
export interface BoardDay {
  /** 年の中の日（0＝4月1日） */
  index: number;
  month: number;
  day: number;
  lanes: Panel[];
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** 年の中の日（0＝4月1日）→ 月日 */
export function dateOf(index: number): { month: number; day: number } {
  let m = YEAR_START.month;
  let d = YEAR_START.day + index;
  while (d > MONTH_DAYS[m - 1]) {
    d -= MONTH_DAYS[m - 1];
    m = m === 12 ? 1 : m + 1;
  }
  return { month: m, day: d };
}

/** 月日 → 年の中の日 */
export function indexOf(month: number, day: number): number {
  for (let i = 0; i < DAYS_IN_YEAR; i++) {
    const d = dateOf(i);
    if (d.month === month && d.day === day) return i;
  }
  throw new Error(`日付がありません: ${month}/${day}`);
}

function colorPanel(rng: Rng): Panel {
  const w = PANEL_WEIGHTS.default;
  const kind = rng.weighted(Object.entries(w).map(([k, v]) => ({ item: k as PanelKind, w: v! })))!;
  return { kind };
}

/** 1年分の盤面を作る */
export function makeBoard(seed: number): BoardDay[] {
  const rng = new Rng(seed * 97 + 5);
  const fixed = new Map(FIXED_EVENTS.map(f => [indexOf(f.month, f.day), f.id]));
  const days: BoardDay[] = [];
  let branchLeft = 0;
  for (let i = 0; i < DAYS_IN_YEAR; i++) {
    const { month, day } = dateOf(i);
    const f = fixed.get(i);
    if (f) {
      // 決まった日の行事は、分かれ道の途中でも両方の道に置く
      days.push({ index: i, month, day, lanes: Array.from({ length: branchLeft > 0 ? 2 : 1 }, () => ({ kind: 'fixed' as const, fixedId: f })) });
      if (branchLeft > 0) branchLeft--;
      continue;
    }
    if (branchLeft > 0) {
      days.push({ index: i, month, day, lanes: [colorPanel(rng), colorPanel(rng)] });
      branchLeft--;
      continue;
    }
    // 分かれ道：次の日から数日、道が2つに分かれる（年の終わりの近くでは作らない）
    if (i < DAYS_IN_YEAR - BRANCH.maxDays - 1 && rng.chance(BRANCH.chance)) {
      days.push({ index: i, month, day, lanes: [{ kind: 'branch' }] });
      branchLeft = BRANCH.minDays + Math.floor(rng.range(0, BRANCH.maxDays - BRANCH.minDays + 1));
      continue;
    }
    days.push({ index: i, month, day, lanes: [colorPanel(rng)] });
  }
  return days;
}
