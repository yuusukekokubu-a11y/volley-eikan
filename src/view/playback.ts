// 記録（RallyRecord）から、ある時刻の見た目の状態を求める。描画はこれを使う。
// 試合計算の結果を読むだけで、計算はしない。
// 移動の始まり・終わりの時刻と位置は記録どおり。途中の速さの付け方（加速・減速）だけをここで決める。

import type { ActionType, BallSegment, RallyEvent, RallyRecord, Role, TeamId, Vec2, Vec3 } from '../sim/types';

export type Pose = 'ready' | 'serve' | 'toss' | 'receive' | 'set' | 'spike' | 'block' | 'tip' | 'dig' | 'cover' | 'dive' | 'dump';

/** ジャンプの段階：踏み込み（沈む）→ 空中 → 着地（膝で沈む） */
export type JumpPhase = 'none' | 'prep' | 'air' | 'land';

/** 移動の種類：普通の移動／スパイクの助走（踏み切りに着く）／飛びつきの走り込み（触る時刻まで走る） */
export type MoveKind = 'none' | 'run' | 'approach' | 'dive';

/** ボールに触る瞬間に手を寄せる情報 */
export interface Contact {
  /** 触る点（世界座標） */
  pos: Vec3;
  /** 寄せ具合 0〜1（触る瞬間に1） */
  w: number;
  /** both＝両手（レシーブ・トス・ブロック）、hit＝利き腕（スパイク・サーブ） */
  hands: 'both' | 'hit';
  action: ActionType;
}

export interface PlayerFrame {
  id: string;
  team: TeamId;
  number: number;
  role: Role;
  /** 身長（m） */
  height: number;
  x: number;
  y: number;
  /** ジャンプの高さ（足が床から離れている分、m） */
  z: number;
  pose: Pose;
  /** ポーズの進み具合 0〜1（腕の振りなど） */
  poseT: number;
  /** 速度・加速度（世界座標、m/s・m/s²） */
  vx: number;
  vy: number;
  ax: number;
  ay: number;
  /** 移動の速さ（m/s） */
  speed: number;
  moveKind: MoveKind;
  /** 移動の中の進み具合 0〜1 */
  moveT: number;
  jumpPhase: JumpPhase;
  /** ジャンプの段階の中の進み具合 0〜1 */
  jumpT: number;
  /** 片足で踏み切るジャンプ（ブロード） */
  oneFoot?: boolean;
  /** 左利き（打つ腕が左。描画で腕の左右を入れ替える） */
  left?: boolean;
  contact?: Contact;
  /** 動作のために向く点（世界座標）。なければ移動の方向かボールの方を向く */
  faceTo?: Vec2;
}

/** 踏み込み・着地の時間（秒） */
export const JUMP_PREP = 0.25;
export const JUMP_LAND = 0.3;

/** 触る瞬間に手を寄せ始める時間・離す時間（秒） */
const CONTACT_IN = 0.3;
const CONTACT_HOLD = 0.06;
const CONTACT_OUT = 0.22;

export interface Frame {
  t: number;
  players: PlayerFrame[];
  ball: Vec3;
  ballVisible: boolean;
  /** 得点が入った後なら、その情報 */
  point?: Extract<RallyEvent, { type: 'point' }>;
  /** 最後のスパイク（打点・到達点の表示用） */
  lastAttack?: Extract<RallyEvent, { type: 'action' }>;
}

interface MoveSeg { t: number; from: Vec2; to: Vec2; dur: number; kind: MoveKind }

type ActionEv = Extract<RallyEvent, { type: 'action' }>;
type JumpEv = Extract<RallyEvent, { type: 'jump' }>;

/** ポーズを取る時間（動作の時刻の前後、秒）。前の時間は「着いてから」に切り詰める */
const POSE_WINDOW: Partial<Record<ActionType, { pose: Pose; before: number; after: number }>> = {
  serve: { pose: 'serve', before: 0.6, after: 0.25 },
  toss: { pose: 'toss', before: 0.2, after: 0.35 },
  receive: { pose: 'receive', before: 0.5, after: 0.3 },
  dig: { pose: 'dig', before: 0.4, after: 0.35 },
  set: { pose: 'set', before: 0.35, after: 0.2 },
  spike: { pose: 'spike', before: 0.35, after: 0.3 },
  tip: { pose: 'tip', before: 0.35, after: 0.25 },
  dump: { pose: 'dump', before: 0.35, after: 0.25 },
  block: { pose: 'block', before: 0.35, after: 0.35 },
  freeball: { pose: 'set', before: 0.3, after: 0.2 },
  cover: { pose: 'dig', before: 0.3, after: 0.3 },
};

const HANDS: Partial<Record<ActionType, Contact['hands']>> = {
  receive: 'both', dig: 'both', cover: 'both', set: 'both', freeball: 'both', block: 'both',
  spike: 'hit', tip: 'hit', serve: 'hit', dump: 'hit',
};

const isDive = (a: ActionEv) => (a.action === 'dig' || a.action === 'receive' || a.action === 'cover') && a.pos.z <= 0.3;

export class Playback {
  private moves = new Map<string, MoveSeg[]>();
  private jumps = new Map<string, JumpEv[]>();
  private actions = new Map<string, ActionEv[]>();
  private place = new Map<string, Vec2>();

  constructor(public readonly rec: RallyRecord) {
    for (const pl of rec.placements) {
      this.moves.set(pl.playerId, []);
      this.jumps.set(pl.playerId, []);
      this.actions.set(pl.playerId, []);
      this.place.set(pl.playerId, pl.pos);
    }
    for (const e of rec.events) {
      if (e.type === 'jump') this.jumps.get(e.playerId)!.push(e);
      else if (e.type === 'action') this.actions.get(e.playerId)!.push(e);
    }
    // 移動は、前の移動の途中からでも次の移動に切り替わる
    const cur = new Map<string, MoveSeg>();
    for (const pl of rec.placements) cur.set(pl.playerId, { t: 0, from: pl.pos, to: pl.pos, dur: 0, kind: 'run' });
    for (const e of rec.events) {
      if (e.type !== 'move') continue;
      const prev = cur.get(e.playerId)!;
      const end = e.t + e.dur;
      // 踏み切りに着く移動は助走、飛びつきの時刻まで走る移動は走り込み
      let kind: MoveKind = 'run';
      if (this.jumps.get(e.playerId)!.some(j => Math.abs(j.t - end) < 0.03)) kind = 'approach';
      if (this.actions.get(e.playerId)!.some(a => isDive(a) && Math.abs(a.t - end) < 0.03)) kind = 'dive';
      const seg: MoveSeg = { t: e.t, from: segAt(prev, e.t), to: e.to, dur: e.dur, kind };
      this.moves.get(e.playerId)!.push(seg);
      cur.set(e.playerId, seg);
    }
  }

  get duration(): number {
    return this.rec.duration;
  }

  private posAt(id: string, t: number): Vec2 {
    const segs = this.moves.get(id)!;
    for (let i = segs.length - 1; i >= 0; i--) if (segs[i].t <= t) return segAt(segs[i], t);
    return this.place.get(id)!;
  }

  /** その時刻に動いている移動（なければ undefined） */
  private segOf(id: string, t: number): MoveSeg | undefined {
    const segs = this.moves.get(id)!;
    for (let i = segs.length - 1; i >= 0; i--) if (segs[i].t <= t) return segs[i];
    return undefined;
  }

  frame(t: number): Frame {
    const players: PlayerFrame[] = this.rec.placements.map(pl => {
      const id = pl.playerId;
      const pos = this.posAt(id, t);
      // 速度・加速度（前後の位置の差から）
      const h = 0.04;
      const p0 = this.posAt(id, t - h), p1 = this.posAt(id, t + h);
      const pm = this.posAt(id, t - 2 * h), pp = this.posAt(id, t + 2 * h);
      const vx = (p1.x - p0.x) / (2 * h), vy = (p1.y - p0.y) / (2 * h);
      const ax = (pp.x - 2 * pos.x + pm.x) / (4 * h * h), ay = (pp.y - 2 * pos.y + pm.y) / (4 * h * h);
      const seg = this.segOf(id, t);
      let moveKind: MoveKind = 'none';
      let moveT = 0;
      if (seg && seg.dur > 0 && t <= seg.t + seg.dur) {
        moveKind = seg.kind;
        moveT = (t - seg.t) / seg.dur;
      }

      let z = 0;
      let jumpPhase: JumpPhase = 'none';
      let jumpT = 0;
      let oneFoot = false;
      for (const j of this.jumps.get(id)!) {
        if (t >= j.t && t <= j.t + j.dur) {
          const s = (t - j.t) / j.dur;
          z = Math.max(z, j.height * 4 * s * (1 - s));
          jumpPhase = 'air';
          jumpT = s;
          oneFoot = !!j.oneFoot;
        } else if (jumpPhase === 'none' && t >= j.t - JUMP_PREP && t < j.t) {
          jumpPhase = 'prep';
          jumpT = (t - (j.t - JUMP_PREP)) / JUMP_PREP;
          oneFoot = !!j.oneFoot;
        } else if (jumpPhase === 'none' && t > j.t + j.dur && t <= j.t + j.dur + JUMP_LAND) {
          jumpPhase = 'land';
          jumpT = (t - j.t - j.dur) / JUMP_LAND;
        }
      }

      let pose: Pose = 'ready';
      let poseT = 0;
      let contact: Contact | undefined;
      let faceTo: Vec2 | undefined;
      for (const a of this.actions.get(id)!) {
        // ジャンプ系のサーブは、スパイクと同じ腕振りで打つ
        const jumpServe = a.action === 'serve' && !!a.info?.serveType && a.info.serveType !== 'float';
        const w = jumpServe ? POSE_WINDOW.spike : POSE_WINDOW[a.action];
        if (!w) continue;
        const dive = isDive(a);
        // 移動 → 着いてからポーズ：構え始めは「その動作に向けた移動が終わった時刻」より前にしない
        const arrive = this.arrivalBefore(id, a.t);
        let start = a.t - (dive ? 0.35 : w.before);
        if (!dive && !jumpServe && a.action !== 'spike' && a.action !== 'tip' && a.action !== 'toss') {
          start = Math.max(start, Math.min(arrive, a.t - 0.1));
        }
        const end = a.t + (dive ? 0.6 : w.after);
        if (t >= start && t <= end) {
          pose = dive ? 'dive' : w.pose;
          poseT = (t - start) / (end - start);
          faceTo = this.faceTarget(a);
        }
        // 触る瞬間、手を触る点に寄せる
        const hands = HANDS[a.action];
        if (hands) {
          const inStart = Math.max(a.t - CONTACT_IN, Math.min(start, a.t - 0.1));
          let cw = 0;
          if (t >= inStart && t < a.t) cw = smooth((t - inStart) / (a.t - inStart));
          else if (t >= a.t && t <= a.t + CONTACT_HOLD) cw = 1;
          else if (t > a.t + CONTACT_HOLD && t < a.t + CONTACT_HOLD + CONTACT_OUT) cw = 1 - smooth((t - a.t - CONTACT_HOLD) / CONTACT_OUT);
          if (cw > (contact?.w ?? 0)) contact = { pos: a.pos, w: cw, hands, action: a.action };
        }
      }
      return {
        id, team: pl.team, number: pl.number, role: pl.role, height: pl.height / 100,
        x: pos.x, y: pos.y, z, pose, poseT, vx, vy, ax, ay, speed: Math.hypot(vx, vy), moveKind, moveT,
        jumpPhase, jumpT, contact, faceTo, ...(oneFoot ? { oneFoot } : {}), ...(pl.hand === 'left' ? { left: true } : {}),
      };
    });

    const { pos: ball, visible } = ballAt(this.rec.ball, t);
    let point: Frame['point'];
    let lastAttack: Frame['lastAttack'];
    for (const e of this.rec.events) {
      if (e.t > t) break;
      if (e.type === 'point') point = e;
      if (e.type === 'action' && (e.action === 'spike' || e.action === 'tip' || e.action === 'dump')) lastAttack = e;
    }
    return { t, players, ball, ballVisible: visible, point, lastAttack };
  }

  /** その時刻に向けた移動が終わる時刻（動いていなければ -∞） */
  private arrivalBefore(id: string, t: number): number {
    const seg = this.segOf(id, t);
    return seg ? seg.t + seg.dur : -Infinity;
  }

  /** 動作の時に向く点：受けるボールは来る方向、トス・スパイク・サーブは打つ方向、ブロックはネットの向こう */
  private faceTarget(a: ActionEv): Vec2 {
    const segs = this.rec.ball;
    if (a.action === 'block') return { x: a.pos.x + (a.team === 'A' ? 3 : -3), y: a.pos.y };
    if (a.action === 'receive' || a.action === 'dig' || a.action === 'cover') {
      const inc = segs.find(s => Math.abs(s.t1 - a.t) < 0.005);
      if (inc) return inc.from;
    } else {
      const out = segs.find(s => Math.abs(s.t0 - a.t) < 0.005 && s.t1 > s.t0);
      if (out) return out.to;
    }
    return { x: a.team === 'A' ? 5 : -5, y: a.pos.y };
  }
}

const smooth = (k: number) => {
  const c = Math.min(1, Math.max(0, k));
  return c * c * (3 - 2 * c);
};

/**
 * 移動の途中の進み具合。始まりと終わりの時刻・位置は記録どおりで、速さの付け方だけ種類で変える。
 *   run：ゆっくり動き出して加速し、止まる前に減速する
 *   approach：踏み込むほど速くなる（減速しない）
 *   dive：加速したまま触る瞬間まで走り込む
 */
function progress(kind: MoveKind, k: number): number {
  if (kind === 'approach') return Math.pow(k, 1.7);
  if (kind === 'dive') return Math.pow(k, 1.35);
  // 出だしと止まりがはっきりした加速・減速（真ん中の速さは平均の約1.9倍）
  return k * k * k * (k * (6 * k - 15) + 10);
}

function segAt(s: MoveSeg, t: number): Vec2 {
  if (s.dur <= 0) return t >= s.t ? s.to : s.from;
  const k = Math.min(1, Math.max(0, (t - s.t) / s.dur));
  const e = progress(s.kind, k);
  return { x: s.from.x + (s.to.x - s.from.x) * e, y: s.from.y + (s.to.y - s.from.y) * e };
}

export function ballAt(segs: BallSegment[], t: number): { pos: Vec3; visible: boolean } {
  if (!segs.length) return { pos: { x: 0, y: 0, z: 0 }, visible: false };
  if (t <= segs[0].t0) return { pos: segs[0].from, visible: true };
  for (const s of segs) {
    if (t >= s.t0 && t <= s.t1) {
      const k = s.t1 > s.t0 ? (t - s.t0) / (s.t1 - s.t0) : 1;
      return {
        pos: {
          x: s.from.x + (s.to.x - s.from.x) * k,
          y: s.from.y + (s.to.y - s.from.y) * k,
          z: Math.max(0.11, s.from.z + (s.to.z - s.from.z) * k + 4 * s.bulge * k * (1 - k)),
        },
        visible: true,
      };
    }
  }
  const last = segs[segs.length - 1];
  return { pos: { ...last.to, z: Math.max(0.11, last.to.z) }, visible: true };
}

/** 得点の一言（画面の端に出す） */
export function pointText(rec: RallyRecord, teamName: (t: TeamId) => string): string {
  const key = rec.placements.find(p => p.playerId === rec.keyPlayerId);
  const who = key ? `${teamName(key.team)} ${key.number}番` : '';
  const w = teamName(rec.winner);
  switch (rec.reason) {
    case 'kill': return `${who}のスパイク`;
    case 'tipKill': {
      const lastAct = rec.events.filter(e => e.type === 'action' && e.playerId === rec.keyPlayerId).pop();
      return lastAct?.type === 'action' && lastAct.action === 'dump' ? `${who}のツーアタック` : `${who}のフェイント`;
    }
    case 'blockKill': return `${who}のブロック`;
    case 'blockOut': return `${who}のブロックアウト`;
    case 'ace': return `${who}のサービスエース`;
    case 'serveFault': return `${who}のサーブミス`;
    case 'attackError': return `${who}のスパイクミス`;
    case 'receiveError': return `${who}のつなぎのミス`;
    case 'freeballDrop': return `${w}の得点（返球が落ちた）`;
  }
}
