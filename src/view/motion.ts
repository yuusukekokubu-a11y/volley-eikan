// 人形の動き（見た目とは分けてある）。
// 関節の角度（pose.ts）を時間でなめらかにつなぎ、体の向き・上体の傾き・ボールの方へのひねり・待機中の揺れを決める。
// 数値だけを返し、Three.js は使わない。

import type { Frame, PlayerFrame } from './playback';
import { blendJoints, targetJoints, type Joints } from './pose';

/** 待機中の足踏みの速さ（ラジアン/秒。2πで左右1回ずつ） */
const IDLE_STEP_RATE = 7.5;
/** 関節の動きを目標に寄せる速さ（1秒あたり） */
const BLEND_RATE = 14;
/** 体の向きを目標に寄せる速さ（1秒あたり） */
const FACE_RATE = 9;

export const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
export const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface MotionState {
  /** 関節の角度（待機中の揺れを含む） */
  j: Joints;
  /** 体の向き（世界座標の xy での角度） */
  yaw: number;
  /** 上体の前傾（＋で前）、横への傾き（＋で左＝世界の y 側へ）、ボールの方へのひねり（＋で左へ） */
  lean: number;
  roll: number;
  twist: number;
  /** 待機中で止まっている */
  still: boolean;
  /** 腰の左右の揺れ（m、待機中のみ） */
  sway: number;
  /** 空中にいる（脚をたたんでも腰の高さを保つ） */
  air: boolean;
  /** なめらかにつなぐための係数（1フレーム分）。0 は「そのまま合わせる」 */
  k: number;
  /** 走る脚の振りの位相と、走りの強さ（0〜1.2。止まっている・跳んでいる時は0） */
  runPhase: number;
  runAmt: number;
  /** 待機中の足踏み・体の揺れの位相（選手ごとにずれる） */
  idlePhase: number;
}

export class Motion {
  private joints?: Joints;
  private runPhase = 0;
  yaw: number;
  private idle: number;

  constructor(pl: PlayerFrame) {
    this.yaw = pl.team === 'A' ? 0 : Math.PI;
    let h = 0;
    for (const ch of pl.id) h = (h * 31 + ch.charCodeAt(0)) % 1000;
    this.idle = h / 159;
  }

  update(pl: PlayerFrame, dt: number, fr: Frame): MotionState {
    // 走る脚の振り：進んだ距離で位相を進める。速いほど歩幅が大きい
    const stride = 0.55 + 0.17 * pl.speed;
    this.runPhase += (pl.speed * dt * Math.PI) / stride;
    const target = targetJoints(pl, this.runPhase);
    const k = dt === 0 ? 0 : 1 - Math.exp(-BLEND_RATE * dt);
    this.joints = !this.joints || dt === 0 ? target : blendJoints(this.joints, target, k);
    const j = { ...this.joints };

    // 体の向き
    const want = desiredYaw(this.yaw, pl, fr);
    this.yaw = dt === 0 ? want : this.yaw + wrap(want - this.yaw) * (1 - Math.exp(-FACE_RATE * dt));
    const cos = Math.cos(this.yaw), sin = Math.sin(this.yaw);

    // 加速で前傾、減速で後ろに重心。横への加速では内側へ傾く
    const fwdAcc = pl.ax * cos + pl.ay * sin;
    const sideAcc = -pl.ax * sin + pl.ay * cos;
    let lean = j.lean + clampN(fwdAcc * 0.05, -0.32, 0.32);
    const roll = clampN(sideAcc * 0.035, -0.2, 0.2);

    // 待機中もわずかに重心を揺らす
    const still = pl.pose === 'ready' && pl.speed < 0.3 && pl.jumpPhase === 'none';
    let sway = 0;
    if (still) {
      lean += 0.03 * Math.sin(fr.t * 1.7 + this.idle);
      const bob = 0.07 * Math.sin(fr.t * 2.3 + this.idle * 1.3);
      j.kneeN += bob; j.kneeF += bob; j.thighN += bob * 0.5; j.thighF += bob * 0.5;
      sway = 0.015 * Math.sin(fr.t * 1.1 + this.idle);
    }

    // 上体をボールの方へ少しひねる
    let twist = 0;
    if (fr.ballVisible) {
      const rel = wrap(Math.atan2(fr.ball.y - pl.y, fr.ball.x - pl.x) - this.yaw);
      twist = clampN(rel * 0.3, -0.45, 0.45);
    }
    const running = pl.speed > 0.5 && pl.jumpPhase === 'none' && pl.pose !== 'dive';
    const runAmt = running ? Math.min(1.2, pl.speed / 4.5) : 0;
    return { j, yaw: this.yaw, lean, roll, twist, still, sway, air: pl.jumpPhase === 'air', k, runPhase: this.runPhase, runAmt, idlePhase: fr.t * IDLE_STEP_RATE + this.idle * 2.1 };
  }
}

/** 体の向き：動作の向き → 速く走っている時は進む方向 → それ以外はボールの方 */
function desiredYaw(cur: number, pl: PlayerFrame, fr: Frame): number {
  const forward = pl.team === 'A' ? 0 : Math.PI;
  const toward = (x: number, y: number) => Math.atan2(y - pl.y, x - pl.x);
  if (pl.faceTo) {
    const a = toward(pl.faceTo.x, pl.faceTo.y);
    // 受けるボールには少しだけ横を向く（体は相手コート寄りのまま）
    if (pl.pose === 'receive' || pl.pose === 'dig' || pl.pose === 'cover') return forward + wrap(a - forward) * 0.55;
    return a;
  }
  if (pl.speed > 2.0) return Math.atan2(pl.vy, pl.vx);
  if (fr.ballVisible && Math.hypot(fr.ball.x - pl.x, fr.ball.y - pl.y) > 0.5) return toward(fr.ball.x, fr.ball.y);
  return cur;
}
