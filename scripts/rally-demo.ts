// 1ラリーの計算の確認用。
//   npm run rally            … 集計（男女それぞれ多数のラリー）
//   npm run rally -- 123     … 種123のラリーの記録を表示
import { simulateRally } from '../src/sim/rally';
import { makeTeam, rotate } from '../src/sim/sample';
import type { Gender, RallyInput, TeamState } from '../src/sim/types';

function input(gender: Gender, seed: number, A: TeamState, B: TeamState): RallyInput {
  let a = A, b = B;
  for (let i = 0; i < seed % 6; i++) a = rotate(a);
  for (let i = 0; i < (seed >> 3) % 6; i++) b = rotate(b);
  return { gender, teams: { A: a, B: b }, serving: seed % 2 ? 'A' : 'B', seed };
}

const arg = process.argv[2];
if (arg) {
  const g: Gender = process.argv[3] === 'female' ? 'female' : 'male';
  const rec = simulateRally(input(g, Number(arg), makeTeam(1, 'A', g, 55), makeTeam(2, 'B', g, 55)));
  for (const e of rec.events) {
    if (e.type === 'action') console.log(e.t.toFixed(2), e.team, e.playerId.padEnd(4), e.action.padEnd(8), JSON.stringify(e.pos), e.info ? JSON.stringify(e.info) : '');
    if (e.type === 'jump') console.log(e.t.toFixed(2), '   ', e.playerId.padEnd(4), 'jump    ', e.height);
    if (e.type === 'land' || e.type === 'point') console.log(e.t.toFixed(2), JSON.stringify(e));
  }
  console.log(`勝ち: ${rec.winner}  理由: ${rec.reason}  関係: ${rec.keyPlayerId}  打数: ${rec.touches}  時間: ${rec.duration}s  ボール区間: ${rec.ball.length}`);
} else {
  for (const g of ['male', 'female'] as Gender[]) {
    const N = 20000;
    const reasons: Record<string, number> = {};
    let sideout = 0, touches = 0, attacks = 0, kills = 0, overBlock = 0;
    const setTypes: Record<string, number> = {};
    for (const tacticA of ['ace', 'balance', 'quick'] as const) {
      const A = makeTeam(11, 'A', g, 55, { attack: tacticA });
      const B = makeTeam(12, 'B', g, 55);
      for (let s = 0; s < N / 3; s++) {
        const rec = simulateRally(input(g, s + 1, A, B));
        reasons[rec.reason] = (reasons[rec.reason] ?? 0) + 1;
        if (rec.winner !== rec.serving) sideout++;
        touches += rec.touches;
        for (const e of rec.events) if (e.type === 'action' && (e.action === 'spike' || e.action === 'tip')) {
          attacks++;
          if (e.info?.overBlock) overBlock++;
          setTypes[e.info!.setType!] = (setTypes[e.info!.setType!] ?? 0) + 1;
        }
        if (rec.reason === 'kill' || rec.reason === 'tipKill' || rec.reason === 'blockOut') kills++;
      }
    }
    const pct = (x: number, d = N) => (100 * x / d).toFixed(1) + '%';
    console.log(`\n== ${g} (${N}ラリー) ==`);
    console.log('サイドアウト率', pct(sideout), ' 平均打数', (touches / N).toFixed(1), ' 決定率(攻撃あたり)', pct(kills, attacks), ' ブロックの上から', pct(overBlock, attacks));
    console.log('得点の理由', Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v)}`).join(' / '));
    console.log('トスの種類', Object.entries(setTypes).map(([k, v]) => `${k} ${pct(v, attacks)}`).join(' / '));
  }
}
