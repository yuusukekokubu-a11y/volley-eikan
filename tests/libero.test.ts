import { describe, expect, it } from 'vitest';
import { COURT } from '../src/sim/constants';
import { simulateRally } from '../src/sim/rally';
import { makeTeam, rotate } from '../src/sim/sample';
import type { RallyEvent, RallyRecord } from '../src/sim/types';

type ActionEv = Extract<RallyEvent, { type: 'action' }>;

const recs: RallyRecord[] = [];
for (const g of ['male', 'female'] as const) {
  for (let s = 1; s <= 1500; s++) {
    let A = makeTeam(21, 'A', g, 55), B = makeTeam(22, 'B', g, 55);
    for (let i = 0; i < s % 6; i++) A = rotate(A);
    for (let i = 0; i < (s >> 3) % 6; i++) B = rotate(B);
    recs.push(simulateRally({ gender: g, teams: { A, B }, serving: s % 2 ? 'A' : 'B', seed: s }));
  }
}

const liberoActs = (r: RallyRecord) => {
  const ids = new Set(r.placements.filter(p => p.role === 'L').map(p => p.playerId));
  return r.events.filter((e): e is ActionEv => e.type === 'action' && ids.has(e.playerId));
};
const distFromNet = (e: ActionEv) => Math.abs(e.pos.x);

describe('リベロのルール', () => {
  it('フロントゾーンで2本目を上げる時はアンダーハンド。オーバーハンドで上げるのはバックゾーンだけ', () => {
    let front = 0;
    for (const r of recs) {
      for (const e of liberoActs(r)) {
        if (e.action !== 'set') continue;
        if (distFromNet(e) < COURT.attackLine) { expect(e.info?.underhand).toBe(true); front++; }
        else expect(e.info?.underhand).toBeFalsy();
      }
    }
    expect(front).toBeGreaterThan(5);
  });

  it('サーブ・ブロック・攻撃（スパイク・フェイント・ツーアタック）をしない', () => {
    for (const r of recs) {
      for (const e of liberoActs(r)) expect(['serve', 'toss', 'block', 'spike', 'tip', 'dump', 'fakeJump']).not.toContain(e.action);
    }
  });

  it('前衛（ローテーションのゾーン2・3・4）には入らない', () => {
    for (const r of recs) {
      for (const p of r.placements.filter(x => x.role === 'L')) expect(Math.abs(p.pos.x)).toBeGreaterThan(COURT.attackLine - 0.5);
    }
  });
});
