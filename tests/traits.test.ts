import { describe, expect, it } from 'vitest';
import { simulateRally } from '../src/sim/rally';
import { makeTeam } from '../src/sim/sample';
import { TRAITS, traitDelta, validateTrait, type Scene, type StatTrait } from '../src/sim/traits';

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
