import { describe, expect, it } from 'vitest';
import { MATCH } from '../src/sim/constants';
import { Match, type BestOf } from '../src/sim/game';
import { makeBench, makeTeam } from '../src/sim/sample';

function newMatch(seed: number, bestOf: BestOf) {
  return new Match({
    gender: 'male', bestOf, seed,
    teams: { A: makeTeam(1, 'A', 'male', 55), B: makeTeam(2, 'B', 'male', 55) },
    bench: { A: makeBench(1, 'A', 'male', 55), B: makeBench(2, 'B', 'male', 55) },
  });
}

function playSet(m: Match) {
  const g = m.startSet();
  g.takePendingStop();
  while (!g.over) g.next();
  return g;
}

describe('試合（複数セット）', () => {
  it('3セットマッチは2セット、5セットマッチは3セット先取。最終セットだけ15点', () => {
    for (const bestOf of [3, 5] as BestOf[]) {
      for (let s = 1; s <= 8; s++) {
        const m = newMatch(s, bestOf);
        while (m.phase !== 'over') {
          const g = playSet(m);
          expect(g.target).toBe(m.results.length + 1 === bestOf ? 15 : 25);
          m.finishSet();
        }
        expect(m.setsWon[m.winner!]).toBe(MATCH.setsToWin[bestOf]);
        expect(m.results.length).toBeLessThanOrEqual(bestOf);
        expect(m.results.length).toBeGreaterThanOrEqual(MATCH.setsToWin[bestOf]);
      }
    }
  });

  it('サーブ権：第2セット以降は前のセットと交互、最終セットは抽選し直す', () => {
    let finalA = 0, finals = 0;
    for (let s = 1; s <= 40; s++) {
      const m = newMatch(s, 5);
      while (m.phase !== 'over') { playSet(m); m.finishSet(); }
      const f = m.firstServes;
      for (let i = 1; i < f.length; i++) if (i + 1 < 5) expect(f[i]).not.toBe(f[i - 1]);
      if (f.length === 5) { finals++; if (f[4] === 'A') finalA++; }
    }
    // 最終セットは交互ではなく抽選（両方が出る）
    if (finals >= 6) expect(finalA).toBeGreaterThan(0);
  });

  it('タイムアウト・交代の回数、タイムアウトの効果、連続失点は次のセットに残らない。疲れは持ち越して少し回復', () => {
    const m = newMatch(3, 3);
    const g1 = m.startSet();
    g1.takePendingStop();
    g1.timeout('basic');
    const s = g1.validSubs()[0];
    g1.substitute(s.outId, s.inId);
    while (!g1.over) g1.next();
    const tired = Object.entries(g1.fatigue).find(([, f]) => f > 0.1)!;
    m.finishSet();
    const g2 = m.startSet();
    expect(g2.timeoutsLeft.A).toBe(MATCH.timeouts);
    expect(g2.subsUsed.A).toBe(0);
    expect(g2.buffs).toHaveLength(0);
    expect(g2.lostStreak).toEqual({ A: 0, B: 0 });
    // 先発は前のセットの先発（交代前）に戻る
    expect(g2.teams.A.rotation.map(x => x.player.id)).toEqual(m.lineups.A.rotation.map(x => x.player.id));
    expect(g2.teams.A.rotation.some(x => x.player.id === s.outId)).toBe(true);
    expect(g2.fatigue[tired[0]]).toBeCloseTo(Math.max(0, tired[1] - 0.08), 5);
  });

  it('試合の前とセットの間に、先発・並び・方針を変えられる（セット中は変えられない）', () => {
    const m = newMatch(4, 3);
    const first = m.lineups.A.rotation[0].player.id;
    m.rotateLineup();
    expect(m.lineups.A.rotation[5].player.id).toBe(first);
    m.swapSlots(0, 1);
    const benchId = m.bench.A[0].id;
    m.replaceStarter(2, benchId);
    expect(m.lineups.A.rotation[2].player.id).toBe(benchId);
    m.setTactics({ attack: 'quick' });
    const g = m.startSet();
    expect(g.teams.A.tactics.attack).toBe('quick');
    expect(g.teams.A.rotation[2].player.id).toBe(benchId);
    expect(() => m.setTactics({ attack: 'ace' })).toThrow();
    g.takePendingStop();
    while (!g.over) g.next();
    m.finishSet();
    m.setTactics({ block: 'bunch' });
    expect(m.startSet().teams.A.tactics.block).toBe('bunch');
  });

  it('コートチェンジ：毎セットの終わりと、最終セットの8点', () => {
    const m = newMatch(5, 3);
    expect(m.swapped).toBe(false);
    playSet(m); m.finishSet();
    expect(m.swapped).toBe(true);
    if ((m.phase as string) !== 'over') {
      playSet(m); m.finishSet();
      if ((m.phase as string) !== 'over') {
        expect(m.swapped).toBe(false);
        const g = m.startSet();
        g.takePendingStop();
        while (!g.courtChanged) g.next();
        expect(m.swapped).toBe(true);
      }
    }
  });
});
