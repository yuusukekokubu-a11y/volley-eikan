import { describe, expect, it } from 'vitest';
import { COACH, MATCH } from '../src/sim/constants';
import { Match } from '../src/sim/game';
import { SetGame } from '../src/sim/match';
import { makeBench, makeTeam } from '../src/sim/sample';

const newSet = (seed: number, o: { coach?: boolean; opp?: string[]; finalSet?: boolean } = {}) => new SetGame({
  gender: 'male', seed, serving: 'A', finalSet: o.finalSet, coach: o.coach, oppManagerSkills: o.opp ?? ['geki', 'tatenaoshi', 'aceTaisaku'],
  teams: { A: makeTeam(1, 'A', 'male', 60), B: makeTeam(2, 'B', 'male', 50) },
  bench: { A: makeBench(1, 'A', 'male', 60), B: makeBench(2, 'B', 'male', 50) },
});

describe('相手チームの采配', () => {
  it('相手のタイムアウトは、失点した直後に、連続失点か終盤の負けている時だけ。大差でリードしている時は取らない。1セット2回まで', () => {
    let taken = 0;
    for (let s = 1; s <= 40; s++) {
      const g = newSet(s);
      g.takePendingStop();
      while (!g.over) {
        const before = g.timeoutsLeft.B;
        const { rec, stop } = g.next();
        if (g.timeoutsLeft.B === before) continue;
        taken++;
        expect(stop?.oppTimeout).toBeTruthy();
        expect(rec.winner).toBe('A');
        const lead = g.score.B - g.score.A;
        expect(lead).toBeLessThan(COACH.noTimeoutLead);
        const streak = g.lostStreak.B === g.streakNeeded('B');
        const late = Math.max(g.score.A, g.score.B) >= COACH.lateFrom.normal && -lead >= COACH.lateBehind && before === MATCH.timeouts;
        expect(streak || late).toBe(true);
      }
      expect(g.timeoutsLeft.B).toBeGreaterThanOrEqual(0);
    }
    expect(taken).toBeGreaterThan(10);
  });

  it('采配しない設定なら、相手はタイムアウトも交代もしない', () => {
    const g = newSet(3, { coach: false });
    while (!g.over) g.next();
    expect(g.timeoutsLeft.B).toBe(MATCH.timeouts);
    expect(g.subsUsed.B).toBe(0);
  });

  it('相手の交代は6回まで。使った監督特能は持っているものか基本効果', () => {
    for (let s = 1; s <= 30; s++) {
      const g = newSet(s, { opp: ['aceTaisaku'] });
      while (!g.over) {
        g.next();
        // こちらは監督特能を持っていないので、かかっている効果はすべて相手が使ったもの
        for (const b of g.buffs) expect(['エース対策', '基本効果']).toContain(b.name);
      }
      expect(g.subsUsed.B).toBeLessThanOrEqual(MATCH.substitutions);
    }
  });

  it('ピンチサーバー：サーブの間だけ入り、サイドアウトで先発が戻る（交代2回分）', () => {
    const g = newSet(5, { coach: false });
    g.takePendingStop();
    const server = g.teams.A.rotation[0].player.id;
    const sub = g.validPinch()[0];
    expect(sub.outId).toBe(server);
    g.pinchServe(sub.outId, sub.inId);
    expect(g.teams.A.rotation[0].player.id).toBe(sub.inId);
    // サーブ権を失うまで進める
    while (!g.over && g.serving === 'A') g.next();
    expect(g.teams.A.rotation.some(s => s.player.id === server)).toBe(true);
    expect(g.teams.A.rotation.some(s => s.player.id === sub.inId)).toBe(false);
    expect(g.subsUsed.A).toBe(2);
    expect(g.notices.some(n => n.kind === 'pinchBack')).toBe(true);
  });

  it('ピンチサーバーにできるのは、次にサーブする時の、次のサーバーだけ', () => {
    const g = newSet(6, { coach: false });
    g.takePendingStop();
    expect(g.validPinch().every(s => s.outId === g.teams.A.rotation[0].player.id)).toBe(true);
    while (!g.over && g.serving === 'A') g.next();
    expect(g.validPinch()).toEqual([]);
  });

  it('相手の監督特能は、試作用にランダムで0〜3つ（同じ種なら同じ）', () => {
    const mk = (seed: number) => new Match({
      gender: 'male', bestOf: 3, seed,
      teams: { A: makeTeam(1, 'A', 'male', 55), B: makeTeam(2, 'B', 'male', 55) },
      bench: { A: makeBench(1, 'A', 'male', 55), B: makeBench(2, 'B', 'male', 55) },
    });
    const counts = new Set<number>();
    for (let s = 1; s <= 30; s++) {
      const m = mk(s);
      expect(m.oppManagerSkills.length).toBeLessThanOrEqual(3);
      expect(new Set(m.oppManagerSkills).size).toBe(m.oppManagerSkills.length);
      expect(mk(s).oppManagerSkills).toEqual(m.oppManagerSkills);
      counts.add(m.oppManagerSkills.length);
    }
    expect(counts.size).toBeGreaterThan(2);
  });
});
