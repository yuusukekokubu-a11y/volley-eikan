// 特能の効き方の一覧（確認用）。
// 同じ能力の2チームで、自チーム（A）の「その特能が効く位置の選手」に1つだけ持たせ、持たせない場合と得点率を比べる。
// 同じ乱数の種でラリーを回すので、差はほぼ特能の効きによる。個々の数値は調整しない方針なので、
// 極端に強い・弱い・効いていない・向きが逆のものに印を付けるだけ。
// ラリーの乱数の並びがずれる分のばらつきがあるので、種の組を K 回変えて平均し、ばらつきの目安（±）も出す。
//   npx tsx scripts/trait-check.ts [1回のラリー数] [male|female|both] [特能IDをカンマ区切り] [K]

import { simulateRally } from '../src/sim/rally';
import { Rng } from '../src/sim/rng';
import { makeTeam, rotate } from '../src/sim/sample';
import { TRAITS, type Scene, type TraitDef } from '../src/sim/traits';
import type { Gender, Player, Role, TeamState } from '../src/sim/types';

const N = Number(process.argv[2] || 6000);
const genders: Gender[] = process.argv[3] === 'male' ? ['male'] : process.argv[3] === 'female' ? ['female'] : ['male', 'female'];
const only = process.argv[4] && process.argv[4] !== 'all' ? process.argv[4].split(',') : undefined;
const K = Number(process.argv[5] || 4);

/** 特能を持たせる位置：ポジション専用ならその位置。ほかは効く場面から決める */
function holders(d: TraitDef): Role[] {
  if (d.roles) return d.roles;
  if (d.kind === 'style') {
    const a = d.axis;
    if (a.startsWith('serve')) return ['S', 'OH', 'MB', 'OP'];
    if (a === 'course' || a === 'hitting') return ['OH', 'OP', 'MB'];
    if (a === 'blocking') return ['MB', 'OH', 'OP'];
    if (a === 'defense' || a === 'receiving') return ['OH', 'L'];
    return ['S'];
  }
  if (d.kind === 'unlock') return d.unlocks === 'jumpFloat' || d.unlocks === 'spikeServe' ? ['S', 'OH', 'MB', 'OP'] : ['OH', 'OP'];
  const scenes = new Set<Scene>(d.effects.map(e => e.scene));
  const has = (...xs: Scene[]) => xs.some(x => scenes.has(x));
  if (has('serve', 'serveAim', 'serveChoice', 'serveFloat', 'serveJumpFloat', 'serveSpike', 'serveStreak', 'pinchServe')) return ['S', 'OH', 'MB', 'OP'];
  if (has('serveReceive', 'receiveFloat', 'receiveHard', 'dig', 'digTip', 'dive', 'freeball', 'blockFollow')) return ['OH', 'L'];
  if (has('set', 'setChoice', 'setBadPass', 'setSpin', 'setQuick', 'setBack')) return ['S'];
  if (has('setSecondary')) return ['OH', 'OP', 'L'];
  if (has('block', 'blockRead', 'blockQuick', 'blockTouch', 'blockKill', 'blockOutGuard')) return ['MB', 'OH', 'OP'];
  if (has('attack', 'attackBadSet', 'attackQuick', 'attackSecondary', 'attackRepeat', 'attackStraight', 'attackCross',
    'attackTimeDiff', 'blockOut', 'tip', 'direct', 'cover')) return ['OH', 'OP', 'MB'];
  return ['S', 'OH', 'MB', 'OP', 'L']; // 全般
}

function withTrait(t: TeamState, id: string | null, roles: Role[]): TeamState {
  const give = (p: Player, role: Role): Player => (id && roles.includes(role) && !p.traits.includes(id) ? { ...p, traits: [...p.traits, id] } : p);
  return {
    ...t,
    rotation: t.rotation.map(s => ({ ...s, player: give(s.player, s.role) })),
    libero: t.libero ? give(t.libero, 'L') : t.libero,
  };
}

/** 調子を決まった種でばらけさせる（不調・好調の場面も試すため） */
function withCondition(t: TeamState, seed: number): TeamState {
  const rng = new Rng(seed);
  const c = (p: Player): Player => ({ ...p, condition: Math.round(rng.range(-2.4, 2.4)) });
  return { ...t, rotation: t.rotation.map(s => ({ ...s, player: c(s.player) })), libero: t.libero ? c(t.libero) : t.libero };
}

/** Aが取る点の割合（同じ種の並び） */
function pointRate(g: Gender, id: string | null, roles: Role[], seedOffset = 0): number {
  const A0 = withTrait(makeTeam(21, 'A', g, 55), id, roles);
  const B0 = makeTeam(22, 'B', g, 55);
  let won = 0;
  for (let s = 1; s <= N; s++) {
    const chunk = Math.floor(s / 500);
    let a = withCondition(A0, 1000 + chunk), b = withCondition(B0, 2000 + chunk);
    for (let i = 0; i < s % 6; i++) a = rotate(a);
    for (let i = 0; i < (s >> 3) % 6; i++) b = rotate(b);
    // 点数をばらけさせる（セット終盤の場面も試す）
    const score = { A: (s * 7) % 25, B: (s * 13) % 25 };
    const r = simulateRally({
      gender: g, teams: { A: a, B: b }, serving: s % 2 ? 'A' : 'B', seed: s + seedOffset,
      context: { setNumber: 1, isFinalSet: false, score, serveStreak: s % 5 },
    });
    if (r.winner === 'A') won++;
  }
  return won / N;
}

/** 1点を取る確率 p から、25点・2点差のセットを取る確率 */
function setWin(p: number): number {
  const memo = new Map<string, number>();
  const f = (a: number, b: number): number => {
    if (a >= 25 && a - b >= 2) return 1;
    if (b >= 25 && b - a >= 2) return 0;
    if (a >= 24 && b >= 24 && a === b) return (p * p) / (p * p + (1 - p) * (1 - p)); // デュース
    const k = `${a},${b}`;
    if (!memo.has(k)) memo.set(k, p * f(a + 1, b) + (1 - p) * f(a, b + 1));
    return memo.get(k)!;
  };
  return f(0, 0);
}

function stageOf(d: TraitDef): string {
  if (d.kind === 'stat') {
    const m = Math.max(...d.effects.map(e => Math.abs(e.delta)));
    const pos = d.effects.some(e => e.delta > 0), neg = d.effects.some(e => e.delta < 0);
    return `${pos && neg ? '±' : neg ? '-' : '+'}${m}`;
  }
  return d.kind === 'style' ? '緑' : '解禁';
}

const KIND: Record<string, string> = { stat: '補正', style: '緑', unlock: '解禁' };
const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}`;

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => Math.sqrt(mean(a.map(x => (x - mean(a)) ** 2)));

for (const g of genders) {
  const offs = Array.from({ length: K }, (_, i) => i * 100000);
  const bases = offs.map(o => pointRate(g, null, [], o));
  const base = mean(bases);
  const rows: { d: TraitDef; diff: number; err: number; set: number; stage: string; roles: Role[] }[] = [];
  for (const d of Object.values(TRAITS)) {
    if (only && !only.includes(d.id)) continue;
    const roles = holders(d);
    const diffs = offs.map((o, i) => pointRate(g, d.id, roles, o) - bases[i]);
    const diff = mean(diffs);
    rows.push({ d, diff, err: (2 * sd(diffs)) / Math.sqrt(K), set: setWin(base + diff) - setWin(base), stage: stageOf(d), roles });
  }
  const noise = mean(rows.map(r => r.err));
  console.log(`\n== ${g === 'male' ? '男子' : '女子'}（${N}ラリー×${K}組、基準の得点率 ${(base * 100).toFixed(1)}%、ばらつきの目安 ±${(noise * 100).toFixed(1)}点）`);
  // 同じ段階の中での中央値と比べて印を付ける
  const med = new Map<string, number>();
  for (const st of new Set(rows.map(r => r.stage))) {
    const v = rows.filter(r => r.stage === st).map(r => Math.abs(r.diff)).sort((a, b) => a - b);
    med.set(st, v[Math.floor(v.length / 2)]);
  }
  console.log('特能｜型｜段階｜持たせた位置｜得点率の差（±ばらつき）｜セット勝率の差｜判定');
  for (const r of rows.sort((a, b) => b.diff - a.diff)) {
    const m = med.get(r.stage) ?? 0;
    const sign = r.stage.startsWith('-') ? -1 : r.stage.startsWith('+') ? 1 : 0;
    let mark = '';
    if (Math.abs(r.diff) < Math.max(r.err, 0.002)) mark = '効きが見えない';
    else if (sign && Math.sign(r.diff) !== sign) mark = '向きが逆';
    else if (m > 0 && Math.abs(r.diff) > m * 2.5 && Math.abs(r.diff) > 0.01) mark = '極端に大きい';
    console.log(`${r.d.name}｜${KIND[r.d.kind]}｜${r.stage}｜${r.roles.join('・')}｜${pct(r.diff)}点（±${(r.err * 100).toFixed(1)}）｜${pct(r.set)}%｜${mark}`);
  }
}
