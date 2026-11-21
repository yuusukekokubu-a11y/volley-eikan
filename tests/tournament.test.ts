import { describe, expect, it } from 'vitest';
import { Career } from '../src/grow/career';
import { indexOf } from '../src/grow/board';
import { MATCH_EXP, SQUAD_LIMIT, TOURNAMENTS } from '../src/grow/constants';
import { applyMatchExp } from '../src/grow/matchplay';
import { enroll } from '../src/grow/roster';
import { autoRegister, checkRegistration, makePrefecture } from '../src/grow/school';
import { finishStep, useQuickBouts, type Season } from '../src/grow/season';
import { Tournament, type Entry } from '../src/grow/tournament';
import { Rng } from '../src/sim/rng';
import type { Squad } from '../src/sim/types';
useQuickBouts();

const KEYS = ['jump', 'power', 'speed', 'technique', 'block', 'stamina'] as const;

function squad(seed: number, strong = false): Squad {
  const sq: Squad = { players: [], captainId: null };
  const rng = new Rng(seed);
  enroll(sq, 0, 'male', rng);
  enroll(sq, 0, 'male', rng);
  enroll(sq, 1, 'male', rng);
  if (strong) for (const p of sq.players) for (const k of KEYS) p[k] = 97;
  return sq;
}

/** 条件を満たすまで進める（試合は done を見てから「結果だけ」で行う） */
function until(s: Season, done: () => boolean) {
  let guard = 0;
  while (!done() && !s.over && guard++ < 1500) {
    if (s.pendingMatch) { s.playMatch(); continue; }
    while (s.pending) s.choose(0);
    if (s.matchChoices) { s.chooseMatch(0); continue; }
    if (s.matchInvite) { s.answerInvite(false); continue; }
    finishStep(s, s.useCard(s.firstUsable()));
    while (s.pending) s.choose(0);
  }
}

describe('トーナメント', () => {
  const entries = (n = 32): Entry[] => Array.from({ length: n }, (_, i) => ({ id: `e${i}`, name: `${i}`, strength: 80 - i, own: i === 20 }));
  const quick = (a: Entry, b: Entry) => ({ aWins: a.strength > b.strength, sets: '2-0' });

  it('32校で5回戦。強い2校は別の山に入り、強い方が勝てば決勝で当たる', () => {
    const t = new Tournament(TOURNAMENTS.interhighPrelim, entries(), new Rng(1), 1);
    expect(t.rounds[0]).toHaveLength(16);
    const p0 = t.entries.findIndex(e => e.id === 'e0'), p1 = t.entries.findIndex(e => e.id === 'e1');
    expect(Math.floor(p0 / 16)).not.toBe(Math.floor(p1 / 16));
    t.recordOwn(false, '2-0');
    t.finish(quick);
    expect(t.over).toBe(true);
    expect(t.rounds).toHaveLength(5);
    expect(t.champion!.id).toBe('e0');
    expect(t.ownResult().text).toBe('1回戦で負け');
  });

  it('セット数：インターハイ本戦は決勝だけ5セット、春高本戦は準決勝・決勝が5セット、予選は全部3セット', () => {
    expect(TOURNAMENTS.interhigh.bestOf).toEqual([3, 3, 3, 3, 5]);
    expect(TOURNAMENTS.harukou.bestOf).toEqual([3, 3, 3, 5, 5]);
    expect(TOURNAMENTS.interhighPrelim.bestOf.every(b => b === 3)).toBe(true);
  });
});

describe('登録と県内の学校', () => {
  it('登録は12人まで、リベロは2人まで。自動の登録は決まりに合う', () => {
    const sq = squad(3);
    expect(sq.players.length).toBeGreaterThan(SQUAD_LIMIT.size);
    const ids = autoRegister(sq.players);
    expect(ids).toHaveLength(SQUAD_LIMIT.size);
    expect(checkRegistration(sq.players, ids)).toBeNull();
    expect(checkRegistration(sq.players, sq.players.map(p => p.id))).toMatch(/12人まで/);
  });

  it('県内の学校は31校で、毎年同じ学校（強さは年度の終わりに少し動く）', () => {
    expect(makePrefecture(5)).toHaveLength(31);
    expect(makePrefecture(5)).toEqual(makePrefecture(5));
    const c = new Career({ seed: 5, squad: squad(5), events: [] });
    const names = c.schools.map(x => x.name);
    const before = c.schools.map(x => x.strength);
    until(c.season, () => false);
    c.nextYear();
    expect(c.schools.map(x => x.name)).toEqual(names);
    expect(c.season.schools).toBe(c.schools);
    expect(c.schools.map(x => x.strength)).not.toEqual(before);
    expect(c.history.some(h => h.tournament === 'インターハイ予選')).toBe(true);
  });
});

describe('大会の進み方', () => {
  it('予選：大会の日に止まって試合。勝つと次の回戦の日（数日後）に止まり、間は双六を進む。負けたら終わり', () => {
    const c = new Career({ seed: 7, squad: squad(7, true), events: [] });
    const s = c.season;
    until(s, () => !!s.pendingMatch && s.pendingMatch.kind === 'tournament');
    expect(s.date).toEqual({ month: 6, day: 1 });
    expect(s.pendingMatch!.limit).toBe(true);
    expect(() => s.useCard(s.firstUsable())).toThrow();
    s.playMatch();
    expect(s.tournamentDay).toBe(indexOf(6, 4));
    until(s, () => !!s.pendingMatch);
    expect(s.date).toEqual({ month: 6, day: 4 });
    expect(s.pendingMatch!.title).toContain('2回戦');
    until(s, () => !!s.tournaments.interhighPrelim?.over);
    expect(s.tournaments.interhighPrelim!.ownResult().text).toBe('優勝');
    expect(s.qualified.interhigh).toBe(true);
  });

  it('本戦：続けて試合をする（1日ずつ進み、間に練習なし）。決勝は5セット', () => {
    const c = new Career({ seed: 8, squad: squad(8, true), events: [] });
    const s = c.season;
    until(s, () => !!s.pendingMatch && s.pendingMatch.tournamentId === 'interhigh');
    expect(s.date).toEqual({ month: 7, day: 28 });
    const days: number[] = [];
    const bestOf: number[] = [];
    const energy = s.squad.players[0].energy;
    while (s.pendingMatch?.tournamentId === 'interhigh') {
      days.push(s.day);
      bestOf.push(s.pendingMatch.bestOf);
      s.playMatch();
    }
    expect(days).toEqual([0, 1, 2, 3, 4].map(i => indexOf(7, 28) + i));
    expect(bestOf).toEqual([3, 3, 3, 3, 5]);
    expect(s.squad.players[0].energy).toBe(energy);
    expect(s.tournaments.interhigh!.ownResult().text).toBe('優勝');
  });

  it('予選で負けた年は本戦に出ない（止まらない）', () => {
    const sq = squad(9);
    for (const p of sq.players) for (const k of KEYS) p[k] = 5;
    const c = new Career({ seed: 9, squad: sq, events: [] });
    const s = c.season;
    until(s, () => s.day > indexOf(8, 5));
    expect(s.tournaments.interhighPrelim!.over).toBe(true);
    expect(s.qualified.interhigh).toBeFalsy();
    expect(s.tournaments.interhigh).toBeUndefined();
  });

  it('練習試合も試合をする（登録の制限なし）。勝つと報奨', () => {
    const c = new Career({ seed: 3, squad: squad(3, true), events: [] });
    const s = c.season;
    until(s, () => s.pendingMatch?.kind === 'practice');
    expect(s.pendingMatch!.limit).toBe(false);
    expect(s.defaultRegistration().length).toBe(s.squad.players.filter(p => !p.retired).length);
    const money = s.money;
    const r = s.playMatch();
    if (r.notes[0].includes('勝ち')) expect(s.money).toBeGreaterThan(money);
  });
});

describe('試合の経験', () => {
  it('スタメン＞途中出場＞ベンチ入り＞ベンチ外。練習指示の能力に入る', () => {
    const sq = squad(4);
    const [a, b, c, d] = sq.players;
    for (const p of [a, b, c, d]) { p.power = 50; p.exp.power = 0; p.practice.focus = 'power'; }
    applyMatchExp([a, b, c, d], {
      win: true, sets: [{ own: 25, opp: 20 }, { own: 25, opp: 20 }], starters: [a.id],
      lines: { [a.id]: { sets: 2, roles: { OH: 2 }, kills: 0, blockPoints: 0, aces: 0 }, [b.id]: { sets: 1, roles: { OH: 1 }, kills: 0, blockPoints: 0, aces: 0 } },
    }, [a.id, b.id, c.id]);
    const g = [a, b, c, d].map(p => p.power + p.exp.power - 50);
    expect(g[0]).toBeGreaterThan(g[1]);
    expect(g[1]).toBeGreaterThan(g[2]);
    expect(g[2]).toBeGreaterThan(g[3]);
    expect(g[0] / g[3]).toBeCloseTo(MATCH_EXP.starter / MATCH_EXP.out, 5);
  });
});
