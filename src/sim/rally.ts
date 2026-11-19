// 1ラリーのシミュレーション。描画は一切知らず、座標つきの記録（RallyRecord）を返すだけ。
//
// 内部では各チームの「自コート基準」の座標で考える。
//   u = ネットからの距離（0〜9。9がエンドライン）
//   v = 自分のコートでネットを向いた時の左が＋（-4.5〜4.5）
// 記録に書く時に world() で共通の座標（types.ts の説明）に直す。

import { trustDelta } from './player';
import {
  aptitudeFactor, blockReachCm, effective, hitHeightCm, jumpHeightCm, runSpeed,
  sideSpeed, standingReachCm, type AbilityKey,
} from './ability';
import {
  APPROACH, ATTACK, BLOCK, BLOCK_BASE_V, BODY, COURT, COVER, DEFENSE_POS, DIRECT, RECORD, GENDER_WEIGHTS, HIT_U, LANE_V, LOAD,
  MAX_CONTACTS, PASS, RECEIVE_FORMATION, SERVE, SERVE_RUN, SET, SET_TARGET, SERVE_CHOICE, STYLE, TACTIC_FIT, TIMING, TRAIT_EXTRA, BACK_ATTACK,
} from './constants';
import { Rng } from './rng';
import { canDo, hasTrait, styleOf, traitDelta, traitExtra, type Scene } from './traits';
import type {
  ActionInfo, ActionType, BallKind, BallSegment, Player, PlayerPlacement, PointReason, RallyEvent,
  RallyInput, RallyRecord, Role, ServeType, SetType, TeamId, Vec2, Vec3,
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
  /** 打球を読みにくい分の遅れ（秒）。速い攻撃ほど、守る側は打つ前に構え直す時間がない */
  readDelay?: number;
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
  /** 1本目に触った時刻 */
  tPass: number;
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
  /** 相手の返球を直接打つ */
  direct?: boolean;
  /** 踏み切りの時刻 */
  tTake: number;
  /** 実際に跳ぶ高さ（m）。助走が短いと下がる */
  jumpM: number;
  /** 助走で直しきれなかったトスのずれ（m） */
  miss: number;
  /** 実際にボールに触る高さ（cm）。ジャンプの頂点からずれると低くなる */
  contactCm: number;
  /** 空中のどの段階で触ったか（0〜1、頂点は0.5） */
  airPhase: number;
  /** トスを上げた選手（配球バレ：相手ブロッカーの読みに効く） */
  tosser?: CourtPlayer;
  /** 打つコース（サイドから打つ時だけ） */
  course?: 'straight' | 'cross';
}

/** 助走の計画（乱数を使わない見積もり） */
interface ApproachPlan {
  /** 助走を始める時刻と位置 */
  tA: number;
  from: Local;
  /** 助走の長さ（m）と、十分な長さに対する割合 */
  d: number;
  q: number;
  /** 踏み切りに遅れる時間（秒） */
  late: number;
  /** 予定の踏み切りの時刻 */
  tTakeNom: number;
}

interface Blocker {
  cp: CourtPlayer;
  /** ブロック能力を引く時の場面 */
  sc: Scene[];
  spot: Local;
  timing: number;
  reachCm: number;
  /** コース読み：相手アタッカーの好みのコース（読んで寄っている） */
  readCourse?: 'straight' | 'cross';
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
/** 記録の数値は小数3桁に丸める（-0 は 0 にそろえる） */
const round = (v: number) => Math.round(v * 1000) / 1000 || 0;

export function simulateRally(input: RallyInput): RallyRecord {
  return new RallySim(input).run();
}

class RallySim {
  private rng: Rng;
  private w: { physical: number; skill: number; tactic: number };
  private netH: number;
  private court: Record<TeamId, CourtPlayer[]> = { A: [], B: [] };
  private pos = new Map<string, Local>();
  /** 判定に使う「移動の途中の位置」を求めるための、最後の移動（判定上の位置で） */
  private track = new Map<string, { from: Local; to: Local; t0: number; dur: number }>();
  private busyUntil = new Map<string, number>();
  private events: RallyEvent[] = [];
  private ball: BallSegment[] = [];
  private ballPos: Vec3 = { x: 0, y: 0, z: 0 };
  private ballT = 0;
  private load: Record<string, number> = {};
  private touches = 0;
  private placements: PlayerPlacement[] = [];
  private result?: { winner: TeamId; reason: PointReason; key?: string; t: number };
  /** セット終盤か（特能の場面 clutch） */
  private clutch: boolean;
  /** このラリーで各選手が打った回数（連続トスの場面用） */
  private attackCount = new Map<string, number>();
  /** このラリーのサーブの種類（準備の時にサーバーが選ぶ） */
  private serveType: ServeType = 'float';

  constructor(private input: RallyInput) {
    this.rng = new Rng(input.seed);
    this.w = GENDER_WEIGHTS[input.gender];
    this.netH = COURT.netHeight[input.gender];
    const ctx = input.context;
    this.clutch = !!ctx && Math.max(ctx.score.A, ctx.score.B) >= (ctx.isFinalSet ? 10 : 20);
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
    // ラリーが終わった後に始まる予定だった移動は記録しない
    this.events = this.events.filter(e => !(e.type === 'move' && e.t > r.t));
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

    // サーバーが打つサーブの種類を選ぶ
    const s = this.input.serving;
    this.serveType = this.chooseServe(this.court[s].find(c => c.zoneIdx === 0)!, other(s));

    // 最初の並び：サーブ側は基本の位置、レシーブ側はサーブレシーブの隊形
    for (const c of this.court[s]) {
      const z = ZONE_POS[c.zoneIdx];
      this.pos.set(c.p.id, c.zoneIdx === 0 ? serveStartSpot(this.serveType) : { u: c.front ? 1.2 : z.u, v: z.v });
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
      // 後衛のセッターは自分のローテーション位置の近くに立ち、サーブと同時に前へ上がってくる
      if (c.role === 'S') this.pos.set(c.p.id, c.front ? { u: 1.0, v: -1.5 } : { u: RECEIVE_FORMATION.backSetterU, v: z.v * 0.8 });
      else this.pos.set(c.p.id, c.front ? { u: 1.5, v: z.v } : { u: 7.5, v: z.v });
    }
  }

  // ============================================================
  // 能力の値
  // ============================================================

  /** 調子と疲れを反映した能力（特能なし）。打点・到達点と移動の速さはこれを使う */
  private eff(c: CourtPlayer, k: AbilityKey): number {
    return effective(c.p, k, c.fatigue);
  }
  /** その場面での能力（特能の上下を含む） */
  private ab(c: CourtPlayer, k: AbilityKey, scenes: Scene[] = [], facing?: Player): number {
    const set = new Set<Scene>(['all', ...scenes]);
    if (this.clutch) set.add('clutch');
    if (c.p.condition < 0) set.add('slump');
    if (c.p.condition > 0) set.add('goodForm');
    const row = { front: c.front, teammates: this.court[c.team].map(m => ({ p: m.p, front: m.front })) };
    // チームにかかっている一時的な上下（タイムアウトの監督特能など）
    let buff = 0;
    for (const e of this.input.teams[c.team].buffs ?? []) if (e.ability === k && set.has(e.scene)) buff += e.delta;
    // 信頼度による上乗せ（試合中だけ、全能力）
    return Math.max(0, this.eff(c, k) + traitDelta(c.p, k, set, row, facing) + buff + trustDelta(c.p));
  }
  /** 体の能力（跳躍・パワー・スピード）が判定に効く量。男女の重みを掛ける */
  private phys(c: CourtPlayer, k: 'jump' | 'power' | 'speed', scenes: Scene[] = []): number {
    return this.ab(c, k, scenes) * this.w.physical;
  }
  /** テクニックが判定に効く量。男女の重みを掛ける */
  private skill(c: CourtPlayer, scenes: Scene[] = []): number {
    return this.ab(c, 'technique', scenes) * this.w.skill;
  }
  /** ブロック能力（読みとタイミング）。男女の重みは掛けない */
  private blockSkill(c: CourtPlayer, scenes: Scene[] = []): number {
    return this.ab(c, 'block', ['block', ...scenes]);
  }
  private hitCm(c: CourtPlayer): number {
    return hitHeightCm(c.p.height, this.eff(c, 'jump'));
  }
  private blockCm(c: CourtPlayer): number {
    return blockReachCm(c.p.height, this.eff(c, 'jump'));
  }
  private attackRating(c: CourtPlayer): number {
    return this.phys(c, 'power') * ATTACK.power + this.skill(c) * ATTACK.tech
      + (this.hitCm(c) - this.netH * 100) * ATTACK.height * this.w.physical;
  }
  /**
   * ボールが来るまでに届く距離。動き出し（打球を読む判断）はテクニック、走る速さはスピードで決まる。
   */
  private reachDist(c: CourtPlayer, time: number): number {
    const sp = this.eff(c, 'speed');
    return Math.max(0, time - readTime(this.skill(c, ['dig']))) * runSpeed(sp) + BODY.lunge;
  }
  /** ボールを受ける選手が動き出す時刻：動ける状態になってから、打球を読む時間（テクニック）の後 */
  private moveStart(c: CourtPlayer, inc: Incoming): number {
    const free = inc.tArrive - this.timeToReact(c, inc.tArrive, inc.flight);
    return free + readTime(this.skill(c, ['dig']));
  }

  /** ボールが来るまでに使える時間（跳んだ後の着地と立て直しを差し引く） */
  private timeToReact(c: CourtPlayer, tArrive: number, flight: number): number {
    const free = (this.busyUntil.get(c.p.id) ?? -Infinity) + BODY.landingRecovery;
    return tArrive - Math.max(tArrive - flight, free);
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

  /**
   * 移動を記録する。
   *   asap：t に全力で動き出す（ボールに関わる選手）。arriveBy までに着かない時は arriveBy まで走り続ける
   *   asap なし＋arriveBy：間に合う範囲でなるべく遅く動き出し、arriveBy に着く（助走・おとりなど時刻の決まった動き）
   *   stand：記録する体の立ち位置（ボールに触る点から腕の長さ分ずらした位置）。
   *          計算で使う位置（届くかどうかなどの判定）は to のまま
   */
  private moveTo(c: CourtPlayer, to: Local, t: number,
    opts: { arriveBy?: number; dur?: number; asap?: boolean; stand?: Local } = {}) {
    const from = this.pos.get(c.p.id)!;
    const d = dist(from, to);
    if (d < 0.05 && !opts.stand) return;
    const natural = d / runSpeed(this.eff(c, 'speed'));
    let dur = opts.dur ?? Math.max(0.15, natural);
    let start = t;
    if (opts.asap) {
      if (opts.arriveBy !== undefined) {
        start = Math.min(start, opts.arriveBy - 0.12);
        if (start + dur > opts.arriveBy) dur = opts.arriveBy - start;
      }
    } else if (opts.arriveBy !== undefined) {
      start = Math.min(Math.max(t, opts.arriveBy - natural), opts.arriveBy - 0.12);
      dur = opts.arriveBy - start;
    }
    const shown = opts.stand ?? to;
    // 新しく決まった移動は、それより後に始まる予定だった移動を取り消す（記録の上での予定の上書き）
    this.events = this.events.filter(e => !(e.type === 'move' && e.playerId === c.p.id && e.t > start + 1e-9));
    this.events.push({ type: 'move', t: round(start), playerId: c.p.id, to: this.w2(c.team, shown), dur: round(Math.max(0.12, dur)) });
    this.track.set(c.p.id, { from: { ...from }, to: { ...to }, t0: start, dur: Math.max(0.12, dur) });
    this.pos.set(c.p.id, { ...to });
    this.load[c.p.id] += d * LOAD.perMeter;
  }

  /** その時刻に、移動の途中のどこにいるか（判定上の位置）。移動が終わっていれば移動先 */
  private posAt(c: CourtPlayer, t: number): Local {
    const m = this.track.get(c.p.id);
    if (!m || t >= m.t0 + m.dur) return this.pos.get(c.p.id)!;
    if (t <= m.t0) return m.from;
    const k = (t - m.t0) / m.dur;
    return { u: m.from.u + (m.to.u - m.from.u) * k, v: m.from.v + (m.to.v - m.from.v) * k };
  }

  /** 世界座標 → チームの自コート基準 */
  private local(team: TeamId, p: Vec3): Local {
    return team === 'A' ? { u: -p.x, v: p.y } : { u: p.x, v: -p.y };
  }

  /**
   * ボールに触る時の体の立ち位置。触る点から、ボールが進んでくる向きの先へ腕の長さ分ずらす。
   * コートの外やネットの向こうにはしない。
   */
  private standFor(team: TeamId, contact: Local, comingFrom: Vec3, offset: number): Local {
    const f = this.local(team, comingFrom);
    let du = contact.u - f.u;
    let dv = contact.v - f.v;
    const n = Math.hypot(du, dv);
    if (n < 1e-6) { du = 1; dv = 0; } else { du /= n; dv /= n; }
    return {
      u: clamp(contact.u + du * offset, RECORD.minU, COURT.halfLength),
      v: clamp(contact.v + dv * offset, -COURT.halfWidth, COURT.halfWidth),
    };
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

  /** 跳んでいる選手は、着地して立て直してから動き出す */
  private freeAt(c: CourtPlayer, t: number): number {
    return Math.max(t, (this.busyUntil.get(c.p.id) ?? -Infinity) + BODY.landingRecovery);
  }

  /** 相手の攻撃に備える守備の基本隊形。react なら各自が読む時間の後に動き出す */
  private defenseBase(team: TeamId, t: number, react = false) {
    const start = (c: CourtPlayer) => this.freeAt(c, t) + (react ? readTime(this.skill(c, ['dig'])) : 0);
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
    for (const [c, s] of fs) this.moveTo(c, { u: 0.8, v: clamp(base[s] + shift, -4, 4) }, start(c));
    const dp = DEFENSE_POS[ts.tactics.receive];
    for (const [c, s] of this.backSlots(team)) this.moveTo(c, dp[s], start(c));
  }

  /** こちらの攻撃に向けて助走の位置へ */
  /**
   * こちらの攻撃に向けて助走の位置へ。start は選手ごとの動き出しの時刻
   * （ボールに触らない選手は、相手が打った時点で読む時間の後に、跳んでいた選手は着地して立て直したら動き出す）
   */
  private attackBase(team: TeamId, start: (c: CourtPlayer) => number, exclude: Set<string>) {
    const fs = this.frontSlots(team);
    for (const [c, s] of fs) {
      if (exclude.has(c.p.id) || c.role === 'S') continue;
      this.moveTo(c, this.approachSpot(c, this.laneOf(c, s)), start(c), { asap: true });
    }
    const backAtk = new Set(this.backAttackers(team));
    for (const [c, s] of this.backSlots(team)) {
      if (exclude.has(c.p.id) || c.role === 'S') continue;
      // バックアタックを打てる選手は、後ろの助走の位置へ
      const to = backAtk.has(c) ? { u: BACK_ATTACK.startU, v: this.backLane(c) } : { u: 4.5, v: SLOT_V[s] * 0.8 };
      this.moveTo(c, to, start(c), { asap: true });
    }
  }

  /** バックアタックを打てる選手：後衛のアウトサイド・オポジットで、特能（解禁）を持つ */
  private backAttackers(team: TeamId): CourtPlayer[] {
    return this.court[team].filter(c => !c.front && (c.role === 'OH' || c.role === 'OP') && canDo(c.p, 'backAttack'));
  }

  private backLane(c: CourtPlayer): number {
    return c.role === 'OP' ? BACK_ATTACK.laneOP : BACK_ATTACK.laneOH;
  }

  // ============================================================
  // サーブ
  // ============================================================

  private serve(): Step {
    const st = this.input.serving;
    const rt = other(st);
    const server = this.court[st].find(c => c.zoneIdx === 0)!;
    const type = this.serveType;
    const sc = this.serveScenes(server, type);
    const tech = this.skill(server, sc);
    const pc = SERVE.pressure[type];
    const R_ = SERVE_RUN;

    // 構える → サーブトスを上げる → 助走 → 踏み切り → 打つ
    const tToss = R_.tossAt;
    const tc = tToss + R_.tossFlight[type];
    const start = this.pos.get(server.p.id)!;
    const jump = type !== 'float';

    // サーブトスのずれ（テクニック）を、助走の途中で直す（スピード）。直しきれなかった分が残る
    const techK = Math.max(0.2, R_.techPivot - tech / 100);
    const tossErr = Math.abs(this.rng.normal()) * R_.tossErr[type] * techK;
    const tossDir = this.rng.range(0, Math.PI * 2);
    const adjust = R_.adjustTime[type] * (APPROACH.adjustBase + this.eff(server, 'speed') * APPROACH.adjustPer);
    const miss = Math.max(tossErr * R_.minResidual, tossErr - adjust);
    // 踏み切りのタイミングのずれ（テクニック。トスがずれるほど合わせにくい）
    const timing = jump ? this.rng.normal() * R_.timingSigma[type] * techK * (1 + tossErr) : 0;
    const bad = miss + Math.abs(timing) * R_.timingToMiss;

    // 打つ位置と高さ。ジャンプ系はジャンプの頂点からずれると低い所で打つ
    const plan: Local = jump
      ? { u: R_.takeoffU - R_.drift[type], v: start.v }
      : { u: start.u - 0.3, v: start.v };
    const contactL: Local = { u: plan.u + Math.cos(tossDir) * tossErr, v: plan.v + Math.sin(tossDir) * tossErr };
    const standing = standingReachCm(server.p.height) / 100;
    const jumpM = jumpHeightCm(this.eff(server, 'jump')) / 100 * R_.jumpRatio[type];
    const tTake = tc - TIMING.jumpRise + timing;
    const phase = (tc - tTake) / TIMING.jumpTotal;
    const z = jump ? standing + jumpM * (phase > 0 && phase < 1 ? 4 * phase * (1 - phase) : 0) : standing + 0.1;
    // 空中で合わせられないほどタイミングが外れたら、打ち損じ（ミス）
    const misHit = jump && (phase < APPROACH.minAirPhase || phase > 1 - APPROACH.minAirPhase);

    // 緑：強気サーブ／安全サーブ
    const risk = styleOf(server.p, 'serveRisk');
    const rs = risk ? STYLE.serveRisk[risk] : { fault: 1, pressure: 0 };
    const len = styleOf(server.p, 'serveLength');
    const faultRate = clamp(SERVE.faultRate[type] * (1 - (tech - 50) * SERVE.faultTechSlope) * rs.fault * (len ? STYLE.serveLengthFault[len] : 1)
      + bad * R_.faultPerMiss, 0.01, 0.7);
    const pressure = pc.base + tech * pc.tech + this.phys(server, 'power', sc) * pc.power + this.phys(server, 'jump', sc) * pc.jump
      - bad * R_.pressurePerMiss + rs.pressure + (len ? STYLE.serveLengthPressure[len] : 0);
    const shake = SERVE.shake[type];

    // 記録：ボールを持って構える → トス → 助走 → 踏み切り → 打つ
    const hand = this.world(st, { u: start.u - 0.25, v: start.v }, 1.0);
    this.ballPos = hand;
    this.ballT = 0;
    this.ballTo(hand, tToss, 'serve');
    this.act(server, tToss, 'toss', { u: start.u - 0.25, v: start.v }, 1.3, { serveType: type });
    this.ballTo(this.world(st, contactL, z), tc, 'serve', z + R_.tossApexAbove[type]);
    if (jump) {
      // 踏み切る位置：打つ点の後ろ。直しきれなかった分だけ、ボールの真下からずれる
      const k = tossErr > 1e-6 ? (tossErr - miss) / tossErr : 1;
      const take: Local = {
        u: Math.max(R_.takeoffU, plan.u + R_.drift[type] + Math.cos(tossDir) * tossErr * k),
        v: plan.v + Math.sin(tossDir) * tossErr * k,
      };
      const tA = tTake - R_.approachDur[type];
      this.moveTo(server, take, tA, { asap: true, dur: Math.max(0.15, tTake - tA) });
      this.jump(server, tTake, TIMING.jumpTotal, jumpM);
    }
    this.act(server, tc, 'serve', contactL, z, { serveType: type });
    this.touches++;

    // サーブを打った後はサーブ側が守備の隊形へ（ジャンプ系は着地してから）
    this.defenseBase(st, tc + 0.2);

    const flight = TIMING.serveFlight[type];
    const target = this.serveAim(server, rt, flight, sc, bad * R_.aimPerMiss);
    const apex = type === 'spike' ? Math.max(z, this.netH + 0.6) : Math.max(z, this.netH + 0.8) + 0.4;

    if (misHit || this.rng.chance(faultRate)) {
      if (misHit || this.rng.chance(0.5)) {
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
        team: rt, kind: 'serve', land: target, tArrive: tc + flight, flight, pressure, shake,
        apex, ballKind: 'serve', dropReason: 'ace', dropKey: server.p.id, sender: server,
      },
    };
  }

  private serveScenes(server: CourtPlayer, type: ServeType): Scene[] {
    const sc: Scene[] = ['serve', type === 'float' ? 'serveFloat' : type === 'jumpFloat' ? 'serveJumpFloat' : 'serveSpike'];
    const ctx = this.input.context;
    if (ctx?.serveStreak) sc.push('serveStreak');
    if (ctx?.subbedIn?.includes(server.p.id)) sc.push('pinchServe');
    return sc;
  }

  /**
   * サーブの種類を選ぶ。持っているサーブ（フローターは全員）ごとに「崩せそうな度合い－ミスしそうな度合い」を見積もり、
   * 一番良いものを打つ。見積もりには自分の能力、相手レシーバーの得手不得手（揺れる球・強い球）、男女の重みが入る。
   * 判断の正確さはテクニック（場面 serveChoice）。低いほど見積もりがぶれる。
   * 結果の乱数の並びを変えないよう、選ぶための乱数は別に持つ。
   */
  private chooseServe(server: CourtPlayer, rt: TeamId): ServeType {
    const types: ServeType[] = ['float'];
    if (canDo(server.p, 'jumpFloat')) types.push('jumpFloat');
    if (canDo(server.p, 'spikeServe')) types.push('spike');
    if (types.length === 1) return 'float';
    const rng = new Rng(this.input.seed * 7919 + 13);
    const judge = this.skill(server, ['serve', 'serveChoice']);
    const risk = styleOf(server.p, 'serveRisk');
    const fw = risk ? SERVE_CHOICE.faultWeight[risk] : 1;
    const recv = this.receivers(rt);
    let best: { t: ServeType; v: number } | undefined;
    for (const t of types) {
      const e = this.serveEstimate(server, t, recv);
      const v = (1 - e.fault * fw) * (1 - (SERVE_CHOICE.sideoutBad + (SERVE_CHOICE.sideoutGood - SERVE_CHOICE.sideoutBad) * e.pass))
        + rng.normal() * SERVE_CHOICE.noise * Math.max(0.2, SERVE_CHOICE.pivot - judge / 100);
      if (!best || v > best.v) best = { t, v };
    }
    return best!.t;
  }

  /** サーブの見積もり（乱数を使わない）：ミスの率と、レシーバーのパスの良さの期待値 */
  private serveEstimate(server: CourtPlayer, type: ServeType, recv: CourtPlayer[]): { fault: number; pass: number } {
    const R_ = SERVE_RUN;
    const sc = this.serveScenes(server, type);
    const tech = this.skill(server, sc);
    const techK = Math.max(0.2, R_.techPivot - tech / 100);
    const tossErr = 0.8 * R_.tossErr[type] * techK; // 正規乱数の絶対値の平均 ≒ 0.8
    const adjust = R_.adjustTime[type] * (APPROACH.adjustBase + this.eff(server, 'speed') * APPROACH.adjustPer);
    const bad = Math.max(tossErr * R_.minResidual, tossErr - adjust);
    const risk = styleOf(server.p, 'serveRisk');
    const rs = risk ? STYLE.serveRisk[risk] : { fault: 1, pressure: 0 };
    const len = styleOf(server.p, 'serveLength');
    const fault = clamp(SERVE.faultRate[type] * (1 - (tech - 50) * SERVE.faultTechSlope) * rs.fault * (len ? STYLE.serveLengthFault[len] : 1)
      + bad * R_.faultPerMiss, 0.01, 0.7);
    const pc = SERVE.pressure[type];
    const pressure = pc.base + tech * pc.tech + this.phys(server, 'power', sc) * pc.power + this.phys(server, 'jump', sc) * pc.jump
      - bad * R_.pressurePerMiss + rs.pressure + (len ? STYLE.serveLengthPressure[len] : 0);
    const shake = SERVE.shake[type];
    let pass = 0;
    for (const c of recv) {
      const rsc: Scene[] = ['serveReceive'];
      if (shake > 0) rsc.push('receiveFloat');
      if (pressure >= PASS.hardPressure) rsc.push('receiveHard');
      const sk = PASS.skill.base + this.skill(c, rsc) * PASS.skill.tech * (c.role === 'L' ? aptitudeFactor(c.p, 'L') : 1)
        + this.phys(c, 'speed', rsc) * PASS.skill.speed;
      // 揺れ（ばらつき）の分だけ、パスの良さの期待値は真ん中に寄る
      const sdv = PASS.noise + shake;
      pass += sigmoid(((sk - pressure) / PASS.scale + PASS.base.serve) / Math.sqrt(1 + (Math.PI * sdv * sdv) / 8));
    }
    return { fault, pass: recv.length ? pass / recv.length : 0.5 };
  }

  /**
   * サーブの狙い。判断（どこを狙うか）も実行（狙いどおり打てるか）もテクニックで決まる。
   * 判断の場面 serveAim では、狙いを決める時だけ能力が上がる特能（弱点狙撃など）が効く。
   */
  private serveAim(server: CourtPlayer, rt: TeamId, flight: number, sc: Scene[], extraErr = 0): Local {
    const judge = this.skill(server, [...sc, 'serveAim']);
    const exec = this.skill(server, sc);
    const recv = this.receivers(rt);
    // 緑：ショート多め／ロング多め（狙う深さ）、人狙い／つなぎ目狙い（狙い方）
    const len = styleOf(server.p, 'serveLength');
    const uR: [number, number] = len ? STYLE.serveLength[len] : SERVE.targetU;
    const tgt = styleOf(server.p, 'serveTarget');
    const k = 1 + Math.floor(Math.max(0, judge) / SERVE.aimTechDiv) + (tgt === 'seam' ? STYLE.seamExtraCandidates : 0);
    // 人狙い：一番レシーブの弱そうな選手（場面 serveReceive のテクニック）の正面
    const weakest = tgt === 'person' ? recv.reduce((a, b) => (this.skill(b, ['serveReceive']) < this.skill(a, ['serveReceive']) ? b : a)) : undefined;
    let best: { l: Local; s: number } | undefined;
    for (let i = 0; i < k; i++) {
      const l: Local = { u: this.rng.range(uR[0], uR[1]), v: this.rng.range(SERVE.targetV[0], SERVE.targetV[1]) };
      // レシーバーが動いて取りにくい所ほど良い。人狙いは狙った選手に近いほど良い
      const s = weakest
        ? -dist(this.pos.get(weakest.p.id)!, l)
        : Math.min(...recv.map(c => dist(this.pos.get(c.p.id)!, l) - this.reachDist(c, flight) * 0.3));
      if (!best || s > best.s) best = { l, s };
    }
    // 狙いのずれ：テクニック。トスと助走で直しきれなかったずれの分だけ大きくなる
    const err = Math.max(0.25, SERVE.aimErrBase - exec * SERVE.aimErrTech) + extraErr;
    return {
      u: clamp(best!.l.u + this.rng.normal() * err, SERVE.targetU[0], SERVE.targetU[1]),
      v: clamp(best!.l.v + this.rng.normal() * err, SERVE.targetV[0], SERVE.targetV[1]),
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
      // ボールが飛んできた時に、記録の上でいる位置（守備の位置へ動いている途中ならその途中）から追う
      const from = this.posAt(c, inc.tArrive - inc.flight);
      const d = dist(from, inc.land);
      // 緑：積極守備は届く範囲が広く、消極守備は狭い
      const ds = styleOf(c.p, 'defense');
      const reach = this.reachDist(c, Math.max(0, this.timeToReact(c, inc.tArrive, inc.flight) - (inc.readDelay ?? 0)))
        + (ds ? STYLE.defense[ds].reach : 0);
      // セッターは2本目のために、なるべく1本目を触らない
      const margin = reach - d - (c.role === 'S' && inc.kind !== 'serve' ? 0.8 : 0);
      if (!best || margin > best.margin) best = { c, margin, d, reach };
    }

    // 相手の返球がネット際に来たら、前衛が直接打つ（ダイレクト）
    if (inc.kind === 'overpass' && inc.land.u <= DIRECT.maxU) {
      const d = this.tryDirect(inc);
      if (d) return d;
    }

    const landW = this.world(team, inc.land);
    const forced = this.touches >= MAX_CONTACTS;
    if (!best || best.reach < best.d || forced) {
      // 誰も届かない：ボールが落ちる
      if (best) {
        const from = this.pos.get(best.c.p.id)!;
        const k = Math.min(1, best.reach / Math.max(best.d, 0.01));
        this.moveTo(best.c, { u: from.u + (inc.land.u - from.u) * k, v: from.v + (inc.land.v - from.v) * k },
          this.moveStart(best.c, inc), { arriveBy: inc.tArrive, asap: true });
      }
      this.land(landW, inc.tArrive, inc.ballKind, inc.apex);
      return this.point(opp, inc.dropReason, inc.tArrive, inc.dropKey);
    }

    const c = best.c;
    const dive = best.d > best.reach - BODY.lunge;
    const isServe = inc.kind === 'serve';
    const sc: Scene[] = isServe ? ['serveReceive'] : inc.kind === 'freeball' || inc.kind === 'overpass' ? ['freeball'] : ['dig'];
    if (isServe && inc.shake > 0) sc.push('receiveFloat');
    if ((isServe || inc.kind === 'spike') && inc.pressure >= PASS.hardPressure) sc.push('receiveHard');
    if (inc.kind === 'tip') sc.push('digTip');
    if (inc.kind === 'oneTouch') sc.push('blockFollow');
    if (dive) sc.push('dive');
    let sk = PASS.skill.base + this.skill(c, sc) * PASS.skill.tech * (c.role === 'L' ? aptitudeFactor(c.p, 'L') : 1)
      + this.phys(c, 'speed', sc) * PASS.skill.speed;
    if (inc.kind === 'spike' || inc.kind === 'tip') {
      const match = (inc.kind === 'spike') === (ts.tactics.receive === 'back');
      sk += (match ? TACTIC_FIT.receiveMatch : TACTIC_FIT.receiveMismatch) * this.w.tactic;
    }
    if (dive) sk -= 8;
    // 緑：積極守備は弾くミスが増え、消極守備は確実に上げる。オーバー派・アンダー派はサーブの種類で得手不得手
    const ds = styleOf(c.p, 'defense');
    if (ds) sk += STYLE.defense[ds].skillPerPressure * inc.pressure;
    const rcv = isServe ? styleOf(c.p, 'receiving') : undefined;
    if (rcv) sk += (inc.shake > 0 ? STYLE.receiving[rcv].float : 0) + (inc.pressure >= PASS.hardPressure ? STYLE.receiving[rcv].hard : 0);
    const baseKey = inc.kind === 'blockBack' ? 'oneTouch' : inc.kind;
    const noiseK = ds ? STYLE.defense[ds].noise : 1;
    const p = sigmoid((sk - inc.pressure) / PASS.scale + PASS.base[baseKey] + this.rng.normal() * (PASS.noise + inc.shake) * noiseK);
    const z = dive ? PASS.contactZ.dive : isServe ? PASS.contactZ.receive : PASS.contactZ.dig;

    // セッター：誰が1本目を触るか決まったら、パスを待たずにセットする位置へ走り出す（相手が打った時点で、読む時間の後）
    const setter = this.court[team].find(x => x.role === 'S');
    if (setter && setter !== c) this.moveTo(setter, SET_TARGET, this.moveStart(setter, inc), { asap: true });

    // 反応したらすぐ全力で動き出し、間に合えば先に着いて構える。触る点の手前（ボールが来る側の反対）に立つ
    const stand = this.standFor(team, inc.land, this.ballPos, dive ? RECORD.diveStandOffset : RECORD.standOffset);
    this.moveTo(c, inc.land, this.moveStart(c, inc), { arriveBy: inc.tArrive, asap: true, stand });
    this.ballTo(this.world(team, inc.land, z), inc.tArrive, inc.ballKind, inc.apex);
    this.touches++;
    if (!isServe) this.load[c.p.id] += LOAD.dig;

    if (p < PASS.failBelow) {
      this.act(c, inc.tArrive, isServe ? 'receive' : 'dig', inc.land, z, { offset: 99, spin: 1 });
      const away: Local = { u: clamp(inc.land.u + this.rng.range(1, 4), 0, 12), v: inc.land.v + this.rng.range(-5, 5) };
      this.land(this.world(team, away), inc.tArrive + 0.7, 'deflect', z + this.rng.range(0.3, 2));
      const reason: PointReason = inc.kind === 'freeball' || inc.kind === 'overpass' ? 'receiveError' : inc.dropReason;
      const key = reason === 'receiveError' ? c.p.id : inc.dropKey;
      return this.point(opp, reason, inc.tArrive + 0.7, key);
    }

    const offset = PASS.maxOffset * Math.pow(1 - p, PASS.offsetPow) * this.rng.range(0.6, 1.25);
    const spin = clamp((inc.pressure / 100) * (1 - p) * PASS.spinScale + this.rng.range(0, 0.08), 0, 1);
    this.act(c, inc.tArrive, isServe ? 'receive' : 'dig', inc.land, z, { offset: round(offset), spin: round(spin) });

    // ずれが大きいと相手コートへ返ってしまう
    if (offset >= PASS.overpassOffset && this.rng.chance(PASS.overpassChance)) {
      const land: Local = { u: this.rng.range(DIRECT.overpassU[0], DIRECT.overpassU[1]), v: this.rng.range(-4, 4) };
      const tA = inc.tArrive + TIMING.overpassFlight;
      this.defenseBase(team, inc.tArrive + 0.2);
      this.attackBase(opp, c2 => this.freeAt(c2, inc.tArrive + 0.2), new Set());
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

    // 相手は守備の隊形、こちらは攻撃の準備。触らない選手は相手が打った時点で動き出す
    this.defenseBase(opp, inc.tArrive, true);
    this.attackBase(team, x => this.moveStart(x, inc), new Set([c.p.id]));
    return { kind: 'ballUp', bu: { team, tPass: inc.tArrive, t: tUp, at, offset, spin, firstToucher: c.p.id } };
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
    // セッターは走っている途中でパスの落下点へ向きを変えて追う。間に合えばセッターが上げ、
    // 間に合わなければ（届く所まで追うだけで）、パスが上がった時点で落下点に一番近い選手が二段トスを上げる
    const chase = (c: CourtPlayer) => {
      const start = this.freeAt(c, bu.tPass) + readTime(this.skill(c, ['set']));
      const from = this.posAt(c, start);
      const d = dist(from, bu.at);
      const reach = Math.max(0, bu.t - start) * runSpeed(this.eff(c, 'speed')) + SET.setterLunge;
      return { start, from, d, ok: d <= reach, reach };
    };
    let useSetter = false;
    if (setter && setter.p.id !== bu.firstToucher) {
      const ch = chase(setter);
      useSetter = ch.ok;
      if (!ch.ok) {
        const k = Math.max(0, ch.reach - SET.setterLunge) / Math.max(ch.d, 1e-6);
        const stop = { u: ch.from.u + (bu.at.u - ch.from.u) * k, v: ch.from.v + (bu.at.v - ch.from.v) * k };
        this.moveTo(setter, stop, ch.start, { arriveBy: bu.t, asap: true });
      }
    }
    let tosser: CourtPlayer;
    if (useSetter) tosser = setter!;
    else {
      // 落下点に間に合う選手を候補にし、役割の優先順位（リベロ → 後衛 → 前衛のアウトサイド・オポジット → ミドル）で選ぶ。
      // 同じ順位の中では一番近い選手。誰も間に合わなければ一番近い選手
      const pool = list.filter(c => c.p.id !== bu.firstToucher && c !== setter);
      const near = (c: CourtPlayer) => dist(this.posAt(c, bu.tPass), bu.at);
      const rank = (c: CourtPlayer) => (c.role === 'L' ? 0 : !c.front ? 1 : c.role === 'MB' ? 3 : 2);
      const ok = pool.filter(c => chase(c).ok);
      const cands = ok.length ? ok : pool;
      tosser = cands.reduce((a, b) => {
        if (ok.length && rank(a) !== rank(b)) return rank(b) < rank(a) ? b : a;
        return near(b) < near(a) ? b : a;
      });
    }
    // パスが上がったら（読む時間の後）すぐ落下点へ動き、着いてからトスの構え
    this.moveTo(tosser, bu.at, this.freeAt(tosser, bu.tPass) + readTime(this.skill(tosser, ['set'])), { arriveBy: bu.t, asap: true });

    // 攻撃の選択肢
    const fs = this.frontSlots(team);
    const options: { c: CourtPlayer; type: SetType; w: number; lane: number }[] = [];
    const tw = SET.tacticWeights[ts.tactics.attack];
    const can = (type: SetType) => (type === 'high' || useSetter) && bu.offset <= SET.maxOffset[type];
    // バックアタック（解禁型）：後衛のアウトサイド・オポジットで、特能を持つ選手
    const backOptions: { c: CourtPlayer; type: SetType; w: number; lane: number }[] = [];
    if (can('back')) {
      for (const c of this.backAttackers(team)) {
        if (c === tosser) continue;
        backOptions.push({ c, type: 'back', w: SET.tacticWeights[ts.tactics.attack].back, lane: this.backLane(c) });
      }
    }
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
      let share = wings.length === 1 ? 1 : SET.aceShare[ts.tactics.attack];
      // 緑：エース頼み／散らし好き
      const st = styleOf(tosser.p, 'setting');
      if (wings.length > 1 && st === 'ace') share = Math.min(STYLE.setting.aceMax, share * STYLE.setting.aceMul);
      if (wings.length > 1 && st === 'spread') share += (1 / wings.length - share) * STYLE.setting.spreadMix;
      for (const c of wings) {
        const part = c === ace ? share : (1 - share) / (wings.length - 1);
        const lane = this.laneOf(c, fs.get(c)!);
        if (can('fast')) options.push({ c, type: 'fast', w: tw.fast * part, lane });
        options.push({ c, type: 'high', w: tw.high * part, lane });
      }
    }
    options.push(...backOptions);
    // 配球の判断：テクニックが高いほど、相手ブロックが薄くなりそうな攻撃を選ぶ
    // アタッカーの助走の準備ができていない攻撃（戻りきれていない・間に合わない）ほど避ける
    const judge = this.skill(tosser, ['set', 'setChoice']) / 100;
    const choice = this.rng.weighted(options.map(o => {
      const fl = TIMING.setFlight[o.type] + (useSetter ? 0 : TIMING.secondarySetExtra);
      const pl = this.approachPlan(o.c, o.type, o.lane, bu.t, bu.t + fl, o.c.p.id === bu.firstToucher ? bu.tPass + 0.1 : -Infinity);
      const unready = (1 - pl.q) + pl.late * 3;
      return {
        item: o,
        w: o.w * Math.exp(SET.choiceK * judge * (BLOCK.maxBlockers - this.expectedBlockers(opp, o.lane, o.type, !useSetter, bu.t)))
          * Math.exp(-SET.readyK * judge * unready),
      };
    }));

    // トスの精度
    const ssc: Scene[] = ['set'];
    if (!useSetter) ssc.push('setSecondary');
    if (bu.offset > SET.maxOffset.fast) ssc.push('setBadPass');
    if (bu.spin > SET.spinScene) ssc.push('setSpin');
    if (choice && (choice.type === 'quick' || choice.type === 'timeDiff')) ssc.push('setQuick');
    if (choice && choice.lane < bu.at.v - 0.5) ssc.push('setBack');
    const tossSkill = this.skill(tosser, ssc) * (useSetter ? aptitudeFactor(tosser.p, 'S') : SET.secondarySkill);
    const errScale = SET.errBase * (1 + bu.offset * SET.errOffsetK + bu.spin * SET.errSpinK) * Math.max(0.2, SET.skillPivot - tossSkill / 100);
    const setError = Math.abs(this.rng.normal()) * errScale;
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
      // 崩れた所（ネットから遠い所）から上げたトスは、打つ位置もネットから離れる
      u: clamp((choice.type === 'back' ? BACK_ATTACK.hitU : HIT_U) + Math.abs(Math.cos(ang)) * setError + Math.max(0, bu.at.u - SET_TARGET.u) * SET.offNetCarry, 0.25, 4.5),
      v: clamp(choice.lane + Math.sin(ang) * setError, -4.6, 4.6),
    };
    const flight = TIMING.setFlight[setType] + (useSetter ? 0 : TIMING.secondarySetExtra);
    const tHit = bu.t + flight;

    // 助走：計画どおりに始め、トスのずれを見て途中で踏み切る位置を直す。直しきれない分は残る
    const plan = this.approachPlan(attacker, setType, choice.lane, bu.t, tHit, attacker.p.id === bu.firstToucher ? bu.tPass + 0.1 : -Infinity);
    const asc: Scene[] = ['attack'];
    if (setType === 'quick' || setType === 'timeDiff') asc.push('attackQuick');
    if (!useSetter) asc.push('attackSecondary');
    const aTech = this.skill(attacker, asc);
    const tNom = tHit - TIMING.jumpRise;
    const adjust = Math.max(0, tNom - (bu.t + readTime(aTech))) * (APPROACH.adjustBase + this.eff(attacker, 'speed') * APPROACH.adjustPer);
    const miss = Math.max(setError * APPROACH.minResidual, setError - adjust);
    // 踏み切りのタイミング：判断はテクニック。崩れたトスほど合わせにくい
    const timing = this.rng.normal() * APPROACH.timingSigma * Math.max(0.2, APPROACH.timingTechPivot - aTech / 100)
      * (1 + setError * APPROACH.timingPerSetError);
    const tTake = tNom + plan.late + timing;
    const jumpM = (jumpHeightCm(this.eff(attacker, 'jump')) / 100) * (APPROACH.standingRatio + (1 - APPROACH.standingRatio) * plan.q);
    const contact = this.contactAt(attacker, tTake, jumpM, tHit);
    const hitZ = contact.cm / 100;
    this.act(tosser, bu.t, 'set', bu.at, setZ, { setType, secondary: !useSetter });
    this.ballTo(this.world(team, hit, hitZ), tHit, 'set', Math.max(hitZ, this.hitCm(attacker) / 100) + TIMING.setApexAbove[setType] + (useSetter ? 0 : 0.5));

    // バックアタックはアタックラインを踏まない所で踏み切る
    const take: Local = { u: setType === 'back' ? Math.max(BACK_ATTACK.minTakeoffU, hit.u + APPROACH.takeoffBack) : hit.u + APPROACH.takeoffBack, v: hit.v };
    if (setType === 'timeDiff') {
      // 時間差：速攻の時刻に踏み込んで止まり（フェイク）、その場でもう一度跳ぶ
      const tFake = plan.tTakeNom + plan.late;
      this.moveTo(attacker, take, plan.tA, { asap: true, dur: Math.max(0.15, tFake - plan.tA) });
      this.act(attacker, tFake, 'fakeJump', take, 0);
    } else {
      this.moveTo(attacker, take, plan.tA, { asap: true, dur: Math.max(0.15, tTake - plan.tA) });
    }
    for (const [c] of fs) {
      if (c === attacker || c === tosser || c.role === 'S' || c.role === 'L') continue;
      const p = this.pos.get(c.p.id)!;
      this.moveTo(c, { u: Math.max(0.8, p.u - 1.8), v: p.v }, bu.t, { arriveBy: tHit });
    }

    const sb: SetBall = {
      team, attacker, setType, hit, tSet: bu.t, tHit, setError, secondary: !useSetter,
      tTake, jumpM, miss, contactCm: contact.cm, airPhase: contact.phase, tosser,
    };

    // 打てないトス、または踏み切りのタイミングが大きく外れて空中で合わせられない時：跳ばずにつなぎで返す
    const offTiming = contact.phase < APPROACH.minAirPhase || contact.phase > 1 - APPROACH.minAirPhase;
    if (setError >= SET.unhittable || offTiming) {
      this.act(attacker, tHit, 'freeball', hit, Math.min(Math.max(hitZ, 2.0), 2.4));
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
    this.coverAttack(sb, tosser);
    return { kind: 'set', sb };
  }

  /** 助走を始める位置：ミドルはレーンの正面、アウトサイド・オポジットは外側から斜めに入る */
  private approachSpot(c: CourtPlayer, lane: number): Local {
    if (c.role === 'MB') return { u: APPROACH.startU.middle, v: lane };
    return { u: APPROACH.startU.wing, v: clamp(lane + Math.sign(lane || 1) * APPROACH.wingOutside, -4.3, 4.3) };
  }

  private approachSpeed(c: CourtPlayer): number {
    return APPROACH.speedBase + this.eff(c, 'speed') * APPROACH.speedPer;
  }

  /**
   * 助走の計画。オープンはトスを見て（読む時間の後に）、平行はトスの少し前から、速攻・時間差はパスの間に助走を始める。
   * アタッカーが助走を始める位置まで戻りきれていなければ、その途中の位置から助走する（助走が短くなる）。
   * 遠すぎれば早めに動き出し、それでも間に合わなければ踏み切りが遅れる。
   */
  private approachPlan(c: CourtPlayer, type: SetType, lane: number, tSet: number, tHit: number, notBefore = -Infinity): ApproachPlan {
    // 時間差は、速攻の時刻に踏み込む（フェイク）ところまでを助走とする
    const tTakeNom = (type === 'timeDiff' ? tSet + TIMING.setFlight.quick : tHit) - TIMING.jumpRise;
    const take: Local = { u: type === 'back' ? BACK_ATTACK.hitU + APPROACH.takeoffBack : HIT_U + APPROACH.takeoffBack, v: lane };
    const v = this.approachSpeed(c);
    const full = APPROACH.fullLen[type];
    const earliest = type === 'high' ? tSet + readTime(this.skill(c, ['attack']))
      : type === 'fast' ? tSet - APPROACH.fastLead : type === 'back' ? tSet - BACK_ATTACK.lead : -Infinity;
    // 1本目を触った選手は、触った後からしか助走を始められない
    const free = this.freeAt(c, notBefore);
    let tA = Math.max(earliest, free, tTakeNom - full / v);
    let from = this.posAt(c, tA);
    let d = dist(from, take);
    if (d > full) {
      const t2 = Math.max(earliest, free, tTakeNom - d / v);
      if (t2 < tA) { tA = t2; from = this.posAt(c, tA); d = dist(from, take); }
    }
    const late = Math.max(0, tA + d / v - tTakeNom);
    return { tA, from, d, q: clamp(d / full, 0, 1), late, tTakeNom };
  }

  /** 踏み切りの時刻と跳ぶ高さから、打つ時刻にボールに触る高さを求める */
  private contactAt(c: CourtPlayer, tTake: number, jumpM: number, tHit: number): { cm: number; phase: number } {
    const phase = (tHit - tTake) / TIMING.jumpTotal;
    const rise = phase > 0 && phase < 1 ? 4 * phase * (1 - phase) : 0;
    return { cm: standingReachCm(c.p.height) + jumpM * 100 * rise, phase };
  }

  /**
   * 味方がスパイクを打つ時、打たない選手がアタッカーの近く（後ろ側の半円）に寄って、ブロックに当たって落ちるボールに備える。
   * トスを上げた選手はトスの後、おとりの前衛は打つ時刻まで助走してから、ほかは読む時間の後に動き出す
   */
  private coverAttack(sb: SetBall, tosser: CourtPlayer) {
    const team = sb.team;
    const slots: Local[] = COVER.slots.map(([r, deg]) => {
      const a = (deg * Math.PI) / 180;
      return { u: clamp(sb.hit.u + r * Math.cos(a), COVER.minU, COVER.maxU), v: clamp(sb.hit.v + r * Math.sin(a), -COURT.halfWidth + 0.2, COURT.halfWidth - 0.2) };
    });
    const free = this.court[team].filter(c => c !== sb.attacker);
    for (const slot of slots) {
      if (!free.length) break;
      let bi = 0;
      for (let i = 1; i < free.length; i++) {
        if (dist(this.pos.get(free[i].p.id)!, slot) < dist(this.pos.get(free[bi].p.id)!, slot)) bi = i;
      }
      const c = free.splice(bi, 1)[0];
      const decoy = c.front && c.role !== 'S' && c.role !== 'L' && c !== tosser;
      const start = c === tosser ? sb.tSet + 0.15 : decoy ? sb.tHit - 0.1 : sb.tSet + readTime(this.skill(c, ['cover']));
      this.moveTo(c, slot, this.freeAt(c, start), { asap: true });
    }
  }

  // ============================================================
  // 3本目（スパイク・ブロック）
  // ============================================================

  private attack(sb: SetBall): Step {
    const team = sb.team;
    const opp = other(team);
    const a = sb.attacker;
    // 最高の打点（身長と跳躍だけで決まる）と、実際に触る高さ（助走の長さと踏み切りのタイミングで下がる）
    const maxCm = this.hitCm(a);
    const hitCm = sb.contactCm;
    const hitZ = hitCm / 100;
    const netCm = this.netH * 100;
    const n = (this.attackCount.get(a.p.id) ?? 0) + 1;
    this.attackCount.set(a.p.id, n);
    const quick = sb.setType === 'quick' || sb.setType === 'timeDiff';
    const sc: Scene[] = ['attack'];
    if (sb.miss > ATTACK.softBadSetFrom) sc.push('attackBadSet');
    if (quick) sc.push('attackQuick');
    if (sb.secondary) sc.push('attackSecondary');
    if (n >= 2) sc.push('attackRepeat');
    if (sb.direct) sc.push('direct');

    // コース（サイドから打つ時だけ）。緑のストレート好み／クロス好みで偏る
    if (!sb.direct && Math.abs(sb.hit.v) >= STYLE.sideLaneV) {
      const pref = styleOf(a.p, 'course');
      sb.course = this.rng.chance(STYLE.straightShare[pref ?? 'none']) ? 'straight' : 'cross';
      sc.push(sb.course === 'straight' ? 'attackStraight' : 'attackCross');
    }

    let penalty = sb.miss * ATTACK.missPenalty;
    const slow = quick ? Math.max(0, ATTACK.quickSpeedPivot - this.ab(a, 'speed', sc)) : 0;
    penalty += slow * ATTACK.quickSpeedPenalty;
    if (sb.direct) penalty += ATTACK.directPenalty;
    const blockers = this.blockers(sb);
    const maxReach = blockers.reduce((m, b) => Math.max(m, b.reachCm), 0);

    // ネットを越えて強打できる最短の距離
    const clearZ = this.netH + ATTACK.netClearance;
    // バックアタックは回転をかけて弧を描くので、ネットから離れていても強打できる（その分だけ近い所から打つとみなす）
    const fromU = sb.setType === 'back' ? Math.max(0.3, sb.hit.u - BACK_ATTACK.arcU) : sb.hit.u;
    const minLand = hitZ - clearZ > 0.05 ? (fromU * clearZ) / (hitZ - clearZ) : Infinity;
    const goodPhase = sb.airPhase >= APPROACH.minAirPhase && sb.airPhase <= 1 - APPROACH.minAirPhase;
    const canHard = goodPhase && hitCm >= netCm + APPROACH.minOverNetCm && minLand <= ATTACK.hardTargetU[1] - 0.5;

    // ブロックの壁の厚さ（枚数・間に合い具合・高さ・ブロック能力）
    let wall = 0;
    for (const b of blockers) {
      wall += b.timing * (this.blockSkill(b.cp, b.sc) / 100) * clamp(1 + (b.reachCm - hitCm) / BLOCK.heightFactorDivCm, 0.1, 1.5);
    }
    // 軟打に切り替える判断：壁が厚いのを読めるほど（テクニック）軟打でかわす
    const judge = this.skill(a, sc) / 100;
    const hs = styleOf(a.p, 'hitting');
    const softRate = (ATTACK.softBase + (sb.miss > ATTACK.softBadSetFrom ? ATTACK.softBadSet : 0)
      + ATTACK.softRead * Math.min(ATTACK.softReadWallMax, wall) * judge) * (hs ? STYLE.softRate[hs] : 1);
    const soft = !canHard || (!sb.direct && this.rng.chance(softRate));
    if (soft) sc.push('tip');
    const tech = this.skill(a, sc);
    const power = (this.phys(a, 'power', sc) * ATTACK.power + tech * ATTACK.tech
      + (hitCm - netCm) * ATTACK.height * this.w.physical - penalty) * (soft ? ATTACK.softPowerRatio : 1)
      * (sb.setType === 'back' ? BACK_ATTACK.powerRatio : 1);
    const errRate = clamp((ATTACK.errBase + sb.miss * ATTACK.errPerMiss - (tech - 50) * ATTACK.errTechSlope + slow * ATTACK.quickSpeedErr)
      * (soft ? ATTACK.softErrRatio : sb.course ? STYLE.course[sb.course].err : 1), 0.01, 0.6);
    const overBlock = blockers.length > 0 && hitCm - maxReach >= BLOCK.overMarginCm;

    // 打ち手・ブロッカーの動き
    this.jump(a, sb.tTake, TIMING.jumpTotal, sb.jumpM);
    const tBlock = sb.tHit + 0.04;
    for (const b of blockers) {
      this.jump(b.cp, sb.tHit - TIMING.blockRise, TIMING.blockTotal, (b.reachCm - standingReachCm(b.cp.p.height)) / 100);
      this.act(b.cp, tBlock, 'block', b.spot, b.reachCm / 100);
    }
    const info: ActionInfo = {
      setType: sb.setType, hitHeight: round(maxCm), contactHeight: round(hitCm), blockReach: blockers.length ? round(maxReach) : undefined,
      blockers: blockers.map(b => b.cp.p.id), overBlock, direct: sb.direct || undefined,
    };
    this.act(a, sb.tHit, soft ? 'tip' : 'spike', sb.hit, hitZ, info);
    this.touches++;

    // ミス
    if (this.rng.chance(errRate)) {
      const side = traitExtra(a.p).attackMissSide;
      if (!soft && this.rng.chance(TRAIT_EXTRA.attackMissNet[side ?? 'normal'])) {
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
      // 軟打志向は落とし所がうまい（狙いの候補を増やす）
      const extra = hs === 'soft' ? STYLE.softTipCandidates : 0;
      const land = this.aim(opp, ATTACK.tipTargetU, TIMING.tipFlight, tech, blockers, sb.tHit, ATTACK.targetV, extra);
      return {
        kind: 'incoming',
        inc: {
          team: opp, kind: 'tip', land, tArrive: sb.tHit + TIMING.tipFlight, flight: TIMING.tipFlight, readDelay: this.readDelay(sb),
          pressure: power, shake: 0, apex: Math.max(hitZ, (maxReach || netCm) / 100) + 0.35,
          ballKind: 'tip', dropReason: 'tipKill', dropKey: a.p.id, sender: a,
        },
      };
    }

    // ブロックに触るか
    if (blockers.length && !overBlock) {
      // 打ち分け：テクニックが高いほどブロックの手に当てずに打てる
      // 触る判定（場面 blockTouch）と止める判定（場面 blockKill）。コース読みが当たれば壁が厚くなる
      let wallTouch = 0;
      for (const b of blockers) {
        const read = b.readCourse && b.readCourse === sb.course ? STYLE.courseReadWall : 1;
        // コースの性質：ストレートは間に合ったブロックに止められやすく、遅れたブロックは抜きやすい
        const cw = sb.course ? STYLE.course[sb.course] : undefined;
        const courseK = cw ? (b.timing >= 1 ? cw.wallOnTime : cw.wallLate) : 1;
        wallTouch += b.timing * (this.blockSkill(b.cp, [...b.sc, 'blockTouch']) / 100) * read * courseK
          * (sb.setType === 'back' ? BACK_ATTACK.wallRatio : 1)
          * clamp(1 + (b.reachCm - hitCm) / BLOCK.heightFactorDivCm, 0.1, 1.5);
      }
      const touch = (1 - Math.exp(-wallTouch * BLOCK.touchK)) * clamp(BLOCK.touchTechPivot - tech / BLOCK.touchTechDiv, 0.2, 1);
      const blockPower = BLOCK.power.base + Math.max(...blockers.map(b =>
        this.blockSkill(b.cp, [...b.sc, 'blockKill']) * BLOCK.power.block + (b.reachCm - hitCm) * BLOCK.power.height * this.w.physical))
        + (blockers.length - 1) * BLOCK.power.extra;

      if (this.rng.chance(touch)) {
        const main = blockers[0];
        const contact = this.world(opp, { u: 0.15, v: -sb.hit.v }, main.reachCm / 100 - 0.1);
        this.ballTo(contact, tBlock, 'spike');
        const pKill = sigmoid((blockPower - power - tech * BLOCK.killTech) / BLOCK.killScale + BLOCK.killBase);
        if (this.rng.chance(pKill)) return this.blockKill(sb, main, tBlock);
        // ブロックアウト：打つ側のテクニック（場面 blockOut）。ブロックアウトされやすい選手が当てられると増える
        const outTech = this.skill(a, [...sc, 'blockOut']);
        const guard = this.blockSkill(main.cp, [...main.sc, 'blockOutGuard']) - this.blockSkill(main.cp, main.sc);
        if (this.rng.chance(BLOCK.blockOutBase * (outTech / 50) * clamp(1 - guard / 40, 0.3, 2))) {
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
              pressure: power * BLOCK.oneTouchPressure * 0.6, shake: 0.2, apex: contact.z + 1.2,
              ballKind: 'deflect', dropReason: 'blockKill', dropKey: main.cp.p.id, sender: main.cp,
            },
          };
        }
        const land: Local = { u: this.rng.range(3, 8.5), v: this.rng.range(-4, 4) };
        return {
          kind: 'incoming',
          inc: {
            team: opp, kind: 'oneTouch', land, tArrive: tBlock + TIMING.oneTouchFlight, flight: TIMING.oneTouchFlight,
            pressure: power * BLOCK.oneTouchPressure, shake: 0.3, apex: contact.z + 1.5,
            ballKind: 'deflect', dropReason: 'kill', dropKey: a.p.id, sender: a,
          },
        };
      }
    }

    // ブロックを抜けた（または上から打ち抜いた）強打
    const speed = TIMING.spikeSpeedBase + this.phys(a, 'power', sc) * TIMING.spikeSpeedPerPower;
    const range: [number, number] = [Math.max(ATTACK.hardTargetU[0], minLand), ATTACK.hardTargetU[1]];
    const roughFlight = (sb.hit.u + (range[0] + range[1]) / 2) / speed;
    // コース：ストレートは打った側のサイドライン沿い、クロスは反対側（守る側の座標では v の向きが逆になる）
    let vRange: [number, number] = ATTACK.targetV;
    if (sb.course) {
      const sameSide = -Math.sign(sb.hit.v);
      const side = sb.course === 'straight' ? sameSide : -sameSide;
      const lo = side * ATTACK.courseInnerV, hi = side * ATTACK.targetV[1];
      vRange = [Math.min(lo, hi), Math.max(lo, hi)];
    }
    const land = this.aim(opp, range, roughFlight, tech, blockers, sb.tHit, vRange);
    const dx = sb.hit.u + land.u;
    const dy = (-land.v) - sb.hit.v;
    const flight = Math.hypot(dx, dy, hitZ) / speed;
    return {
      kind: 'incoming',
      inc: {
        team: opp, kind: 'spike', land, tArrive: sb.tHit + flight, flight, pressure: power, shake: 0, readDelay: this.readDelay(sb),
        ballKind: 'spike', dropReason: 'kill', dropKey: a.p.id, sender: a,
      },
    };
  }

  /** ブロックに跳ぶ選手と、その間に合い具合 */
  private blockers(sb: SetBall): Blocker[] {
    const def = other(sb.team);
    const laneDef = -sb.hit.v;
    const tAvail = sb.direct ? DIRECT.blockTime : TIMING.setFlight[sb.setType] + (sb.secondary ? TIMING.secondarySetExtra : 0) + BLOCK.readExtra;
    const quick = sb.setType === 'quick' || sb.setType === 'timeDiff';
    const sc: Scene[] = quick ? ['blockQuick'] : [];
    const front = [...this.frontSlots(def).keys()].filter(c => c.role !== 'L');
    // トスが上がった時に記録の上でいる位置（ブロックの基本位置へ動いている途中ならその途中）から判定する
    const at = (c: CourtPlayer) => this.posAt(c, sb.tSet);
    front.sort((x, y) => Math.abs(at(x).v - laneDef) - Math.abs(at(y).v - laneDef));
    const res: Blocker[] = [];
    const tQuick = sb.tSet + TIMING.setFlight.quick;
    const usedSides = new Set<number>();
    front.forEach(c => {
      if (res.length >= BLOCK.maxBlockers) return;
      const p = at(c);
      // 1人目はレーンの正面、2人目以降は自分のいる側の隣（埋まっていれば反対側）
      let spotV = laneDef;
      if (res.length > 0) {
        let side = Math.sign(p.v - laneDef) || 1;
        if (usedSides.has(side)) side = -side;
        usedSides.add(side);
        spotV = laneDef + side * BLOCK.spotSpacing;
      }
      const spot: Local = { u: 0.3, v: clamp(spotV, -4.4, 4.4) };
      // 読み（ブロック能力）：トスを見て動き出すまでの時間と、時間差のフェイクに跳ばされるか
      // 配球バレ：トスを上げた選手の特能が、相手ブロッカーの読みに効く
      const read = this.ab(c, 'block', ['block', ...sc, 'blockRead'], sb.tosser?.p);
      // 打つミドルが速いほど、速攻のフェイクが本物らしく見えて跳ばされやすい（場面 attackTimeDiff）
      const fake = sb.setType === 'timeDiff' ? (this.ab(sb.attacker, 'speed', ['attack', 'attackQuick', 'attackTimeDiff']) - 50) * APPROACH.fakeSpeedSlope : 0;
      // 緑：コミット寄りは時間差に掛かりやすく速攻に早い。リード寄りはその逆
      const bs = styleOf(c.p, 'blocking');
      const bsk = bs ? STYLE.blocking[bs] : { bite: 1, quickReact: 0, sideReact: 0 };
      const bite = clamp((BLOCK.timeDiffBite + (50 - read) * BLOCK.biteReadSlope + fake) * bsk.bite, 0.05, 0.9);
      if (sb.setType === 'timeDiff' && c.role === 'MB' && this.rng.chance(bite)) {
        this.moveTo(c, { u: 0.3, v: clamp(-LANE_V.quick, -4, 4) }, sb.tSet, { dur: 0.2 });
        this.jump(c, tQuick - TIMING.blockRise, TIMING.blockTotal, (this.blockCm(c) - standingReachCm(c.p.height)) / 100);
        this.act(c, tQuick, 'block', this.pos.get(c.p.id)!, this.blockCm(c) / 100);
        return;
      }
      const sp = this.eff(c, 'speed');
      const react = Math.max(0.05, readReaction(read) + (quick ? bsk.quickReact : bsk.sideReact));
      // 読み→横移動→踏み切り（跳び上がるまでの時間）が、トスが上がってから打つまでに収まるか
      const tNeed = react + Math.abs(spot.v - p.v) / sideSpeed(sp) + TIMING.blockRise;
      const late = tNeed - tAvail;
      if (late > BLOCK.lateLimit) return;
      const timing = late <= 0 ? 1 : 1 - (late / BLOCK.lateLimit) * BLOCK.latePenalty;
      this.moveTo(c, spot, sb.tSet + react, {
        arriveBy: sb.tSet + Math.max(tNeed - TIMING.blockRise, 0.15), asap: true, dur: Math.abs(spot.v - p.v) / sideSpeed(sp),
      });
      // コース読み：相手アタッカーにコースの好みがあれば、そちらに寄って跳ぶ
      const pref = hasTrait(c.p, 'courseRead') ? styleOf(sb.attacker.p, 'course') : undefined;
      res.push({ cp: c, sc, spot, timing, reachCm: this.blockCm(c) - (1 - timing) * 20, readCourse: pref });
    });
    // ブロックに跳ばない前衛は下がってフェイントや強打に備える
    for (const c of front) {
      if (res.some(b => b.cp === c) || (this.busyUntil.get(c.p.id) ?? 0) > sb.tSet) continue;
      const p = this.pos.get(c.p.id)!;
      this.moveTo(c, { u: DEFENSE_POS.offBlockerU, v: clamp(p.v * 0.9, -3.8, 3.8) }, sb.tSet);
    }
    return res;
  }

  /** 配球の判断用：その攻撃に相手ブロックが何枚つきそうか（乱数を使わない見積もり） */
  private expectedBlockers(def: TeamId, lane: number, type: SetType, secondary: boolean, tSet: number): number {
    const laneDef = -lane;
    const tAvail = TIMING.setFlight[type] + (secondary ? TIMING.secondarySetExtra : 0) + BLOCK.readExtra;
    let n = 0;
    for (const c of this.court[def]) {
      if (!c.front || c.role === 'L') continue;
      const p = this.posAt(c, tSet);
      const tNeed = readReaction(this.blockSkill(c, ['blockRead'])) + Math.abs(laneDef - p.v) / sideSpeed(this.eff(c, 'speed')) + TIMING.blockRise;
      if (tNeed - tAvail <= BLOCK.lateLimit * 0.5) n++;
    }
    return Math.min(n, BLOCK.maxBlockers);
  }

  /** ダイレクト：ネット際に返ってきたボールを前衛が直接打つ。打てなければ普通に受ける */
  private tryDirect(inc: Incoming): Step | undefined {
    const team = inc.team;
    const hit: Local = { u: Math.max(0.3, inc.land.u), v: inc.land.v };
    const tHit = inc.tArrive - 0.15;
    let best: { c: CourtPlayer; m: number } | undefined;
    for (const c of this.court[team]) {
      if (!c.front || c.role === 'L') continue;
      const t = this.timeToReact(c, tHit, inc.flight - 0.15);
      if (t <= 0) continue;
      const m = this.reachDist(c, t) - dist(this.pos.get(c.p.id)!, hit);
      if (m >= 0 && (!best || m > best.m)) best = { c, m };
    }
    if (!best) return undefined;
    const a = best.c;
    // ネット際なので助走は短く、踏み切りのタイミングも合わせにくい
    const setError = this.rng.range(0, DIRECT.maxError);
    const tech = this.skill(a, ['attack', 'direct']);
    const tTake = tHit - TIMING.jumpRise
      + this.rng.normal() * APPROACH.timingSigma * Math.max(0.2, APPROACH.timingTechPivot - tech / 100);
    const jumpM = (jumpHeightCm(this.eff(a, 'jump')) / 100) * (APPROACH.standingRatio + (1 - APPROACH.standingRatio) * DIRECT.approachQ);
    const contact = this.contactAt(a, tTake, jumpM, tHit);
    const hitZ = contact.cm / 100;
    this.moveTo(a, { u: hit.u + 0.3, v: hit.v }, inc.tArrive - inc.flight + 0.2, { arriveBy: tTake });
    this.ballTo(this.world(team, hit, hitZ), tHit, inc.ballKind, Math.max(inc.apex ?? 0, hitZ + 0.3));
    this.defenseBase(other(team), inc.tArrive - inc.flight + 0.2);
    return {
      kind: 'set',
      sb: {
        team, attacker: a, setType: 'high', hit, tSet: tHit - DIRECT.blockTime, tHit,
        setError, secondary: false, direct: true,
        tTake, jumpM, miss: setError, contactCm: contact.cm, airPhase: contact.phase,
      },
    };
  }

  /** 守る側が打球を読みにくい分の遅れ：トスが速いほど、打つ前に構え直す時間がない */
  private readDelay(sb: SetBall): number {
    return sb.direct ? ATTACK.readDelay.quick : ATTACK.readDelay[sb.setType];
  }

  /** 狙う場所：テクニックが高いほど候補を多く比べて、守備のいない所を選ぶ */
  private aim(def: TeamId, uRange: [number, number], flight: number, tech: number, blockers: Blocker[], tHit: number,
    vRange: [number, number] = ATTACK.targetV, extraCandidates = 0): Local {
    const k = 1 + Math.floor(Math.max(0, tech) / ATTACK.aimTechDiv) + extraCandidates;
    const jumped = new Set(blockers.map(b => b.cp.p.id));
    const diggers = this.court[def].filter(c => !jumped.has(c.p.id));
    let best: { l: Local; s: number } | undefined;
    for (let i = 0; i < k; i++) {
      const l: Local = { u: this.rng.range(uRange[0], uRange[1]), v: this.rng.range(vRange[0], vRange[1]) };
      const s = Math.min(...diggers.map(c => dist(this.posAt(c, tHit), l) - this.reachDist(c, flight)));
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
      .map(c => ({ c, m: this.reachDist(c, TIMING.blockReboundFlight + 0.1) - dist(this.posAt(c, tBlock), land) }))
      .sort((x, y) => y.m - x.m)[0];
    // フォローの上手さはテクニック（場面 cover）。50で基本の確率
    const chance = cover ? clamp(BLOCK.coverChance * this.skill(cover.c, ['cover']) / 50, 0, 0.6) : 0;
    if (cover && cover.m >= 0 && this.rng.chance(chance)) {
      const c = cover.c;
      const stand = this.standFor(team, land, this.ballPos, RECORD.diveStandOffset);
      this.moveTo(c, land, tBlock + readTime(this.skill(c, ['dig'])), { arriveBy: tLand, asap: true, stand });
      this.ballTo(this.world(team, land, 0.4), tLand, 'blockRebound');
      this.act(c, tLand, 'cover', land, 0.4);
      this.touches++;
      this.load[c.p.id] += LOAD.dig;
      const offset = this.rng.range(1.8, 3.8);
      const ang = this.rng.range(-1.2, 1.2);
      const at: Local = { u: clamp(SET_TARGET.u + 1 + Math.abs(Math.cos(ang)) * offset, 0.5, 8), v: clamp(SET_TARGET.v + Math.sin(ang) * offset, -4.3, 4.3) };
      const tUp = tLand + TIMING.passFlight + offset * TIMING.passFlightPerOffset;
      this.ballTo(this.world(team, at, 2.3), tUp, 'pass', 3.8);
      this.attackBase(team, x => this.freeAt(x, tLand + 0.1), new Set([c.p.id]));
      this.defenseBase(other(team), tLand);
      return { kind: 'ballUp', bu: { team, tPass: tLand, t: tUp, at, offset, spin: 0.5, firstToucher: c.p.id } };
    }
    this.land(this.world(team, land), tLand, 'blockRebound');
    return this.point(other(team), 'blockKill', tLand, main.cp.p.id);
  }
}


/** 打球を読んで動き出すまでの時間（テクニックから。男女の重みを掛けた値を渡す） */
function readTime(tech: number): number {
  return clamp(BODY.readMax - ((BODY.readMax - BODY.readMin) * tech) / 100, BODY.readFloor, BODY.readMax);
}

/** サーブを構える位置：フローターはエンドラインのすぐ後ろ、ジャンプ系は助走の長さだけ後ろ */
export function serveStartSpot(type: ServeType): Local {
  if (type === 'float') return { u: SERVE.serverU, v: -2.5 };
  return { u: SERVE_RUN.takeoffU + SERVE_RUN.approachLen[type], v: -2.5 };
}

/** ブロックの読みの速さ（ブロック能力から） */
function readReaction(read: number): number {
  return BLOCK.readReactionMax - ((BLOCK.readReactionMax - BLOCK.readReactionMin) * clamp(read, 0, 100)) / 100;
}

/** 始点・終点の高さと最高点から、BallSegment の bulge を求める */
export function bulgeForApex(z0: number, z1: number, apex: number): number {
  const d = z1 - z0;
  const h = Math.max(apex, z0, z1);
  const k = h - z0 - d / 2;
  const disc = k * k - (d * d) / 4;
  return (k + Math.sqrt(Math.max(0, disc))) / 2;
}
