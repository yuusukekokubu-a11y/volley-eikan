import { describe, expect, it } from 'vitest';
import { drawCard, PRACTICE } from '../src/grow/cards';
import { MONEY, REPUTATION } from '../src/grow/constants';
import { applyPractice, dailyCondition, gymLevel, gymMul, practiceGain } from '../src/grow/practice';
import { Season } from '../src/grow/season';
import { Rng } from '../src/sim/rng';
import { makeBench, makePlayer, makeTeam } from '../src/sim/sample';
import type { Squad } from '../src/sim/types';

const player = () => makePlayer(new Rng(3), 'P', 1, 'OH', 'male', 50);

describe('練習', () => {
  it('練習指示は伸びる量を寄せる：指示した能力がよく伸び、合計はおまかせと同じ（伸びにくさが同じなら）', () => {
    const p = player();
    for (const k of ['jump', 'power', 'speed', 'technique', 'block', 'stamina'] as const) p[k] = 50;
    const sum = (g: Record<string, number | undefined>) => Object.values(g).reduce((a, b) => a! + b!, 0)!;
    p.practice.focus = 'auto';
    const auto = practiceGain(p, PRACTICE.dash, 1);
    p.practice.focus = 'power';
    const focus = practiceGain(p, PRACTICE.dash, 1);
    expect(focus.power!).toBeGreaterThan(0);
    expect(focus.speed!).toBeLessThan(auto.speed!);
    expect(sum(focus)).toBeCloseTo(sum(auto));
    // 指示した能力の練習なら、そのまま入る
    p.practice.focus = 'speed';
    expect(practiceGain(p, PRACTICE.dash, 1).speed!).toBeCloseTo(auto.speed!);
  });

  it('体力が低いほど練習の伸びが落ちる（体力0でも7割）', () => {
    const p = player();
    p.energy = 100;
    const full = practiceGain(p, PRACTICE.dash, 1).speed!;
    p.energy = 50;
    expect(practiceGain(p, PRACTICE.dash, 1).speed!).toBeCloseTo(full);
    p.energy = 0;
    expect(practiceGain(p, PRACTICE.dash, 1).speed!).toBeCloseTo(full * 0.7);
  });

  it('能力が高いほど伸びにくく、100で止まる', () => {
    const p = player();
    p.speed = 40;
    const lo = practiceGain(p, PRACTICE.dash, 1).speed!;
    p.speed = 90;
    expect(practiceGain(p, PRACTICE.dash, 1).speed!).toBeLessThan(lo);
    p.speed = 100;
    applyPractice([p], PRACTICE.dash, 200, 1);
    expect(p.speed).toBe(100);
  });

  it('体育館レベルは持っている機材で決まり、上位機材ほど多く上がる。レベルが高いほど経験が増える', () => {
    expect(gymLevel([])).toBe(1);
    expect(gymLevel(['dumbbell'])).toBe(2);
    expect(gymLevel(['barbell'])).toBe(3);
    expect(gymLevel(['barbell', 'jumpMeter', 'dumbbell'])).toBe(6);
    const p = player();
    expect(practiceGain(p, PRACTICE.core, 4).power!).toBeCloseTo(practiceGain(p, PRACTICE.core, 1).power! * gymMul(4) / gymMul(1));
  });

  it('機材を持つと、その練習のカードが出る。高効率カードは方針と機材の条件を満たした時だけ', () => {
    const draw = (policy: Parameters<typeof drawCard>[1], owned: string[]) => {
      const rng = new Rng(9);
      const ids = new Set<string>();
      for (let i = 0; i < 3000; i++) ids.add(drawCard(rng, policy, owned).practiceId);
      return ids;
    };
    const none = draw('all', []);
    expect(none.has('dumbbell')).toBe(false);
    expect(none.has('uchikomi')).toBe(false);
    expect(draw('all', ['dumbbell']).has('dumbbell')).toBe(true);
    expect(draw('attack', ['dumbbell']).has('uchikomi')).toBe(false);
    expect(draw('attack', ['dumbbell', 'jumpBox']).has('uchikomi')).toBe(true);
    expect(draw('all', ['dumbbell', 'jumpBox']).has('uchikomi')).toBe(false);
    expect(draw('defense', ['tossRing']).has('senbon')).toBe(true);
  });

  it('練習するポジションの適性の経験がたまる', () => {
    const p = player();
    p.practice.position = 'OP';
    const before = p.aptExp.OP;
    applyPractice([p], PRACTICE.general, 5, 1);
    expect(p.aptExp.OP + p.aptitude.OP * 1000).toBeGreaterThan(before + p.aptitude.OP * 1000 - 1e-9);
    expect(p.aptExp.OP).not.toBe(before);
  });

  it('お金：年度の初めに部費が入り、機材を買うと減る。足りなければ買えない。勝利の報奨が入る', () => {
    const t = makeTeam(1, 'A', 'male', 55);
    const squad: Squad = { players: [...t.rotation.map(s => s.player), t.libero!, ...makeBench(1, 'A', 'male', 55)], captainId: null };
    const s = new Season({ seed: 1, squad, events: [] });
    // 部費は評判で決まる（最初は弱小）
    expect(s.money).toBe(REPUTATION.budget[0]);
    s.money = 200000;
    s.buy('barbell');
    expect(s.money).toBe(200000 - MONEY.price.advanced);
    expect(s.gym).toBe(3);
    expect(() => s.buy('barbell')).toThrow();
    s.money = 0;
    expect(() => s.buy('dumbbell')).toThrow();
    expect(s.rewardWin('practice')).toBe(MONEY.winPractice);
    expect(s.rewardWin('tournament', 3)).toBeGreaterThan(s.rewardWin('tournament', 1));
  });

  it('調子：たいていは普通。安定感は普通の日が多く、ムラっ気は少ない', () => {
    const share = (traits: string[]) => {
      const p = player();
      p.traits = traits;
      const rng = new Rng(4);
      let normal = 0;
      for (let d = 0; d < 20000; d++) { dailyCondition(p, rng); if (p.condition === 0) normal++; }
      return normal / 20000;
    };
    const base = share([]), stable = share(['stable']), moody = share(['moody']);
    expect(base).toBeGreaterThan(0.45);
    expect(stable).toBeGreaterThan(base + 0.1);
    expect(moody).toBeLessThan(base - 0.1);
  });
});
