// 選手の人形：手足が浮いたデフォルメ体型。腕と脚はなく、手と靴が体から離れて浮いている。頭は大きめ、体は丸い。
// 手と靴の位置は、見えない腕・脚（pose.ts の関節の角度）の先として決める。触る瞬間、手は触る点へ直接置く。
// 身長差は体全体の大きさで見せる。顔は点の目だけの、特定のキャラクターに似せないシンプルなもの。

import * as THREE from 'three';
import { TEAM_COLOR } from './common';
import {
  SKIN, handGoal, handSpread, makeShadow, numberSprite, placeShadow, smoothHip, trackHead, v3, type Figure,
} from './figure';
import type { MotionState } from './motion';
import type { Frame, PlayerFrame } from './playback';
import { hipHeight } from './pose';

/** 人形の大きさ＝身長×この値。各部は人形の大きさ F に対する割合 */
const SCALE = 0.88;
const B = {
  thigh: 0.165, shin: 0.165,   // 見えない脚
  hipSide: 0.09,
  bodyY: 0.2, bodyR: [0.17, 0.22, 0.155] as const,  // 体（だ円体）の中心の高さ（腰から）と半径
  shortsY: 0.04, shortsR: [0.165, 0.1, 0.15] as const,
  headR: 0.17, neckGap: 0.01,
  shoulderY: 0.34, shoulderSide: 0.24, armLen: 0.27, // 見えない腕
  handR: 0.055,
  shoe: [0.085, 0.04, 0.05] as const,              // 靴（だ円体）の半径
};

const HAIR = new THREE.MeshLambertMaterial({ color: '#4a2f22' });
const EYE = new THREE.MeshBasicMaterial({ color: '#1b1b1b' });
const SHOE = new THREE.MeshLambertMaterial({ color: '#f6f6f6' });

function ellipsoid(r: readonly [number, number, number], mat: THREE.Material, seg = 18): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, seg, Math.round(seg * 0.7)), mat);
  m.scale.set(r[0], r[1], r[2]);
  return m;
}

export class FigureB implements Figure {
  root = new THREE.Group();
  shadow = makeShadow();
  private pitch = new THREE.Group();
  private upper = new THREE.Group();
  private head = new THREE.Group();
  private handN: THREE.Mesh;
  private handF: THREE.Mesh;
  private shoeN: THREE.Mesh;
  private shoeF: THREE.Mesh;
  private F: number;
  private hipY?: number;

  constructor(pl: PlayerFrame) {
    const F = (this.F = pl.height * SCALE);
    const s = (r: readonly [number, number, number]) => [r[0] * F, r[1] * F, r[2] * F] as const;
    const color = TEAM_COLOR[pl.team][pl.role === 'L' ? 'libero' : 'main'];
    const shirt = new THREE.MeshLambertMaterial({ color });
    const shorts = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.5) });

    this.root.add(this.pitch);
    this.pitch.add(this.upper);
    const shortsM = ellipsoid(s(B.shortsR), shorts);
    shortsM.position.y = B.shortsY * F;
    const body = ellipsoid(s(B.bodyR), shirt);
    body.position.y = B.bodyY * F;
    this.upper.add(shortsM, body);

    // 頭：大きめの球。髪は後ろ寄りにかぶせ、前に点の目を2つ
    const hr = B.headR * F;
    const face = new THREE.Mesh(new THREE.SphereGeometry(hr, 20, 16), SKIN);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(hr * 1.05, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.42), HAIR);
    hair.rotation.z = 0.35; // 前髪を上げて顔を見せる
    const eyeGeo = new THREE.SphereGeometry(hr * 0.12, 10, 8);
    for (const side of [1, -1]) {
      const eye = new THREE.Mesh(eyeGeo, EYE);
      eye.scale.set(0.6, 1.2, 1);
      eye.position.set(hr * 0.9, hr * 0.08, side * hr * 0.33);
      this.head.add(eye);
    }
    this.head.add(face, hair);
    this.head.position.set(0.01 * F, (B.bodyY + B.bodyR[1] + B.neckGap) * F + hr, 0);
    this.upper.add(this.head);

    const handGeo = new THREE.SphereGeometry(B.handR * F, 12, 10);
    this.handN = new THREE.Mesh(handGeo, SKIN);
    this.handF = new THREE.Mesh(handGeo, SKIN);
    this.upper.add(this.handN, this.handF);

    this.shoeN = ellipsoid(s(B.shoe), SHOE, 12);
    this.shoeF = ellipsoid(s(B.shoe), SHOE, 12);
    this.pitch.add(this.shoeN, this.shoeF);

    const label = numberSprite(pl.number, color, 0.36 * (F / 1.6));
    label.position.set(0, B.bodyY * F, 0);
    this.upper.add(label);
  }

  update(pl: PlayerFrame, ms: MotionState, fr: Frame) {
    const j = ms.j;
    const F = this.F;
    const thigh = B.thigh * F, shin = B.shin * F;
    this.root.position.copy(v3(pl.x, pl.y, pl.z));
    this.root.rotation.y = ms.yaw;
    // しゃがむ時は体が沈み、空中では靴を引き寄せる（腰の高さは保つ）
    this.hipY = smoothHip(this.hipY, ms.air ? thigh + shin : hipHeight(j, thigh, shin), ms);
    this.pitch.position.set(0, this.hipY, ms.sway);
    this.pitch.rotation.z = -j.pitch;

    // 靴：見えない脚の先
    const foot = (shoe: THREE.Mesh, t: number, k: number, side: number) => {
      shoe.position.set(
        thigh * Math.sin(t) + shin * Math.sin(t - k) + 0.02 * F,
        -(thigh * Math.cos(t) + shin * Math.cos(t - k)) + B.shoe[1] * F,
        side * B.hipSide * F,
      );
      shoe.rotation.z = (t - k) * 0.6;
    };
    foot(this.shoeN, j.thighN, j.kneeN, 1);
    foot(this.shoeF, j.thighF, j.kneeF, -1);

    this.upper.rotation.set(-ms.roll, ms.twist, -ms.lean);
    // 手：見えない腕の先（肘を曲げた分だけ腕が短くなる）
    const hand = (m: THREE.Mesh, angle: number, elbow: number, side: number) => {
      const a = angle + ms.lean;
      const len = B.armLen * F * (1 - 0.3 * Math.min(1, elbow / 1.5));
      m.position.set(len * Math.sin(a), B.shoulderY * F - len * Math.cos(a), side * B.shoulderSide * F);
    };
    hand(this.handN, j.armN, j.elbowN, 1);
    hand(this.handF, j.armF, j.elbowF, -1);
    this.root.updateMatrixWorld(true);
    trackHead(this.upper, this.head, fr);

    // 触る瞬間：手を触る点へ直接置く
    const c = pl.contact;
    if (c && c.w > 0.001) {
      const put = (m: THREE.Mesh, side: number) => {
        const from = new THREE.Vector3(0, B.shoulderY * F, Math.sign(side || 1) * B.shoulderSide * F);
        const g = handGoal(this.upper, c.pos, from, side);
        m.position.lerp(g, c.w);
      };
      if (c.hands === 'hit') put(this.handN, 0);
      else {
        const s = handSpread(c.action);
        put(this.handN, s);
        put(this.handF, -s);
      }
    }
    placeShadow(this.shadow, pl, F / 1.6);
  }
}
