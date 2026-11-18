// 試合の描画（簡易3D・Three.js）。
// 計算の座標 (x, y, z) は Three.js では (x, z, -y) に置く（Three.js は y が上）。
// カメラはテレビ中継のように手前の横（y が負の側）の斜め上に置く。

import * as THREE from 'three';
import { COURT } from '../sim/constants';
import type { Gender } from '../sim/types';
import { TEAM_COLOR } from './common';
import type { Frame, PlayerFrame } from './playback';
import { blendJoints, hipHeight, targetJoints, type Joints } from './pose';

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);

/** 体の寸法（身長 h に対する割合など） */
const BODY = {
  legRatio: 0.47,   // 腰の高さ（脚の長さ）／身長
  headR: 0.12,
  neck: 0.05,
  torsoR: 0.17,
  thighR: 0.085,
  shinR: 0.06,
  hipHalfW: 0.1,    // 腰の中心から脚の付け根までの横幅
  armLenRatio: 0.34,
};

interface PlayerMesh {
  root: THREE.Group;    // 足元（床またはジャンプの高さ）
  pitch: THREE.Group;   // 腰を軸に体ごと倒れる
  upper: THREE.Group;   // 上体（前傾）
  armN: THREE.Group;
  armF: THREE.Group;
  thighN: THREE.Group;
  kneeN: THREE.Group;
  thighF: THREE.Group;
  kneeF: THREE.Group;
  shadow: THREE.Mesh;
  thigh: number;
  shin: number;
  joints?: Joints;
  runPhase: number;
}

/** 関節の動きを目標に寄せる速さ（1秒あたり） */
const BLEND_RATE = 14;

export class Render3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 2, 0.1, 200);
  private players = new Map<string, PlayerMesh>();
  private ball: THREE.Mesh;
  private ballShadow: THREE.Mesh;
  private net = new THREE.Group();
  private lastT = 0;

  constructor(canvas: HTMLCanvasElement, private gender: Gender) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene.background = new THREE.Color('#2f5d8a');

    this.scene.add(new THREE.HemisphereLight('#ffffff', '#556070', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 1.4);
    sun.position.set(-6, 14, 8);
    this.scene.add(sun);

    this.buildCourt();
    this.scene.add(this.net);
    this.buildNet();

    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), new THREE.MeshLambertMaterial({ map: ballTexture() }));
    this.scene.add(this.ball);
    this.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.16, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45 }));
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.ballShadow);

    this.camera.position.copy(v3(-1.0, -25, 12));
    this.camera.lookAt(v3(0, 0.9, 1.6));
  }

  setGender(g: Gender) {
    this.gender = g;
    this.net.clear();
    this.buildNet();
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, true);
    this.camera.aspect = w / h;
    // 横幅いっぱいに約23mが入るよう、縦の視野角を合わせる
    const halfW = 11.2;
    const dist = this.camera.position.distanceTo(v3(0, 0.9, 1.6));
    const vfov = 2 * Math.atan(halfW / this.camera.aspect / dist) * (180 / Math.PI);
    this.camera.fov = Math.max(22, vfov);
    this.camera.updateProjectionMatrix();
  }

  draw(fr: Frame) {
    // 再生の時間の進み（速度の倍率込み）。大きく飛んだ時はなめらかにせずそのまま合わせる
    const dt = fr.t - this.lastT;
    this.lastT = fr.t;
    const snap = dt < 0 || dt > 0.5;
    const seen = new Set<string>();
    for (const pl of fr.players) {
      seen.add(pl.id);
      let m = this.players.get(pl.id);
      if (!m) {
        m = makePlayer(pl);
        this.players.set(pl.id, m);
        this.scene.add(m.root, m.shadow);
      }
      updatePlayer(m, pl, snap ? 0 : dt);
    }
    for (const [id, m] of this.players) {
      if (!seen.has(id)) {
        this.scene.remove(m.root, m.shadow);
        this.players.delete(id);
      }
    }
    this.ball.visible = this.ballShadow.visible = fr.ballVisible;
    this.ball.position.copy(v3(fr.ball.x, fr.ball.y, fr.ball.z));
    this.ball.rotation.x = fr.t * 6;
    this.ballShadow.position.copy(v3(fr.ball.x, fr.ball.y, 0.012));
    const s = Math.max(0.5, 1 - fr.ball.z * 0.06);
    this.ballShadow.scale.set(s, s, s);
    this.renderer.render(this.scene, this.camera);
  }

  /** 選手が入れ替わった時（新しいラリー）に古い人形を消す */
  reset() {
    for (const m of this.players.values()) this.scene.remove(m.root, m.shadow);
    this.players.clear();
    this.lastT = 0;
  }

  private buildCourt() {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(26, 15), new THREE.MeshLambertMaterial({ color: '#3c7d5a' }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.copy(v3(0, 0.5, -0.01));
    this.scene.add(floor);
    const court = new THREE.Mesh(new THREE.PlaneGeometry(18, 9), new THREE.MeshLambertMaterial({ color: '#d9874a' }));
    court.rotation.x = -Math.PI / 2;
    this.scene.add(court);
    const lineMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const line = (x0: number, y0: number, x1: number, y1: number) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len + 0.05, 0.05), lineMat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = Math.atan2(y1 - y0, x1 - x0);
      m.position.copy(v3((x0 + x1) / 2, (y0 + y1) / 2, 0.005));
      this.scene.add(m);
    };
    line(-9, -4.5, 9, -4.5); line(-9, 4.5, 9, 4.5);
    line(-9, -4.5, -9, 4.5); line(9, -4.5, 9, 4.5);
    line(0, -4.5, 0, 4.5); line(-3, -4.5, -3, 4.5); line(3, -4.5, 3, 4.5);
  }

  private buildNet() {
    const top = COURT.netHeight[this.gender];
    const width = 10;
    const netMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, 1),
      new THREE.MeshBasicMaterial({ map: netTexture(), transparent: true, side: THREE.DoubleSide, depthWrite: false }),
    );
    netMesh.rotation.y = Math.PI / 2;
    netMesh.position.copy(v3(0, 0, top - 0.5));
    this.net.add(netMesh);
    const tape = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.07, width), new THREE.MeshLambertMaterial({ color: '#ffffff' }));
    tape.position.copy(v3(0, 0, top - 0.035));
    this.net.add(tape);
    for (const y of [-5, 5]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, top + 0.15, 10), new THREE.MeshLambertMaterial({ color: '#dddddd' }));
      post.position.copy(v3(0, y, (top + 0.15) / 2));
      this.net.add(post);
    }
  }
}

const skin = new THREE.MeshLambertMaterial({ color: '#f1c7a1' });
const hair = new THREE.MeshLambertMaterial({ color: '#222222' });

const shoe = new THREE.MeshLambertMaterial({ color: '#f4f4f4' });

/** 長さ len のカプセルを、親の原点から下（-y）に向けて置く */
function limb(len: number, r: number, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.01, len - r * 2), 4, 10), mat);
  m.position.y = -len / 2;
  return m;
}

function makePlayer(pl: PlayerFrame): PlayerMesh {
  const h = pl.height;
  const color = TEAM_COLOR[pl.team][pl.role === 'L' ? 'libero' : 'main'];
  const shirt = new THREE.MeshLambertMaterial({ color });
  const shorts = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.45) });

  const legLen = h * BODY.legRatio;
  const thigh = legLen * 0.5;
  const shin = legLen * 0.5;
  const torsoLen = h - legLen - BODY.headR * 2 - BODY.neck;

  const root = new THREE.Group();
  const pitch = new THREE.Group();
  root.add(pitch);

  // 腰（パンツ）
  const hips = new THREE.Mesh(new THREE.CapsuleGeometry(BODY.torsoR * 0.95, 0.12, 4, 12), shorts);
  hips.position.y = 0.04;
  pitch.add(hips);

  // 上体
  const upper = new THREE.Group();
  pitch.add(upper);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(BODY.torsoR, Math.max(0.05, torsoLen - BODY.torsoR * 2), 6, 14), shirt);
  torso.position.y = torsoLen / 2 + 0.04;
  upper.add(torso);
  const head = new THREE.Group();
  const face = new THREE.Mesh(new THREE.SphereGeometry(BODY.headR, 16, 12), skin);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(BODY.headR * 1.03, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), hair);
  cap.position.y = 0.02;
  head.add(face, cap);
  head.position.set(0.02, torsoLen + BODY.neck + BODY.headR, 0);
  upper.add(head);

  const armLen = h * BODY.armLenRatio;
  const makeArm = (side: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(0, torsoLen - 0.08, side * (BODY.torsoR + 0.045));
    pivot.add(limb(armLen, 0.045, skin));
    upper.add(pivot);
    return pivot;
  };
  const armN = makeArm(1);
  const armF = makeArm(-1);

  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: numberTexture(pl.number, color), depthTest: false }));
  label.scale.set(0.4, 0.4, 1);
  label.position.set(0, torsoLen * 0.6, 0);
  upper.add(label);

  // 脚：太もも → 膝 → すね → 靴
  const makeLeg = (side: number) => {
    const hip = new THREE.Group();
    hip.position.set(0, 0, side * BODY.hipHalfW);
    hip.add(limb(thigh, BODY.thighR, shorts));
    const knee = new THREE.Group();
    knee.position.y = -thigh;
    knee.add(limb(shin, BODY.shinR, skin));
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.09), shoe);
    foot.position.set(0.04, -shin + 0.02, 0);
    knee.add(foot);
    hip.add(knee);
    pitch.add(hip);
    return { hip, knee };
  };
  const ln = makeLeg(1);
  const lf = makeLeg(-1);

  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.32, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 }));
  shadow.rotation.x = -Math.PI / 2;

  // 向き：A は +x、B は -x を向く（体の前が +x になるように作ってある）
  root.rotation.y = pl.team === 'A' ? 0 : Math.PI;
  return {
    root, pitch, upper, armN, armF, thighN: ln.hip, kneeN: ln.knee, thighF: lf.hip, kneeF: lf.knee, shadow,
    thigh, shin, runPhase: 0,
  };
}

function updatePlayer(m: PlayerMesh, pl: PlayerFrame, dt: number) {
  // 走る脚の振りは、進んだ距離で位相を進める（歩幅 約1.6m で1周）
  m.runPhase += (pl.speed * dt * Math.PI * 2) / 1.6;
  const target = targetJoints(pl, m.runPhase);
  m.joints = !m.joints || dt === 0 ? target : blendJoints(m.joints, target, 1 - Math.exp(-BLEND_RATE * dt));
  const j = m.joints;

  m.root.position.copy(v3(pl.x, pl.y, pl.z));
  m.pitch.position.y = hipHeight(j, m.thigh, m.shin);
  // Three.js の z 軸まわりの回転は、＋で体の前（+x）から上へ。前へ倒すのはマイナス
  m.pitch.rotation.z = -j.pitch;
  m.upper.rotation.z = -j.lean;
  m.thighN.rotation.z = j.thighN;
  m.kneeN.rotation.z = -j.kneeN;
  m.thighF.rotation.z = j.thighF;
  m.kneeF.rotation.z = -j.kneeF;
  // 腕は上体の前傾を打ち消して、体の向きに対する角度にする
  m.armN.rotation.z = j.armN + j.lean;
  m.armF.rotation.z = j.armF + j.lean;

  m.shadow.position.copy(v3(pl.x, pl.y, 0.01));
  const s = 1 - Math.min(0.4, pl.z * 0.3);
  m.shadow.scale.set(s, s, s);
}

function canvasTexture(w: number, h: number, paint: (c: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  paint(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function numberTexture(n: number, color: string) {
  return canvasTexture(64, 64, c => {
    c.fillStyle = color;
    c.beginPath(); c.arc(32, 32, 30, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fff';
    c.font = 'bold 38px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(String(n), 32, 34);
  });
}

function netTexture() {
  const t = canvasTexture(512, 52, c => {
    c.fillStyle = 'rgba(20,20,20,0.35)';
    c.fillRect(0, 0, 512, 52);
    c.strokeStyle = 'rgba(255,255,255,0.45)';
    c.lineWidth = 1;
    for (let x = 0; x <= 512; x += 6) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 52); c.stroke(); }
    for (let y = 0; y <= 52; y += 6) { c.beginPath(); c.moveTo(0, y); c.lineTo(512, y); c.stroke(); }
  });
  return t;
}

function ballTexture() {
  return canvasTexture(128, 64, c => {
    c.fillStyle = '#ffe14d';
    c.fillRect(0, 0, 128, 64);
    c.fillStyle = '#1d4fb8';
    for (let i = 0; i < 3; i++) c.fillRect(0, 8 + i * 20, 128, 8);
  });
}
