import { describe, expect, it } from 'vitest';
import { simulateRally } from '../src/sim/rally';
import { makeTeam, rotate } from '../src/sim/sample';
import { Playback } from '../src/view/playback';
import type { RallyEvent, RallyRecord } from '../src/sim/types';

const recs: RallyRecord[] = [];
let A = makeTeam(1, 'A', 'male', 55), B = makeTeam(2, 'B', 'male', 55);
for (let s = 1; s <= 400; s++) {
  if (s % 7 === 0) A = rotate(A);
  if (s % 5 === 0) B = rotate(B);
  recs.push(simulateRally({ gender: s % 3 ? 'male' : 'female', teams: { A, B }, serving: s % 2 ? 'A' : 'B', seed: s }));
}
type Ev<T extends RallyEvent['type']> = Extract<RallyEvent, { type: T }>;
const spikes = recs.flatMap(r => r.events.filter((e): e is Ev<'action'> => e.type === 'action' && (e.action === 'spike' || e.action === 'tip') && !e.info?.direct).map(e => ({ r, e })));

describe('スパイクの助走', () => {
  it('実際に触る高さは、最高の打点（身長と跳躍だけで決まる）を超えない', () => {
    expect(spikes.length).toBeGreaterThan(300);
    for (const { e } of spikes) expect(e.info!.contactHeight!).toBeLessThanOrEqual(e.info!.hitHeight! + 1e-6);
  });

  it('助走の移動は踏み切りの時刻に終わる（時間差はフェイクの踏み込みに終わる）', () => {
    for (const { r, e } of spikes) {
      if (e.info!.setType === 'timeDiff') continue;
      const jump = r.events.filter((x): x is Ev<'jump'> => x.type === 'jump' && x.playerId === e.playerId && x.t < e.t).pop()!;
      const move = r.events.filter((x): x is Ev<'move'> => x.type === 'move' && x.playerId === e.playerId && x.t <= jump.t).pop()!;
      expect(Math.abs(move.t + move.dur - jump.t)).toBeLessThan(0.01);
    }
  });

  it('オープンは、ネットから離れた位置から十分な長さの助走を取れることが多い（アウトサイド・オポジット）', () => {
    let long = 0, n = 0;
    for (const { r, e } of spikes) {
      if (e.info!.setType !== 'high') continue;
      const pl = r.placements.find(p => p.playerId === e.playerId)!;
      if (pl.role === 'MB') continue;
      const jump = r.events.filter((x): x is Ev<'jump'> => x.type === 'jump' && x.playerId === e.playerId && x.t < e.t).pop()!;
      const move = r.events.filter((x): x is Ev<'move'> => x.type === 'move' && x.playerId === e.playerId && x.t <= jump.t).pop()!;
      const p0 = new Playback(r).frame(move.t).players.find(p => p.id === e.playerId)!;
      n++;
      // 崩れたトスでは打つ位置がネットから離れるので、記録上の助走は少し短くなる（跳ぶ高さは予定の踏み切り位置で決まる）
      if (Math.hypot(move.to.x - p0.x, move.to.y - p0.y) >= 2.0) long++;
    }
    expect(n).toBeGreaterThan(50);
    expect(long / n).toBeGreaterThan(0.8);
  });
});
