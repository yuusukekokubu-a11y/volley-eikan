// 進行カード（spec.md「練習の仕組み」）。1枚に「進む日数」と「練習の種類」が書いてある。
// 手札は5枚。使ったら1枚引く。出やすさはチーム方針（と、後で機材）で変わる。
// 練習の効果は practice.ts。

import type { Rng } from '../sim/rng';
import type { TrainKey } from '../sim/types';
import { HAND, INSTRUCTION_CARD_CHANCE, PRACTICE_MATCH } from './constants';

/** 機材：なし・下位・上位 */
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
export const CARD_WEIGHTS = { base: 1, policyMul: 2.5, general: 1.5, efficient: 1.5 };

export interface Card {
  days: number;
  practiceId: string;
  /**
   * 練習以外のカード（進まない、練習もしない）。instruction＝練習指示カード（使うと練習指示を変えられる）、
   * matchOffer＝練習試合申し込みカード（使うと3校から相手を選び、次の土曜日に練習試合）
   */
  special?: 'instruction' | 'matchOffer';
}

/**
 * 高効率カードの条件（spec.md の表）：チーム方針と、持っている機材の組み合わせ。条件を満たすと手札に出るようになる
 */
export const EFFICIENT: Record<string, { policy: TeamPolicy; needs: string[][] }> = {
  // 攻撃重視 ＋（ダンベルかバーベル）＋（ジャンプボックスかジャンプ測定器）
  uchikomi: { policy: 'attack', needs: [['dumbbell', 'barbell'], ['jumpBox', 'jumpMeter']] },
  // 守備重視 ＋（トス練習リングかボールマシン）
  senbon: { policy: 'defense', needs: [['tossRing', 'ballMachine']] },
};

/** 高効率カードの条件を満たしているか */
export function efficientReady(id: string, policy: TeamPolicy, owned: string[]): boolean {
  const c = EFFICIENT[id];
  return !!c && c.policy === policy && c.needs.every(any => any.some(x => owned.includes(x)));
}

/**
 * 1枚引く。機材なしの練習と総合系はいつでも出る。機材を使う練習は、その機材を持っていれば出る。
 * 高効率カードは条件（方針＋機材）を満たせば出る
 */
/** 練習カードを引く。onlyPractice（合宿中）なら練習以外のカードは出ない */
export function drawCard(rng: Rng, policy: TeamPolicy, owned: string[] = [], onlyPractice = false): Card {
  if (!onlyPractice) {
    if (rng.chance(INSTRUCTION_CARD_CHANCE)) return { days: 0, practiceId: '', special: 'instruction' };
    if (rng.chance(PRACTICE_MATCH.cardChance)) return { days: 0, practiceId: '', special: 'matchOffer' };
  }
  const fav = new Set(POLICY[policy].abilities);
  const pool = PRACTICES.filter(p => p.kind === 'efficient' ? efficientReady(p.id, policy, owned) : p.equipment === 'none' || owned.includes(p.id));
  const practice = rng.weighted(pool.map(p => ({
    item: p,
    w: p.kind === 'general' ? CARD_WEIGHTS.general : p.kind === 'efficient' ? CARD_WEIGHTS.efficient
      : CARD_WEIGHTS.base * (p.abilities.some(a => fav.has(a)) ? CARD_WEIGHTS.policyMul : 1),
  })))!;
  const days = HAND.minDays + Math.min(HAND.maxDays - HAND.minDays, Math.floor(rng.range(0, HAND.maxDays - HAND.minDays + 1)));
  return { days, practiceId: practice.id };
}
