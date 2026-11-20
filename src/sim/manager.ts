// 監督特能（試合中の効果）。獲得・失効・期限は育成の段階（第3段階）で作る。
//
// 種類は3つ：
//   timeout  … タイムアウトの時に1つ選んで発動し、次の5ラリーだけ効く（檄・立て直し・サーブ崩し・エース対策）。
//              監督特能を持っていなければ、基本効果（自チーム全体を少しだけ上げる）だけ
//   passive  … 持っているだけで効く（勝負師＝最終セットで自チーム強化、データ分析＝試合前・セット間に相手の傾向がわかる）
//   instinct … 勝負勘：止まった時に1試合1回、次の1ラリーだけ方針を変えられる
// 効果は選手の特能と同じ「場面・能力・段階（±1/3/5/10/15）」の形。段階の付け方も特能と同じ基準
// （場面が狭いものは10、広いものは5）。

import type { AbilityKey } from './ability';
import type { StageDelta, StatEffect, Scene } from './traits';
import type { LineupSlot, Player, TeamState } from './types';

export type ManagerKind = 'timeout' | 'passive' | 'instinct';

export interface ManagerSkill {
  id: string;
  name: string;
  /** 説明（数字は出さず、言葉で表す） */
  desc: string;
  kind: ManagerKind;
  own?: StatEffect[];
  opp?: StatEffect[];
  /** 相手の効果を、相手のエース1人だけにかける（エース対策） */
  oppAceOnly?: boolean;
  /** 常時系：いつ効くか（最終セット）／見せるだけ（相手の傾向） */
  passive?: 'finalSet' | 'scouting';
}

/** 持てる監督特能の数 */
export const MANAGER_MAX = 3;

const ALL: AbilityKey[] = ['jump', 'power', 'speed', 'technique', 'block'];
const every = (delta: StageDelta, scene: Scene = 'all'): StatEffect[] => ALL.map(ability => ({ scene, ability, delta }));

export const MANAGER_SKILLS: Record<string, ManagerSkill> = {
  /** 監督特能を持っていない時の基本効果（仕様：自チーム全体を少しだけアップ） */
  basic: { id: 'basic', name: '基本効果', kind: 'timeout', desc: '自チーム全体を少しだけ上げる', own: every(3) },
  // ---- タイムアウト系 ----
  geki: { id: 'geki', name: '檄', kind: 'timeout', desc: '自チーム全体を上げる', own: every(5) },
  tatenaoshi: {
    id: 'tatenaoshi', name: '立て直し', kind: 'timeout', desc: '自チームのレシーブを上げる',
    own: [{ scene: 'serveReceive', ability: 'technique', delta: 10 }, { scene: 'dig', ability: 'technique', delta: 10 }],
  },
  serveKuzushi: {
    id: 'serveKuzushi', name: 'サーブ崩し', kind: 'timeout', desc: '相手のサーブを弱らせる',
    opp: [{ scene: 'serve', ability: 'technique', delta: -10 }, { scene: 'serve', ability: 'power', delta: -10 }],
  },
  aceTaisaku: {
    id: 'aceTaisaku', name: 'エース対策', kind: 'timeout', desc: '相手エースのスパイクを弱らせる', oppAceOnly: true,
    opp: [{ scene: 'attack', ability: 'power', delta: -10 }, { scene: 'attack', ability: 'technique', delta: -10 }],
  },
  // ---- 常時系 ----
  shoubushi: { id: 'shoubushi', name: '勝負師', kind: 'passive', passive: 'finalSet', desc: '最終セットで自チームを強くする', own: every(5) },
  dataBunseki: { id: 'dataBunseki', name: 'データ分析', kind: 'passive', passive: 'scouting', desc: '試合前に相手の傾向がわかる' },
  // ---- 勝負勘 ----
  shoubukan: { id: 'shoubukan', name: '勝負勘', kind: 'instinct', desc: '止まった時に1試合1回、次の1ラリーだけ方針を変えられる' },
};

/** 試作用の画面で選べる順 */
export const MANAGER_SKILL_IDS = ['geki', 'tatenaoshi', 'serveKuzushi', 'aceTaisaku', 'shoubushi', 'dataBunseki', 'shoubukan'];

/** タイムアウトで選べる監督特能：持っているタイムアウト系。なければ基本効果だけ */
export function timeoutChoices(owned: string[]): ManagerSkill[] {
  const list = owned.map(id => MANAGER_SKILLS[id]).filter((s): s is ManagerSkill => !!s && s.kind === 'timeout' && s.id !== 'basic');
  return list.length ? list : [MANAGER_SKILLS.basic];
}

/** スパイクの攻撃力の目安（エースを決める用。身長・跳躍・パワー・テクニック） */
export function attackPower(p: Player): number {
  return p.power + p.technique * 0.6 + p.jump * 0.6 + (p.height - 180) * 0.8;
}

/**
 * そのチームのエース：前衛（ゾーン2・3・4）のアウトサイド・オポジット・ミドルで、攻撃力の一番高い選手。
 * 前衛にいなければ、チーム全体のアウトサイド・オポジットから
 */
export function aceOf(team: TeamState): Player | undefined {
  const wings = (slots: LineupSlot[]) => slots.filter(s => s.role === 'OH' || s.role === 'OP' || s.role === 'MB');
  const front = wings(team.rotation.slice(1, 4));
  const pool = front.length ? front : wings(team.rotation);
  return pool.map(s => s.player).sort((a, b) => attackPower(b) - attackPower(a))[0];
}
