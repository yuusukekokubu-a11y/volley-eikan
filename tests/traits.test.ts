import { describe, expect, it } from 'vitest';
import { simulateRally } from '../src/sim/rally';
import { readFileSync } from 'node:fs';
import { ACE_AURA } from '../src/sim/constants';
import { SetGame } from '../src/sim/match';
import { makeBench, makeTeam } from '../src/sim/sample';
import { canDo, hasTrait, TRAITS, traitDelta, validateTrait, type Scene, type StatTrait } from '../src/sim/traits';

const base = makeTeam(1, 'A', 'male', 55).rotation[0].player;

describe('特能の受け皿', () => {
  it('段階は +1/+3/+5/+10/+15 のどれかでなければならない', () => {
    const ok: StatTrait = { kind: 'stat', id: 'x', name: 'x', color: 'blue', effects: [{ scene: 'dig', ability: 'technique', delta: 5 }] };
    const bad = { ...ok, effects: [{ scene: 'dig' as Scene, ability: 'technique' as const, delta: 4 as 5 }] };
    const red = { ...ok, color: 'red' as const };
    expect(validateTrait(ok)).toEqual([]);
    expect(validateTrait(bad).length).toBe(1);
    expect(validateTrait(red).length).toBe(1);
  });

  it('登録済みの特能はすべて型の決まりを守っている', () => {
    for (const d of Object.values(TRAITS)) expect(validateTrait(d)).toEqual([]);
  });

  it('その場面でだけ能力が上下する', () => {
    TRAITS.__test = { kind: 'stat', id: '__test', name: 'テスト', color: 'blue', effects: [{ scene: 'serveAim', ability: 'technique', delta: 10 }] };
    const p = { ...base, traits: ['__test'] };
    expect(traitDelta(p, 'technique', new Set<Scene>(['all', 'serve', 'serveAim']))).toBe(10);
    expect(traitDelta(p, 'technique', new Set<Scene>(['all', 'serve']))).toBe(0);
    expect(traitDelta(p, 'power', new Set<Scene>(['all', 'serveAim']))).toBe(0);
    delete TRAITS.__test;
  });

  it('前衛全体に効く特能は、持ち主と同じ列の味方にだけ効く', () => {
    TRAITS.__cmd = { kind: 'stat', id: '__cmd', name: '号令（テスト）', color: 'blue', effects: [{ scene: 'block', ability: 'block', delta: 3, target: 'frontRow' }] };
    const owner = { ...base, id: 'o', traits: ['__cmd'] };
    const mate = { ...base, id: 'm', traits: [] };
    const sc = new Set<Scene>(['all', 'block']);
    const team = (ownerFront: boolean) => [{ p: owner, front: ownerFront }, { p: mate, front: true }];
    expect(traitDelta(mate, 'block', sc, { front: true, teammates: team(true) })).toBe(3);
    expect(traitDelta(mate, 'block', sc, { front: true, teammates: team(false) })).toBe(0);
    expect(traitDelta(owner, 'block', sc, { front: true, teammates: team(true) })).toBe(3);
    delete TRAITS.__cmd;
  });

  it('サーブの種類：解禁特能がなければフローターだけ。持っていれば、持っているサーブの中から選ぶ', () => {
    const typesOf = (traits: string[], gender: 'male' | 'female' = 'male') => {
      const A = makeTeam(1, 'A', gender, 55), B = makeTeam(2, 'B', gender, 55);
      A.rotation[0] = { ...A.rotation[0], player: { ...A.rotation[0].player, traits } };
      const seen = new Set<string>();
      for (let s = 1; s <= 300; s++) {
        const r = simulateRally({ gender, teams: { A, B }, serving: 'A', seed: s });
        const toss = r.events.find(e => e.type === 'action' && e.action === 'toss');
        if (toss && toss.type === 'action' && toss.info?.serveType) seen.add(toss.info.serveType);
      }
      return seen;
    };
    expect([...typesOf([])]).toEqual(['float']);
    expect(typesOf(['jumpFloat']).has('spike')).toBe(false);
    expect(typesOf(['jumpFloat']).has('jumpFloat')).toBe(true);
    const both = typesOf(['spikeServe', 'jumpFloat']);
    expect(both.has('float') || both.has('jumpFloat')).toBe(true);
  });
});

describe('ダイレクト', () => {
  it('特能がなくても、ネット際の返球を直接打つことがある', () => {
    const A = makeTeam(1, 'A', 'male', 55), B = makeTeam(2, 'B', 'male', 55);
    let found = false;
    for (let s = 1; s <= 3000 && !found; s++) {
      const r = simulateRally({ gender: 'male', teams: { A, B }, serving: s % 2 ? 'A' : 'B', seed: s });
      found = r.events.some(e => e.type === 'action' && e.info?.direct);
    }
    expect(found).toBe(true);
  });
});

describe('特能の仕組み', () => {
  it('金特を持つと、元の青は効かない（置き換わる）', () => {
    const p = { ...base, traits: ['receiveMaster', 'perfectCut'] };
    expect(traitDelta(p, 'technique', new Set<Scene>(['all', 'serveReceive']))).toBe(15);
    expect(hasTrait(p, 'receiveMaster')).toBe(true);
  });

  it('◎や金のサーブは、◯を持っていなくても打てる', () => {
    expect(canDo({ ...base, traits: ['jumpFloatPro'] }, 'jumpFloat')).toBe(true);
    expect(canDo({ ...base, traits: ['cannonServe'] }, 'spikeServe')).toBe(true);
    expect(canDo({ ...base, traits: [] }, 'spikeServe')).toBe(false);
  });

  it('相手に効く特能（配球バレ）は、向き合っている相手の能力を上げ、持ち主には効かない', () => {
    const setter = { ...base, id: 's', traits: ['setTell'] };
    const blocker = { ...base, id: 'b', traits: [] };
    const sc = new Set<Scene>(['all', 'block', 'blockRead']);
    expect(traitDelta(blocker, 'block', sc, undefined, setter)).toBe(10);
    expect(traitDelta(blocker, 'block', sc)).toBe(0);
    expect(traitDelta(setter, 'block', sc)).toBe(0);
  });

  it('登録した特能の場面は、すべて試合の計算で使われている', () => {
    const src = readFileSync('src/sim/rally.ts', 'utf8');
    for (const d of Object.values(TRAITS)) {
      if (d.kind !== 'stat') continue;
      for (const e of d.effects) {
        if (e.scene === 'all') continue;
        expect(src.includes(`'${e.scene}'`), `${d.name} の場面 ${e.scene}`).toBe(true);
      }
    }
  });

  it('エースの風格：持ち主が決めると、チーム全体に数ラリーの上乗せがかかる', () => {
    const A = makeTeam(1, 'A', 'male', 55), B = makeTeam(2, 'B', 'male', 55);
    A.rotation = A.rotation.map(s => ({ ...s, player: { ...s.player, traits: [...s.player.traits, 'aceAura'] } }));
    const g = new SetGame({ gender: 'male', seed: 4, serving: 'A', teams: { A, B }, bench: { A: makeBench(1, 'A', 'male', 55), B: makeBench(2, 'B', 'male', 55) } });
    let seen = false;
    for (let i = 0; i < 60 && !g.over && !seen; i++) {
      const { rec } = g.next();
      if (rec.winner === 'A' && ['kill', 'tipKill', 'blockOut', 'blockKill', 'ace'].includes(rec.reason)) {
        seen = g.buffs.some(b => b.team === 'A' && b.name === 'エースの風格' && b.left === ACE_AURA.rallies);
      }
    }
    expect(seen).toBe(true);
  });
});
