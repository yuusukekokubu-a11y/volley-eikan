// 作戦の効果の確認：能力が偏ったチームで、作戦ごとの勝率（ラリー単位）を比べる。
//   npm run tactics
import { simulateRally } from '../src/sim/rally';
import { makeTeam, rotate } from '../src/sim/sample';
import type { Gender, Tactics, TeamState } from '../src/sim/types';

const N = 12000;

function winRate(g: Gender, A: TeamState, B: TeamState): number {
  let w = 0;
  for (let s = 1; s <= N; s++) {
    let a = A, b = B;
    for (let i = 0; i < s % 6; i++) a = rotate(a);
    for (let i = 0; i < (s >> 3) % 6; i++) b = rotate(b);
    if (simulateRally({ gender: g, teams: { A: a, B: b }, serving: s % 2 ? 'A' : 'B', seed: s }).winner === 'A') w++;
  }
  return (100 * w) / N;
}

function flat(g: Gender, name: string, v: number): TeamState {
  const t = makeTeam(21, name, g, v);
  for (const p of [...t.rotation.map(s => s.player), t.libero!]) {
    p.jump = p.power = p.speed = p.technique = p.block = p.stamina = v;
  }
  return t;
}

/** エースだけ突出：ゾーン2のアウトサイドが高く跳べて強い */
function aceTeam(g: Gender): TeamState {
  const t = flat(g, 'A', 50);
  const ace = t.rotation[1].player;
  ace.height += 8; ace.jump = 90; ace.power = 90; ace.technique = 70;
  return t;
}

/** ミドルとセッターが優秀 */
function middleTeam(g: Gender): TeamState {
  const t = flat(g, 'A', 50);
  for (const s of t.rotation) {
    if (s.role === 'MB') { s.player.speed = 85; s.player.jump = 75; s.player.power = 70; s.player.height += 4; }
    if (s.role === 'S') { s.player.technique = 90; s.player.aptitude.S = 100; }
  }
  return t;
}

function withTactics(t: TeamState, tac: Partial<Tactics>): TeamState {
  return { ...t, tactics: { ...t.tactics, ...tac } };
}

for (const g of ['male', 'female'] as Gender[]) {
  const opp = flat(g, 'B', 55);
  console.log(`\n== ${g}（相手は全員55の平均的なチーム、${N}ラリー）`);
  for (const [label, team] of [['エースだけ突出', aceTeam(g)], ['ミドルとセッターが優秀', middleTeam(g)], ['全員50', flat(g, 'A', 50)]] as const) {
    const row = (['ace', 'balance', 'quick'] as const).map(a => `${a} ${winRate(g, withTactics(team, { attack: a }), opp).toFixed(1)}%`);
    console.log(`${label.padEnd(12, '　')} 攻撃：${row.join(' / ')}`);
  }
}
