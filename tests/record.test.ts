import { describe, expect, it } from 'vitest';
import { simulateRally } from '../src/sim/rally';
import { makeTeam, rotate } from '../src/sim/sample';
import type { RallyEvent, RallyRecord } from '../src/sim/types';

const recs: RallyRecord[] = [];
let A = makeTeam(1, 'A', 'male', 55), B = makeTeam(2, 'B', 'male', 55);
for (let s = 1; s <= 300; s++) {
  if (s % 7 === 0) A = rotate(A);
  recs.push(simulateRally({ gender: s % 3 ? 'male' : 'female', teams: { A, B }, serving: s % 2 ? 'A' : 'B', seed: s }));
}

type Move = Extract<RallyEvent, { type: 'move' }>;
const lastMoveBefore = (r: RallyRecord, id: string, t: number): Move | undefined =>
  r.events.filter((e): e is Move => e.type === 'move' && e.playerId === id && e.t <= t + 1e-6).pop();

describe('記録：ボールを受ける選手の立ち位置と移動', () => {
  it('立ち位置は触る点から腕の長さほど離れ、自分のコートの中にある', () => {
    let n = 0;
    for (const r of recs) {
      for (const e of r.events) {
        if (e.type !== 'action' || !['receive', 'dig', 'cover'].includes(e.action)) continue;
        const m = lastMoveBefore(r, e.playerId, e.t);
        if (!m) continue;
        n++;
        const team = r.placements.find(p => p.playerId === e.playerId)!.team;
        expect(team === 'A' ? m.to.x <= -0.3 + 1e-6 : m.to.x >= 0.3 - 1e-6).toBe(true);
        expect(Math.abs(m.to.x)).toBeLessThanOrEqual(9 + 1e-6);
        expect(Math.abs(m.to.y)).toBeLessThanOrEqual(4.5 + 1e-6);
        expect(Math.hypot(m.to.x - e.pos.x, m.to.y - e.pos.y)).toBeLessThanOrEqual(0.9 + 2e-3);
      }
    }
    expect(n).toBeGreaterThan(200);
  });

  it('受ける選手は触る時刻までに着いている（間に合う時は先に着いて構える）', () => {
    let early = 0, total = 0;
    for (const r of recs) {
      for (const e of r.events) {
        if (e.type !== 'action' || !['receive', 'dig'].includes(e.action)) continue;
        const m = lastMoveBefore(r, e.playerId, e.t);
        if (!m) continue;
        total++;
        expect(m.t + m.dur).toBeLessThanOrEqual(e.t + 2e-3);
        if (m.t + m.dur < e.t - 0.15) early++;
      }
    }
    // 多くの場面で先に着いて待っている
    expect(early / total).toBeGreaterThan(0.5);
  });
});
