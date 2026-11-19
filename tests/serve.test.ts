import { describe, expect, it } from 'vitest';
import { simulateRally } from '../src/sim/rally';
import { makeTeam, rotate } from '../src/sim/sample';
import type { RallyEvent, RallyRecord } from '../src/sim/types';

type Ev<T extends RallyEvent['type']> = Extract<RallyEvent, { type: T }>;
const recs: RallyRecord[] = [];
let A = makeTeam(1, 'A', 'male', 55), B = makeTeam(2, 'B', 'male', 55);
for (let s = 1; s <= 300; s++) {
  if (s % 7 === 0) A = rotate(A);
  if (s % 5 === 0) B = rotate(B);
  recs.push(simulateRally({ gender: 'male', teams: { A, B }, serving: s % 2 ? 'A' : 'B', seed: s }));
}

describe('サーブのトスと助走', () => {
  it('サーブトスを上げてから打つ', () => {
    for (const r of recs) {
      const toss = r.events.find((e): e is Ev<'action'> => e.type === 'action' && e.action === 'toss')!;
      const serve = r.events.find((e): e is Ev<'action'> => e.type === 'action' && e.action === 'serve')!;
      expect(toss.playerId).toBe(serve.playerId);
      expect(serve.t).toBeGreaterThan(toss.t + 0.4);
    }
  });

  it('ジャンプ系は、助走の移動が踏み切りの時刻に終わり、空中で打つ。フローターは跳ばない', () => {
    let jumpServes = 0;
    for (const r of recs) {
      const serve = r.events.find((e): e is Ev<'action'> => e.type === 'action' && e.action === 'serve')!;
      const jump = r.events.find((e): e is Ev<'jump'> => e.type === 'jump' && e.playerId === serve.playerId && e.t < serve.t);
      if (serve.info!.serveType === 'float') {
        expect(jump).toBeUndefined();
        continue;
      }
      jumpServes++;
      expect(jump).toBeDefined();
      const move = r.events.filter((e): e is Ev<'move'> => e.type === 'move' && e.playerId === serve.playerId && e.t <= jump!.t).pop()!;
      expect(Math.abs(move.t + move.dur - jump!.t)).toBeLessThan(0.01);
      expect(serve.t).toBeGreaterThan(jump!.t);
      expect(serve.t).toBeLessThan(jump!.t + jump!.dur);
      // 助走はエンドラインの後ろから始まる
      const start = r.placements.find(p => p.playerId === serve.playerId)!.pos;
      expect(Math.abs(start.x)).toBeGreaterThan(10);
    }
    expect(jumpServes).toBeGreaterThan(50);
  });
});
