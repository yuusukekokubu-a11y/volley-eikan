import { describe, expect, it } from 'vitest';
import { useQuickBouts } from '../src/grow/season';
useQuickBouts();
import { dateOf, indexOf, makeBoard } from '../src/grow/board';
import { HAND, ENERGY, FIXED_EVENTS, DAYS_IN_YEAR, YELLOW_BONUS } from '../src/grow/constants';
import { applyEffects, injuryChance } from '../src/grow/events';
import { pickEvent, type EventDef } from '../src/grow/events';
import { Season, finishStep } from '../src/grow/season';
import { Rng } from '../src/sim/rng';
import { makeBench, makeTeam } from '../src/sim/sample';
import type { Squad } from '../src/sim/types';

const squad = (): Squad => {
  const t = makeTeam(1, 'A', 'male', 55);
  return { players: [...t.rotation.map(s => s.player), t.libero!, ...makeBench(1, 'A', 'male', 55)], captainId: null };
};

/** テストの中だけで使う仮のイベント（ゲームには出ない） */
const TEST_EVENTS: EventDef[] = [
  {
    id: 't-blue', trigger: { panel: ['blue'] }, subject: [{ kind: 'grade', in: [1, 2, 3] }], text: '{number}番の仮のイベント',
    choices: [
      { label: '上げる', effects: [{ kind: 'ability', key: 'power', delta: 2 }, { kind: 'flag', name: 'seen', value: true }] },
      { label: '続く', effects: [{ kind: 'money', delta: 100 }], next: 't-next' },
    ],
  },
  { id: 't-next', trigger: {}, text: '続きの仮のイベント', choices: [{ label: 'OK', effects: [{ kind: 'energy', delta: -10, target: 'team' }] }] },
  { id: 't-red', trigger: { panel: ['red'] }, when: [{ kind: 'flag', name: 'seen', is: true }], text: '印のある時だけ', effects: [{ kind: 'condition', delta: -1 }] },
  { id: 't-fixed', trigger: { fixed: 'entrance' }, text: '入学式の仮', effects: [{ kind: 'flag', name: 'entered', value: true }] },
];

describe('双六の盤面', () => {
  it('日付：0日目は4月1日、最後は3月31日', () => {
    expect(dateOf(0)).toEqual({ month: 4, day: 1 });
    expect(dateOf(DAYS_IN_YEAR - 1)).toEqual({ month: 3, day: 31 });
    expect(indexOf(1, 1)).toBe(275);
  });

  it('決まった日の行事は、その日付に必ず置かれる', () => {
    const b = makeBoard(3);
    for (const f of FIXED_EVENTS) {
      const d = b[indexOf(f.month, f.day)];
      expect(d.lanes.every(l => l.kind === 'fixed' && l.fixedId === f.id)).toBe(true);
    }
  });

  it('分かれ道のパネルの次の数日は2つの道に分かれ、また1本に戻る。同じ種なら同じ盤面', () => {
    const b = makeBoard(5);
    expect(makeBoard(5)).toEqual(b);
    const branches = b.filter(d => d.lanes[0].kind === 'branch');
    expect(branches.length).toBeGreaterThan(3);
    for (const br of branches) {
      expect(b[br.index + 1].lanes.length).toBe(2);
      let n = 0;
      while (b[br.index + 1 + n].lanes.length === 2) n++;
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(6);
    }
  });
});

describe('双六の進行', () => {
  it('手札は5枚、進む日数は1〜5。使うと書いてある日数だけ進み、1枚引く', () => {
    const s = new Season({ seed: 1, squad: squad(), events: [] });
    expect(s.hand).toHaveLength(HAND.size);
    for (const c of s.hand.filter(c => !c.special)) expect(c.days).toBeGreaterThanOrEqual(1);
    for (const c of s.hand) expect(c.days).toBeLessThanOrEqual(5);
    let guard = 0;
    while (guard++ < 30) {
      const before = s.day;
      const i = s.firstUsable();
      const days = s.hand[i].days;
      const r = finishStep(s, s.useCard(i));
      expect(s.hand).toHaveLength(HAND.size);
      // 大会・練習試合・月初めで止まった時だけ、書いてある日数より短い
      if (s.day - before !== days) expect(s.panelAt(s.day).kind === 'fixed' || s.date.day === 1 || !!r.match || !!s.pendingMatch).toBe(true);
      if (s.matchChoices) s.chooseMatch(0);
      if (s.matchInvite) s.answerInvite(true);
      while (s.pending) s.choose(0);
      while (s.pendingMatch) s.playMatch();
    }
  });

  it('大会のマスでは、残りの日数があっても止まる', () => {
    const s = new Season({ seed: 2, squad: squad(), events: [] });
    const target = indexOf(6, 1); // インターハイ予選
    while (s.day < target) {
      finishStep(s, s.useCard(s.firstUsable()));
      expect(s.day).toBeLessThanOrEqual(target);
    }
    expect(s.day).toBe(target);
  });

  it('大会以外の行事（入学式など）は止まらず、通り過ぎても起きる', () => {
    let passed = false;
    for (let seed = 1; seed <= 30 && !passed; seed++) {
      const s = new Season({ seed, squad: squad(), events: TEST_EVENTS });
      const target = indexOf(4, 7); // 入学式
      while (s.day < target) {
        finishStep(s, s.useCard(s.firstUsable()));
        while (s.pending) s.choose(0);
        while (s.pendingMatch) s.playMatch();
      }
      if (s.day > target) {
        passed = true;
        expect(s.flags.entered).toBe(true);
      }
    }
    expect(passed).toBe(true);
  });

  it('分かれ道では止まって道を選び、選んだ道のマスを通る', () => {
    const s = new Season({ seed: 5, squad: squad(), events: [] });
    let asked = false;
    for (let i = 0; i < 200 && !asked && !s.over; i++) {
      while (s.pendingMatch) s.playMatch();
      while (s.pending) s.choose(0);
      if (s.matchChoices) s.chooseMatch(0);
      if (s.matchInvite) s.answerInvite(false);
      let r = s.useCard(s.firstUsable());
      while (r.paused) r = s.resume();
      if (r.needBranch) {
        asked = true;
        expect(() => s.useCard(s.firstUsable())).toThrow();
        s.chooseBranch(1);
        if (s.board[s.day].lanes.length === 2) expect(s.lane).toBe(1);
      }
    }
    expect(asked).toBe(true);
  });

  it('育成用の体力：練習で減り、休みで回復する。練習できなくなる怪我の状態はない', () => {
    const sq = squad();
    const s = new Season({ seed: 7, squad: sq, events: [] });
    const p = sq.players[0];
    const before = p.energy;
    finishStep(s, s.useCard(s.firstUsable()));
    expect(p.energy).toBeLessThan(before);
    const low = p.energy;
    s.rest();
    expect(p.energy).toBeGreaterThan(low);
    expect('injuryDays' in p).toBe(false);
  });

  it('練習を渡す口：使ったカードの練習と日数が渡り、黄パネルで止まると経験値が増える', () => {
    const calls: { id: string; days: number; mul: number }[] = [];
    const s = new Season({ seed: 9, squad: squad(), events: [], onPractice: (pr, days, mul) => calls.push({ id: pr.id, days, mul }) });
    let yellow = false;
    for (let i = 0; i < 150 && !yellow && !s.over; i++) {
      const card = s.hand[s.firstUsable()];
      calls.length = 0;
      const r = finishStep(s, s.useCard(s.firstUsable()));
      if (card.special) { if (s.matchChoices) s.chooseMatch(0); continue; }
      expect(calls[0].id).toBe(card.practiceId);
      if (r.panel?.kind === 'yellow') {
        yellow = true;
        expect(calls.some(c => c.mul === YELLOW_BONUS - 1)).toBe(true);
      }
    }
    expect(yellow).toBe(true);
  });
});

describe('イベントの仕組み', () => {
  it('きっかけと条件に合うものだけが選ばれ、対象の選手が決まる', () => {
    const sq = squad();
    const w = { year: 1, month: 5, players: sq.players, flags: {}, money: 0 };
    const rng = new Rng(1);
    expect(pickEvent(TEST_EVENTS, { panel: 'red' }, w, rng)).toBeNull(); // 印がない
    const ev = pickEvent(TEST_EVENTS, { panel: 'blue' }, w, rng)!;
    expect(ev.def.id).toBe('t-blue');
    expect(ev.subjectId).toBeTruthy();
    expect(ev.text).toMatch(/^\d+番の仮のイベント$/);
  });

  it('選択肢の効果がかかり、続きのイベントへつながる。選択肢がなければすぐに効果がかかる', () => {
    const sq = squad();
    const s = new Season({ seed: 11, squad: sq, events: TEST_EVENTS });
    // 青パネルに止まるまで進める
    let ev = null;
    for (let i = 0; i < 300 && !ev && !s.over; i++) {
      finishStep(s, s.useCard(s.firstUsable()));
      if (s.pending?.def.id === 't-blue') ev = s.pending;
      else if (s.pending) s.choose(0);
    }
    expect(ev).toBeTruthy();
    const p = sq.players.find(x => x.id === ev!.subjectId)!;
    const power = p.power;
    expect(() => s.useCard(s.firstUsable())).toThrow(); // 選択肢を選ぶまで進めない
    s.choose(0);
    expect(p.power).toBe(Math.min(100, power + 2));
    expect(s.flags.seen).toBe(true);
    // 続きのイベント
    const s2 = new Season({ seed: 11, squad: squad(), events: TEST_EVENTS });
    for (let i = 0; i < 300 && s2.pending?.def.id !== 't-blue' && !s2.over; i++) {
      finishStep(s2, s2.useCard(s2.firstUsable()));
      if (s2.pending && s2.pending.def.id !== 't-blue') s2.choose(0);
    }
    const money = s2.money;
    const next = s2.choose(1);
    expect(next?.def.id).toBe('t-next');
    expect(s2.money).toBe(money + 100);
    s2.choose(0);
    expect(s2.pending).toBeNull();
  });

  it('行事のマスに止まった時も、その行事のイベントが起きる', () => {
    let landed = false;
    for (let seed = 1; seed <= 40 && !landed; seed++) {
      const s = new Season({ seed, squad: squad(), events: TEST_EVENTS });
      while (s.day < indexOf(4, 7)) {
        finishStep(s, s.useCard(s.firstUsable()));
        while (s.pending) s.choose(0);
        while (s.pendingMatch) s.playMatch();
      }
      if (s.day === indexOf(4, 7)) { landed = true; expect(s.flags.entered).toBe(true); }
    }
    expect(landed).toBe(true);
  });
});

describe('怪我（イベントの効果）', () => {
  it('確率で起き、能力・体力・調子が少し下がる。体力が低いほど起きやすい', () => {
    expect(injuryChance(0.2, 100)).toBeCloseTo(0.2);
    expect(injuryChance(0.2, 0)).toBeCloseTo(0.2 * ENERGY.injuryLowMul);
    expect(injuryChance(0.2, 25)).toBeGreaterThan(0.2);
    const sq = squad();
    const p = sq.players[0];
    p.power = 60; p.energy = 50; p.condition = 0;
    const w = { year: 1, month: 5, players: sq.players, flags: {}, money: 0 };
    applyEffects([{ kind: 'injury', chance: 1, abilities: { power: -2 }, energy: -20, condition: -1 }], w, p.id, new Rng(1));
    expect(p.power).toBe(58);
    expect(p.energy).toBe(30);
    expect(p.condition).toBe(-1);
    applyEffects([{ kind: 'injury', chance: 0, abilities: { power: -2 } }], w, p.id, new Rng(1));
    expect(p.power).toBe(58);
  });
});
