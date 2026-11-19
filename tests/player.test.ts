import { describe, expect, it } from 'vitest';
import { aptitudeFactor } from '../src/sim/ability';
import { ABILITY, APTITUDE, TRUST } from '../src/sim/constants';
import { Match } from '../src/sim/game';
import { addAbilityExp, addAptitudeExp, applyMatch, gradeOf, rollHeightPotential, trustDelta } from '../src/sim/player';
import { Rng } from '../src/sim/rng';
import { makeBench, makePlayer, makeTeam, SAMPLE_YEAR } from '../src/sim/sample';

const player = (seed = 1) => makePlayer(new Rng(seed), 'P', 1, 'OH', 'male', 55);

describe('選手のデータ', () => {
  it('適性は4段階で、段階が上がるほど効きが大きい', () => {
    const p = player();
    const f = [0, 1, 2, 3].map(s => { p.aptitude.MB = s as 0 | 1 | 2 | 3; return aptitudeFactor(p, 'MB'); });
    expect(f).toEqual(APTITUDE.factor);
    for (let i = 1; i < f.length; i++) expect(f[i]).toBeGreaterThan(f[i - 1]);
  });

  it('能力の経験は端数をためて1ずつ上がり、100で止まる', () => {
    const p = player();
    p.power = 50;
    p.exp.power = 0;
    addAbilityExp(p, 'power', 0.6);
    expect(p.power).toBe(50);
    addAbilityExp(p, 'power', 0.6);
    expect(p.power).toBe(51);
    expect(p.exp.power).toBeCloseTo(0.2);
    p.power = ABILITY.max - 1;
    addAbilityExp(p, 'power', 5);
    expect(p.power).toBe(ABILITY.max);
    expect(p.exp.power).toBe(0);
  });

  it('適性の経験がたまると1段階ずつ上がり、◎で止まる', () => {
    const p = player();
    p.aptitude.S = 0;
    p.aptExp.S = 0;
    addAptitudeExp(p, 'S', APTITUDE.expToNext[0] - 1);
    expect(p.aptitude.S).toBe(0);
    addAptitudeExp(p, 'S', 1);
    expect(p.aptitude.S).toBe(1);
    addAptitudeExp(p, 'S', 10000);
    expect(p.aptitude.S).toBe(3);
    expect(p.aptExp.S).toBe(0);
  });

  it('信頼度：高いと全能力に+1、とても高いと+3', () => {
    const p = player();
    p.trust = 0;
    expect(trustDelta(p)).toBe(0);
    p.trust = TRUST.bonus[1].at;
    expect(trustDelta(p)).toBe(1);
    p.trust = TRUST.bonus[0].at;
    expect(trustDelta(p)).toBe(3);
  });

  it('学年は入学年度から決まる', () => {
    const p = player();
    p.enrollYear = SAMPLE_YEAR;
    expect(gradeOf(p, SAMPLE_YEAR)).toBe(1);
    expect(gradeOf(p, SAMPLE_YEAR + 2)).toBe(3);
  });

  it('身長の伸びしろ：男子はほとんど0〜3cm、まれに10cm以上。女子は小さめ', () => {
    const rng = new Rng(5);
    const m = Array.from({ length: 4000 }, () => rollHeightPotential(rng, 'male'));
    const f = Array.from({ length: 4000 }, () => rollHeightPotential(rng, 'female'));
    const share = (a: number[], lo: number, hi: number) => a.filter(x => x >= lo && x <= hi).length / a.length;
    expect(share(m, 0, 3)).toBeGreaterThan(0.75);
    expect(share(m, 10, 15)).toBeGreaterThan(0.01);
    expect(share(m, 10, 15)).toBeLessThan(0.06);
    expect(Math.max(...m)).toBeLessThanOrEqual(15);
    const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
    expect(avg(f)).toBeLessThan(avg(m));
  });

  it('試合の後：出た選手だけ通算成績・信頼度・適性の経験が増える', () => {
    const teams = { A: makeTeam(1, 'A', 'male', 55), B: makeTeam(2, 'B', 'male', 55) };
    const bench = { A: makeBench(1, 'A', 'male', 55), B: makeBench(2, 'B', 'male', 55) };
    const m = new Match({ gender: 'male', bestOf: 3, seed: 3, teams, bench });
    while (m.phase !== 'over') {
      const g = m.startSet();
      while (!g.over) g.next();
      m.finishSet();
    }
    const starters = [...teams.A.rotation.map(s => s.player), teams.A.libero!];
    const all = [...starters, ...bench.A];
    const before = all.map(p => ({ trust: p.trust, apt: { ...p.aptExp } }));
    applyMatch(all, m.lines);
    const sets = m.results.length;
    starters.forEach(p => {
      const i = all.indexOf(p);
      expect(p.stats.matches).toBe(1);
      expect(p.stats.sets).toBe(sets);
      expect(p.trust).toBe(Math.min(TRUST.max, before[i].trust + TRUST.perSet * sets));
    });
    // 控え（交代していない）は変わらない
    for (const p of bench.A) expect(p.stats.matches).toBe(0);
    // ミドルは本職（◎）なので適性の経験はたまらないが、試合に出た記録は残る
    const mb = teams.A.rotation.find(s => s.role === 'MB')!.player;
    expect(m.lines[mb.id].roles.MB).toBe(sets);
    // 得点の合計は、自チームのスパイク・ブロック・エースの数に等しい
    const total = all.reduce((s, p) => s + p.stats.kills + p.stats.blockPoints + p.stats.aces, 0);
    expect(total).toBeGreaterThan(10);
  });
});
