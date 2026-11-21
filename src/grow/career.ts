// 育成全体（何年も続く）。1年分の双六は Season。年度の切り替えで、部員・お金・機材・方針・印・卒業生の名簿を引き継ぐ。
// セーブは第3段階で。描画は知らない。

import { ENERGY, MONEY, SCHOOLS } from './constants';
import { makePrefecture, type School } from './school';
import { Rng } from '../sim/rng';
import type { TeamPolicy } from './cards';
import type { Graduate } from './roster';
import { Season, type PracticeHook } from './season';
import type { EventDef } from './events';
import type { Gender, Squad } from '../sim/types';

export interface CareerOptions {
  seed: number;
  squad: Squad;
  gender?: Gender;
  events?: EventDef[];
  onPractice?: PracticeHook;
}

export class Career {
  readonly seed: number;
  readonly gender: Gender;
  season: Season;
  /** 卒業生の名簿（後で作るOBパネル用） */
  graduates: Graduate[] = [];
  /** 県内の学校（毎年同じ。強さは成績で少しずつ変わる） */
  readonly schools: School[];
  /** 年度ごとの大会の成績（自チーム） */
  history: { year: number; tournament: string; text: string; wins: number }[] = [];
  private o: CareerOptions;

  constructor(o: CareerOptions) {
    this.o = o;
    this.seed = o.seed;
    this.gender = o.gender ?? 'male';
    this.schools = makePrefecture(o.seed);
    this.season = new Season({ seed: this.seedOf(1), squad: o.squad, year: 1, gender: this.gender, events: o.events, onPractice: o.onPractice, schools: this.schools });
  }

  get year(): number {
    return this.season.year;
  }

  get squad(): Squad {
    return this.season.squad;
  }

  private seedOf(year: number): number {
    return this.seed * 1009 + year;
  }

  /** 次の年度へ（3月31日まで進んでから）。部費が入り、盤面を作り直し、全員の体力が戻る */
  nextYear(): Season {
    const s = this.season;
    if (!s.over) throw new Error('まだ年度の途中です');
    this.graduates.push(...s.graduates);
    this.closeYear(s);
    for (const p of s.squad.players) p.energy = ENERGY.max;
    const year = s.year + 1;
    this.season = new Season({
      seed: this.seedOf(year), squad: s.squad, year, gender: this.gender,
      policy: s.policy as TeamPolicy, money: s.money + MONEY.budget, equipment: s.equipment, flags: s.flags,
      events: this.o.events, onPractice: this.o.onPractice, schools: this.schools,
    });
    return this.season;
  }

  /** 年度の終わり：大会の成績を残し、県内の学校の強さを予選の成績で少し動かす */
  private closeYear(s: Season) {
    const wins: Record<string, number> = {};
    for (const t of Object.values(s.tournaments)) {
      if (!t) continue;
      const r = t.ownResult();
      this.history.push({ year: s.year, tournament: t.def.name, text: r.text, wins: r.wins });
      if (t.def.kind !== 'prelim') continue;
      for (const [id, w] of Object.entries(t.winsById())) wins[id] = (wins[id] ?? 0) + w;
    }
    const d = SCHOOLS.drift;
    const rng = new Rng(this.seed * 7919 + s.year);
    for (const sc of this.schools) {
      // 予選2つで勝った数が平均より多ければ上がる。作った時の強さへ少し戻る
      const v = sc.strength + ((wins[sc.id] ?? 0) - 2 * d.expectedWins) * d.perWin + (sc.base - sc.strength) * d.toBase + rng.normal() * d.noise;
      sc.strength = Math.round(Math.max(d.min, Math.min(d.max, v)) * 10) / 10;
    }
  }
}
