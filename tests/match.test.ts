import { describe, expect, it } from 'vitest';
import { MATCH } from '../src/sim/constants';
import { SetGame, type StopInfo } from '../src/sim/match';
import { makeBench, makeTeam } from '../src/sim/sample';

function newSet(seed: number, finalSet = false, managerSkills: string[] = []) {
  return new SetGame({
    gender: 'male', seed, finalSet, managerSkills, serving: 'A',
    teams: { A: makeTeam(1, 'A', 'male', 55), B: makeTeam(2, 'B', 'male', 55) },
    bench: { A: makeBench(1, 'A', 'male', 55), B: makeBench(2, 'B', 'male', 55) },
  });
}

/** 1セットを最後まで進め、止まった場面を集める */
function playOut(g: SetGame) {
  const stops: { stop: StopInfo; a: number; b: number; streak: number; need: number }[] = [];
  const first = g.takePendingStop();
  if (first) stops.push({ stop: first, a: 0, b: 0, streak: 0, need: 0 });
  let guard = 0;
  while (!g.over && guard++ < 200) {
    const { stop } = g.next();
    if (stop) stops.push({ stop, a: g.score.A, b: g.score.B, streak: g.lostStreak.A, need: g.streakNeeded() });
  }
  return stops;
}

describe('1セットの進行', () => {
  it('25点・2点差でセットが終わる（最終セットは15点）', () => {
    for (let s = 1; s <= 20; s++) {
      for (const fin of [false, true]) {
        const g = newSet(s, fin);
        playOut(g);
        const w = g.winner!;
        const l = w === 'A' ? 'B' : 'A';
        expect(g.score[w]).toBeGreaterThanOrEqual(fin ? 15 : 25);
        expect(g.score[w] - g.score[l]).toBeGreaterThanOrEqual(2);
        if (g.score[w] > (fin ? 15 : 25)) expect(g.score[w] - g.score[l]).toBe(2);
      }
    }
  });

  it('定期の停止は、試合開始・10点・20点に1回ずつ（最終セットは開始・8点でコートチェンジ）', () => {
    for (let s = 1; s <= 20; s++) {
      const stops = playOut(newSet(s)).filter(x => x.stop.reason === 'periodic');
      expect(stops.map(x => x.stop.label.split('・')[0])).toEqual(['試合開始', '10点の区切り', '20点の区切り']);
      for (const x of stops.slice(1)) expect([10, 20]).toContain(Math.max(x.a, x.b));
      const fin = playOut(newSet(s, true)).filter(x => x.stop.reason === 'periodic');
      expect(fin.map(x => x.stop.label.split('・')[0])).toEqual(['試合開始', '8点の区切り（コートチェンジ）']);
      expect(fin[1].stop.courtChange).toBe(true);
    }
  });

  it('連続失点の停止は、点数帯と点差で決まる数にちょうど達した時に起きる', () => {
    let n = 0;
    for (let s = 1; s <= 40; s++) {
      for (const x of playOut(newSet(s))) {
        if (!x.stop.label.includes('連続失点')) continue;
        n++;
        expect(x.streak).toBe(x.need);
        const top = Math.max(x.a, x.b);
        const base = top >= 20 ? 2 : top >= 10 ? 3 : 4;
        expect(x.need).toBe(base + (x.a - x.b >= MATCH.leadForLooserStop ? 1 : 0));
      }
    }
    expect(n).toBeGreaterThan(10);
  });

  it('タイムアウトは1セット2回。効果は5ラリーで切れる。監督特能がなければ基本効果だけ', () => {
    const g = newSet(3);
    g.takePendingStop();
    expect(g.timeoutChoices().map(s => s.id)).toEqual(['basic']);
    g.timeout('basic', { attack: 'quick' });
    expect(g.teams.A.tactics.attack).toBe('quick');
    expect(g.buffs).toHaveLength(1);
    for (let i = 0; i < MATCH.timeoutRallies; i++) g.next();
    expect(g.buffs).toHaveLength(0);
    g.timeout('basic');
    expect(g.canTimeout()).toBe(false);
    expect(() => g.timeout('basic')).toThrow();
    const h = newSet(4, false, ['geki', 'serveKuzushi']);
    expect(h.timeoutChoices().map(s => s.id)).toEqual(['geki', 'serveKuzushi']);
    h.timeout('serveKuzushi');
    expect(h.buffs[0].team).toBe('B');
  });

  it('選手交代：控えと交代でき、入った控えは入れ替わった先発とだけ戻れる。戻った組はもう交代できない。6回まで', () => {
    const g = newSet(5);
    const starter = g.teams.A.rotation[1].player.id;
    const all = g.validSubs();
    expect(all.length).toBe(6 * 4); // 先発6人 × 控え4人
    const sub = all.find(x => x.outId === starter)!.inId;
    g.substitute(starter, sub);
    expect(g.teams.A.rotation[1].player.id).toBe(sub);
    // 入った控えは、元の先発とだけ交代できる
    expect(g.validSubs().filter(x => x.outId === sub)).toEqual([{ outId: sub, inId: starter }]);
    // その控えは、ほかの先発の交代相手には出てこない
    expect(g.validSubs().some(x => x.inId === sub)).toBe(false);
    g.substitute(sub, starter);
    // 戻った先発は、もう交代できない
    expect(g.validSubs().some(x => x.outId === starter)).toBe(false);
    // 6回まで
    let used = 2;
    while (g.validSubs().length) {
      const s = g.validSubs()[0];
      g.substitute(s.outId, s.inId);
      used++;
    }
    expect(used).toBeLessThanOrEqual(6);
    expect(g.subsUsed.A).toBe(used);
  });

  it('疲れは試合が進むほど積み上がり、スタミナが高いほど少ない', () => {
    const g = newSet(6);
    g.teams.A.rotation[2].player.stamina = 90;
    g.teams.A.rotation[5].player.stamina = 20;
    playOut(g);
    const hi = g.fatigue[g.teams.A.rotation.find(s => s.player.stamina === 90)?.player.id ?? ''] ?? 0;
    const lo = g.fatigue[g.teams.A.rotation.find(s => s.player.stamina === 20)?.player.id ?? ''] ?? 0;
    expect(lo).toBeGreaterThan(0.05);
    expect(hi).toBeLessThan(lo);
  });
});
