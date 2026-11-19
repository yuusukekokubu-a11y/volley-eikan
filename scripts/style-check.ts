// 緑（行動の傾向）の確認用。対になる緑ごとに、相手や状況を変えて「持たせない場合との得点率の差」を比べる。
// 目標は「平均では釣り合っていて、相手や状況によって得・損が入れ替わる」こと。
//   npx tsx scripts/style-check.ts [1回のラリー数] [male|female|both] [K]

import { simulateRally } from '../src/sim/rally';
import { makeTeam, rotate } from '../src/sim/sample';
import { defaultHolders, TRAITS } from '../src/sim/traits';
import type { Gender, Player, Role, TeamState } from '../src/sim/types';

const N = Number(process.argv[2] || 3000);
const genders: Gender[] = process.argv[3] === 'male' ? ['male'] : process.argv[3] === 'female' ? ['female'] : ['male', 'female'];
const K = Number(process.argv[4] || 3);

type Mod = (t: TeamState) => TeamState;
const none: Mod = t => t;
/** 選手ごとに手を加える（リベロも含む） */
const players = (f: (p: Player, role: Role) => Player, roles?: Role[]): Mod => t => ({
  ...t,
  rotation: t.rotation.map(s => (!roles || roles.includes(s.role) ? { ...s, player: f(s.player, s.role) } : s)),
  libero: t.libero && (!roles || roles.includes('L')) ? f(t.libero, 'L') : t.libero,
});
const add = (o: Partial<Record<'power' | 'technique' | 'speed' | 'block' | 'jump' | 'height', number>>, roles?: Role[]): Mod =>
  players(p => {
    const q = { ...p };
    for (const [k, v] of Object.entries(o)) (q as unknown as Record<string, number>)[k] = Math.max(1, (q as unknown as Record<string, number>)[k] + v!);
    return q;
  }, roles);
const give = (id: string, roles?: Role[]): Mod => players(p => ({ ...p, traits: [...p.traits.filter(x => !(TRAITS[x]?.kind === 'style' && TRAITS[id]?.kind === 'style' && (TRAITS[x] as { axis: string }).axis === (TRAITS[id] as { axis: string }).axis)), id] }), roles);
const serves = (ids: string[]): Mod => players(p => ({ ...p, traits: [...p.traits.filter(x => x !== 'jumpFloat' && x !== 'spikeServe'), ...ids] }), ['S', 'OH', 'MB', 'OP']);
const tactic = (t: Partial<TeamState['tactics']>): Mod => x => ({ ...x, tactics: { ...x.tactics, ...t } });
const both = (...m: Mod[]): Mod => t => m.reduce((a, f) => f(a), t);
const firstOH: Mod = t => {
  const i = t.rotation.findIndex(s => s.role === 'OH');
  const r = [...t.rotation];
  r[i] = { ...r[i], player: { ...r[i].player, technique: Math.max(1, r[i].player.technique - 25) } };
  return { ...t, rotation: r };
};
const oneAce: Mod = t => {
  const i = t.rotation.findIndex(s => s.role === 'OH');
  const r = [...t.rotation];
  r[i] = { ...r[i], player: { ...r[i].player, power: r[i].player.power + 20, technique: r[i].player.technique + 10 } };
  return { ...t, rotation: r };
};
const WING: Role[] = ['OH', 'OP', 'MB'];

interface Scenario { name: string; own?: Mod; opp?: Mod }
interface Pair { a: string; b: string; scenarios: Scenario[] }

const PAIRS: Pair[] = [
  { a: 'activeDefense', b: 'passiveDefense', scenarios: [
    { name: '相手が強打中心', opp: both(give('hardHitter', WING), add({ power: 15 }, WING)) },
    { name: '相手がフェイント多め', opp: both(give('softHitter', WING), give('feint', WING)) },
  ] },
  { a: 'straightPref', b: 'crossPref', scenarios: [
    { name: '相手のブロックが速い・強い', opp: add({ block: 15, speed: 15 }, WING) },
    { name: '相手のブロックが遅い・弱い', opp: add({ block: -15, speed: -15 }, WING) },
  ] },
  { a: 'commitBlock', b: 'readBlock', scenarios: [
    { name: '相手が速攻中心', opp: tactic({ attack: 'quick' }) },
    { name: '相手がエース中心', opp: tactic({ attack: 'ace' }) },
  ] },
  { a: 'hardHitter', b: 'softHitter', scenarios: [
    { name: '相手のブロックが高い', opp: add({ block: 15, height: 8 }, WING) },
    { name: '相手の守備が前寄り', opp: tactic({ receive: 'front' }) },
    { name: '相手の守備が後ろ寄り', opp: tactic({ receive: 'back' }) },
  ] },
  { a: 'overhandPass', b: 'underhandPass', scenarios: [
    { name: '相手のサーブがジャンフロ', opp: serves(['jumpFloat']) },
    { name: '相手のサーブがスパイク', opp: both(serves(['spikeServe']), add({ power: 15 }, ['S', 'OH', 'MB', 'OP'])) },
  ] },
  { a: 'aggressiveServe', b: 'safeServe', scenarios: [
    { name: '相手のレシーブが強い', opp: add({ technique: 15 }) },
    { name: '相手のレシーブが弱い', opp: add({ technique: -15 }) },
  ] },
  { a: 'shortServe', b: 'longServe', scenarios: [
    { name: '相手のレシーバーが速い', opp: add({ speed: 15 }) },
    { name: '相手のレシーバーが遅い', opp: add({ speed: -15 }) },
  ] },
  { a: 'personServe', b: 'seamServe', scenarios: [
    { name: '相手に弱いレシーバーが1人', opp: firstOH },
    { name: '相手のレシーバーが揃っている' },
  ] },
  { a: 'aceSetter', b: 'spreadSetter', scenarios: [
    { name: '自チームにエースが1人', own: oneAce },
    { name: '相手のブロックがデディケート', opp: tactic({ block: 'dedicate' }) },
  ] },
];

function rate(g: Gender, own: Mod, opp: Mod, style: string | null, off: number): number {
  const holder = style ? give(style, defaultHolders(TRAITS[style])) : none;
  const A0 = holder(own(makeTeam(21, 'A', g, 55))), B0 = opp(makeTeam(22, 'B', g, 55));
  let won = 0;
  for (let s = 1; s <= N; s++) {
    let a = A0, b = B0;
    for (let i = 0; i < s % 6; i++) a = rotate(a);
    for (let i = 0; i < (s >> 3) % 6; i++) b = rotate(b);
    const r = simulateRally({ gender: g, teams: { A: a, B: b }, serving: s % 2 ? 'A' : 'B', seed: s + off });
    if (r.winner === 'A') won++;
  }
  return won / N;
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const f = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}`;

for (const g of genders) {
  console.log(`\n== ${g === 'male' ? '男子' : '女子'}（${N}ラリー×${K}組。持たせない場合との得点率の差、点）`);
  for (const pair of PAIRS) {
    const scs: Scenario[] = [{ name: '普通の相手' }, ...pair.scenarios];
    const rows: { name: string; a: number; b: number }[] = [];
    for (const sc of scs) {
      const own = sc.own ?? none, opp = sc.opp ?? none;
      const da: number[] = [], db: number[] = [];
      for (let k = 0; k < K; k++) {
        const off = k * 100000;
        const base = rate(g, own, opp, null, off);
        da.push(rate(g, own, opp, pair.a, off) - base);
        db.push(rate(g, own, opp, pair.b, off) - base);
      }
      rows.push({ name: sc.name, a: mean(da), b: mean(db) });
    }
    console.log(`\n${TRAITS[pair.a].name}／${TRAITS[pair.b].name}`);
    for (const r of rows) console.log(`  ${r.name}：${f(r.a)}／${f(r.b)}`);
    console.log(`  平均：${f(mean(rows.map(r => r.a)))}／${f(mean(rows.map(r => r.b)))}`);
  }
}
