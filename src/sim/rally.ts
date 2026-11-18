// 1ラリーのシミュレーション。描画は一切知らず、座標つきの記録（RallyRecord）を返すだけ。
//
// 内部では各チームの「自コート基準」の座標で考える。
//   u = ネットからの距離（0〜9。9がエンドライン）
//   v = 自分のコートでネットを向いた時の左が＋（-4.5〜4.5）
// 記録に書く時に world() で共通の座標（types.ts の説明）に直す。

import {
  aptitudeFactor, blockReachCm, effective, hitHeightCm, jumpHeightCm, reactionTime, runSpeed,
  sideSpeed, standingReachCm, type AbilityKey,
} from './ability';
import {
  ATTACK, BLOCK, BLOCK_BASE_V, BODY, COURT, DEFENSE_POS, GENDER_WEIGHTS, HIT_U, LANE_V, LOAD,
  MAX_CONTACTS, PASS, RECEIVE_FORMATION, SERVE, SET, SET_TARGET, TACTIC_FIT, TIMING,
} from './constants';
import { Rng } from './rng';
import { applyTraits, type Side } from './traits';
import type {
  ActionInfo, ActionType, BallKind, BallSegment, Player, PlayerPlacement, PointReason, RallyEvent,
  RallyInput, RallyRecord, Role, SetType, TeamId, Vec2, Vec3,
} from './types';

interface Local { u: number; v: number }

interface CourtPlayer {
  p: Player;
  team: TeamId;
  role: Role;
  /** ローテーション上の位置 0〜5（ゾーン1〜6） */
  zoneIdx: number;
  front: boolean;
  fatigue: number;
}

type Slot = 'left' | 'mid' | 'right';

type IncomingKind = 'serve' | 'spike' | 'tip' | 'oneTouch' | 'freeball' | 'overpass' | 'blockBack';

/** 相手から飛んでくる（またはこちらのコートに入ってくる）ボール */
interface Incoming {
  team: TeamId;
  kind: IncomingKind;
  land: Local;
  tArrive: number;
  flight: number;
  pressure: number;
  shake: number;
  /** 最高点（m）。undefined なら直線（スパイク） */
  apex?: number;
  ballKind: BallKind;
  /** 拾えずに落ちた時の得点理由と関係者 */
  dropReason: PointReason;
  dropKey?: string;
  sender?: CourtPlayer;
}

/** 1本目で上がったボール */
interface BallUp {
  team: TeamId;
  t: number;
  at: Local;
  offset: number;
  spin: number;
  firstToucher: string;
}

interface SetBall {
  team: TeamId;
  attacker: CourtPlayer;
  setType: SetType;
  hit: Local;
  tSet: number;
  tHit: number;
  setError: number;
  secondary: boolean;
}

interface Blocker {
  cp: CourtPlayer;
  spot: Local;
  timing: number;
  reachCm: number;
}

type Step =
  | { kind: 'incoming'; inc: Incoming }
  | { kind: 'ballUp'; bu: BallUp }
  | { kind: 'set'; sb: SetBall }
  | { kind: 'end' };

const ZONE_POS: Local[] = [
  { u: 7, v: -3 }, { u: 2, v: -3 }, { u: 2, v: 0 }, { u: 2, v: 3 }, { u: 7, v: 3 }, { u: 7, v: 0 },
];
const SLOT_V: Record<Slot, number> = { left: 3, mid: 0, right: -3 };

const other = (t: TeamId): TeamId => (t === 'A' ? 'B' : 'A');
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const dist = (a: Local, b: Local) => Math.hypot(a.u - b.u, a.v - b.v);
const round = (v: number) => Math.round(v * 1000) / 1000;

export function simulateRally(input: RallyInput): RallyRecord {
  return new RallySim(input).run();
}

class RallySim {
  private rng: Rng;
  private w: { physical: number; skill: number; tactic: number };
  private netH: number;
  private court: Record<TeamId, CourtPlayer[]> = { A: [], B: [] };
  private pos = new Map<string, Local>();
  private busyUntil = new Map<string, number>();
  private events: RallyEvent[] = [];
  private ball: BallSegment[] = [];
  private ballPos: Vec3 = { x: 0, y: 0, z: 0 };
  private ballT = 0;
  private load: Record<string, number> = {};
  private touches = 0;
  private placements: PlayerPlacement[] = [];
  private result?: { winner: TeamId; reason: PointReason; key?: string; t: number };

  constructor(private input: RallyInput) {
    this.rng = new Rng(input.seed);
    this.w = GENDER_WEIGHTS[input.gender];
    this.netH = COURT.netHeight[input.gender];
  }

  run(): RallyRecord {
    this.setup();
    let step: Step = this.serve();
    while (step.kind !== 'end') {
      if (step.kind === 'incoming') step = this.firstTouch(step.inc);
      else if (step.kind === 'ballUp') step = this.secondTouch(step.bu);
      else step = this.attack(step.sb);
    }
    const r = this.result!;
    this.events.sort((a, b) => a.t - b.t);
    return {
      seed: this.input.seed,
      serving: this.input.serving,
      winner: r.winner,
      reason: r.reason,
      keyPlayerId: r.key,
      duration: round(r.t + TIMING.endPause),
      placements: this.placements,
      events: this.events,
      ball: this.ball,
      load: this.load,
      touches: this.touches,
    };
  }

  // ============================================================
  // 準備
  // ============================================================

  private setup() {
    for (const team of ['A', 'B'] as TeamId[]) {
      const ts = this.input.teams[team];
      if (ts.rotation.length !== 6) throw new Error(`チーム${team}のローテーションが6人ではありません`);
      const serving = this.input.serving === team;
      const list: CourtPlayer[] = ts.rotation.map((slot, i) => ({
        p: slot.player, team, role: slot.role, zoneIdx: i, front: i >= 1 && i <= 3,
        fatigue: ts.fatigue?.[slot.player.id] ?? 0,
      }));
      // リベロは後衛のミドルと自動で入れ替わる（サーブを打つミドルは除く）
      if (ts.libero) {
        const idx = list.findIndex(c => c.role === 'MB' && !c.front && !(serving && c.zoneIdx === 0));
        if (idx >= 0) {
          list[idx] = { ...list[idx], p: ts.libero, role: 'L', fatigue: ts.fatigue?.[ts.libero.id] ?? 0 };
        }
      }
      this.court[team] = list;
      for (const c of list) this.load[c.p.id] = 0;
    }

    // 最初の並び：サーブ側は基本の位置、レシーブ側はサーブレシーブの隊形
    const s = this.input.serving;
    for (const c of this.court[s]) {
      const z = ZONE_POS[c.zoneIdx];
      this.pos.set(c.p.id, c.zoneIdx === 0 ? { u: SERVE.serverU, v: -2.5 } : { u: c.front ? 1.2 : z.u, v: z.v });
    }
    this.placeReceiveFormation(other(s));

    for (const team of ['A', 'B'] as TeamId[]) {
      for (const c of this.court[team]) {
        const l = this.pos.get(c.p.id)!;
        const w = this.world(team, l);
        this.placements.push({
          playerId: c.p.id, team, number: c.p.number, role: c.role, height: c.p.height,
          pos: { x: round(w.x), y: round(w.y) },
        });
      }
    }
  }

  private receivers(team: TeamId): CourtPlayer[] {
    const list = this.court[team];
    const pri = (c: CourtPlayer) =>
      c.role === 'L' ? 0 : c.role === 'OH' ? 1 : !c.front && c.role !== 'S' ? 2 : 9;
    return list.filter(c => pri(c) < 9).sort((a, b) => pri(a) - pri(b)).slice(0, 3);
  }

  private placeReceiveFormation(team: TeamId) {
    const recv = this.receivers(team);
    const sorted = [...recv].sort((a, b) => ZONE_POS[a.zoneIdx].v - ZONE_POS[b.zoneIdx].v);
    const spots = sorted.length >= 3 ? RECEIVE_FORMATION.spread3 : RECEIVE_FORMATION.spread2;
    sorted.forEach((c, i) => this.pos.set(c.p.id, { u: RECEIVE_FORMATION.u, v: spots[Math.min(i, spots.length - 1)] }));
    for (const c of this.court[team]) {
      if (recv.includes(c)) continue;
      const z = ZONE_POS[c.zoneIdx];
      if (c.role === 'S') this.pos.set(c.p.id, c.front ? { u: 1.0, v: -1.5 } : { u: 3.0, v: -2.0 });
      else this.pos.set(c.p.id, c.front ? { u: 1.5, v: z.v } : { u: 7.5, v: z.v });
    }
  }

  // ============================================================
  // 能力の値
  // ============================================================

  private eff(c: CourtPlayer, k: AbilityKey): number {
    return effective(c.p, k, c.fatigue);
  }
  /** 体の能力（跳躍・パワー・スピード）が判定に効く量。男女の重みを掛ける */
  private phys(c: CourtPlayer, k: AbilityKey): number {
    return this.eff(c, k) * this.w.physical;
  }
  /** テクニックが判定に効く量。男女の重みを掛ける */
  private skill(c: CourtPlayer, k: AbilityKey): number {
    return this.eff(c, k) * this.w.skill;
  }
  private hitCm(c: CourtPlayer): number {
    return hitHeightCm(c.p.height, this.eff(c, 'jump'));
  }
  private blockCm(c: CourtPlayer): number {
    return blockReachCm(c.p.height, this.eff(c, 'jump'));
  }
  private attackRating(c: CourtPlayer): number {
    return this.phys(c, 'power') * ATTACK.power + this.skill(c, 'technique') * ATTACK.tech
      + (this.hitCm(c) - this.netH * 100) * ATTACK.height * this.w.physical;
  }
  private reachDist(c: CourtPlayer, time: number): number {
    const sp = this.eff(c, 'speed');
    return Math.max(0, time - reactionTime(sp)) * runSpeed(sp) + BODY.lunge;
  }
  /** ボールが来るまでに使える時間（跳んだ後の着地と立て直しを差し引く） */
  private timeToReact(c: CourtPlayer, tArrive: number, flight: number): number {
    const free = (this.busyUntil.get(c.p.id) ?? -Infinity) + BODY.landingRecovery;
    return tArrive - Math.max(tArrive - flight, free);
  }
  private trait(values: Record<string, number>, judge: Parameters<typeof applyTraits>[1],
    inv: { c: CourtPlayer; side: Side }[]) {
    applyTraits(values, judge, inv.map(i => ({ player: i.c.p, team: i.c.team, side: i.side })), this.input.context);
  }

  // ============================================================
  // 記録
  // ============================================================

  private world(team: TeamId, l: Local, z = 0): Vec3 {
    return team === 'A' ? { x: -l.u, y: l.v, z } : { x: l.u, y: -l.v, z };
  }
  private w2(team: TeamId, l: Local): Vec2 {
    const p = this.world(team, l);
    return { x: round(p.x), y: round(p.y) };
  }

  private moveTo(c: CourtPlayer, to: Local, t: number, opts: { arriveBy?: number; dur?: number } = {}) {
    const from = this.pos.get(c.p.id)!;
    const d = dist(from, to);
    if (d < 0.05) return;
    const natural = d / runSpeed(this.eff(c, 'speed'));
    let dur = opts.dur ?? Math.max(0.15, natural);
    let start = t;
    if (opts.arriveBy !== undefined) {
      // 間に合う範囲でなるべく遅く動き出し、必ず arriveBy に着く
      start = Math.min(Math.max(t, opts.arriveBy - natural), opts.arriveBy - 0.12);
      dur = opts.arriveBy - start;
    }
    this.events.push({ type: 'move', t: round(start), playerId: c.p.id, to: this.w2(c.team, to), dur: round(dur) });
    this.pos.set(c.p.id, { ...to });
    this.load[c.p.id] += d * LOAD.perMeter;
  }

  private jump(c: CourtPlayer, t: number, dur: number, heightM: number) {
    this.events.push({ type: 'jump', t: round(t), playerId: c.p.id, dur: round(dur), height: round(heightM) });
    this.busyUntil.set(c.p.id, t + dur);
    this.load[c.p.id] += LOAD.jump;
  }

  private act(c: CourtPlayer, t: number, action: ActionType, at: Local, z: number, info?: ActionInfo) {
    const p = this.world(c.team, at, z);
    this.events.push({
      type: 'action', t: round(t), playerId: c.p.id, team: c.team, action,
      pos: { x: round(p.x), y: round(p.y), z: round(z) }, info,
    });
  }

  private ballTo(to: Vec3, t1: number, kind: BallKind, apex?: number) {
    const from = this.ballPos;
    const bulge = apex === undefined ? 0 : bulgeForApex(from.z, to.z, apex);
    this.ball.push({
      t0: round(this.ballT), t1: round(t1),
      from: { x: round(from.x), y: round(from.y), z: round(from.z) },
      to: { x: round(to.x), y: round(to.y), z: round(to.z) },
      bulge: round(bulge), kind,
    });
    this.ballPos = to;
    this.ballT = t1;
  }

  private land(to: Vec3, t: number, kind: BallKind, apex?: number) {
    this.ballTo({ ...to, z: 0 }, t, kind, apex);
    const inCourt = Math.abs(to.x) <= COURT.halfLength && Math.abs(to.y) <= COURT.halfWidth;
    this.events.push({ type: 'land', t: round(t), pos: { x: round(to.x), y: round(to.y), z: 0 }, inCourt });
  }

  private point(winner: TeamId, reason: PointReason, t: number, key?: string): Step {
    this.result = { winner, reason, key, t };
    this.events.push({ type: 'point', t: round(t), winner, reason, playerId: key });
    return { kind: 'end' };
  }

  // ============================================================
  // 隊形
  // ============================================================

  private assignSlots(list: CourtPlayer[], prefs: Record<Role, Slot[]>, order: Role[]): Map<CourtPlayer, Slot> {
    const res = new Map<CourtPlayer, Slot>();
    const used = new Set<Slot>();
    const sorted = [...list].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
    for (const c of sorted) {
      const s = prefs[c.role].find(x => !used.has(x)) ?? (['left', 'mid', 'right'] as Slot[]).find(x => !used.has(x))!;
      used.add(s);
      res.set(c, s);
    }
    return res;
  }

  private frontSlots(team: TeamId) {
    return this.assignSlots(
      this.court[team].filter(c => c.front),
      { MB: ['mid', 'right', 'left'], S: ['right', 'mid', 'left'], OP: ['right', 'left', 'mid'], OH: ['left', 'right', 'mid'], L: ['mid', 'left', 'right'] },
      ['MB', 'S', 'OP', 'OH', 'L'],
    );
  }

  private backSlots(team: TeamId) {
    return this.assignSlots(
      this.court[team].filter(c => !c.front),
      { S: ['right', 'mid', 'left'], OP: ['right', 'mid', 'left'], L: ['left', 'mid', 'right'], OH: ['mid', 'left', 'right'], MB: ['mid', 'left', 'right'] },
      ['S', 'OP', 'L', 'OH', 'MB'],
    );
  }

  /** 攻撃のレーン（攻撃側の自コート基準の v） */
  private laneOf(c: CourtPlayer, slot: Slot): number {
    if (c.role === 'MB') return LANE_V.quick;
    return slot === 'left' ? LANE_V.left : slot === 'right' ? LANE_V.right : LANE_V.timeDiff;
  }

  /** 相手の攻撃に備える守備の基本隊形 */
  private defenseBase(team: TeamId, t: number) {
    const ts = this.input.teams[team];
    const fs = this.frontSlots(team);
    const base = BLOCK_BASE_V[ts.tactics.block];
    let shift = 0;
    if (ts.tactics.block === 'dedicate') {
      // 相手の前衛で一番攻撃力のある選手の側に寄る
      const opp = other(team);
      const ofs = this.frontSlots(opp);
      let best: { c: CourtPlayer; r: number } | undefined;
      for (const [c] of ofs) {
        if (c.role === 'S' || c.role === 'L') continue;
        const r = this.attackRating(c);
        if (!best || r > best.r) best = { c, r };
      }
      if (best) {
        const laneDef = -this.laneOf(best.c, ofs.get(best.c)!);
        shift = Math.sign(laneDef) * BLOCK_BASE_V.dedicate.shift * Math.min(1.5, this.w.tactic);
      }
    }
    for (const [c, s] of fs) this.moveTo(c, { u: 0.8, v: clamp(base[s] + shift, -4, 4) }, t);
    const dp = DEFENSE_POS[ts.tactics.receive];
    for (const [c, s] of this.backSlots(team)) this.moveTo(c, dp[s], t);
  }

  /** こちらの攻撃に向けて助走の位置へ */
  private attackBase(team: TeamId, t: number, exclude: Set<string>) {
    const fs = this.frontSlots(team);
    for (const [c, s] of fs) {
      if (exclude.has(c.p.id) || c.role === 'S') continue;
      const u = c.role === 'MB' ? 2.2 : 3.5;
      this.moveTo(c, { u, v: this.laneOf(c, s) }, t);
    }
    for (const [c, s] of this.backSlots(team)) {
      if (exclude.has(c.p.id) || c.role === 'S') continue;
      this.moveTo(c, { u: 4.5, v: SLOT_V[s] * 0.8 }, t);
    }
  }

  // ============================================================
  // サーブ
  // ============================================================

  private serve(): Step {
    const st = this.input.serving;
    const rt = other(st);
    const server = this.court[st].find(c => c.zoneIdx === 0)!;
    const type = server.p.serveType;
    const tc = TIMING.serveContact;
    const tech = this.skill(server, 'technique');
    const pc = SERVE.pressure[type];
    const v: Record<string, number> = {
      faultRate: clamp(SERVE.faultRate[type] * (1 - (tech - 50) * SERVE.faultTechSlope), 0.01, 0.6),
      pressure: pc.base + tech * pc.tech + this.phys(server, 'power') * pc.power + this.phys(server, 'jump') * pc.jump,
      shake: SERVE.shake[type],
    };
    this.trait(v, 'serve', [{ c: server, side: 'actor' }]);

    const sPos = this.pos.get(server.p.id)!;
    const standing = standingReachCm(server.p.height) / 100;
    const jumpM = jumpHeightCm(this.eff(server, 'jump')) / 100;
    const z = type === 'float' ? standing + 0.1 : type === 'jumpFloat' ? standing + jumpM * 0.5 : standing + jumpM * 0.9;
    if (type !== 'float') this.jump(server, tc - TIMING.jumpRise, TIMING.jumpTotal, type === 'jumpFloat' ? jumpM * 0.5 : jumpM * 0.9);
    this.ballPos = this.world(st, { u: sPos.u - 0.3, v: sPos.v }, 1.0);
    this.ballT = 0;
    this.ballTo(this.world(st, { u: sPos.u - 0.3, v: sPos.v }, z), tc, 'serve', z + 1.5);
    this.act(server, tc, 'serve', { u: sPos.u - 0.3, v: sPos.v }, z, { serveType: type });
    this.touches++;

    // サーブを打った後はサーブ側が守備の隊形へ
    this.defenseBase(st, tc + 0.2);

    const target: Local = { u: this.rng.range(SERVE.targetU[0], SERVE.targetU[1]), v: this.rng.range(SERVE.targetV[0], SERVE.targetV[1]) };
    const flight = TIMING.serveFlight[type];
    const apex = type === 'spike' ? Math.max(z, this.netH + 0.6) : Math.max(z, this.netH + 0.8) + 0.4;

    if (this.rng.chance(v.faultRate)) {
      if (this.rng.chance(0.5)) {
        const net = { x: 0, y: this.world(rt, target).y, z: this.netH - 0.3 };
        this.ballTo(net, tc + flight * 0.5, 'serve', Math.max(z, this.netH) + 0.2);
        const drop = this.world(st, { u: 0.5, v: target.v });
        this.land(drop, tc + flight * 0.5 + 0.5, 'drop');
        return this.point(rt, 'serveFault', tc + flight * 0.5 + 0.5, server.p.id);
      }
      const out: Local = this.rng.chance(0.6)
        ? { u: this.rng.range(9.4, 10.8), v: target.v }
        : { u: target.u, v: Math.sign(target.v || 1) * this.rng.range(4.8, 5.8) };
      this.land(this.world(rt, out), tc + flight + 0.1, 'serve', apex);
      return this.point(rt, 'serveFault', tc + flight + 0.1, server.p.id);
    }

    return {
      kind: 'incoming',
      inc: {
        team: rt, kind: 'serve', land: target, tArrive: tc + flight, flight, pressure: v.pressure, shake: v.shake,
        apex, ballKind: 'serve', dropReason: 'ace', dropKey: server.p.id, sender: server,
      },
    };
  }

  // ============================================================
  // 1本目（レシーブ・ディグ・つなぎ）
  // ============================================================

  private firstTouch(inc: Incoming): Step {
    const team = inc.team;
    const opp = other(team);
    const ts = this.input.teams[team];
    let cands = this.court[team].filter(c => this.timeToReact(c, inc.tArrive, inc.flight) > 0);
    if (inc.kind === 'serve') {
      const recv = this.receivers(team);
      cands = inc.land.u < 3.5 ? cands.filter(c => c.role !== 'S') : cands.filter(c => recv.includes(c));
    }

    let best: { c: CourtPlayer; margin: number; d: number; reach: number } | undefined;
    for (const c of cands) {
      const d = dist(this.pos.get(c.p.id)!, inc.land);
      const reach = this.reachDist(c, this.timeToReact(c, inc.tArrive, inc.flight));
      // セッターは2本目のために、なるべく1本目を触らない
      const margin = reach - d - (c.role === 'S' && inc.kind !== 'serve' ? 0.8 : 0);
      if (!best || margin > best.margin) best = { c, margin, d, reach };
    }

    const landW = this.world(team, inc.land);
    const forced = this.touches >= MAX_CONTACTS;
    if (!best || best.reach < best.d || forced) {
      // 誰も届かない：ボールが落ちる
      if (best) {
        const from = this.pos.get(best.c.p.id)!;
        const k = Math.min(1, best.reach / Math.max(best.d, 0.01));
        this.moveTo(best.c, { u: from.u + (inc.land.u - from.u) * k, v: from.v + (inc.land.v - from.v) * k }, inc.tArrive - inc.flight + 0.2, { arriveBy: inc.tArrive });
      }
      this.land(landW, inc.tArrive, inc.ballKind, inc.apex);
      return this.point(opp, inc.dropReason, inc.tArrive, inc.dropKey);
    }

    const c = best.c;
    const dive = best.d > best.reach - BODY.lunge;
    let sk = PASS.skill.base + this.skill(c, 'technique') * PASS.skill.tech * (c.role === 'L' ? aptitudeFactor(c.p, 'L') : 1)
      + this.phys(c, 'speed') * PASS.skill.speed;
    if (inc.kind === 'spike' || inc.kind === 'tip') {
      const match = (inc.kind === 'spike') === (ts.tactics.receive === 'back');
      sk += (match ? TACTIC_FIT.receiveMatch : TACTIC_FIT.receiveMismatch) * this.w.tactic;
    }
    if (dive) sk -= 8;
    const baseKey = inc.kind === 'blockBack' ? 'oneTouch' : inc.kind;
    const v: Record<string, number> = {
      skill: sk, pressure: inc.pressure, base: PASS.base[baseKey], noise: PASS.noise + inc.shake,
      failBelow: PASS.failBelow, offsetMul: 1, spinMul: 1,
    };
    const inv: { c: CourtPlayer; side: Side }[] = [{ c, side: 'actor' }];
    if (inc.sender) inv.push({ c: inc.sender, side: 'opponent' });
    this.trait(v, 'pass', inv);

    const p = sigmoid((v.skill - v.pressure) / PASS.scale + v.base + this.rng.normal() * v.noise);
    const isServe = inc.kind === 'serve';
    const z = dive ? PASS.contactZ.dive : isServe ? PASS.contactZ.receive : PASS.contactZ.dig;

    this.moveTo(c, inc.land, inc.tArrive - inc.flight + 0.1, { arriveBy: inc.tArrive });
    this.ballTo(this.world(team, inc.land, z), inc.tArrive, inc.ballKind, inc.apex);
    this.touches++;
    if (!isServe) this.load[c.p.id] += LOAD.dig;

    if (p < v.failBelow) {
      this.act(c, inc.tArrive, isServe ? 'receive' : 'dig', inc.land, z, { offset: 99, spin: 1 });
      const away: Local = { u: clamp(inc.land.u + this.rng.range(1, 4), 0, 12), v: inc.land.v + this.rng.range(-5, 5) };
      this.land(this.world(team, away), inc.tArrive + 0.7, 'deflect', z + this.rng.range(0.3, 2));
      const reason: PointReason = inc.kind === 'freeball' || inc.kind === 'overpass' ? 'receiveError' : inc.dropReason;
      const key = reason === 'receiveError' ? c.p.id : inc.dropKey;
      return this.point(opp, reason, inc.tArrive + 0.7, key);
    }

    const offset = PASS.maxOffset * Math.pow(1 - p, PASS.offsetPow) * this.rng.range(0.6, 1.25) * v.offsetMul;
    const spin = clamp((inc.pressure / 100) * (1 - p) * PASS.spinScale * v.spinMul + this.rng.range(0, 0.08), 0, 1);
    this.act(c, inc.tArrive, isServe ? 'receive' : 'dig', inc.land, z, { offset: round(offset), spin: round(spin) });

    // ずれが大きいと相手コートへ返ってしまう
    if (offset >= PASS.overpassOffset && this.rng.chance(PASS.overpassChance)) {
      const land: Local = { u: this.rng.range(1, 4.5), v: this.rng.range(-4, 4) };
      const tA = inc.tArrive + TIMING.overpassFlight;
      this.defenseBase(team, inc.tArrive + 0.2);
      this.attackBase(opp, inc.tArrive + 0.2, new Set());
      return {
        kind: 'incoming',
        inc: {
          team: opp, kind: 'overpass', land, tArrive: tA, flight: TIMING.overpassFlight, pressure: 15, shake: 0,
          apex: this.netH + 2.0, ballKind: 'pass', dropReason: 'freeballDrop', sender: c,
        },
      };
    }

    const du = offset * this.rng.range(0, 1);
    const dv = Math.sqrt(Math.max(0, offset * offset - du * du)) * (this.rng.chance(0.5) ? 1 : -1);
    const at: Local = { u: clamp(SET_TARGET.u + du, 0.3, 8.5), v: clamp(SET_TARGET.v + dv, -4.3, 4.3) };
    const tUp = inc.tArrive + TIMING.passFlight + offset * TIMING.passFlightPerOffset;
    this.ballTo(this.world(team, at, 2.3), tUp, 'pass', 3.6 + offset * 0.4);

    // 相手は守備の隊形、こちらは攻撃の準備
    this.defenseBase(opp, inc.tArrive + 0.1);
    this.attackBase(team, inc.tArrive + 0.15, new Set([c.p.id]));
    return { kind: 'ballUp', bu: { team, t: tUp, at, offset, spin, firstToucher: c.p.id } };
  }

  // ============================================================
  // 2本目（トス）
  // ============================================================

  private secondTouch(bu: BallUp): Step {
    const team = bu.team;
    const opp = other(team);
    const ts = this.input.teams[team];
    const list = this.court[team];
    const setter = list.find(c => c.role === 'S');
    const useSetter = !!setter && setter.p.id !== bu.firstToucher && bu.offset <= SET.setterReach;
    let tosser: CourtPlayer;
    if (useSetter) tosser = setter!;
    else {
      const pool = list.filter(c => c.p.id !== bu.firstToucher);
      tosser = pool.reduce((a, b) => {
        const da = dist(this.pos.get(a.p.id)!, bu.at) - (a.role === 'L' ? 1 : 0);
        const db = dist(this.pos.get(b.p.id)!, bu.at) - (b.role === 'L' ? 1 : 0);
        return db < da ? b : a;
      });
    }
    this.moveTo(tosser, bu.at, bu.t - 1.0, { arriveBy: bu.t });

    // 攻撃の選択肢
    const fs = this.frontSlots(team);
    const options: { c: CourtPlayer; type: SetType; w: number; lane: number }[] = [];
    const tw = SET.tacticWeights[ts.tactics.attack];
    const can = (type: SetType) => (type === 'high' || useSetter) && bu.offset <= SET.maxOffset[type];
    const wings: CourtPlayer[] = [];
    for (const [c] of fs) {
      if (c.role === 'S' || c.role === 'L' || c === tosser) continue;
      if (c.role === 'MB') {
        if (can('quick')) options.push({ c, type: 'quick', w: tw.quick, lane: LANE_V.quick });
        if (can('timeDiff')) options.push({ c, type: 'timeDiff', w: tw.timeDiff, lane: LANE_V.timeDiff });
        options.push({ c, type: 'high', w: tw.high * 0.3, lane: LANE_V.timeDiff * 0.5 });
      } else wings.push(c);
    }
    if (wings.length) {
      const ace = wings.reduce((a, b) => (this.attackRating(b) > this.attackRating(a) ? b : a));
      const share = wings.length === 1 ? 1 : SET.aceShare[ts.tactics.attack];
      for (const c of wings) {
        const part = c === ace ? share : (1 - share) / (wings.length - 1);
        const lane = this.laneOf(c, fs.get(c)!);
        if (can('fast')) options.push({ c, type: 'fast', w: tw.fast * part, lane });
        options.push({ c, type: 'high', w: tw.high * part, lane });
      }
    }
    const choice = this.rng.weighted(options.map(o => ({ item: o, w: o.w })));

    // トスの精度
    const tossSkill = this.skill(tosser, 'technique') * (useSetter ? aptitudeFactor(tosser.p, 'S') : SET.secondarySkill);
    const v: Record<string, number> = {
      errScale: SET.errBase * (1 + bu.offset * SET.errOffsetK + bu.spin * SET.errSpinK) * Math.max(0.2, SET.skillPivot - tossSkill / 100),
    };
    this.trait(v, 'set', [{ c: tosser, side: 'actor' }]);
    const setError = Math.abs(this.rng.normal()) * v.errScale;
    this.touches++;
    this.load[tosser.p.id] += LOAD.set;
    const setZ = Math.max(2.0, standingReachCm(tosser.p.height) / 100 - 0.1);

    if (!choice || setError >= SET.setFault) {
      // トスミス：ボールが続かない
      this.act(tosser, bu.t, 'set', bu.at, setZ, { secondary: !useSetter });
      const away: Local = { u: bu.at.u + this.rng.range(-1, 3), v: bu.at.v + this.rng.range(-4, 4) };
      this.land(this.world(team, away), bu.t + 1.0, 'deflect', setZ + 1.5);
      return this.point(opp, 'receiveError', bu.t + 1.0, tosser.p.id);
    }

    const attacker = choice.c;
    const setType = choice.type;
    const ang = this.rng.range(0, Math.PI * 2);
    const hit: Local = {
      u: clamp(HIT_U + Math.abs(Math.cos(ang)) * setError, 0.25, 3.5),
      v: clamp(choice.lane + Math.sin(ang) * setError, -4.6, 4.6),
    };
    const flight = TIMING.setFlight[setType] + (useSetter ? 0 : TIMING.secondarySetExtra);
    const tHit = bu.t + flight;
    const hitZ = this.hitCm(attacker) / 100;
    this.act(tosser, bu.t, 'set', bu.at, setZ, { setType, secondary: !useSetter });
    this.ballTo(this.world(team, hit, hitZ), tHit, 'set', hitZ + TIMING.setApexAbove[setType] + (useSetter ? 0 : 0.5));

    // 打ち手の助走、ほかの前衛はおとりの動き
    this.moveTo(attacker, { u: hit.u + 0.3, v: hit.v }, tHit - TIMING.approach, { arriveBy: tHit - TIMING.jumpRise });
    for (const [c] of fs) {
      if (c === attacker || c === tosser || c.role === 'S' || c.role === 'L') continue;
      const p = this.pos.get(c.p.id)!;
      this.moveTo(c, { u: Math.max(0.8, p.u - 1.8), v: p.v }, bu.t, { arriveBy: tHit });
    }
    if (setType === 'timeDiff') {
      this.act(attacker, bu.t + TIMING.setFlight.quick, 'fakeJump', { u: hit.u + 0.4, v: hit.v - 0.6 }, 0);
    }

    const sb: SetBall = { team, attacker, setType, hit, tSet: bu.t, tHit, setError, secondary: !useSetter };

    if (setError >= SET.unhittable) {
      // 打てないトス：つなぎで返す
      this.act(attacker, tHit, 'freeball', hit, Math.min(hitZ, 2.4));
      this.touches++;
      const land: Local = { u: this.rng.range(4, 8), v: this.rng.range(-3.5, 3.5) };
      return {
        kind: 'incoming',
        inc: {
          team: opp, kind: 'freeball', land, tArrive: tHit + TIMING.freeballFlight, flight: TIMING.freeballFlight,
          pressure: 15, shake: 0, apex: this.netH + 2.2, ballKind: 'freeball', dropReason: 'freeballDrop', sender: attacker,
        },
      };
    }
    return { kind: 'set', sb };
  }

  // ============================================================
  // 3本目（スパイク・ブロック）
  // ============================================================

  private attack(sb: SetBall): Step {
    const team = sb.team;
    const opp = other(team);
    const a = sb.attacker;
    const hitCm = this.hitCm(a);
    const hitZ = hitCm / 100;
    const netCm = this.netH * 100;
    const tech = this.skill(a, 'technique');

    let penalty = sb.setError * ATTACK.tempoPenalty[sb.setType];
    if (sb.setType === 'quick' || sb.setType === 'timeDiff') {
      penalty += Math.max(0, 50 - this.eff(a, 'speed')) * ATTACK.quickSpeedPenalty;
    }
    const blockers = this.blockers(sb);
    const maxReach = blockers.reduce((m, b) => Math.max(m, b.reachCm), 0);

    // ネットを越えて強打できる最短の距離
    const clearZ = this.netH + ATTACK.netClearance;
    const minLand = hitZ - clearZ > 0.05 ? (sb.hit.u * clearZ) / (hitZ - clearZ) : Infinity;
    const canHard = minLand <= ATTACK.hardTargetU[1] - 0.5;

    const v: Record<string, number> = {
      power: this.phys(a, 'power') * ATTACK.power + tech * ATTACK.tech + (hitCm - netCm) * ATTACK.height * this.w.physical - penalty,
      errRate: ATTACK.errBase + sb.setError * ATTACK.errPerSetError - (tech - 50) * ATTACK.errTechSlope,
      softRate: ATTACK.softBase + (sb.setError > ATTACK.softBadSetFrom ? ATTACK.softBadSet : 0)
        + (blockers.length && maxReach > hitCm ? ATTACK.softHighBlock : 0),
    };
    this.trait(v, 'attack', [{ c: a, side: 'actor' }, ...blockers.map(b => ({ c: b.cp, side: 'opponent' as Side }))]);

    const soft = !canHard || this.rng.chance(v.softRate);
    const errRate = clamp(v.errRate * (soft ? ATTACK.softErrRatio : 1), 0.01, 0.6);
    const overBlock = blockers.length > 0 && hitCm - maxReach >= BLOCK.overMarginCm;

    // 打ち手・ブロッカーの動き
    this.jump(a, sb.tHit - TIMING.jumpRise, TIMING.jumpTotal, jumpHeightCm(this.eff(a, 'jump')) / 100);
    const tBlock = sb.tHit + 0.04;
    for (const b of blockers) {
      this.jump(b.cp, sb.tHit - TIMING.blockRise, TIMING.blockTotal, (b.reachCm - standingReachCm(b.cp.p.height)) / 100);
      this.act(b.cp, tBlock, 'block', b.spot, b.reachCm / 100);
    }
    const info: ActionInfo = {
      setType: sb.setType, hitHeight: round(hitCm), blockReach: blockers.length ? round(maxReach) : undefined,
      blockers: blockers.map(b => b.cp.p.id), overBlock,
    };
    this.act(a, sb.tHit, soft ? 'tip' : 'spike', sb.hit, hitZ, info);
    this.touches++;

    // ミス
    if (this.rng.chance(errRate)) {
      if (!soft && this.rng.chance(0.45)) {
        const net = { x: 0, y: this.world(team, sb.hit).y, z: this.netH - this.rng.range(0.2, 0.8) };
        this.ballTo(net, sb.tHit + 0.12, 'spike');
        this.land(this.world(team, { u: 0.4, v: sb.hit.v }), sb.tHit + 0.7, 'drop');
        return this.point(opp, 'attackError', sb.tHit + 0.7, a.p.id);
      }
      const out: Local = this.rng.chance(0.6)
        ? { u: this.rng.range(9.3, 11), v: this.rng.range(-4, 4) }
        : { u: this.rng.range(4, 9), v: (this.rng.chance(0.5) ? 1 : -1) * this.rng.range(4.7, 6) };
      const outW = this.world(opp, out);
      const tL = sb.tHit + (soft ? TIMING.tipFlight : 0.5);
      this.land(outW, tL, soft ? 'tip' : 'spike', soft ? hitZ + 0.5 : undefined);
      return this.point(opp, 'attackError', tL, a.p.id);
    }

    // フェイント・軟打：ブロックの上を越えて手前に落とす
    if (soft) {
      const land = this.aim(opp, ATTACK.tipTargetU, TIMING.tipFlight, tech, blockers);
      return {
        kind: 'incoming',
        inc: {
          team: opp, kind: 'tip', land, tArrive: sb.tHit + TIMING.tipFlight, flight: TIMING.tipFlight,
          pressure: v.power * ATTACK.softPowerRatio, shake: 0, apex: Math.max(hitZ, (maxReach || netCm) / 100) + 0.35,
          ballKind: 'tip', dropReason: 'tipKill', dropKey: a.p.id, sender: a,
        },
      };
    }

    // ブロックに触るか
    if (blockers.length && !overBlock) {
      let wall = 0;
      for (const b of blockers) {
        wall += b.timing * (this.eff(b.cp, 'block') / 100) * clamp(1 + (b.reachCm - hitCm) / BLOCK.heightFactorDivCm, 0.1, 1.5);
      }
      const bv: Record<string, number> = {
        touch: (1 - Math.exp(-wall * BLOCK.touchK)) * Math.max(0.3, BLOCK.touchTechPivot - tech / BLOCK.touchTechDiv),
        blockPower: BLOCK.power.base + Math.max(...blockers.map(b =>
          this.eff(b.cp, 'block') * this.w.physical * BLOCK.power.block + (b.reachCm - hitCm) * BLOCK.power.height * this.w.physical))
          + (blockers.length - 1) * BLOCK.power.extra,
        attackPower: v.power,
        blockOut: BLOCK.blockOutBase * (tech / 50),
      };
      this.trait(bv, 'block', [...blockers.map(b => ({ c: b.cp, side: 'actor' as Side })), { c: a, side: 'opponent' }]);

      if (this.rng.chance(bv.touch)) {
        const main = blockers[0];
        const contact = this.world(opp, { u: 0.15, v: -sb.hit.v }, main.reachCm / 100 - 0.1);
        this.ballTo(contact, tBlock, 'spike');
        const pKill = sigmoid((bv.blockPower - bv.attackPower) / BLOCK.killScale + BLOCK.killBase);
        if (this.rng.chance(pKill)) return this.blockKill(sb, main, tBlock);
        if (this.rng.chance(bv.blockOut)) {
          const out: Local = this.rng.chance(0.5)
            ? { u: this.rng.range(9.5, 12), v: this.rng.range(-5, 5) }
            : { u: this.rng.range(2, 8), v: (this.rng.chance(0.5) ? 1 : -1) * this.rng.range(5, 7) };
          this.land(this.world(opp, out), tBlock + 0.9, 'deflect', contact.z + 1.5);
          return this.point(team, 'blockOut', tBlock + 0.9, a.p.id);
        }
        // ワンタッチ
        if (this.rng.chance(BLOCK.oneTouchBackChance)) {
          const land: Local = { u: this.rng.range(0.8, 3.5), v: this.rng.range(-3.5, 3.5) };
          return {
            kind: 'incoming',
            inc: {
              team, kind: 'blockBack', land, tArrive: tBlock + TIMING.oneTouchFlight, flight: TIMING.oneTouchFlight,
              pressure: v.power * BLOCK.oneTouchPressure * 0.6, shake: 0.2, apex: contact.z + 1.2,
              ballKind: 'deflect', dropReason: 'blockKill', dropKey: main.cp.p.id, sender: main.cp,
            },
          };
        }
        const land: Local = { u: this.rng.range(3, 8.5), v: this.rng.range(-4, 4) };
        return {
          kind: 'incoming',
          inc: {
            team: opp, kind: 'oneTouch', land, tArrive: tBlock + TIMING.oneTouchFlight, flight: TIMING.oneTouchFlight,
            pressure: v.power * BLOCK.oneTouchPressure, shake: 0.3, apex: contact.z + 1.5,
            ballKind: 'deflect', dropReason: 'kill', dropKey: a.p.id, sender: a,
          },
        };
      }
    }

    // ブロックを抜けた（または上から打ち抜いた）強打
    const speed = TIMING.spikeSpeedBase + this.phys(a, 'power') * TIMING.spikeSpeedPerPower;
    const range: [number, number] = [Math.max(ATTACK.hardTargetU[0], minLand), ATTACK.hardTargetU[1]];
    const roughFlight = (sb.hit.u + (range[0] + range[1]) / 2) / speed;
    const land = this.aim(opp, range, roughFlight, tech, blockers);
    const dx = sb.hit.u + land.u;
    const dy = (-land.v) - sb.hit.v;
    const flight = Math.hypot(dx, dy, hitZ) / speed;
    return {
      kind: 'incoming',
      inc: {
        team: opp, kind: 'spike', land, tArrive: sb.tHit + flight, flight, pressure: v.power, shake: 0,
        ballKind: 'spike', dropReason: 'kill', dropKey: a.p.id, sender: a,
      },
    };
  }

  /** ブロックに跳ぶ選手と、その間に合い具合 */
  private blockers(sb: SetBall): Blocker[] {
    const def = other(sb.team);
    const laneDef = -sb.hit.v;
    const tAvail = TIMING.setFlight[sb.setType] + (sb.secondary ? TIMING.secondarySetExtra : 0) + BLOCK.readExtra;
    const front = [...this.frontSlots(def).keys()].filter(c => c.role !== 'L');
    front.sort((x, y) => Math.abs(this.pos.get(x.p.id)!.v - laneDef) - Math.abs(this.pos.get(y.p.id)!.v - laneDef));
    const res: Blocker[] = [];
    const tQuick = sb.tSet + TIMING.setFlight.quick;
    const usedSides = new Set<number>();
    front.forEach(c => {
      if (res.length >= BLOCK.maxBlockers) return;
      const p = this.pos.get(c.p.id)!;
      // 1人目はレーンの正面、2人目以降は自分のいる側の隣（埋まっていれば反対側）
      let spotV = laneDef;
      if (res.length > 0) {
        let side = Math.sign(p.v - laneDef) || 1;
        if (usedSides.has(side)) side = -side;
        usedSides.add(side);
        spotV = laneDef + side * BLOCK.spotSpacing;
      }
      const spot: Local = { u: 0.3, v: clamp(spotV, -4.4, 4.4) };
      // 時間差のフェイクに跳ばされる
      if (sb.setType === 'timeDiff' && c.role === 'MB' && this.rng.chance(BLOCK.timeDiffBite)) {
        this.moveTo(c, { u: 0.3, v: clamp(-LANE_V.quick, -4, 4) }, sb.tSet, { dur: 0.2 });
        this.jump(c, tQuick - TIMING.blockRise, TIMING.blockTotal, (this.blockCm(c) - standingReachCm(c.p.height)) / 100);
        this.act(c, tQuick, 'block', this.pos.get(c.p.id)!, this.blockCm(c) / 100);
        return;
      }
      const sp = this.eff(c, 'speed');
      // 反応→横移動→踏み切り（跳び上がるまでの時間）が、トスが上がってから打つまでに収まるか
      const tNeed = reactionTime(sp) + Math.abs(spot.v - p.v) / sideSpeed(sp) + TIMING.blockRise;
      const late = tNeed - tAvail;
      if (late > BLOCK.lateLimit) return;
      const timing = late <= 0 ? 1 : 1 - (late / BLOCK.lateLimit) * BLOCK.latePenalty;
      this.moveTo(c, spot, sb.tSet + reactionTime(sp), { arriveBy: sb.tSet + Math.max(tNeed - TIMING.blockRise, 0.15) });
      res.push({ cp: c, spot, timing, reachCm: this.blockCm(c) - (1 - timing) * 20 });
    });
    // ブロックに跳ばない前衛は下がってフェイントや強打に備える
    for (const c of front) {
      if (res.some(b => b.cp === c) || (this.busyUntil.get(c.p.id) ?? 0) > sb.tSet) continue;
      const p = this.pos.get(c.p.id)!;
      this.moveTo(c, { u: DEFENSE_POS.offBlockerU, v: clamp(p.v * 0.9, -3.8, 3.8) }, sb.tSet);
    }
    return res;
  }

  /** 狙う場所：テクニックが高いほど候補を多く比べて、守備のいない所を選ぶ */
  private aim(def: TeamId, uRange: [number, number], flight: number, tech: number, blockers: Blocker[]): Local {
    const k = 1 + Math.floor(Math.max(0, tech) / ATTACK.aimTechDiv);
    const jumped = new Set(blockers.map(b => b.cp.p.id));
    const diggers = this.court[def].filter(c => !jumped.has(c.p.id));
    let best: { l: Local; s: number } | undefined;
    for (let i = 0; i < k; i++) {
      const l: Local = { u: this.rng.range(uRange[0], uRange[1]), v: this.rng.range(ATTACK.targetV[0], ATTACK.targetV[1]) };
      const s = Math.min(...diggers.map(c => dist(this.pos.get(c.p.id)!, l) - this.reachDist(c, flight)));
      if (!best || s > best.s) best = { l, s };
    }
    // 狙いどおりには飛ばない
    const err = Math.max(0.2, ATTACK.aimErrBase - tech * ATTACK.aimErrTech);
    return {
      u: clamp(best!.l.u + this.rng.normal() * err, uRange[0], COURT.halfLength - 0.05),
      v: clamp(best!.l.v + this.rng.normal() * err, -COURT.halfWidth + 0.05, COURT.halfWidth - 0.05),
    };
  }

  private blockKill(sb: SetBall, main: Blocker, tBlock: number): Step {
    const team = sb.team;
    const land: Local = { u: this.rng.range(0.3, 2.2), v: clamp(sb.hit.v + this.rng.range(-1.5, 1.5), -4.3, 4.3) };
    const tLand = tBlock + TIMING.blockReboundFlight;
    // 攻撃側のフォロー
    const cands = this.court[team].filter(c => (this.busyUntil.get(c.p.id) ?? 0) <= tLand - 0.05);
    const cover = cands
      .map(c => ({ c, m: this.reachDist(c, TIMING.blockReboundFlight + 0.1) - dist(this.pos.get(c.p.id)!, land) }))
      .sort((x, y) => y.m - x.m)[0];
    const cv: Record<string, number> = { chance: BLOCK.coverChance };
    if (cover) this.trait(cv, 'cover', [{ c: cover.c, side: 'actor' }, { c: main.cp, side: 'opponent' }]);
    if (cover && cover.m >= 0 && this.rng.chance(cv.chance)) {
      const c = cover.c;
      this.moveTo(c, land, tBlock, { arriveBy: tLand });
      this.ballTo(this.world(team, land, 0.4), tLand, 'blockRebound');
      this.act(c, tLand, 'cover', land, 0.4);
      this.touches++;
      this.load[c.p.id] += LOAD.dig;
      const offset = this.rng.range(1.8, 3.8);
      const ang = this.rng.range(-1.2, 1.2);
      const at: Local = { u: clamp(SET_TARGET.u + 1 + Math.abs(Math.cos(ang)) * offset, 0.5, 8), v: clamp(SET_TARGET.v + Math.sin(ang) * offset, -4.3, 4.3) };
      const tUp = tLand + TIMING.passFlight + offset * TIMING.passFlightPerOffset;
      this.ballTo(this.world(team, at, 2.3), tUp, 'pass', 3.8);
      this.attackBase(team, tLand + 0.1, new Set([c.p.id]));
      this.defenseBase(other(team), tLand);
      return { kind: 'ballUp', bu: { team, t: tUp, at, offset, spin: 0.5, firstToucher: c.p.id } };
    }
    this.land(this.world(team, land), tLand, 'blockRebound');
    return this.point(other(team), 'blockKill', tLand, main.cp.p.id);
  }
}

/** 始点・終点の高さと最高点から、BallSegment の bulge を求める */
export function bulgeForApex(z0: number, z1: number, apex: number): number {
  const d = z1 - z0;
  const h = Math.max(apex, z0, z1);
  const k = h - z0 - d / 2;
  const disc = k * k - (d * d) / 4;
  return (k + Math.sqrt(Math.max(0, disc))) / 2;
}
