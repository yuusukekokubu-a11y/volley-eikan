import { describe, expect, it } from 'vitest';
import { Career } from '../src/grow/career';
import { enroll } from '../src/grow/roster';
import { clearSave, deserialize, loadFrom, MIGRATIONS, SAVE_VERSION, saveTo, serialize, type Store } from '../src/grow/save';
import { finishStep, useQuickBouts, type Season } from '../src/grow/season';
import { Rng } from '../src/sim/rng';
import type { Squad } from '../src/sim/types';
useQuickBouts();

function squad(seed: number): Squad {
  const sq: Squad = { players: [], captainId: null };
  const rng = new Rng(seed);
  enroll(sq, -1, 'male', rng);
  enroll(sq, 0, 'male', rng);
  return sq;
}

/** 1回の行動（待っているものがあればそれに答える）。決まった選び方なので、同じ状態からは同じ結果になる */
function act(s: Season) {
  if (s.pending) { s.choose(0); return; }
  if (s.skillOffer) { s.answerSkill(s.managerSkills[0].id); return; }
  if (s.matchChoices) { s.chooseMatch(1); return; }
  if (s.matchInvite) { s.answerInvite(true); return; }
  if (s.pendingMatch) { s.playMatch(); return; }
  if (s.paused) { s.resume(); return; }
  const avg = s.squad.players.reduce((a, p) => a + p.energy, 0) / s.squad.players.length;
  finishStep(s, avg < 45 ? s.rest() : s.useCard(s.firstUsable()));
}

function run(c: Career, n: number) {
  for (let i = 0; i < n; i++) {
    if (c.season.over) c.nextYear();
    act(c.season);
  }
}

/** 比べる時は、保存した日時を除いたセーブの中身で比べる */
const body = (c: Career) => JSON.stringify(c.toData());

describe('セーブ', () => {
  it('保存して読み戻すと、全部の状態が同じになる（盤面も保存する）', () => {
    const c = new Career({ seed: 3, squad: squad(3), events: [] });
    run(c, 150);
    const back = deserialize(serialize(c), { events: [] });
    expect(body(back)).toBe(body(c));
    expect(back.season.board).toEqual(c.season.board);
  });

  it('途中でセーブ→ロードして続けた結果が、そのまま続けた結果と一致する（大会・年度をまたぐ）', () => {
    for (const at of [40, 160, 420]) {
      const a = new Career({ seed: 5, squad: squad(5), events: [] });
      run(a, at);
      const b = deserialize(serialize(a), { events: [] });
      run(a, 500);
      run(b, 500);
      expect(body(b)).toBe(body(a));
      expect(a.year).toBeGreaterThanOrEqual(2);
    }
  }, 120000);

  it('待っているもの（試合・相手選び・一時停止など）がある時に保存しても、続きから進められる', () => {
    const c = new Career({ seed: 7, squad: squad(7), events: [] });
    let checked = 0;
    for (let i = 0; i < 900 && checked < 8; i++) {
      const s = c.season;
      if (s.pendingMatch || s.paused || s.matchInvite || s.matchChoices || s.skillOffer) {
        const b = deserialize(serialize(c), { events: [] });
        expect(!!b.season.pendingMatch).toBe(!!s.pendingMatch);
        expect(b.season.paused).toBe(s.paused);
        act(b.season);
        checked++;
      }
      if (c.season.over) c.nextYear();
      act(c.season);
    }
    expect(checked).toBeGreaterThan(3);
  }, 60000);

  it('ブラウザの保存領域：保存・読み戻し・消す', () => {
    const mem = new Map<string, string>();
    const store: Store = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => { mem.set(k, v); }, removeItem: k => { mem.delete(k); } };
    expect(loadFrom(store)).toBeNull();
    const c = new Career({ seed: 9, squad: squad(9) });
    saveTo(store, c);
    expect(body(loadFrom(store)!)).toBe(body(c));
    clearSave(store);
    expect(loadFrom(store)).toBeNull();
  });

  it('版：古い版は直してから読む。新しい版・壊れたものは読めない', () => {
    const c = new Career({ seed: 2, squad: squad(2), events: [] });
    const f = JSON.parse(serialize(c));
    expect(f.version).toBe(SAVE_VERSION);
    // 仮の古い版（版0）：直し方があれば読める
    MIGRATIONS[0] = d => ({ ...d, version: 1 });
    expect(body(deserialize(JSON.stringify({ ...f, version: 0 }), { events: [] }))).toBe(body(c));
    delete MIGRATIONS[0];
    expect(() => deserialize(JSON.stringify({ ...f, version: 0 }))).toThrow();
    expect(() => deserialize(JSON.stringify({ ...f, version: SAVE_VERSION + 1 }))).toThrow();
    expect(() => deserialize('こわれた文字列')).toThrow();
  });
});
