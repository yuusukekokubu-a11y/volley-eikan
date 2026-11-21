import { describe, expect, it } from 'vitest';
import { Career } from '../src/grow/career';
import { GYM, MONEY, ROSTER } from '../src/grow/constants';
import { gymLevel, gymMul, EQUIPMENT } from '../src/grow/practice';
import { enroll, graduate, measure } from '../src/grow/roster';
import { gradeOf } from '../src/sim/player';
import { Rng } from '../src/sim/rng';
import { TRAITS } from '../src/sim/traits';
import type { Squad } from '../src/sim/types';

const startSquad = (seed = 1): Squad => {
  const sq: Squad = { players: [], captainId: null };
  const rng = new Rng(seed);
  enroll(sq, -1, 'male', rng);
  enroll(sq, 0, 'male', rng);
  return sq;
};

/** 3月31日まで進める */
function playYear(c: Career) {
  const s = c.season;
  let guard = 0;
  while (!s.over && guard++ < 1000) {
    const r = s.useCard(0);
    if (r.needBranch) s.chooseBranch(0);
    while (s.pending) s.choose(0);
    if (s.campOffer) s.decideCamp(true);
  }
}

describe('新入生', () => {
  it('人数は毎年4〜7人。1年生で、名字があり、背番号は空いている小さい番号から', () => {
    const rng = new Rng(3);
    for (let i = 0; i < 30; i++) {
      const sq: Squad = { players: [], captainId: null };
      const a = enroll(sq, 1, 'male', rng);
      expect(a.length).toBeGreaterThanOrEqual(ROSTER.newcomers.min);
      expect(a.length).toBeLessThanOrEqual(ROSTER.newcomers.max);
      expect(a.map(p => p.number)).toEqual(a.map((_, k) => k + 1));
      for (const p of a) {
        expect(gradeOf(p, 1)).toBe(1);
        expect(p.name).toMatch(/^[^\x00-\x7F]+$/);
        expect(p.trust).toBe(0);
      }
    }
    // 卒業で空いた番号から埋まる
    const sq: Squad = { players: [], captainId: null };
    enroll(sq, 1, 'male', rng);
    sq.players = sq.players.filter(p => p.number !== 2);
    expect(enroll(sq, 2, 'male', rng)[0].number).toBe(2);
  });

  it('能力の平均は35前後。特能はたまに青か赤を1つだけ（サーブの解禁・金・緑は持たない）', () => {
    const rng = new Rng(5);
    const sq: Squad = { players: [], captainId: null };
    for (let y = 1; y <= 80; y++) enroll(sq, y, 'male', rng);
    const ps = sq.players;
    const avg = ps.reduce((a, p) => a + (p.jump + p.power + p.speed + p.technique + p.block + p.stamina) / 6, 0) / ps.length;
    expect(avg).toBeGreaterThan(33);
    expect(avg).toBeLessThan(42);
    const withTrait = ps.filter(p => p.traits.length > 0);
    expect(withTrait.length).toBeGreaterThan(ps.length * 0.1);
    expect(withTrait.length).toBeLessThan(ps.length * 0.35);
    for (const p of ps) {
      expect(p.traits.length).toBeLessThanOrEqual(1);
      for (const t of p.traits) expect(['blue', 'red']).toContain((TRAITS[t] as { color?: string }).color);
    }
  });
});

describe('卒業・身体測定', () => {
  it('卒業：3年生だけが外れ、名簿に入る', () => {
    const sq = startSquad();
    const third = sq.players.filter(p => gradeOf(p, 1) === 3).length;
    const g = graduate(sq, 1);
    expect(g.length).toBe(third);
    expect(sq.players.every(p => gradeOf(p, 1) < 3)).toBe(true);
    expect(g[0].gradYear).toBe(1);
  });

  it('身体測定：1年は伸びない。2年で伸びしろの6割、3年で残り。伸びしろを超えない', () => {
    const sq: Squad = { players: [], captainId: null };
    enroll(sq, 1, 'male', new Rng(8));
    const p = sq.players[0];
    p.heightPotential = 10;
    const h = p.height;
    measure(sq, 1);
    expect(p.height).toBe(h);
    measure(sq, 2);
    expect(p.height).toBe(h + 6);
    measure(sq, 3);
    expect(p.height).toBe(h + 10);
    expect(p.heightPotential).toBe(0);
  });
});

describe('育成全体（年度の切り替え）', () => {
  it('行事で部員が入れ替わり、次の年へ進むと学年が上がる。お金・機材・名簿は引き継ぐ', () => {
    const c = new Career({ seed: 2, squad: startSquad(2), events: [] });
    const firstIds = new Set(c.squad.players.map(p => p.id));
    c.season.buy('dumbbell');
    const money = c.season.money;
    expect(() => c.nextYear()).toThrow();
    playYear(c);
    // 入学式で新入生が入り、卒業式で3年生が抜けた
    expect(c.season.newcomers.length).toBeGreaterThanOrEqual(ROSTER.newcomers.min);
    expect(c.season.graduates.length).toBeGreaterThan(0);
    expect(c.squad.players.every(p => gradeOf(p, 1) < 3)).toBe(true);
    c.nextYear();
    expect(c.year).toBe(2);
    expect(c.graduates.length).toBeGreaterThan(0);
    expect(c.season.money).toBe(money + MONEY.budget);
    expect(c.season.equipment).toContain('dumbbell');
    expect(c.squad.players.some(p => !firstIds.has(p.id))).toBe(true);
    expect(c.squad.players.every(p => p.energy === 100)).toBe(true);
  });
});

describe('体育館レベルの上限', () => {
  it('機材を全部そろえるとレベル19が上限', () => {
    expect(gymLevel(EQUIPMENT.map(e => e.id))).toBe(GYM.maxLevel);
    expect(gymMul(GYM.maxLevel)).toBeCloseTo(1 + 18 * GYM.perLevelGain);
  });
});

/** 条件を満たすまで進める（合宿は answer で返事をする） */
function until(c: Career, done: () => boolean, answer = true) {
  const s = c.season;
  let guard = 0;
  while (!done() && !s.over && guard++ < 1000) {
    const r = s.useCard(0);
    if (r.needBranch) s.chooseBranch(0);
    while (s.pending) s.choose(0);
    if (s.campOffer) s.decideCamp(answer);
  }
}

describe('練習指示・引退・合宿・練習試合', () => {
  it('練習指示を変えられるのは月初め（通り過ぎても止まる）と練習指示カードの後だけ', () => {
    const c = new Career({ seed: 4, squad: startSquad(4), events: [] });
    const s = c.season;
    const p = c.squad.players[0];
    s.setPractice(p.id, { focus: 'power' }); // 4月1日は開いている
    expect(p.practice.focus).toBe('power');
    let closed = false;
    for (let i = 0; i < 40 && !closed; i++) {
      const before = s.date.month;
      const r = s.useCard(0);
      if (r.needBranch) s.chooseBranch(0);
      while (s.pending) s.choose(0);
      if (s.campOffer) s.decideCamp(false);
      if (!s.practiceOpen) { closed = true; expect(() => s.setPractice(p.id, { focus: 'jump' })).toThrow(); }
      // 月が変わったら、必ず1日で止まっている
      if (s.date.month !== before && !r.needBranch) expect(s.date.day).toBe(1);
    }
    expect(closed).toBe(true);
    until(c, () => s.date.month === 5);
    expect(s.date.day).toBe(1);
    expect(s.practiceOpen).toBe(true);
    s.setPractice(p.id, { focus: 'jump', position: 'OP' });
    expect(p.practice).toEqual({ focus: 'jump', position: 'OP' });
    // 練習指示カード：使うと進まずに開く
    s.useCard(0);
    s.hand[0] = { days: 0, practiceId: '', instruction: true };
    const day = s.day;
    const r = s.useCard(0);
    expect(r.practiceOpen).toBe(true);
    expect(s.day).toBe(day);
    s.setPractice(p.id, { focus: 'auto' });
  });

  it('3年生は1月の引退の後、練習にも出ず、3月に卒業する', () => {
    const c = new Career({ seed: 6, squad: startSquad(6), events: [] });
    const s = c.season;
    until(c, () => s.date.month === 2);
    const third = c.squad.players.filter(p => gradeOf(p, 1) === 3);
    expect(third.length).toBeGreaterThan(0);
    expect(third.every(p => p.retired)).toBe(true);
    expect(c.squad.players.filter(p => gradeOf(p, 1) < 3).every(p => !p.retired)).toBe(true);
    const power = third.map(p => p.power + p.exp.power);
    const energy = third.map(p => p.energy);
    until(c, () => s.date.month === 3 && s.date.day > 1);
    expect(third.map(p => p.energy)).toEqual(energy);
    expect(c.squad.players.some(p => p.retired)).toBe(false);
    expect(power.length).toBe(third.length);
    expect(() => s.setPractice(third[0].id, { focus: 'power' })).toThrow();
  });

  it('合宿：1ヶ月前の月初めに開催するかを選ぶ。開催すると体力が多く減り、経験が多く入る', () => {
    const run = (hold: boolean) => {
      const c = new Career({ seed: 8, squad: startSquad(8), events: [] });
      const s = c.season;
      until(c, () => s.campOffer !== null || s.date.month === 7, hold);
      expect(s.date).toEqual({ month: 7, day: 1 });
      until(c, () => s.date.month === 8 && s.date.day > 8, hold);
      expect(s.camps.summer).toBe(hold);
      return c.squad.players.reduce((a, p) => a + p.jump + p.power + p.speed + p.technique + p.block + p.stamina, 0);
    };
    expect(run(true)).toBeGreaterThan(run(false));
  });

  it('練習試合の日は止まる', () => {
    const c = new Career({ seed: 9, squad: startSquad(9), events: [] });
    const s = c.season;
    until(c, () => s.date.month === 5 && s.date.day >= 5);
    expect(s.date).toEqual({ month: 5, day: 5 });
    expect(s.panelAt(s.day).fixedId).toBe('practiceMatch-5-5');
  });
});
