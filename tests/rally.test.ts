import { describe, expect, it } from 'vitest';
import { blockReachCm, hitHeightCm } from '../src/sim/ability';
import { bulgeForApex, simulateRally } from '../src/sim/rally';
import { makeTeam, rotate } from '../src/sim/sample';
import type { Gender, RallyInput, RallyRecord } from '../src/sim/types';

function input(seed: number, gender: Gender = 'male'): RallyInput {
  let A = makeTeam(1, 'A', gender, 55);
  let B = makeTeam(2, 'B', gender, 55);
  for (let i = 0; i < seed % 6; i++) A = rotate(A);
  for (let i = 0; i < (seed >> 3) % 6; i++) B = rotate(B);
  return { gender, teams: { A, B }, serving: seed % 2 ? 'A' : 'B', seed };
}

const many: RallyRecord[] = [];
for (let s = 1; s <= 400; s++) many.push(simulateRally(input(s, s % 3 ? 'male' : 'female')));

describe('打点とブロック到達点', () => {
  it('身長と跳躍だけで決まり、どちらが上がっても高くなる', () => {
    expect(hitHeightCm(180, 50)).toBeCloseTo(180 * 1.33 + 72.5);
    expect(hitHeightCm(185, 50)).toBeGreaterThan(hitHeightCm(180, 50));
    expect(hitHeightCm(180, 60)).toBeGreaterThan(hitHeightCm(180, 50));
    expect(blockReachCm(180, 50)).toBeLessThan(hitHeightCm(180, 50));
  });
});

describe('1ラリーの計算', () => {
  it('同じ種なら同じ記録になる', () => {
    expect(simulateRally(input(42))).toEqual(simulateRally(input(42)));
  });

  it('必ず勝敗と理由がつき、最後に得点イベントがある', () => {
    for (const r of many) {
      expect(['A', 'B']).toContain(r.winner);
      const last = r.events[r.events.length - 1];
      expect(last.type).toBe('point');
      if (last.type === 'point') expect(last.winner).toBe(r.winner);
      expect(r.duration).toBeGreaterThan(last.t);
    }
  });

  it('イベントは時刻順', () => {
    for (const r of many) {
      for (let i = 1; i < r.events.length; i++) expect(r.events[i].t).toBeGreaterThanOrEqual(r.events[i - 1].t);
    }
  });

  it('ボールの軌道は途切れずにつながっている', () => {
    for (const r of many) {
      expect(r.ball.length).toBeGreaterThan(0);
      for (let i = 0; i < r.ball.length; i++) {
        const s = r.ball[i];
        expect(s.t1).toBeGreaterThanOrEqual(s.t0);
        expect(s.bulge).toBeGreaterThanOrEqual(0);
        if (i > 0) {
          const p = r.ball[i - 1];
          expect(s.t0).toBeCloseTo(p.t1, 3);
          expect(s.from).toEqual(p.to);
        }
      }
    }
  });

  it('選手の位置は体育館の中に収まる', () => {
    for (const r of many) {
      for (const e of r.events) {
        if (e.type === 'move') {
          expect(Math.abs(e.to.x)).toBeLessThanOrEqual(11);
          expect(Math.abs(e.to.y)).toBeLessThanOrEqual(5);
        }
      }
      // A は x<=0、B は x>=0 側にいる（ネットを越えない）
      for (const pl of r.placements) expect(pl.team === 'A' ? pl.pos.x <= 0 : pl.pos.x >= 0).toBe(true);
    }
  });

  it('スパイクには打点が記録され、ブロックがあれば到達点も記録される', () => {
    let spikes = 0;
    for (const r of many) {
      for (const e of r.events) {
        if (e.type === 'action' && (e.action === 'spike' || e.action === 'tip')) {
          spikes++;
          expect(e.info?.hitHeight).toBeGreaterThan(200);
          if (e.info?.blockers?.length) expect(e.info.blockReach).toBeGreaterThan(200);
        }
      }
    }
    expect(spikes).toBeGreaterThan(100);
  });

  it('レシーブ・ディグには「位置のずれ」と「回転・勢い」が付く', () => {
    for (const r of many) {
      for (const e of r.events) {
        if (e.type === 'action' && (e.action === 'receive' || e.action === 'dig')) {
          expect(e.info?.offset).toBeGreaterThanOrEqual(0);
          expect(e.info?.spin).toBeGreaterThanOrEqual(0);
          expect(e.info?.spin).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('後衛のミドルはリベロと入れ替わる（サーブを打つミドルは除く）', () => {
    const inp = input(0);
    const r = simulateRally(inp);
    const ids = r.placements.map(p => p.playerId);
    expect(ids).toContain(inp.teams.A.libero!.id);
    expect(r.placements.filter(p => p.role === 'L')).toHaveLength(2);
  });

  it('いろいろな結果が出る', () => {
    const reasons = new Set(many.map(r => r.reason));
    for (const k of ['kill', 'blockKill', 'attackError', 'serveFault', 'ace']) expect(reasons).toContain(k);
  });
});

describe('bulgeForApex', () => {
  it('指定した最高点を通る', () => {
    const b = bulgeForApex(1, 3, 5);
    let max = 0;
    for (let i = 0; i <= 1000; i++) {
      const s = i / 1000;
      max = Math.max(max, 1 + 2 * s + 4 * b * s * (1 - s));
    }
    expect(max).toBeCloseTo(5, 2);
  });
});
