// 作戦の確認用：相手に合わせて方針を変えることが得になるか（spec.md「作戦の目標」）。
// 相手の攻撃の偏りごとに、こちら（A）の方針を変えて得点率を比べる。こちらのチームの型（どの方針が合うか）も変える。
//   npx tsx scripts/tactic-counter.ts [male|female] [1回のラリー数] [K]

import { simulateRally } from '../src/sim/rally';
import { makeTeam, rotate } from '../src/sim/sample';
import type { BlockTactic, Gender, Player, ReceiveTactic, Role, TeamState } from '../src/sim/types';

const g: Gender = process.argv[2] === 'female' ? 'female' : 'male';
const N = Number(process.argv[3] || 3000);
const K = Number(process.argv[4] || 3);

type Mod = (t: TeamState) => TeamState;
const players = (f: (p: Player, role: Role) => Player, roles?: Role[]): Mod => t => ({
  ...t,
  rotation: t.rotation.map(s => (!roles || roles.includes(s.role) ? { ...s, player: f(s.player, s.role) } : s)),
  libero: t.libero && (!roles || roles.includes('L')) ? f(t.libero, 'L') : t.libero,
});
const add = (o: Partial<Record<'power' | 'technique' | 'speed' | 'block' | 'jump' | 'height', number>>, roles?: Role[]): Mod =>
  players(p => {
    const q = { ...p } as unknown as Record<string, number>;
    for (const [k, v] of Object.entries(o)) q[k] = Math.max(1, q[k] + v!);
    return q as unknown as Player;
  }, roles);
const give = (ids: string[], roles: Role[]): Mod => players(p => ({ ...p, traits: [...p.traits, ...ids] }), roles);
const both = (...m: Mod[]): Mod => t => m.reduce((a, f) => f(a), t);
const WING: Role[] = ['OH', 'OP', 'MB'];
const FRONT: Role[] = ['OH', 'OP', 'MB'];
/** ローテーションの最初のアウトサイドだけを強いエースにする */
const oneAce: Mod = t => {
  const i = t.rotation.findIndex(s => s.role === 'OH');
  const r = [...t.rotation];
  const p = r[i].player;
  r[i] = { ...r[i], player: { ...p, power: p.power + 20, technique: p.technique + 10, jump: p.jump + 10, height: p.height + 6 } };
  return { ...t, rotation: r };
};

/** 相手の攻撃の偏り（相手の方針は試合を通して変わらない） */
const OPP: { name: string; mod: Mod; counter: { block?: BlockTactic; receive?: ReceiveTactic } }[] = [
  { name: '普通の相手', mod: t => t, counter: {} },
  { name: '速攻が多い', mod: both(t => ({ ...t, tactics: { ...t.tactics, attack: 'quick' } }), add({ speed: 15, jump: 10 }, ['MB'])), counter: { block: 'bunch' } },
  { name: 'サイドのエース頼み', mod: both(t => ({ ...t, tactics: { ...t.tactics, attack: 'ace' } }), oneAce), counter: { block: 'dedicate' } },
  { name: 'フェイントが多い', mod: give(['softHitter', 'feint'], WING), counter: { receive: 'front' } },
  { name: '強打が多い', mod: both(give(['hardHitter'], WING), add({ power: 10 }, WING)), counter: { receive: 'back' } },
];

/** こちらのチームの型（spec の「活きる能力」：バンチ＝スピード、スプレッド＝個々のブロック、デディケート＝身長・跳躍） */
const OWN: { name: string; mod: Mod; fit: BlockTactic }[] = [
  { name: '普通', mod: t => t, fit: 'spread' },
  { name: 'ブロッカーが速い', mod: add({ speed: 15 }, FRONT), fit: 'bunch' },
  { name: 'ブロックが個人で強い', mod: add({ block: 15 }, FRONT), fit: 'spread' },
  { name: '背が高い', mod: add({ height: 6, jump: 10 }, FRONT), fit: 'dedicate' },
];

function rate(own: Mod, opp: Mod, block: BlockTactic, receive: ReceiveTactic, off: number): number {
  const A0 = own(makeTeam(21, 'A', g, 55));
  const A1 = { ...A0, tactics: { ...A0.tactics, block, receive } };
  const B0 = opp(makeTeam(22, 'B', g, 55));
  let won = 0;
  for (let s = 1; s <= N; s++) {
    let a = A1, b = B0;
    for (let i = 0; i < s % 6; i++) a = rotate(a);
    for (let i = 0; i < (s >> 3) % 6; i++) b = rotate(b);
    if (simulateRally({ gender: g, teams: { A: a, B: b }, serving: s % 2 ? 'A' : 'B', seed: s + off }).winner === 'A') won++;
  }
  return won / N;
}
const avg = (f: (off: number) => number) => {
  let s = 0;
  for (let k = 0; k < K; k++) s += f(k * 100000);
  return s / K;
};
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const d = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}`;

console.log(`== ${g === 'male' ? '男子' : '女子'}（${N}ラリー×${K}組。こちらの得点率。基準はスプレッド・後ろ寄り）`);
console.log('\n[ブロック] こちらの型 × 相手の偏り：スプレッド／バンチ／デディケート（スプレッドとの差）');
for (const own of OWN) {
  for (const opp of OPP.filter(o => !o.counter.receive)) {
    const sp = avg(off => rate(own.mod, opp.mod, 'spread', 'back', off));
    const bu = avg(off => rate(own.mod, opp.mod, 'bunch', 'back', off));
    const de = avg(off => rate(own.mod, opp.mod, 'dedicate', 'back', off));
    const mark = opp.counter.block ? `（対策＝${opp.counter.block === 'bunch' ? 'バンチ' : 'デディケート'}）` : '';
    console.log(`${own.name}（合う＝${own.fit}）× ${opp.name}${mark}：${pct(sp)}／バンチ ${d(bu - sp)}／デディケート ${d(de - sp)}`);
  }
}
console.log('\n[セッターの上手さ] 相手のセッターが普通／うまい時の、対策の効き（スプレッドとの差）');
const setTech = (v: number): Mod => players(p => ({ ...p, technique: v }), ['S']);
const goodSetter: Mod = both(setTech(80), give(['setEye'], ['S']));
for (const opp of OPP.filter(o => o.counter.block)) {
  for (const [label, sm] of [['普通のセッター（テクニック50）', setTech(50)], ['うまいセッター（テクニック80・配球眼）', goodSetter]] as [string, Mod][]) {
    const m = both(opp.mod, sm);
    const sp = avg(off => rate(OWN[0].mod, m, 'spread', 'back', off));
    const c = avg(off => rate(OWN[0].mod, m, opp.counter.block!, 'back', off));
    console.log(`${opp.name}・${label}：スプレッド ${pct(sp)}／対策（${opp.counter.block === 'bunch' ? 'バンチ' : 'デディケート'}）${d(c - sp)}`);
  }
}

console.log('\n[レシーブ] 相手の偏り：後ろ寄り／前寄り（後ろ寄りとの差）');
for (const opp of OPP) {
  const back = avg(off => rate(OWN[0].mod, opp.mod, 'spread', 'back', off));
  const front = avg(off => rate(OWN[0].mod, opp.mod, 'spread', 'front', off));
  console.log(`${opp.name}：${pct(back)}／前寄り ${d(front - back)}`);
}
