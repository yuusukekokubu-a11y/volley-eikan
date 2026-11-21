// 育成から試合を行う：結果だけ（全部おまかせで計算）と、試合の後の経験。描画は知らない。
// 試合の計算は src/sim/game.ts（Match）をそのまま使う。

import { MATCH_EXP, PRACTICE_GAIN } from './constants';
import { growth } from './practice';
import { Match, type MatchOptions } from '../sim/game';
import { addAbilityExp, applyMatch, type MatchLine } from '../sim/player';
import type { Player, TeamId, TrainKey } from '../sim/types';

const KEYS: TrainKey[] = ['jump', 'power', 'speed', 'technique', 'block', 'stamina'];

/** 試合の結果（自チーム＝A から見る） */
export interface MatchOutcome {
  win: boolean;
  /** セットごとの点（自チーム-相手） */
  sets: { own: number; opp: number }[];
  lines: Record<string, MatchLine>;
  /** 先発（第1セットの始まりのコート上の6人とリベロ） */
  starters: string[];
}

/** セットカウント（勝った側から。例 "2-1"） */
export function setCount(sets: { own: number; opp: number }[], fromWinner = true): string {
  const own = sets.filter(s => s.own > s.opp).length;
  const opp = sets.length - own;
  return fromWinner ? `${Math.max(own, opp)}-${Math.min(own, opp)}` : `${own}-${opp}`;
}

/** 試合を最後まで計算する（自チームも采配なし。相手は交代だけ） */
export function runMatch(o: MatchOptions): Match {
  const m = new Match(o);
  while (m.phase !== 'over') {
    const g = m.startSet();
    while (!g.over) g.next();
    m.finishSet();
  }
  return m;
}

/** 計算し終えた試合から、自チーム（A）の結果を取り出す */
export function outcomeOf(m: Match, starters: string[]): MatchOutcome {
  return {
    win: m.winner === ('A' as TeamId),
    sets: m.results.map(r => ({ own: r.A, opp: r.B })),
    lines: m.lines,
    starters,
  };
}

/**
 * 試合の経験：練習何日分か（スタメン＞途中出場＞ベンチ入り＞ベンチ外）。練習指示の能力に入り、おまかせなら6能力に等分。
 * 通算成績・信頼度・適性の経験も更新する
 */
export function applyMatchExp(players: Player[], o: MatchOutcome, registered: string[]) {
  for (const p of players) {
    const played = (o.lines[p.id]?.sets ?? 0) > 0;
    const days = o.starters.includes(p.id) ? MATCH_EXP.starter : played ? MATCH_EXP.sub : registered.includes(p.id) ? MATCH_EXP.bench : MATCH_EXP.out;
    const amount = PRACTICE_GAIN.base * days;
    const f = p.practice.focus;
    if (f === 'auto') for (const k of KEYS) addAbilityExp(p, k, amount / KEYS.length * growth(p[k]));
    else addAbilityExp(p, f, amount * growth(p[f]));
  }
  applyMatch(players, o.lines);
}
