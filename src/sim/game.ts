// 試合（3セットマッチ・5セットマッチ）。1セットの進行（SetGame）をセットごとに使う。描画は知らない。
// セットの間・試合の前に止まり、先発メンバーと並び（ローテーション）、方針（作戦3項目）を変えられる（自チームだけ）。
// タイムアウトの効果・連続失点・タイムアウトと交代の回数はセットごとに作り直すので、次のセットに残らない。
// 疲れは次のセットに持ち越し、セットの間に少し回復する。

import { FATIGUE, MATCH } from './constants';
import { OWN, SetGame } from './match';
import { Rng } from './rng';
import type { Gender, LineupSlot, Player, Tactics, TeamId, TeamState } from './types';

export type BestOf = 3 | 5;
/** 試合の前／セット中／セットの間／試合の終わり */
export type MatchPhase = 'pregame' | 'set' | 'break' | 'over';

export interface MatchOptions {
  gender: Gender;
  bestOf: BestOf;
  teams: Record<TeamId, TeamState>;
  bench: Record<TeamId, Player[]>;
  seed: number;
  managerSkills?: string[];
}

export interface SetResult { A: number; B: number; winner: TeamId }

const other = (t: TeamId): TeamId => (t === 'A' ? 'B' : 'A');

export class Match {
  readonly gender: Gender;
  readonly bestOf: BestOf;
  readonly setsToWin: number;
  phase: MatchPhase = 'pregame';
  /** 次のセットの先発と並び・方針（試合の前とセットの間に変えられる）。初期値は前のセットの先発 */
  lineups: Record<TeamId, TeamState>;
  bench: Record<TeamId, Player[]>;
  results: SetResult[] = [];
  setsWon: Record<TeamId, number> = { A: 0, B: 0 };
  current: SetGame | null = null;
  fatigue: Record<string, number> = {};
  /** 各セットの最初のサーブ */
  firstServes: TeamId[] = [];
  winner?: TeamId;
  private rng: Rng;
  private seed: number;
  private managerSkills: string[];

  constructor(o: MatchOptions) {
    this.gender = o.gender;
    this.bestOf = o.bestOf;
    this.setsToWin = MATCH.setsToWin[o.bestOf];
    this.lineups = { A: o.teams.A, B: o.teams.B };
    this.bench = { A: [...o.bench.A], B: [...o.bench.B] };
    this.seed = o.seed;
    this.rng = new Rng(o.seed * 31 + 7);
    this.managerSkills = o.managerSkills ?? [];
  }

  get setNumber(): number {
    return this.results.length + (this.phase === 'set' ? 1 : 0);
  }

  /** 次に始めるセットが最終セットか */
  get nextIsFinal(): boolean {
    return this.results.length + 1 === this.bestOf;
  }

  /** 自チーム（赤）が右側のコートにいるか。毎セットの終わりと、最終セットの8点でコートチェンジする */
  get swapped(): boolean {
    const sets = this.results.length; // 終わったセットの数だけ入れ替わる
    const mid = this.phase === 'set' && this.current?.courtChanged ? 1 : 0; // 最終セットの8点
    return (sets + mid) % 2 === 1;
  }

  // ---------------- 試合の前・セットの間の変更（自チームだけ） ----------------

  private editable() {
    if (this.phase !== 'pregame' && this.phase !== 'break') throw new Error('試合の前かセットの間にだけ変えられます');
  }

  /** 並びの2か所を入れ替える（選手と役割がいっしょに動く） */
  swapSlots(i: number, j: number) {
    this.editable();
    const r = [...this.lineups[OWN].rotation];
    [r[i], r[j]] = [r[j], r[i]];
    this.lineups[OWN] = { ...this.lineups[OWN], rotation: r };
  }

  /** 並び全体を1つ回す（誰がゾーン1から始めるかを変える） */
  rotateLineup() {
    this.editable();
    const r = this.lineups[OWN].rotation;
    this.lineups[OWN] = { ...this.lineups[OWN], rotation: [...r.slice(1), r[0]] };
  }

  /** 先発の1人を控えと入れ替える（入る選手はその位置の役割を引き継ぐ） */
  replaceStarter(slot: number, benchId: string) {
    this.editable();
    const team = this.lineups[OWN];
    const incoming = this.bench[OWN].find(p => p.id === benchId);
    if (!incoming) throw new Error('控えにいない選手です');
    const out = team.rotation[slot].player;
    const rotation: LineupSlot[] = team.rotation.map((s, i) => (i === slot ? { ...s, player: incoming } : s));
    this.lineups[OWN] = { ...team, rotation };
    this.bench[OWN] = [...this.bench[OWN].filter(p => p.id !== benchId), out];
  }

  /** リベロを控えと入れ替える */
  replaceLibero(benchId: string) {
    this.editable();
    const team = this.lineups[OWN];
    const incoming = this.bench[OWN].find(p => p.id === benchId);
    if (!incoming) throw new Error('控えにいない選手です');
    const out = team.libero;
    this.lineups[OWN] = { ...team, libero: incoming };
    this.bench[OWN] = [...this.bench[OWN].filter(p => p.id !== benchId), ...(out ? [out] : [])];
  }

  setTactics(t: Partial<Tactics>) {
    this.editable();
    this.lineups[OWN] = { ...this.lineups[OWN], tactics: { ...this.lineups[OWN].tactics, ...t } };
  }

  // ---------------- 進行 ----------------

  /** 次のセットを始める。サーブ権は第1セットと最終セットが抽選、ほかは前のセットと交互 */
  startSet(): SetGame {
    if (this.phase !== 'pregame' && this.phase !== 'break') throw new Error('セットを始められる時ではありません');
    const n = this.results.length + 1;
    const final = n === this.bestOf;
    const serving: TeamId = n === 1 || final
      ? (this.rng.chance(0.5) ? 'A' : 'B')
      : other(this.firstServes[this.firstServes.length - 1]);
    this.firstServes.push(serving);
    this.current = new SetGame({
      gender: this.gender, seed: this.seed * 100 + n, setNumber: n, finalSet: final, serving,
      teams: { A: this.lineups.A, B: this.lineups.B }, bench: this.bench,
      managerSkills: this.managerSkills, fatigue: this.fatigue,
    });
    this.phase = 'set';
    return this.current;
  }

  /** セットが終わった後に呼ぶ。試合が終わったか、セットの間に入る */
  finishSet() {
    const g = this.current;
    if (!g || !g.over) throw new Error('セットはまだ終わっていません');
    this.results.push({ A: g.score.A, B: g.score.B, winner: g.winner! });
    this.setsWon[g.winner!]++;
    // 疲れは持ち越し、セットの間に少し回復する
    this.fatigue = {};
    for (const [id, f] of Object.entries(g.fatigue)) this.fatigue[id] = Math.max(0, f - FATIGUE.setBreakRecover);
    this.current = null;
    if (this.setsWon[g.winner!] >= this.setsToWin) {
      this.winner = g.winner!;
      this.phase = 'over';
    } else this.phase = 'break';
  }
}
