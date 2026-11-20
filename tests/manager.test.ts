import { describe, expect, it } from 'vitest';
import { MATCH } from '../src/sim/constants';
import { Match } from '../src/sim/game';
import { aceOf, timeoutChoices } from '../src/sim/manager';
import { SetGame } from '../src/sim/match';
import { makeBench, makeTeam } from '../src/sim/sample';

const newSet = (skills: string[], finalSet = false, instinctAvailable = true) => new SetGame({
  gender: 'male', seed: 7, serving: 'A', finalSet, managerSkills: skills, instinctAvailable,
  teams: { A: makeTeam(1, 'A', 'male', 55), B: makeTeam(2, 'B', 'male', 55) },
  bench: { A: makeBench(1, 'A', 'male', 55), B: makeBench(2, 'B', 'male', 55) },
});

describe('監督特能', () => {
  it('タイムアウトで選べるのは持っているタイムアウト系だけ。なければ基本効果', () => {
    expect(timeoutChoices([]).map(s => s.id)).toEqual(['basic']);
    expect(timeoutChoices(['shoubushi', 'dataBunseki']).map(s => s.id)).toEqual(['basic']);
    expect(timeoutChoices(['geki', 'shoubukan', 'aceTaisaku']).map(s => s.id)).toEqual(['geki', 'aceTaisaku']);
  });

  it('エース対策は、相手の前衛の一番攻撃力の高い選手1人だけに、5ラリー効く', () => {
    const g = newSet(['aceTaisaku']);
    g.takePendingStop();
    const ace = aceOf(g.teams.B)!;
    expect(g.teams.B.rotation.slice(1, 4).some(s => s.player.id === ace.id)).toBe(true);
    g.timeout('aceTaisaku');
    const b = g.buffs.find(x => x.name === 'エース対策')!;
    expect(b.team).toBe('B');
    expect(b.effects.every(e => e.playerId === ace.id)).toBe(true);
    for (let i = 0; i < MATCH.timeoutRallies; i++) g.next();
    expect(g.buffs.some(x => x.name === 'エース対策')).toBe(false);
  });

  it('勝負師は最終セットの間ずっと効き、ほかのセットでは効かない', () => {
    expect(newSet(['shoubushi'], false).buffs).toHaveLength(0);
    const g = newSet(['shoubushi'], true);
    for (let i = 0; i < 12 && !g.over; i++) g.next();
    expect(g.buffs.some(b => b.name === '勝負師' && b.team === 'A')).toBe(true);
  });

  it('勝負勘：次の1ラリーだけ方針が変わり、終わったら戻る。持っていなければ使えない', () => {
    expect(newSet([]).canInstinct()).toBe(false);
    const g = newSet(['shoubukan']);
    g.takePendingStop();
    const before = g.teams.A.tactics.attack;
    const other = before === 'quick' ? 'ace' : 'quick';
    g.instinct({ attack: other });
    expect(g.teams.A.tactics.attack).toBe(other);
    expect(g.canInstinct()).toBe(false);
    expect(g.timeoutsLeft.A).toBe(MATCH.timeouts);
    g.next();
    expect(g.teams.A.tactics.attack).toBe(before);
  });

  it('勝負勘は1試合1回（次のセットでは使えない）', () => {
    const m = new Match({
      gender: 'male', bestOf: 3, seed: 3, managerSkills: ['shoubukan'],
      teams: { A: makeTeam(1, 'A', 'male', 55), B: makeTeam(2, 'B', 'male', 55) },
      bench: { A: makeBench(1, 'A', 'male', 55), B: makeBench(2, 'B', 'male', 55) },
    });
    const g1 = m.startSet();
    g1.takePendingStop();
    expect(g1.canInstinct()).toBe(true);
    g1.instinct({ attack: 'quick' });
    while (!g1.over) g1.next();
    m.finishSet();
    expect(m.startSet().canInstinct()).toBe(false);
  });
});
