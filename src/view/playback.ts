// 記録（RallyRecord）から、ある時刻の見た目の状態を求める。2D・3Dどちらの描画もこれを使う。
// 試合計算の結果を読むだけで、計算はしない。

import type { ActionType, BallSegment, RallyEvent, RallyRecord, Role, TeamId, Vec2, Vec3 } from '../sim/types';

export type Pose = 'ready' | 'serve' | 'receive' | 'set' | 'spike' | 'block' | 'tip' | 'dig' | 'cover';

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
}

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

interface MoveSeg { t: number; from: Vec2; to: Vec2; dur: number }

/** ポーズを取る時間（動作の時刻の前後、秒） */
const POSE_WINDOW: Partial<Record<ActionType, { pose: Pose; before: number; after: number }>> = {
  serve: { pose: 'serve', before: 0.6, after: 0.25 },
  receive: { pose: 'receive', before: 0.5, after: 0.3 },
  dig: { pose: 'dig', before: 0.4, after: 0.35 },
  set: { pose: 'set', before: 0.35, after: 0.2 },
  spike: { pose: 'spike', before: 0.35, after: 0.3 },
  tip: { pose: 'tip', before: 0.35, after: 0.25 },
  block: { pose: 'block', before: 0.35, after: 0.35 },
  freeball: { pose: 'set', before: 0.3, after: 0.2 },
  cover: { pose: 'dig', before: 0.3, after: 0.3 },
  fakeJump: { pose: 'spike', before: 0.3, after: 0.1 },
};

export class Playback {
  private moves = new Map<string, MoveSeg[]>();
  private jumps = new Map<string, Extract<RallyEvent, { type: 'jump' }>[]>();
  private actions = new Map<string, Extract<RallyEvent, { type: 'action' }>[]>();

  constructor(public readonly rec: RallyRecord) {
    for (const pl of rec.placements) {
      this.moves.set(pl.playerId, []);
      this.jumps.set(pl.playerId, []);
      this.actions.set(pl.playerId, []);
    }
    // 移動は、前の移動の途中からでも次の移動に切り替わる
    const cur = new Map<string, MoveSeg>();
    for (const pl of rec.placements) cur.set(pl.playerId, { t: 0, from: pl.pos, to: pl.pos, dur: 0 });
    for (const e of rec.events) {
      if (e.type === 'move') {
        const prev = cur.get(e.playerId)!;
        const seg = { t: e.t, from: segAt(prev, e.t), to: e.to, dur: e.dur };
        this.moves.get(e.playerId)!.push(seg);
        cur.set(e.playerId, seg);
      } else if (e.type === 'jump') this.jumps.get(e.playerId)!.push(e);
      else if (e.type === 'action') this.actions.get(e.playerId)!.push(e);
    }
  }

  get duration(): number {
    return this.rec.duration;
  }

  frame(t: number): Frame {
    const players: PlayerFrame[] = this.rec.placements.map(pl => {
      const segs = this.moves.get(pl.playerId)!;
      let pos: Vec2 = pl.pos;
      for (let i = segs.length - 1; i >= 0; i--) {
        if (segs[i].t <= t) { pos = segAt(segs[i], t); break; }
      }
      let z = 0;
      for (const j of this.jumps.get(pl.playerId)!) {
        if (t >= j.t && t <= j.t + j.dur) {
          const s = (t - j.t) / j.dur;
          z = Math.max(z, j.height * 4 * s * (1 - s));
        }
      }
      let pose: Pose = 'ready';
      let poseT = 0;
      for (const a of this.actions.get(pl.playerId)!) {
        const w = POSE_WINDOW[a.action];
        if (!w) continue;
        if (t >= a.t - w.before && t <= a.t + w.after) {
          pose = w.pose;
          poseT = (t - (a.t - w.before)) / (w.before + w.after);
        }
      }
      return {
        id: pl.playerId, team: pl.team, number: pl.number, role: pl.role, height: pl.height / 100,
        x: pos.x, y: pos.y, z, pose, poseT,
      };
    });

    const { pos: ball, visible } = ballAt(this.rec.ball, t);
    let point: Frame['point'];
    let lastAttack: Frame['lastAttack'];
    for (const e of this.rec.events) {
      if (e.t > t) break;
      if (e.type === 'point') point = e;
      if (e.type === 'action' && (e.action === 'spike' || e.action === 'tip')) lastAttack = e;
    }
    return { t, players, ball, ballVisible: visible, point, lastAttack };
  }
}

function segAt(s: MoveSeg, t: number): Vec2 {
  if (s.dur <= 0) return t >= s.t ? s.to : s.from;
  const k = Math.min(1, Math.max(0, (t - s.t) / s.dur));
  // 走り出しと止まりを少しなめらかに
  const e = k * k * (3 - 2 * k);
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
    case 'tipKill': return `${who}のフェイント`;
    case 'blockKill': return `${who}のブロック`;
    case 'blockOut': return `${who}のブロックアウト`;
    case 'ace': return `${who}のサービスエース`;
    case 'serveFault': return `${who}のサーブミス`;
    case 'attackError': return `${who}のスパイクミス`;
    case 'receiveError': return `${who}のつなぎのミス`;
    case 'freeballDrop': return `${w}の得点（返球が落ちた）`;
  }
}
