// イベントの仕組み（いつ起きるか・何が起きるか・選択肢）。中身（文章・選択肢・効果）は CLAUDE.md の
// 「イベントの中身の作り方」で入れるので、ここには仕組みだけを置く（ゲームに出るイベントはまだ登録しない）。
//
// イベントはデータで書く：
//   いつ起きるか … きっかけ（パネルの色・定期イベントの ID）＋ 条件（月・学年・ポジション・印など）＋ 重み
//   誰に起きるか … 対象の選手（条件に合う選手から1人。なければチーム全体のイベント）
//   何が起きるか … 文章（{name} は対象の選手の名前、{number} は背番号に置き換える）
//   選択肢       … それぞれに効果（決まった種類の組み合わせ）。選択肢がなければ、すぐに効果をかける

import { addAbilityExp, gradeOf } from '../sim/player';
import type { Rng } from '../sim/rng';
import type { Player, Role, TrainKey } from '../sim/types';
import type { PanelKind } from './board';
import { ENERGY } from './constants';

/** 条件 */
export type Cond =
  | { kind: 'month'; in: number[] }
  | { kind: 'grade'; in: number[] }          // 対象の選手の学年
  | { kind: 'role'; in: Role[] }             // 対象の選手のポジション（一番適性の高い位置）
  | { kind: 'flag'; name: string; is: boolean }
  | { kind: 'energyBelow'; value: number }   // 対象の選手の育成用の体力
  | { kind: 'moneyAtLeast'; value: number };

/** 効果。target を省くと、対象の選手（いなければチーム全体） */
export type Effect = (
  | { kind: 'ability'; key: TrainKey; delta: number }       // 能力を直接上下
  | { kind: 'exp'; key: TrainKey; amount: number }          // 能力の経験（端数がたまると上がる）
  | { kind: 'condition'; delta: number }                    // 調子（-2〜+2）
  | { kind: 'trust'; delta: number }                        // 信頼度
  | { kind: 'energy'; delta: number }                       // 育成用の体力
  // 怪我：chance の確率で起き、能力・体力・調子が少し下がる（練習できなくなる状態はない）。体力が低いほど起きやすい
  | { kind: 'injury'; chance: number; abilities?: Partial<Record<TrainKey, number>>; energy?: number; condition?: number }
  | { kind: 'traitProgress'; id: string; delta: number }    // 特能のきっかけ
  | { kind: 'gainTrait'; id: string }                       // 特能を覚える
  | { kind: 'money'; delta: number }                        // お金（稼ぎ方は「練習」の段階で相談。今は種類として持つだけ）
  | { kind: 'flag'; name: string; value: boolean }          // 印（後のイベントの条件に使う）
) & { target?: 'subject' | 'team' };

export interface Choice {
  label: string;
  effects: Effect[];
  /** 続けて起きるイベント */
  next?: string;
}

export interface EventDef {
  id: string;
  /** きっかけ：止まったパネルの色、または定期イベントの ID */
  trigger: { panel?: PanelKind[]; fixed?: string };
  /** 起きる条件（すべて満たす時だけ） */
  when?: Cond[];
  /** 対象の選手を選ぶ条件（省くと、チーム全体のイベント） */
  subject?: Cond[];
  /** 同じきっかけの中での選ばれやすさ */
  weight?: number;
  text: string;
  choices?: Choice[];
  effects?: Effect[];
}

/** イベントを起こす時に見る、育成の状態 */
export interface EventWorld {
  year: number;
  month: number;
  players: Player[];
  flags: Record<string, boolean>;
  money: number;
}

/** 起きているイベント（選択肢を待っている） */
export interface PendingEvent {
  def: EventDef;
  subjectId?: string;
  text: string;
}

const bestRole = (p: Player): Role => (Object.entries(p.aptitude) as [Role, number][]).sort((a, b) => b[1] - a[1])[0][0];

function checkCond(c: Cond, w: EventWorld, p?: Player): boolean {
  switch (c.kind) {
    case 'month': return c.in.includes(w.month);
    case 'flag': return !!w.flags[c.name] === c.is;
    case 'moneyAtLeast': return w.money >= c.value;
    case 'grade': return !!p && c.in.includes(gradeOf(p, w.year));
    case 'role': return !!p && c.in.includes(bestRole(p));
    case 'energyBelow': return !!p && p.energy < c.value;
  }
}

/** きっかけに合うイベントを1つ選ぶ（条件を満たすものから重みで）。対象の選手もここで決める */
export function pickEvent(defs: EventDef[], trigger: { panel?: PanelKind; fixed?: string }, w: EventWorld, rng: Rng): PendingEvent | null {
  const cands: { def: EventDef; subject?: Player }[] = [];
  for (const def of defs) {
    const hit = trigger.fixed ? def.trigger.fixed === trigger.fixed : !!trigger.panel && !!def.trigger.panel?.includes(trigger.panel);
    if (!hit) continue;
    if (!(def.when ?? []).every(c => checkCond(c, w))) continue;
    if (def.subject) {
      const ok = w.players.filter(p => def.subject!.every(c => checkCond(c, w, p)));
      if (!ok.length) continue;
      cands.push({ def, subject: ok[Math.floor(rng.range(0, ok.length)) % ok.length] });
    } else cands.push({ def });
  }
  if (!cands.length) return null;
  const pick = rng.weighted(cands.map(c => ({ item: c, w: c.def.weight ?? 1 })))!;
  return start(pick.def, pick.subject);
}

function start(def: EventDef, subject?: Player): PendingEvent {
  const text = def.text.replaceAll('{name}', subject?.name ?? '').replaceAll('{number}', subject ? String(subject.number) : '');
  return { def, subjectId: subject?.id, text };
}

/** 怪我の起きやすさ：体力が低いほど高い（体力0で ENERGY.injuryLowMul 倍） */
export function injuryChance(base: number, energy: number): number {
  const low = Math.max(0, ENERGY.lowFrom - energy) / ENERGY.lowFrom;
  return Math.min(1, base * (1 + (ENERGY.injuryLowMul - 1) * low));
}

/** 効果をかける。怪我のように確率で起きる効果には rng を使う */
export function applyEffects(effects: Effect[], w: EventWorld, subjectId: string | undefined, rng: Rng) {
  const subject = w.players.find(p => p.id === subjectId);
  for (const e of effects) {
    const targets = e.target === 'team' || !subject ? w.players : [subject];
    switch (e.kind) {
      case 'money': w.money += e.delta; continue;
      case 'flag': w.flags[e.name] = e.value; continue;
    }
    for (const p of targets) {
      switch (e.kind) {
        case 'ability': p[e.key] = Math.max(1, Math.min(100, p[e.key] + e.delta)); break;
        case 'exp': addAbilityExp(p, e.key, e.amount); break;
        case 'condition': p.condition = Math.max(-2, Math.min(2, p.condition + e.delta)); break;
        case 'trust': p.trust = Math.max(0, Math.min(100, p.trust + e.delta)); break;
        case 'energy': p.energy = Math.max(0, Math.min(ENERGY.max, p.energy + e.delta)); break;
        case 'injury': {
          if (!rng.chance(injuryChance(e.chance, p.energy))) break;
          for (const [k, v] of Object.entries(e.abilities ?? {})) p[k as TrainKey] = Math.max(1, Math.min(100, p[k as TrainKey] + v!));
          if (e.energy) p.energy = Math.max(0, Math.min(ENERGY.max, p.energy + e.energy));
          if (e.condition) p.condition = Math.max(-2, Math.min(2, p.condition + e.condition));
          break;
        }
        case 'traitProgress': p.traitProgress[e.id] = (p.traitProgress[e.id] ?? 0) + e.delta; break;
        case 'gainTrait': if (!p.traits.includes(e.id)) p.traits.push(e.id); break;
      }
    }
  }
}

/**
 * 選択肢を選ぶ（選択肢のないイベントは index を省く）。効果をかけ、続けて起きるイベントがあれば返す
 */
export function resolveEvent(ev: PendingEvent, w: EventWorld, defs: EventDef[], rng: Rng, index?: number): PendingEvent | null {
  const choice = ev.def.choices && index !== undefined ? ev.def.choices[index] : undefined;
  if (ev.def.choices?.length && !choice) throw new Error('選択肢を選んでください');
  applyEffects(choice ? choice.effects : ev.def.effects ?? [], w, ev.subjectId, rng);
  const nextId = choice?.next;
  if (!nextId) return null;
  const next = defs.find(d => d.id === nextId);
  if (!next) throw new Error(`続きのイベントがありません: ${nextId}`);
  return start(next, w.players.find(p => p.id === ev.subjectId));
}

/** ゲームに出るイベント（中身は「イベントの中身の作り方」で入れる。今は空） */
export const EVENTS: EventDef[] = [];
