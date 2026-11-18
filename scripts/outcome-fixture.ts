// 試合計算の「結果」だけを書き出す（記録の見た目を変える修正の前後で、結果が変わらないことを確かめる用）。
//   npx tsx scripts/outcome-fixture.ts > tests/fixtures/outcomes.json
import { simulateRally } from '../src/sim/rally';
import { makeTeam, rotate } from '../src/sim/sample';
import type { Gender, RallyRecord } from '../src/sim/types';

export function outcome(r: RallyRecord) {
  return {
    winner: r.winner,
    reason: r.reason,
    key: r.keyPlayerId ?? null,
    touches: r.touches,
    actions: r.events.flatMap(e => (e.type === 'action' ? [[e.t, e.playerId, e.action, e.pos.x, e.pos.y, e.pos.z]] : [])),
    lands: r.events.flatMap(e => (e.type === 'land' ? [[e.t, e.inCourt, e.pos.x, e.pos.y]] : [])),
  };
}

export function outcomes() {
  const out: Record<string, ReturnType<typeof outcome>> = {};
  for (const g of ['male', 'female'] as Gender[]) {
    let A = makeTeam(1, 'A', g, 55), B = makeTeam(2, 'B', g, 55);
    for (let s = 1; s <= 300; s++) {
      if (s % 7 === 0) A = rotate(A);
      if (s % 5 === 0) B = rotate(B);
      out[`${g}-${s}`] = outcome(simulateRally({ gender: g, teams: { A, B }, serving: s % 2 ? 'A' : 'B', seed: s }));
    }
  }
  return out;
}

if (process.argv[1]?.endsWith('outcome-fixture.ts')) console.log(JSON.stringify(outcomes()));
