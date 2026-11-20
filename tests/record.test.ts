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

describe('記録：片手で打つ時の体の位置', () => {
  it('スパイク・サーブは、ボールが打つ腕の側の肩の上に来る（体は打つ腕と反対側にずれる）', async () => {
    const { Playback } = await import('../src/view/playback');
    const { RECORD } = await import('../src/sim/constants');
    let n = 0;
    const serveDiff: number[] = [];
    for (const r of recs) {
      const pb = new Playback(r);
      for (const e of r.events) {
        if (e.type !== 'action' || (e.action !== 'spike' && e.action !== 'serve')) continue;
        const pl = r.placements.find(p => p.playerId === e.playerId)!;
        const fr = pb.frame(e.t).players.find(p => p.id === e.playerId)!;
        // ネットを向いた時の右が＋になる向きで、体から見たボールの左右
        const right = (pl.team === 'A' ? -1 : 1) * (e.pos.y - fr.y);
        const want = pl.hand === 'left' ? -RECORD.hitSide : RECORD.hitSide;
        // スパイクはぴったり。サーブはトスのずれの分だけばらつくので平均で見る
        if (e.action === 'spike') expect(Math.abs(right - want), `${e.action} ${e.playerId}`).toBeLessThan(0.02);
        else serveDiff.push(right - want);
        n++;
      }
    }
    expect(n).toBeGreaterThan(100);
    expect(Math.abs(serveDiff.reduce((a, b) => a + b, 0) / serveDiff.length)).toBeLessThan(0.05);
  });
});

describe('記録：攻撃を終えた側の動き出し', () => {
  it('スパイクがネットを越えたら、相手が触る前に、攻撃した側が守備の持ち場へ動き始める', () => {
    let n = 0, early = 0;
    for (const r of recs) {
      const acts = r.events.filter((e): e is Extract<RallyEvent, { type: 'action' }> => e.type === 'action');
      acts.forEach((e, k) => {
        if (e.action !== 'spike') return;
        const team = r.placements.find(p => p.playerId === e.playerId)!.team;
        const next = acts.slice(k + 1).find(x => x.action !== 'block');
        if (!next || r.placements.find(p => p.playerId === next.playerId)!.team === team) return;
        n++;
        const mates = new Set(r.placements.filter(p => p.team === team && p.playerId !== e.playerId).map(p => p.playerId));
        if (r.events.some(m => m.type === 'move' && mates.has(m.playerId) && m.t > e.t && m.t < next.t - 0.05)) early++;
      });
    }
    expect(n).toBeGreaterThan(50);
    expect(early / n).toBeGreaterThan(0.9);
  });
});
