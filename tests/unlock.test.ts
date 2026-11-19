import { describe, expect, it } from 'vitest';
import { simulateRally } from '../src/sim/rally';
import { makeTeam, rotate } from '../src/sim/sample';
import type { RallyEvent, RallyRecord, Role, TeamState } from '../src/sim/types';

type ActionEv = Extract<RallyEvent, { type: 'action' }>;
type MoveEv = Extract<RallyEvent, { type: 'move' }>;

const give = (t: TeamState, id: string, roles: Role[]): TeamState => ({
  ...t, rotation: t.rotation.map(s => (roles.includes(s.role) ? { ...s, player: { ...s.player, traits: [...s.player.traits, id] } } : s)),
});

function rallies(id: string | null, roles: Role[], n = 600): RallyRecord[] {
  const out: RallyRecord[] = [];
  for (let s = 1; s <= n; s++) {
    let A = id ? give(makeTeam(21, 'A', 'male', 55), id, roles) : makeTeam(21, 'A', 'male', 55);
    let B = makeTeam(22, 'B', 'male', 55);
    for (let i = 0; i < s % 6; i++) A = rotate(A);
    for (let i = 0; i < (s >> 3) % 6; i++) B = rotate(B);
    out.push(simulateRally({ gender: 'male', teams: { A, B }, serving: s % 2 ? 'A' : 'B', seed: s }));
  }
  return out;
}

const actions = (r: RallyRecord) => r.events.filter((e): e is ActionEv => e.type === 'action');

describe('解禁型の動作', () => {
  it('バックアタック：特能がなければ出ない。持っていれば後衛から、アタックラインの後ろで踏み切って打つ', () => {
    const none = rallies(null, []);
    expect(none.some(r => actions(r).some(e => e.info?.setType === 'back'))).toBe(false);
    let n = 0;
    for (const r of rallies('backAttack', ['OH', 'OP'])) {
      for (const e of actions(r)) {
        if (e.info?.setType !== 'back' || (e.action !== 'spike' && e.action !== 'tip')) continue;
        n++;
        // 打つ前の最後の移動（踏み切る位置）は、アタックライン（ネットから3m）より後ろ
        const take = r.events.filter((x): x is MoveEv => x.type === 'move' && x.playerId === e.playerId && x.t < e.t).pop()!;
        expect(Math.abs(take.to.x)).toBeGreaterThanOrEqual(3.0 - 1e-6);
      }
    }
    expect(n).toBeGreaterThan(20);
  });
});
