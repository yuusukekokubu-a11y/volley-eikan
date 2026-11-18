// 見た目A：肘付き。体（カプセル）・頭・腕（上腕＋前腕＋手）・脚（太もも＋すね＋靴）。
// 触る瞬間は、触る点から肩と肘の角度を逆算して手を合わせる（腕の長さは変えない）。

import * as THREE from 'three';
import { TEAM_COLOR } from './common';
import {
  DOWN, SKIN, handGoal, handSpread, makeShadow, numberSprite, placeShadow, smoothHip, trackHead, v3, type Figure,
} from './figure';
import type { MotionState } from './motion';
import type { Frame, PlayerFrame } from './playback';
import { hipHeight } from './pose';

/** 体の寸法（身長 h に対する割合など） */
const BODY = {
  legRatio: 0.47,      // 腰の高さ（脚の長さ）／身長
  headR: 0.12,
  neck: 0.05,
  torsoR: 0.17,
  thighR: 0.085,
  shinR: 0.06,
  hipHalfW: 0.1,
  upperArmRatio: 0.215,
  foreArmRatio: 0.245, // 前腕＋手
  upperArmR: 0.05,
  foreArmR: 0.04,
  handR: 0.05,
};

const HAIR = new THREE.MeshLambertMaterial({ color: '#222222' });
const SHOE = new THREE.MeshLambertMaterial({ color: '#f4f4f4' });

/** 長さ len のカプセルを、親の原点から下（-y）に向けて置く */
function limb(len: number, r: number, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.01, len - r * 2), 4, 10), mat);
  m.position.y = -len / 2;
  return m;
}

interface Arm { shoulder: THREE.Group; elbow: THREE.Group; side: number }

const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();

export class FigureA implements Figure {
  root = new THREE.Group();
  shadow = makeShadow();
  private pitch = new THREE.Group();
  private upper = new THREE.Group();
  private head = new THREE.Group();
  private armN: Arm;
  private armF: Arm;
  private thighN!: THREE.Group;
  private kneeN!: THREE.Group;
  private thighF!: THREE.Group;
  private kneeF!: THREE.Group;
  private thigh: number;
  private shin: number;
  private ua: number;
  private fa: number;
  private hipY?: number;

  constructor(pl: PlayerFrame) {
    const h = pl.height;
    const color = TEAM_COLOR[pl.team][pl.role === 'L' ? 'libero' : 'main'];
    const shirt = new THREE.MeshLambertMaterial({ color });
    const shorts = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.45) });
    const legLen = h * BODY.legRatio;
    this.thigh = legLen * 0.5;
    this.shin = legLen * 0.5;
    const torsoLen = h - legLen - BODY.headR * 2 - BODY.neck;
    this.ua = h * BODY.upperArmRatio;
    this.fa = h * BODY.foreArmRatio;

    this.root.add(this.pitch);
    const hips = new THREE.Mesh(new THREE.CapsuleGeometry(BODY.torsoR * 0.95, 0.12, 4, 12), shorts);
    hips.position.y = 0.04;
    this.pitch.add(hips, this.upper);

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(BODY.torsoR, Math.max(0.05, torsoLen - BODY.torsoR * 2), 6, 14), shirt);
    torso.position.y = torsoLen / 2 + 0.04;
    this.upper.add(torso);
    const face = new THREE.Mesh(new THREE.SphereGeometry(BODY.headR, 16, 12), SKIN);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(BODY.headR * 1.03, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), HAIR);
    cap.position.y = 0.02;
    this.head.add(face, cap);
    this.head.position.set(0.02, torsoLen + BODY.neck + BODY.headR, 0);
    this.upper.add(this.head);

    const makeArm = (side: number): Arm => {
      const shoulder = new THREE.Group();
      shoulder.position.set(0, torsoLen - 0.08, side * (BODY.torsoR + 0.05));
      shoulder.add(limb(this.ua, BODY.upperArmR, shirt));
      const elbow = new THREE.Group();
      elbow.position.y = -this.ua;
      elbow.add(limb(this.fa - BODY.handR, BODY.foreArmR, SKIN));
      const hand = new THREE.Mesh(new THREE.SphereGeometry(BODY.handR, 10, 8), SKIN);
      hand.position.y = -(this.fa - BODY.handR);
      elbow.add(hand);
      shoulder.add(elbow);
      this.upper.add(shoulder);
      return { shoulder, elbow, side };
    };
    this.armN = makeArm(1);
    this.armF = makeArm(-1);

    const label = numberSprite(pl.number, color, 0.4);
    label.position.set(0, torsoLen * 0.6, 0);
    this.upper.add(label);

    const makeLeg = (side: number) => {
      const hip = new THREE.Group();
      hip.position.set(0, 0, side * BODY.hipHalfW);
      hip.add(limb(this.thigh, BODY.thighR, shorts));
      const knee = new THREE.Group();
      knee.position.y = -this.thigh;
      knee.add(limb(this.shin, BODY.shinR, SKIN));
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.09), SHOE);
      foot.position.set(0.04, -this.shin + 0.02, 0);
      knee.add(foot);
      hip.add(knee);
      this.pitch.add(hip);
      return { hip, knee };
    };
    const ln = makeLeg(1);
    const lf = makeLeg(-1);
    this.thighN = ln.hip; this.kneeN = ln.knee; this.thighF = lf.hip; this.kneeF = lf.knee;
  }

  update(pl: PlayerFrame, ms: MotionState, fr: Frame) {
    const j = ms.j;
    this.root.position.copy(v3(pl.x, pl.y, pl.z));
    this.root.rotation.y = ms.yaw;
    // 床では低い方の足が床に着く。空中では脚をたたんでも腰の高さを保つ
    this.hipY = smoothHip(this.hipY, ms.air ? this.thigh + this.shin : hipHeight(j, this.thigh, this.shin), ms);
    this.pitch.position.set(0, this.hipY, ms.sway);
    this.pitch.rotation.z = -j.pitch;
    this.thighN.rotation.z = j.thighN;
    this.kneeN.rotation.z = -j.kneeN;
    this.thighF.rotation.z = j.thighF;
    this.kneeF.rotation.z = -j.kneeF;
    // Three.js の z 軸まわりは＋で体の前（+x）から上へ。前へ倒すのはマイナス。y 軸まわりは＋で左へ
    this.upper.rotation.set(-ms.roll, ms.twist, -ms.lean);
    // 腕は上体の前傾を打ち消して、体の向きに対する角度にする
    this.armN.shoulder.rotation.set(0, 0, j.armN + ms.lean);
    this.armF.shoulder.rotation.set(0, 0, j.armF + ms.lean);
    this.armN.elbow.rotation.set(0, 0, j.elbowN);
    this.armF.elbow.rotation.set(0, 0, j.elbowF);
    this.root.updateMatrixWorld(true);
    trackHead(this.upper, this.head, fr);

    const c = pl.contact;
    if (c && c.w > 0.001) {
      if (c.hands === 'hit') this.reach(this.armN, c.pos, 0, c.w);
      else {
        const s = handSpread(c.action);
        this.reach(this.armN, c.pos, s, c.w);
        this.reach(this.armF, c.pos, -s, c.w);
      }
    }
    placeShadow(this.shadow, pl);
  }

  /**
   * 2つの骨（上腕・前腕）の長さを変えずに、手を触る点へ合わせる。
   * 肘は下・後ろ・外側へ逃がす（肘の向きを決める補助の方向 pole）。
   */
  private reach(arm: Arm, contact: { x: number; y: number; z: number }, side: number, w: number) {
    const S = arm.shoulder.position.clone();
    const T = handGoal(this.upper, contact, S, side);
    const a = this.ua, b = this.fa;
    const D = T.clone().sub(S);
    const d = D.length();
    if (d < 1e-4) return;
    const dir = D.multiplyScalar(1 / d);
    const dc = Math.min(Math.max(d, Math.abs(a - b) + 1e-3), a + b - 1e-3);
    const cosA = (a * a + dc * dc - b * b) / (2 * a * dc);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const pole = new THREE.Vector3(-0.5, -1, arm.side * 0.7);
    const n = pole.sub(dir.clone().multiplyScalar(pole.dot(dir)));
    if (n.lengthSq() < 1e-6) n.set(0, 0, arm.side);
    n.normalize();
    const E = S.clone().add(dir.clone().multiplyScalar(a * cosA)).add(n.multiplyScalar(a * sinA));
    const H = S.clone().add(dir.clone().multiplyScalar(dc));
    const qUpper = new THREE.Quaternion().setFromUnitVectors(DOWN, E.clone().sub(S).normalize());
    const foreDir = H.sub(E).normalize().applyQuaternion(qUpper.clone().invert());
    const qFore = new THREE.Quaternion().setFromUnitVectors(DOWN, foreDir);
    tmpQ.copy(arm.shoulder.quaternion).slerp(qUpper, w);
    tmpQ2.copy(arm.elbow.quaternion).slerp(qFore, w);
    arm.shoulder.quaternion.copy(tmpQ);
    arm.elbow.quaternion.copy(tmpQ2);
  }
}
