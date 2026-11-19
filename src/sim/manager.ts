// 監督特能（仮）。タイムアウトの時に1つ選んで発動する。
// 効果は選手の特能と同じ「場面・能力・段階（±1/3/5/10/15）」の形で、自チームまたは相手チーム全員にかける。
// 監督特能の獲得・失効・数の上限は育成の段階で作る。今は試作用に、いくつか持っている前提で選べるようにしているだけ。

import type { AbilityKey } from './ability';
import type { StageDelta, StatEffect, Scene } from './traits';

export interface ManagerSkill {
  id: string;
  name: string;
  /** 説明（数字は出さず、言葉で表す） */
  desc: string;
  own?: StatEffect[];
  opp?: StatEffect[];
}

const ALL: AbilityKey[] = ['power', 'technique', 'speed', 'block'];
const every = (delta: StageDelta, scene: Scene = 'all'): StatEffect[] => ALL.map(ability => ({ scene, ability, delta }));

export const MANAGER_SKILLS: Record<string, ManagerSkill> = {
  /** 監督特能を持っていない時の基本効果（仕様：自チーム全体を少しだけアップ） */
  basic: { id: 'basic', name: '基本効果', desc: '自チーム全体を少しだけ上げる', own: every(3) },
  // 以下は仕様の「監督特能の例（案）」から。効果の中身は仮
  geki: { id: 'geki', name: '檄', desc: '自チーム全体を上げる', own: every(5) },
  tatenaoshi: {
    id: 'tatenaoshi', name: '立て直し', desc: '自チームのレシーブを上げる',
    own: [{ scene: 'serveReceive', ability: 'technique', delta: 10 }, { scene: 'dig', ability: 'technique', delta: 10 }],
  },
  serveKuzushi: {
    id: 'serveKuzushi', name: 'サーブ崩し', desc: '相手のサーブを弱らせる',
    opp: [{ scene: 'serve', ability: 'technique', delta: -5 }, { scene: 'serve', ability: 'power', delta: -5 }],
  },
  aceTaisaku: {
    id: 'aceTaisaku', name: 'エース対策', desc: '相手のスパイクを弱らせる（仮：相手全員）',
    opp: [{ scene: 'attack', ability: 'power', delta: -5 }, { scene: 'attack', ability: 'technique', delta: -5 }],
  },
};

/** タイムアウトで選べる監督特能：持っていなければ基本効果だけ */
export function timeoutChoices(owned: string[]): ManagerSkill[] {
  const list = owned.map(id => MANAGER_SKILLS[id]).filter((s): s is ManagerSkill => !!s && s.id !== 'basic');
  return list.length ? list : [MANAGER_SKILLS.basic];
}
