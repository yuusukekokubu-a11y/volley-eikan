import { finishStep } from '../src/grow/season';
import { describe, expect, it } from 'vitest';
import { Career } from '../src/grow/career';
import { CAMP, GYM, MONEY, PRACTICE_MATCH, ROSTER, SATURDAY } from '../src/grow/constants';
import { campOf, indexOf, makeBoard } from '../src/grow/board';
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
    finishStep(s, s.useCard(s.firstUsable()));
    while (s.pending) s.choose(0);
    if (s.matchChoices) s.chooseMatch(0);
        if (s.matchInvite) s.answerInvite(true);
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

/** 条件を満たすまで進める（練習試合は受ける） */
function until(c: Career, done: () => boolean) {
  const s = c.season;
  let guard = 0;
  while (!done() && !s.over && guard++ < 1000) {
    finishStep(s, s.useCard(s.firstUsable()));
    while (s.pending) s.choose(0);
    if (s.matchChoices) s.chooseMatch(0);
    if (s.matchInvite) s.answerInvite(true);
  }
}

describe('練習指示・引退・合宿・練習試合', () => {
  it('練習指示を変えられるのは月初め（通り過ぎる時は一時停止して、残りの日数を続けて進む）と練習指示カードの後だけ', () => {
    const c = new Career({ seed: 4, squad: startSquad(4), events: [] });
    const s = c.season;
    const p = c.squad.players[0];
    s.setPractice(p.id, { focus: 'power' }); // 4月1日は開いている
    expect(p.practice.focus).toBe('power');
    let closed = false;
    let paused = false;
    for (let i = 0; i < 80 && !(closed && paused); i++) {
      const i0 = s.firstUsable();
      const days = s.hand[i0].days;
      const before = s.day;
      let r = s.useCard(i0);
      while (r.needBranch) r = s.chooseBranch(0);
      if (r.paused) {
        // 月初めで一時停止：練習指示を変えられ、続きを進むと残りの日数を進む
        paused = true;
        expect(s.date.day).toBe(1);
        expect(() => s.useCard(s.firstUsable())).toThrow();
        s.setPractice(p.id, { focus: 'jump' });
        const r2 = finishStep(s, s.resume());
        if (!r2.match && s.panelAt(s.day).kind !== 'fixed' && !r2.practiceOpen) expect(s.day - before).toBe(days);
      }
      while (s.pending) s.choose(0);
      if (s.matchChoices) s.chooseMatch(0);
      if (s.matchInvite) s.answerInvite(true);
      if (!s.practiceOpen) { closed = true; expect(() => s.setPractice(p.id, { focus: 'jump' })).toThrow(); }
    }
    expect(closed).toBe(true);
    expect(paused).toBe(true);
    // 練習指示カード：使うと進まずに開く
    s.useCard(s.firstUsable());
    s.hand[0] = { days: 0, practiceId: '', special: 'instruction' };
    const day = s.day;
    const r = s.useCard(s.firstUsable());
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

  it('合宿：夏と冬に自動で開催。合宿中は練習カードだけで緑パネルはなく、経験が多く入り、特能を覚えることがある', () => {
    for (const k of ['summer', 'winter'] as const) {
      const start = indexOf(CAMP[k].start.month, CAMP[k].start.day);
      for (let seed = 1; seed <= 5; seed++) {
        const b = makeBoard(seed);
        for (let d = start; d < start + CAMP.days; d++) expect(b[d].lanes.some(l => l.kind === 'green')).toBe(false);
      }
    }
    let traits = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const c = new Career({ seed, squad: startSquad(seed), events: [] });
      const s = c.season;
      const before = c.squad.players.reduce((a, p) => a + p.traits.length, 0);
      until(c, () => !!campOf(s.day));
      if (!campOf(s.day)) continue;
      expect(s.hand.every(card => !card.special)).toBe(true);
      until(c, () => s.date.month === 8);
      traits += c.squad.players.reduce((a, p) => a + p.traits.length, 0) - before;
    }
    expect(traits).toBeGreaterThan(0);
  });

  it('練習試合：申し込みカードで3校から選ぶと次の土曜日に止まる。大会の20日前からは使えない', () => {
    const c = new Career({ seed: 9, squad: startSquad(9), events: [] });
    const s = c.season;
    expect(s.scheduledMatch).toBeNull();
    s.hand[0] = { days: 0, practiceId: '', special: 'matchOffer' };
    const r = s.useCard(0);
    expect(r.matchChoices).toHaveLength(PRACTICE_MATCH.candidates);
    expect(() => s.useCard(s.firstUsable())).toThrow();
    s.chooseMatch(1);
    const day = s.scheduledMatch!.day;
    expect(s.weekday(day)).toBe(SATURDAY);
    expect(day).toBeGreaterThan(s.day);
    // もう予定があるので、もう1枚は使えない
    expect(s.canUse({ days: 0, practiceId: '', special: 'matchOffer' })).toBe(false);
    let stopped: unknown = null;
    for (let i = 0; i < 20 && !stopped; i++) {
      const res = finishStep(s, s.useCard(s.firstUsable()));
      while (s.pending) s.choose(0);
      if (res.match) stopped = res.match;
    }
    expect(s.day).toBe(day);
    expect(stopped).toBeTruthy();
    expect(s.scheduledMatch).toBeNull();
    // インターハイ予選（6/1）の20日前からは使えない
    until(c, () => s.day >= indexOf(5, 15));
    s.scheduledMatch = null;
    if (s.day < indexOf(6, 1)) expect(s.canUse({ days: 0, practiceId: '', special: 'matchOffer' })).toBe(false);
  });

  it('白パネルでまれに他校から申し込みが来る。受けると次の土曜日、断ると予定は入らない', () => {
    let seen = 0;
    for (let seed = 1; seed <= 30 && seen < 2; seed++) {
      const c = new Career({ seed, squad: startSquad(seed), events: [] });
      const s = c.season;
      s.scheduledMatch = null;
      for (let i = 0; i < 300 && !s.over && seen < 2; i++) {
        const r = finishStep(s, s.useCard(s.firstUsable()));
        while (s.pending) s.choose(0);
        if (s.matchChoices) s.chooseMatch(0);
        if (r.matchInvite) {
          expect(s.panelAt(s.day).kind).toBe('white');
          expect(() => s.useCard(s.firstUsable())).toThrow();
          const accept = seen === 0;
          s.answerInvite(accept);
          if (accept) expect(s.weekday(s.scheduledMatch!.day)).toBe(SATURDAY);
          else expect(s.scheduledMatch).toBeNull();
          seen++;
          s.scheduledMatch = null;
        }
      }
    }
    expect(seen).toBe(2);
  });

  it('1年目の6月に、マネージャーが練習試合を組んで知らせる（2年目からはない）', () => {
    const c = new Career({ seed: 3, squad: startSquad(3), events: [] });
    const s = c.season;
    const said: string[] = [];
    let guard = 0;
    while (!(s.date.month === 6 && s.date.day > 1) && guard++ < 200) {
      const r = finishStep(s, s.useCard(s.firstUsable()));
      for (const m of r.messages ?? []) said.push(m.text);
      while (s.pending) s.choose(0);
      if (s.matchChoices) s.chooseMatch(0);
      if (s.matchInvite) s.answerInvite(false);
    }
    expect(s.scheduledMatch?.via).toBe('manager');
    expect(s.weekday(s.scheduledMatch!.day)).toBe(SATURDAY);
    expect(said.some(t => t.startsWith('監督、') && t.includes('との練習試合を組んでおきました'))).toBe(true);
    until(c, () => s.over);
    c.nextYear();
    until(c, () => c.season.date.month === 7);
    expect(c.season.flags.managerMatchDone).toBe(true);
  });

  it('合宿の始まり・特能・終わりの文章が出る', () => {
    const c = new Career({ seed: 2, squad: startSquad(2), events: [] });
    const s = c.season;
    const said: string[] = [];
    let guard = 0;
    while (s.date.month !== 8 && guard++ < 300) {
      const r = finishStep(s, s.useCard(s.firstUsable()));
      for (const m of r.messages ?? []) said.push(m.text);
      while (s.pending) s.choose(0);
      if (s.matchChoices) s.chooseMatch(0);
      if (s.matchInvite) s.answerInvite(false);
    }
    expect(said).toContain('今日から夏合宿です！5日間、みっちり練習しましょう！');
    expect(said).toContain('合宿おつかれさまでした！みんな、ひと回りたくましくなりましたね');
    expect(said.some(t => /^.+が合宿で『.+』を身につけた！$/.test(t))).toBe(true);
  });
});
