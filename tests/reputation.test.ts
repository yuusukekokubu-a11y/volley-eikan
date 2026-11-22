import { describe, expect, it } from 'vitest';
import { makeBoard } from '../src/grow/board';
import { Career } from '../src/grow/career';
import { MANAGER_GAIN, REPUTATION } from '../src/grow/constants';
import { closeReputation, expireSkills, learnSkill, rankName, rankOf, rollSkill, type OwnedSkill } from '../src/grow/reputation';
import { enroll } from '../src/grow/roster';
import { finishStep, useQuickBouts, type Season } from '../src/grow/season';
import { Rng } from '../src/sim/rng';
import type { Squad } from '../src/sim/types';
useQuickBouts();

const KEYS = ['jump', 'power', 'speed', 'technique', 'block', 'stamina'] as const;
function squad(seed: number, strong = false): Squad {
  const sq: Squad = { players: [], captainId: null };
  const rng = new Rng(seed);
  enroll(sq, -1, 'male', rng);
  enroll(sq, 0, 'male', rng);
  if (strong) for (const p of sq.players) for (const k of KEYS) p[k] = 97;
  return sq;
}
function playYear(s: Season) {
  let guard = 0;
  while (!s.over && guard++ < 1500) {
    if (s.pendingMatch) { s.playMatch(); continue; }
    if (s.skillOffer) { s.answerSkill(null); continue; }
    while (s.pending) s.choose(0);
    if (s.matchChoices) { s.chooseMatch(0); continue; }
    if (s.matchInvite) { s.answerInvite(true); continue; }
    finishStep(s, s.useCard(s.firstUsable()));
  }
}

describe('評判', () => {
  it('6段階（弱小〜超名門）。最初は弱小', () => {
    expect(REPUTATION.ranks).toEqual(['弱小', 'そこそこ', '中堅', '強豪', '名門', '超名門']);
    expect(rankName(0)).toBe('弱小');
    expect(rankName(REPUTATION.at[5])).toBe('超名門');
    expect(new Career({ seed: 1, squad: squad(1), events: [] }).reputation.points).toBe(0);
  });

  it('その年に得た点が今の段階に見合わなければ、年度の終わりに少し下がる', () => {
    const rep = { points: REPUTATION.at[4] + 1 };
    closeReputation(rep, REPUTATION.expected[4]);
    expect(rep.points).toBe(REPUTATION.at[4] + 1);
    closeReputation(rep, 0);
    expect(rep.points).toBeLessThan(REPUTATION.at[4] + 1);
  });

  it('大会で勝ち進むと上がり、部費と新入生は評判で決まる', () => {
    const c = new Career({ seed: 2, squad: squad(2, true), events: [] });
    playYear(c.season);
    expect(c.season.qualified.interhigh).toBe(true);
    expect(c.reputation.points).toBeGreaterThan(REPUTATION.at[1]);
    const money = c.season.money;
    const s = c.nextYear();
    expect(s.money - money).toBe(REPUTATION.budget[rankOf(c.reputation.points)]);
    // 評判が高いほど新入生の能力が高い
    const avg = (rank: number) => {
      const sq: Squad = { players: [], captainId: null };
      const rng = new Rng(9);
      for (let i = 0; i < 40; i++) enroll(sq, 1, 'male', rng, REPUTATION.newcomers[rank]);
      return sq.players.reduce((a, p) => a + KEYS.reduce((b, k) => b + p[k], 0) / 6, 0) / sq.players.length;
    };
    expect(avg(5)).toBeGreaterThan(avg(0) + 5);
  });
});

describe('監督特能の獲得・失効', () => {
  it('3つまで。取り直すと期限が延び、3年で失効する', () => {
    const owned: OwnedSkill[] = [];
    expect(learnSkill(owned, 'geki', 1)).toBe('new');
    expect(owned[0].until).toBe(1 + MANAGER_GAIN.years - 1);
    expect(learnSkill(owned, 'geki', 2)).toBe('refresh');
    expect(owned).toHaveLength(1);
    expect(owned[0].until).toBe(2 + MANAGER_GAIN.years - 1);
    learnSkill(owned, 'tatenaoshi', 2);
    learnSkill(owned, 'serveKuzushi', 2);
    expect(learnSkill(owned, 'aceTaisaku', 2)).toBe('full');
    expect(expireSkills(owned, 4)).toEqual([]);
    expect(expireSkills(owned, 5).sort()).toEqual(['geki', 'serveKuzushi', 'tatenaoshi'].sort());
  });

  it('評判が高いほど取りやすく、勝負師は出にくい', () => {
    const count = (points: number) => {
      const rng = new Rng(3);
      let n = 0, shoubushi = 0;
      for (let i = 0; i < 20000; i++) { const id = rollSkill(rng, 'seminar', points); if (id) { n++; if (id === 'shoubushi') shoubushi++; } }
      return { n, shoubushi };
    };
    const lo = count(0), hi = count(REPUTATION.at[4]);
    expect(hi.n).toBeGreaterThan(lo.n * 2);
    expect(hi.shoubushi / hi.n).toBeLessThan(0.05);
  });

  it('3つ持っている時は、入れ替えるか見送るかを選ぶまで進めない', () => {
    const c = new Career({ seed: 4, squad: squad(4), events: [] });
    const s = c.season;
    for (const id of ['geki', 'tatenaoshi', 'serveKuzushi']) learnSkill(c.managerSkills, id, 1);
    s.skillOffer = { id: 'dataBunseki', source: 'seminar' };
    expect(() => s.useCard(s.firstUsable())).toThrow();
    expect(s.answerSkill('geki').text).toBe('『檄』を手放し、『データ分析』を覚えた！');
    expect(c.managerSkills.map(x => x.id).sort()).toEqual(['dataBunseki', 'serveKuzushi', 'tatenaoshi']);
    s.skillOffer = { id: 'aceTaisaku', source: 'ob' };
    expect(s.answerSkill(null).text).toBe('今回は見送った');
    expect(c.managerSkills).toHaveLength(3);
    expect(c.managerSkills.some(x => x.id === 'aceTaisaku')).toBe(false);
  });

  it('OBパネルは卒業生がいる年だけ。研修会パネルはいつもある', () => {
    const kinds = (ob: boolean) => new Set(makeBoard(7, { ob }).flatMap(d => d.lanes.map(l => l.kind)));
    expect(kinds(false).has('ob')).toBe(false);
    expect(kinds(false).has('seminar')).toBe(true);
    expect(kinds(true).has('ob')).toBe(true);
  });

  it('持っている監督特能が試合に渡る', () => {
    const c = new Career({ seed: 5, squad: squad(5), events: [] });
    learnSkill(c.managerSkills, 'geki', 1);
    const s = c.season;
    let guard = 0;
    while (!s.pendingMatch && guard++ < 300) {
      while (s.pending) s.choose(0);
      if (s.skillOffer) s.answerSkill(null);
      if (s.matchChoices) s.chooseMatch(0);
      if (s.matchInvite) s.answerInvite(true);
      if (!s.pendingMatch) finishStep(s, s.useCard(s.firstUsable()));
    }
    expect(s.matchSetup().options.managerSkills).toContain('geki');
  });

  it('文章：研修会は覚えなくても出る。失効は2つの理由からランダム', () => {
    const c = new Career({ seed: 6, squad: squad(6), events: [] });
    const s = c.season;
    const said: string[] = [];
    let seminar = false;
    for (let g = 0; g < 600 && !s.over && !seminar; g++) {
      const r = finishStep(s, s.useCard(s.firstUsable()));
      for (const m of r.messages ?? []) said.push(m.text);
      if (r.notes.includes('研修会パネル')) seminar = true;
      while (s.pending) s.choose(0);
      if (s.skillOffer) s.answerSkill(null);
      if (s.matchChoices) s.chooseMatch(0);
      if (s.matchInvite) s.answerInvite(false);
      while (s.pendingMatch) { s.playMatch(); if (s.skillOffer) s.answerSkill(null); }
    }
    expect(seminar).toBe(true);
    expect(said).toContain('監督、近くで指導者の研修会があるそうですよ！');
    expect(said.some(t => t === '研修会に参加した。今回は特に得るものはなかった……' || /^研修会で、監督特能『.+』を学んだ！$/.test(t) || /を磨き直した/.test(t) || /3つで手一杯/.test(t))).toBe(true);
    learnSkill(c.managerSkills, 'geki', 1);
    playYear(s);
    c.nextYear(); playYear(c.season); c.nextYear(); playYear(c.season); c.nextYear();
    if (c.expired.includes('geki')) expect(c.expiredMessages.some(m => /監督特能『檄』が通用しなくなった……$/.test(m.text))).toBe(true);
  });
});
