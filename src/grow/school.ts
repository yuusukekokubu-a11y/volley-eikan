// 相手校の自動生成と、部員から試合の並びを決める仕組み。描画は知らない。
// 県内の学校は育成全体（Career）で一度作り、毎年同じ学校を使う（強さは成績で少しずつ変わる）。
// 本戦の相手（他県の代表）と練習試合の相手は、その都度作る。

import { SCHOOLS, SQUAD_LIMIT } from './constants';
import { bestRole } from './roster';
import { SURNAMES } from './names';
import { makePlayer } from '../sim/sample';
import { Rng } from '../sim/rng';
import { TRAITS } from '../sim/traits';
import type { Gender, LineupSlot, Player, Role, Tactics, TeamState, TrainKey } from '../sim/types';

/** 学校（自チーム以外） */
export interface School {
  id: string;
  name: string;
  /** 強さ＝選手の能力の平均の目安（0〜100）。段階は能力と同じ（S〜G） */
  strength: number;
  /** 作った時の強さ（成績で動いても、ここへ少しずつ戻る） */
  base: number;
}

const KEYS: TrainKey[] = ['jump', 'power', 'speed', 'technique', 'block', 'stamina'];

/** 県内の学校を作る（自チームを除く31校）。名門は少なく、中堅・弱小が多い */
export function makePrefecture(seed: number): School[] {
  const rng = new Rng(seed * 53 + 11);
  const names = [...SCHOOLS.names].sort(() => rng.next() - 0.5);
  const out: School[] = [];
  for (const band of SCHOOLS.bands) {
    for (let i = 0; i < band.count; i++) {
      const s = Math.round((band.strength + rng.normal() * SCHOOLS.spread) * 10) / 10;
      out.push({ id: `pref${out.length + 1}`, name: `${names[out.length]}高校`, strength: s, base: s });
    }
  }
  return out;
}

/** 本戦の相手（他県の代表）を作る */
export function makeNationals(rng: Rng, n: number, used: Set<string>): School[] {
  const out: School[] = [];
  const pool = SCHOOLS.names.filter(x => !used.has(`${x}高校`));
  for (let i = 0; i < n; i++) {
    const s = Math.round(rng.range(SCHOOLS.national.min, SCHOOLS.national.max) * 10) / 10;
    const name = pool.length ? pool.splice(Math.floor(rng.range(0, pool.length)), 1)[0] : `第${i + 1}`;
    out.push({ id: `nat${i + 1}`, name: `${SCHOOLS.nationalPrefix[i % SCHOOLS.nationalPrefix.length]}${name}高校`, strength: s, base: s });
  }
  return out;
}

/** 学校の部員（登録の人数分）を作る。同じ seed なら同じ部員 */
export function makeSchoolPlayers(school: { id: string; strength: number }, gender: Gender, seed: number, year: number): Player[] {
  const rng = new Rng(seed);
  const roles: Role[] = ['S', 'OH', 'MB', 'OP', 'OH', 'MB', 'L', 'S', 'OH', 'MB', 'OH', 'L'];
  const out: Player[] = [];
  roles.slice(0, SQUAD_LIMIT.size).forEach((role, i) => {
    // 控えほど少し弱い
    const avg = school.strength - (i >= 7 ? SCHOOLS.benchGap : 0);
    const p = makePlayer(rng, `${school.id}-${i + 1}`, i + 1, role, gender, avg);
    // 6能力の平均が avg（＋ばらつき）になるように全体をずらす（位置ごとの得意・不得意の形は残す）
    const target = avg + rng.normal() * SCHOOLS.playerSpread;
    const shift = target - KEYS.reduce((x, k) => x + p[k], 0) / KEYS.length;
    for (const k of KEYS) p[k] = Math.round(Math.max(1, Math.min(99, p[k] + shift)));
    // 名前は新入生と同じ名字の一覧から（チームの中でかぶらないもの優先）
    const names = new Set(out.map(x => x.name));
    let name = rng.pick(SURNAMES);
    for (let k = 0; k < 20 && names.has(name); k++) name = rng.pick(SURNAMES);
    p.name = name;
    p.enrollYear = year - Math.min(2, Math.floor(rng.range(0, 3)));
    // 特能：強い学校ほど青が多い（サーブの解禁特能は makePlayer のまま）
    const blue = Object.values(TRAITS).filter(t => t.kind === 'stat' && t.color === 'blue' && !t.upgradeOf && !t.alsoUnlocks && (!t.roles || t.roles.includes(role)));
    const red = Object.values(TRAITS).filter(t => t.kind === 'stat' && t.color === 'red' && (!t.roles || t.roles.includes(role)));
    const nBlue = Math.max(0, Math.round((school.strength - SCHOOLS.traitFrom) / SCHOOLS.traitPer + rng.normal() * 0.7));
    for (let k = 0; k < nBlue && blue.length; k++) {
      const t = rng.pick(blue);
      if (!p.traits.includes(t.id)) p.traits.push(t.id);
    }
    if (red.length && rng.chance(SCHOOLS.redChance)) p.traits.push(rng.pick(red).id);
    out.push(p);
  });
  return out;
}

/** 作戦（相手校はランダム） */
export function randomTactics(rng: Rng): Tactics {
  return {
    attack: rng.pick(['ace', 'balance', 'quick'] as const),
    block: rng.pick(['bunch', 'spread', 'dedicate'] as const),
    receive: rng.pick(['front', 'back'] as const),
  };
}

const ROLE_KEYS: Record<Role, TrainKey[]> = {
  S: ['technique', 'speed'],
  OH: ['power', 'jump', 'technique'],
  MB: ['block', 'jump', 'speed'],
  OP: ['power', 'jump', 'block'],
  L: ['technique', 'speed'],
};

/** その位置での使いやすさ（適性の段階と、その位置で大事な能力） */
export function roleScore(p: Player, role: Role): number {
  const ab = ROLE_KEYS[role].reduce((a, k) => a + p[k], 0) / ROLE_KEYS[role].length;
  return p.aptitude[role] * 12 + ab;
}

export const isLibero = (p: Player): boolean => bestRole(p) === 'L';

/** 部員から先発の並び（5-1：S, OH, MB, OP, OH, MB）とリベロ、控えを決める */
export function autoLineup(players: Player[], name: string, tactics: Tactics): { team: TeamState; bench: Player[] } {
  const left = [...players];
  const take = (role: Role): Player | undefined => {
    if (!left.length) return undefined;
    let best = 0;
    for (let i = 1; i < left.length; i++) if (roleScore(left[i], role) > roleScore(left[best], role)) best = i;
    return left.splice(best, 1)[0];
  };
  // 大事な位置から選ぶ
  const s = take('S');
  const libero = players.length > 6 ? take('L') : undefined;
  const mb1 = take('MB'), mb2 = take('MB'), oh1 = take('OH'), oh2 = take('OH'), op = take('OP');
  const order: [Exclude<Role, 'L'>, Player | undefined][] = [['S', s], ['OH', oh1], ['MB', mb1], ['OP', op], ['OH', oh2], ['MB', mb2]];
  if (order.some(([, p]) => !p)) throw new Error('試合に出られる人数が足りません');
  const rotation: LineupSlot[] = order.map(([role, p]) => ({ role, player: p! }));
  return { team: { name, rotation, libero, tactics }, bench: left };
}

/** チームの強さ：自動で決めた先発7人の6能力の平均 */
export function teamStrength(players: Player[]): number {
  const { team } = autoLineup(players, '', { attack: 'balance', block: 'spread', receive: 'back' });
  const ps = [...team.rotation.map(s => s.player), ...(team.libero ? [team.libero] : [])];
  return ps.reduce((a, p) => a + KEYS.reduce((b, k) => b + p[k], 0) / KEYS.length, 0) / ps.length;
}

/** 大会の登録（自動）：リベロ（一番適性の高い位置がリベロの選手）は上手い順に決まった人数まで。先発7人を先に入れ、残りは使いやすさの順 */
export function autoRegister(players: Player[]): string[] {
  const libs = players.filter(isLibero).sort((a, b) => roleScore(b, 'L') - roleScore(a, 'L')).slice(0, SQUAD_LIMIT.libero);
  const pool = players.filter(p => !isLibero(p) || libs.includes(p));
  const { team } = autoLineup(pool, '', { attack: 'balance', block: 'spread', receive: 'back' });
  const ids = [...team.rotation.map(s => s.player.id), ...(team.libero ? [team.libero.id] : [])];
  const best = (p: Player) => Math.max(...(['S', 'OH', 'MB', 'OP', 'L'] as Role[]).map(r => roleScore(p, r)));
  for (const p of pool.filter(x => !ids.includes(x.id)).sort((a, b) => best(b) - best(a))) {
    if (ids.length >= SQUAD_LIMIT.size) break;
    ids.push(p.id);
  }
  return ids;
}

/** 登録が決まりに合っているか（人数・リベロの数）。合っていなければ理由 */
export function checkRegistration(players: Player[], ids: string[]): string | null {
  if (ids.length > SQUAD_LIMIT.size) return `登録は${SQUAD_LIMIT.size}人までです`;
  const ps = players.filter(p => ids.includes(p.id));
  if (ps.length < 6) return '6人以上を登録してください';
  if (ps.filter(isLibero).length > SQUAD_LIMIT.libero) return `リベロは${SQUAD_LIMIT.libero}人までです`;
  return null;
}
