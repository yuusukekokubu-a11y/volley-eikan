// 進行カード（spec.md「練習の仕組み」）。1枚に「進む日数」と「練習の種類」が書いてある。
// 手札は5枚。使ったら1枚引く。出やすさはチーム方針（と、後で機材）で変わる。
// 練習の効果そのものは「練習」の段階で作る。ここでは練習の種類と、カードを使ったことを練習側に渡す口だけ。

import type { Rng } from '../sim/rng';
import type { TrainKey } from '../sim/types';
import { HAND } from './constants';

/** 機材：なし・下位・上位（機材を持っているかは「練習」の段階で） */
export type Equipment = 'none' | 'basic' | 'advanced';

export interface PracticeDef {
  id: string;
  name: string;
  /** 伸ばす能力（総合系は複数） */
  abilities: TrainKey[];
  equipment: Equipment;
  /** 総合系・高効率カード */
  kind: 'single' | 'general' | 'efficient';
}

const single = (id: string, name: string, ability: TrainKey, equipment: Equipment): PracticeDef =>
  ({ id, name, abilities: [ability], equipment, kind: 'single' });

/** 練習の種類（spec.md の表）。身長以外の6能力 × 機材3種類 ＋ 総合系2種類 ＋ 高効率カード */
export const PRACTICES: PracticeDef[] = [
  single('bounding', 'バウンディング', 'jump', 'none'), single('jumpBox', 'ジャンプボックス', 'jump', 'basic'), single('jumpMeter', 'ジャンプ測定器', 'jump', 'advanced'),
  single('core', '体幹・自重トレ', 'power', 'none'), single('dumbbell', 'ダンベル', 'power', 'basic'), single('barbell', 'バーベル・ウェイトマシン', 'power', 'advanced'),
  single('dash', 'ダッシュ', 'speed', 'none'), single('ladder', 'ラダー', 'speed', 'basic'), single('reaction', '反応トレーニング機器', 'speed', 'advanced'),
  single('pairPass', '対人パス', 'technique', 'none'), single('tossRing', 'トス練習リング', 'technique', 'basic'), single('ballMachine', 'ボールマシン', 'technique', 'advanced'),
  single('shadowBlock', 'シャドーブロック', 'block', 'none'), single('blockStand', 'ブロック練習台', 'block', 'basic'), single('spikeMachine', 'スパイクマシン', 'block', 'advanced'),
  single('running', '走り込み', 'stamina', 'none'), single('bike', 'エアロバイク', 'stamina', 'basic'), single('hypoxic', '低酸素トレーニング機器', 'stamina', 'advanced'),
  { id: 'general', name: '総合練習', abilities: ['jump', 'power', 'speed', 'technique', 'block', 'stamina'], equipment: 'none', kind: 'general' },
  { id: 'scrimmage', name: '紅白戦', abilities: ['jump', 'power', 'speed', 'technique', 'block', 'stamina'], equipment: 'none', kind: 'general' },
  { id: 'uchikomi', name: '打ち込み', abilities: ['power', 'jump'], equipment: 'none', kind: 'efficient' },
  { id: 'senbon', name: '千本レシーブ', abilities: ['technique', 'speed'], equipment: 'none', kind: 'efficient' },
];

export const PRACTICE: Record<string, PracticeDef> = Object.fromEntries(PRACTICES.map(p => [p.id, p]));

/** チーム方針（spec.md）：方針で出やすいカードが変わる */
export type TeamPolicy = 'all' | 'attack' | 'defense' | 'speed' | 'stamina';

export const POLICY: Record<TeamPolicy, { name: string; abilities: TrainKey[] }> = {
  all: { name: '総合', abilities: ['jump', 'power', 'speed', 'technique', 'block', 'stamina'] },
  attack: { name: '攻撃重視', abilities: ['power', 'jump'] },
  defense: { name: '守備重視', abilities: ['technique', 'block'] },
  speed: { name: 'スピード重視', abilities: ['speed', 'technique'] },
  stamina: { name: '体力重視', abilities: ['stamina'] },
};

/** カードの出やすさ：方針で伸びやすい能力の練習を重くする（倍率） */
export const CARD_WEIGHTS = { base: 1, policyMul: 2.5, general: 1.5 };

export interface Card {
  days: number;
  practiceId: string;
}

/**
 * 1枚引く。今は機材なしの練習と総合系だけ（機材と高効率カードの条件は「練習」の段階で）
 */
export function drawCard(rng: Rng, policy: TeamPolicy, owned: Equipment[] = ['none']): Card {
  const fav = new Set(POLICY[policy].abilities);
  const pool = PRACTICES.filter(p => p.kind !== 'efficient' && owned.includes(p.equipment));
  const practice = rng.weighted(pool.map(p => ({
    item: p,
    w: p.kind === 'general' ? CARD_WEIGHTS.general : CARD_WEIGHTS.base * (p.abilities.some(a => fav.has(a)) ? CARD_WEIGHTS.policyMul : 1),
  })))!;
  const days = HAND.minDays + Math.min(HAND.maxDays - HAND.minDays, Math.floor(rng.range(0, HAND.maxDays - HAND.minDays + 1)));
  return { days, practiceId: practice.id };
}
