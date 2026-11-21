// 32校のトーナメント（5回戦）。自チームの試合は外から結果を入れ、他校同士の試合は渡された計算（sim）で決める。描画は知らない。

import { ROUND_NAMES, type TournamentDef } from './constants';
import type { Rng } from '../sim/rng';

/** 出場校。own は自チーム */
export interface Entry {
  id: string;
  name: string;
  strength: number;
  own?: boolean;
}

/** 1試合。a・b は entries の番号 */
export interface Bout {
  a: number;
  b: number;
  winner?: number;
  /** セットカウント（勝った側から。例 "2-1"） */
  sets?: string;
}

/** 他校同士の試合を決める計算：勝った方の番号とセットカウント */
export type BoutSim = (a: Entry, b: Entry, bestOf: 3 | 5, key: string) => { aWins: boolean; sets: string };

/** シード校の位置（32の山で、強い順に1〜8番を離して置く） */
const SEED_POS = [0, 31, 16, 15, 8, 23, 24, 7];

export class Tournament {
  readonly def: TournamentDef;
  /** 山の順に並んだ出場校 */
  readonly entries: Entry[];
  /** 回戦ごとの試合（rounds[0] が1回戦） */
  rounds: Bout[][] = [];
  /** 今の回戦（0〜4） */
  round = 0;
  /** 終わった（優勝校が決まった） */
  over = false;
  readonly year: number;

  constructor(def: TournamentDef, entries: Entry[], rng: Rng, year: number) {
    this.def = def;
    this.year = year;
    // 強い順に8校をシードの位置へ、残りはランダム
    const sorted = [...entries].sort((x, y) => y.strength - x.strength);
    const slots: (Entry | null)[] = Array(32).fill(null);
    sorted.slice(0, SEED_POS.length).forEach((e, i) => { slots[SEED_POS[i]] = e; });
    const rest = sorted.slice(SEED_POS.length);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(rng.range(0, i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    for (let i = 0; i < 32; i++) if (!slots[i]) slots[i] = rest.shift()!;
    this.entries = slots as Entry[];
    this.rounds.push(Array.from({ length: 16 }, (_, i) => ({ a: 2 * i, b: 2 * i + 1 })));
  }

  get roundName(): string {
    return ROUND_NAMES[this.round];
  }

  get bestOf(): 3 | 5 {
    return this.def.bestOf[this.round];
  }

  private ownIndex(): number {
    return this.entries.findIndex(e => e.own);
  }

  /** 自チームの今の回戦の試合（負けていれば null） */
  ownBout(): Bout | null {
    if (this.over) return null;
    const me = this.ownIndex();
    return this.rounds[this.round].find(b => (b.a === me || b.b === me) && b.winner === undefined) ?? null;
  }

  /** 自チームがまだ勝ち残っているか */
  get ownAlive(): boolean {
    const me = this.ownIndex();
    for (const r of this.rounds) for (const b of r) if (b.winner !== undefined && (b.a === me || b.b === me) && b.winner !== me) return false;
    return true;
  }

  /** 自チームの今の相手 */
  ownOpponent(): Entry | null {
    const b = this.ownBout();
    if (!b) return null;
    const me = this.ownIndex();
    return this.entries[b.a === me ? b.b : b.a];
  }

  /** 自チームの試合の結果を入れる */
  recordOwn(win: boolean, sets: string) {
    const b = this.ownBout();
    if (!b) throw new Error('自チームの試合はありません');
    const me = this.ownIndex();
    b.winner = win ? me : (b.a === me ? b.b : b.a);
    b.sets = sets;
  }

  /** 今の回戦の、他校同士の試合を決める */
  playOthers(sim: BoutSim) {
    const me = this.ownIndex();
    this.rounds[this.round].forEach((b, i) => {
      if (b.winner !== undefined || b.a === me || b.b === me) return;
      const r = sim(this.entries[b.a], this.entries[b.b], this.bestOf, `${this.def.id}-${this.round}-${i}`);
      b.winner = r.aWins ? b.a : b.b;
      b.sets = r.sets;
    });
  }

  /** 今の回戦が全部終わっていれば、次の回戦を作る（決勝なら終わり） */
  advance(): boolean {
    const cur = this.rounds[this.round];
    if (cur.some(b => b.winner === undefined)) return false;
    if (cur.length === 1) { this.over = true; return true; }
    const next: Bout[] = [];
    for (let i = 0; i < cur.length; i += 2) next.push({ a: cur[i].winner!, b: cur[i + 1].winner! });
    this.rounds.push(next);
    this.round++;
    return true;
  }

  /** 自チームが負けた後などに、残りの試合を最後まで決める */
  finish(sim: BoutSim) {
    while (!this.over) {
      this.playOthers(sim);
      if (this.ownBout()) throw new Error('自チームの試合が残っています');
      this.advance();
    }
  }

  get champion(): Entry | null {
    if (!this.over) return null;
    return this.entries[this.rounds[this.rounds.length - 1][0].winner!];
  }

  /** 自チームの成績：勝った試合の数と、どこまで進んだか（優勝・準優勝・〇〇で負け） */
  ownResult(): { wins: number; text: string } {
    const me = this.ownIndex();
    let wins = 0;
    let lostAt = -1;
    this.rounds.forEach((r, i) => r.forEach(b => {
      if (b.winner === undefined || (b.a !== me && b.b !== me)) return;
      if (b.winner === me) wins++;
      else lostAt = i;
    }));
    if (lostAt < 0) return { wins, text: this.over ? '優勝' : `${ROUND_NAMES[this.round]}まで勝ち残り` };
    return { wins, text: lostAt === 4 ? '準優勝' : `${ROUND_NAMES[lostAt]}で負け` };
  }

  /** 学校ごとの勝った試合の数（強さの動きに使う） */
  winsById(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of this.rounds) for (const b of r) if (b.winner !== undefined) {
      const id = this.entries[b.winner].id;
      out[id] = (out[id] ?? 0) + 1;
    }
    return out;
  }
}
