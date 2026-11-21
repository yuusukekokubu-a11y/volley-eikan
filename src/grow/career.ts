// 育成全体（何年も続く）。1年分の双六は Season。年度の切り替えで、部員・お金・機材・方針・印・卒業生の名簿を引き継ぐ。
// セーブは第3段階で。描画は知らない。

import { ENERGY, MONEY } from './constants';
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
  private o: CareerOptions;

  constructor(o: CareerOptions) {
    this.o = o;
    this.seed = o.seed;
    this.gender = o.gender ?? 'male';
    this.season = new Season({ seed: this.seedOf(1), squad: o.squad, year: 1, gender: this.gender, events: o.events, onPractice: o.onPractice });
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
    for (const p of s.squad.players) p.energy = ENERGY.max;
    const year = s.year + 1;
    this.season = new Season({
      seed: this.seedOf(year), squad: s.squad, year, gender: this.gender,
      policy: s.policy as TeamPolicy, money: s.money + MONEY.budget, equipment: s.equipment, flags: s.flags,
      events: this.o.events, onPractice: this.o.onPractice,
    });
    return this.season;
  }
}
