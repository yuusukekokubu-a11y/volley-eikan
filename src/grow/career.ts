// 育成全体（何年も続く）。1年分の双六は Season。年度の切り替えで、部員・お金・機材・方針・印・卒業生の名簿を引き継ぐ。
// セーブは第3段階で。描画は知らない。

import { ENERGY, REPUTATION, SCHOOLS } from './constants';
import { closeReputation, expireSkills, rankOf, type OwnedSkill, type Reputation } from './reputation';
import { makePrefecture, type School } from './school';
import { Rng } from '../sim/rng';
import { MANAGER_SKILLS } from '../sim/manager';
import { fill, TEXTS, type Message } from './texts';
import type { TeamPolicy } from './cards';
import type { Graduate } from './roster';
import { Season, type PracticeHook, type SeasonData } from './season';
import type { EventDef } from './events';
import type { Gender, Squad } from '../sim/types';

export interface CareerOptions {
  seed: number;
  squad: Squad;
  gender?: Gender;
  events?: EventDef[];
  onPractice?: PracticeHook;
}

/** 育成全体のセーブする形 */
export interface CareerData {
  seed: number;
  gender: Gender;
  graduates: Graduate[];
  schools: School[];
  history: Career['history'];
  reputation: Reputation;
  managerSkills: OwnedSkill[];
  expired: string[];
  expiredMessages: Message[];
  season: SeasonData;
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
  /** 評判（最初は弱小） */
  readonly reputation: Reputation = { points: 0 };
  /** 持っている監督特能（3つまで。期限つき） */
  readonly managerSkills: OwnedSkill[] = [];
  /** 前の年度の終わりに失効した監督特能と、その文章（仮の画面で知らせる） */
  expired: string[] = [];
  expiredMessages: Message[] = [];
  private o: CareerOptions;

  constructor(o: CareerOptions) {
    this.o = o;
    this.seed = o.seed;
    this.gender = o.gender ?? 'male';
    this.schools = makePrefecture(o.seed);
    this.season = new Season({ seed: this.seedOf(1), squad: o.squad, year: 1, gender: this.gender, events: o.events, onPractice: o.onPractice, schools: this.schools, reputation: this.reputation, managerSkills: this.managerSkills });
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

  /** 次の年度へ（3月31日まで進んでから）。評判が成績で下がることがあり、監督特能の期限が切れる。部費（評判で決まる）が入り、盤面を作り直し、全員の体力が戻る */
  nextYear(): Season {
    const s = this.season;
    if (!s.over) throw new Error('まだ年度の途中です');
    this.graduates.push(...s.graduates);
    this.closeYear(s);
    for (const p of s.squad.players) p.energy = ENERGY.max;
    const year = s.year + 1;
    closeReputation(this.reputation, s.repGained);
    this.expired = expireSkills(this.managerSkills, year);
    // 失効の理由づけは2つからランダム（戦術の流行が変わる／研究される）
    const rng = new Rng(this.seed * 4999 + year);
    this.expiredMessages = this.expired.map(id => ({ text: fill(rng.pick(TEXTS.skillExpire), { skill: MANAGER_SKILLS[id].name }) }));
    this.season = new Season({
      seed: this.seedOf(year), squad: s.squad, year, gender: this.gender,
      policy: s.policy as TeamPolicy, money: s.money + REPUTATION.budget[rankOf(this.reputation.points)], equipment: s.equipment, flags: s.flags,
      events: this.o.events, onPractice: this.o.onPractice, schools: this.schools,
      reputation: this.reputation, managerSkills: this.managerSkills, obs: this.graduates,
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

  // ---------------- セーブ ----------------

  toData(): CareerData {
    return {
      seed: this.seed, gender: this.gender, graduates: this.graduates, schools: this.schools, history: this.history,
      reputation: this.reputation, managerSkills: this.managerSkills, expired: this.expired, expiredMessages: this.expiredMessages,
      season: this.season.toData(),
    };
  }

  /** セーブから読み戻す。events・onPractice は保存しない（テストで仮のものを渡す時だけ） */
  static fromData(d: CareerData, o: { events?: EventDef[]; onPractice?: PracticeHook } = {}): Career {
    const c = Object.create(Career.prototype) as Career;
    Object.assign(c, {
      o: { seed: d.seed, squad: d.season.squad, gender: d.gender, ...o },
      seed: d.seed, gender: d.gender, graduates: d.graduates, schools: d.schools, history: d.history,
      reputation: d.reputation, managerSkills: d.managerSkills, expired: d.expired, expiredMessages: d.expiredMessages,
    });
    c.season = Season.fromData(d.season, { schools: c.schools, reputation: c.reputation, managerSkills: c.managerSkills, obs: c.graduates, ...o });
    return c;
  }
}
