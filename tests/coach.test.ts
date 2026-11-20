import { describe, expect, it } from 'vitest';
import { MATCH } from '../src/sim/constants';
import { SetGame } from '../src/sim/match';
import { makeBench, makeTeam } from '../src/sim/sample';

const newSet = (seed: number, o: { coach?: boolean; finalSet?: boolean } = {}) => new SetGame({
  gender: 'male', seed, serving: 'A', finalSet: o.finalSet, coach: o.coach,
  teams: { A: makeTeam(1, 'A', 'male', 60), B: makeTeam(2, 'B', 'male', 50) },
  bench: { A: makeBench(1, 'A', 'male', 60), B: makeBench(2, 'B', 'male', 50) },
});

describe('相手チームの采配（交代だけ）', () => {
  it('相手はタイムアウトを取らず、監督特能も方針も変わらない。交代は6回まで', () => {
    for (let s = 1; s <= 30; s++) {
      const g = newSet(s);
      const tactics = { ...g.teams.B.tactics };
      g.takePendingStop();
      while (!g.over) {
        g.next();
        expect(g.buffs.every(b => b.team === 'A' || ['サーブ崩し', 'エース対策'].includes(b.name))).toBe(true);
      }
      expect(g.timeoutsLeft.B).toBe(MATCH.timeouts);
      expect(g.teams.B.tactics).toEqual(tactics);
      expect(g.subsUsed.B).toBeLessThanOrEqual(MATCH.substitutions);
    }
  });

  it('相手は疲れた先発を同じポジションの控えと替え、回復したら戻す', () => {
    const B = makeTeam(2, 'B', 'male', 50);
    const tired = B.rotation.find(x => x.role === 'OH')!.player.id;
    const g = new SetGame({
      gender: 'male', seed: 9, serving: 'A', fatigue: { [tired]: 0.6 },
      teams: { A: makeTeam(1, 'A', 'male', 60), B }, bench: { A: makeBench(1, 'A', 'male', 60), B: makeBench(2, 'B', 'male', 50) },
    });
    g.next();
    const pair = g.pairs.B.find(p => p.starterId === tired && !p.pinch);
    expect(pair).toBeTruthy();
    expect(g.teams.B.rotation.some(x => x.player.id === tired)).toBe(false);
    // 控えのまま休めば回復し、先発に戻る
    let back = false;
    for (let i = 0; i < 80 && !g.over && !back; i++) { g.next(); back = g.teams.B.rotation.some(x => x.player.id === tired); }
    expect(back).toBe(true);
  });

  it('采配しない設定なら、相手は交代もしない', () => {
    const g = newSet(3, { coach: false });
    while (!g.over) g.next();
    expect(g.subsUsed.B).toBe(0);
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

});
