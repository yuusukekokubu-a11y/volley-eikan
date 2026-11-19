// 1セットの進行（仕様「試合の采配」）。描画は知らない。
// 得点・サーブ権・ローテーション・セットの終わり、停止（定期・連続失点）、タイムアウト、選手交代、疲れを扱う。
// 停止・タイムアウト・交代は自チーム（A）だけ。相手チーム（B）の采配は未決事項。

import { FATIGUE, MATCH } from './constants';
import { MANAGER_SKILLS, timeoutChoices, type ManagerSkill } from './manager';
import { simulateRally } from './rally';
import type { StatEffect } from './traits';
import type { Gender, Player, RallyRecord, Tactics, TeamId, TeamState } from './types';

export const OWN: TeamId = 'A';

export type StopReason = 'periodic' | 'streak';

export interface StopInfo {
  reason: StopReason;
  /** 画面に出す止まった理由（「10点の区切り」「3連続失点」など） */
  label: string;
  /** コートチェンジと同時（最終セットの8点） */
  courtChange?: boolean;
}

export interface SubPair {
  /** 下がった先発の選手と、入った控えの選手 */
  starterId: string;
  subId: string;
  /** in＝控えが入っている、closed＝先発が戻った（この組はもう交代できない） */
  status: 'in' | 'closed';
}

export interface SetOptions {
  gender: Gender;
  teams: Record<TeamId, TeamState>;
  bench: Record<TeamId, Player[]>;
  serving: TeamId;
  seed: number;
  finalSet?: boolean;
  setNumber?: number;
  /** 自チームの監督が持っている監督特能（なければ基本効果だけ） */
  managerSkills?: string[];
  /** 前のセットから持ち越す疲れ */
  fatigue?: Record<string, number>;
}

interface ActiveBuff { team: TeamId; effects: StatEffect[]; left: number; name: string }

const other = (t: TeamId): TeamId => (t === 'A' ? 'B' : 'A');

/** ローテーションを1つ回す（ゾーン2の選手がゾーン1へ） */
export function rotateTeam(team: TeamState): TeamState {
  const r = team.rotation;
  return { ...team, rotation: [...r.slice(1), r[0]] };
}

export class SetGame {
  readonly gender: Gender;
  readonly finalSet: boolean;
  readonly setNumber: number;
  readonly target: number;
  teams: Record<TeamId, TeamState>;
  bench: Record<TeamId, Player[]>;
  score: Record<TeamId, number> = { A: 0, B: 0 };
  serving: TeamId;
  timeoutsLeft: Record<TeamId, number> = { A: MATCH.timeouts, B: MATCH.timeouts };
  subsUsed: Record<TeamId, number> = { A: 0, B: 0 };
  pairs: Record<TeamId, SubPair[]> = { A: [], B: [] };
  fatigue: Record<string, number> = {};
  /** 連続失点（そのチームが続けて失った点） */
  lostStreak: Record<TeamId, number> = { A: 0, B: 0 };
  buffs: ActiveBuff[] = [];
  winner?: TeamId;
  rallies = 0;
  courtChanged = false;
  readonly managerSkills: string[];
  private seed: number;
  private starters: Record<TeamId, Set<string>>;
  private periodicDone = new Set<number>();
  /** 次のラリーの前に止まる（試合開始の0点の停止） */
  private pending: StopInfo | null = null;

  constructor(o: SetOptions) {
    this.gender = o.gender;
    this.finalSet = !!o.finalSet;
    this.setNumber = o.setNumber ?? 1;
    this.target = this.finalSet ? MATCH.finalSetPoints : MATCH.setPoints;
    this.teams = { A: o.teams.A, B: o.teams.B };
    this.bench = { A: [...o.bench.A], B: [...o.bench.B] };
    this.serving = o.serving;
    this.seed = o.seed;
    this.managerSkills = o.managerSkills ?? [];
    this.fatigue = { ...(o.fatigue ?? {}) };
    this.starters = {
      A: new Set(o.teams.A.rotation.map(s => s.player.id)),
      B: new Set(o.teams.B.rotation.map(s => s.player.id)),
    };
    this.pending = this.periodicStop();
  }

  get over(): boolean {
    return this.winner !== undefined;
  }

  /** 次のラリーの前に止まるか（試合開始時の0点の停止など）。取り出すと消える */
  takePendingStop(): StopInfo | null {
    const p = this.pending;
    this.pending = null;
    return p;
  }

  /** 1ラリー進める。止まる場合は stop に理由が入る（自チームの停止だけ） */
  next(): { rec: RallyRecord; stop: StopInfo | null } {
    if (this.over) throw new Error('セットは終わっています');
    const input = {
      gender: this.gender,
      teams: { A: this.teamForRally('A'), B: this.teamForRally('B') },
      serving: this.serving,
      seed: this.seed * 1000 + this.rallies,
      context: { setNumber: this.setNumber, isFinalSet: this.finalSet, score: { ...this.score } },
    };
    const rec = simulateRally(input);
    this.rallies++;
    this.apply(rec);
    let stop: StopInfo | null = null;
    if (!this.over) {
      const per = this.periodicStop();
      const str = this.streakStop();
      // 定期の停止と連続失点が同時なら、両方の理由を出す
      stop = per && str ? { ...per, label: `${per.label}・${str.label}` } : per ?? str;
    }
    return { rec, stop };
  }

  private teamForRally(t: TeamId): TeamState {
    const team = this.teams[t];
    const fatigue: Record<string, number> = {};
    for (const p of [...team.rotation.map(s => s.player), ...(team.libero ? [team.libero] : [])]) fatigue[p.id] = this.fatigue[p.id] ?? 0;
    const buffs = this.buffs.filter(b => b.team === t).flatMap(b => b.effects);
    return { ...team, fatigue, buffs };
  }

  private apply(rec: RallyRecord) {
    const w = rec.winner;
    const l = other(w);
    this.score[w]++;
    this.lostStreak[l]++;
    this.lostStreak[w] = 0;
    // サイドアウト：サーブ権が移り、得点した側がローテーションを回す
    if (w !== this.serving) {
      this.teams[w] = rotateTeam(this.teams[w]);
      this.serving = w;
    }
    // 疲れ：ラリーの負荷とスタミナから積み上げる。ベンチの選手は少し回復する
    const onCourt = new Set<string>();
    for (const t of ['A', 'B'] as TeamId[]) {
      const team = this.teams[t];
      for (const p of [...team.rotation.map(s => s.player), ...(team.libero ? [team.libero] : [])]) {
        onCourt.add(p.id);
        const load = rec.load[p.id] ?? 0;
        this.fatigue[p.id] = Math.min(1, (this.fatigue[p.id] ?? 0) + load * FATIGUE.perLoad * Math.max(0.2, FATIGUE.pivot - p.stamina / 100));
      }
      for (const p of this.bench[t]) if (!onCourt.has(p.id)) this.fatigue[p.id] = Math.max(0, (this.fatigue[p.id] ?? 0) - FATIGUE.benchRecover);
    }
    // タイムアウトの効果は決まったラリー数で切れる
    for (const b of this.buffs) b.left--;
    this.buffs = this.buffs.filter(b => b.left > 0);
    // セットの終わり
    if (this.score[w] >= this.target && this.score[w] - this.score[l] >= MATCH.winBy) this.winner = w;
    if (this.finalSet && !this.courtChanged && Math.max(this.score.A, this.score.B) >= MATCH.finalCourtChange) this.courtChanged = true;
  }

  /** 定期の停止：どちらかの点数が区切りの点に初めて達した時（0は試合開始時） */
  private periodicStop(): StopInfo | null {
    const marks = this.finalSet ? MATCH.finalPeriodicStops : MATCH.periodicStops;
    const top = Math.max(this.score.A, this.score.B);
    for (const m of marks) {
      if (top >= m && !this.periodicDone.has(m)) {
        // 飛ばした区切り（あり得ないが念のため）もまとめて済ませる
        for (const k of marks) if (k <= top) this.periodicDone.add(k);
        const court = this.finalSet && m === MATCH.finalCourtChange;
        return { reason: 'periodic', label: m === 0 ? '試合開始' : court ? `${m}点の区切り（コートチェンジ）` : `${m}点の区切り`, courtChange: court };
      }
    }
    return null;
  }

  /** 連続失点の停止：点数帯（両チームの高い方）で止まる連続失点が決まる。5点以上リードしていれば1つ増やす */
  private streakStop(): StopInfo | null {
    const n = this.lostStreak[OWN];
    if (n === 0) return null;
    const need = this.streakNeeded();
    // 定期の停止の直後でも、条件を満たせば止める（ちょうど達した時だけ止まる）
    if (n === need) return { reason: 'streak', label: `${n}連続失点` };
    return null;
  }

  streakNeeded(): number {
    const table = this.finalSet ? MATCH.finalStreakStops : MATCH.streakStops;
    const top = Math.max(this.score.A, this.score.B);
    let need = table[0].streak;
    for (const row of table) if (top >= row.from) need = row.streak;
    if (this.score[OWN] - this.score[other(OWN)] >= MATCH.leadForLooserStop) need++;
    return need;
  }

  // ---------------- タイムアウト ----------------

  timeoutChoices(): ManagerSkill[] {
    return timeoutChoices(this.managerSkills);
  }

  canTimeout(team: TeamId = OWN): boolean {
    return !this.over && this.timeoutsLeft[team] > 0;
  }

  /** タイムアウトを取り、監督特能を1つ発動する。方針（作戦）の変更もここでできる */
  timeout(skillId: string, tactics?: Partial<Tactics>, team: TeamId = OWN) {
    if (!this.canTimeout(team)) throw new Error('タイムアウトは残っていません');
    const choices = this.timeoutChoices().map(s => s.id);
    if (team === OWN && !choices.includes(skillId)) throw new Error(`使えない監督特能です: ${skillId}`);
    const s = MANAGER_SKILLS[skillId];
    this.timeoutsLeft[team]--;
    if (s.own) this.buffs.push({ team, effects: s.own, left: MATCH.timeoutRallies, name: s.name });
    if (s.opp) this.buffs.push({ team: other(team), effects: s.opp, left: MATCH.timeoutRallies, name: s.name });
    if (tactics) this.teams[team] = { ...this.teams[team], tactics: { ...this.teams[team].tactics, ...tactics } };
  }

  // ---------------- 選手交代 ----------------

  /**
   * 今できる交代の組み合わせ（下がる選手 → 入る選手）。
   * ・1セット6回まで。リベロは対象外（出入りは自動）
   * ・先発の選手は、まだ出ていない控えと交代できる
   * ・控えで入った選手は、自分と入れ替わった先発とだけ交代できる（先発が戻る）
   * ・先発が戻った組は、もう交代できない
   */
  validSubs(team: TeamId = OWN): { outId: string; inId: string }[] {
    if (this.over || this.subsUsed[team] >= MATCH.substitutions) return [];
    const res: { outId: string; inId: string }[] = [];
    const pairs = this.pairs[team];
    const used = new Set(pairs.map(p => p.subId));
    const benchIds = new Set(this.bench[team].map(p => p.id));
    for (const slot of this.teams[team].rotation) {
      const id = slot.player.id;
      const asSub = pairs.find(p => p.subId === id && p.status === 'in');
      if (asSub) {
        if (benchIds.has(asSub.starterId)) res.push({ outId: id, inId: asSub.starterId });
        continue;
      }
      if (!this.starters[team].has(id) || pairs.some(p => p.starterId === id)) continue;
      for (const b of this.bench[team]) if (!used.has(b.id) && !this.starters[team].has(b.id)) res.push({ outId: id, inId: b.id });
    }
    return res;
  }

  substitute(outId: string, inId: string, team: TeamId = OWN) {
    if (!this.validSubs(team).some(s => s.outId === outId && s.inId === inId)) throw new Error('その交代はできません');
    const t = this.teams[team];
    const incoming = this.bench[team].find(p => p.id === inId)!;
    const outgoing = t.rotation.find(s => s.player.id === outId)!.player;
    this.teams[team] = { ...t, rotation: t.rotation.map(s => (s.player.id === outId ? { ...s, player: incoming } : s)) };
    this.bench[team] = [...this.bench[team].filter(p => p.id !== inId), outgoing];
    const back = this.pairs[team].find(p => p.subId === outId && p.status === 'in');
    if (back) back.status = 'closed';
    else this.pairs[team].push({ starterId: outId, subId: inId, status: 'in' });
    this.subsUsed[team]++;
  }
}
