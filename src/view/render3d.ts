// 簡易3D（Three.js）の描画。
// 計算の座標 (x, y, z) は Three.js では (x, z, -y) に置く（Three.js は y が上）。
// カメラはテレビ中継のように手前の横（y が負の側）の斜め上に置く。

import * as THREE from 'three';
import { COURT } from '../sim/constants';
import type { Gender } from '../sim/types';
import { TEAM_COLOR, type Renderer } from './common';
import type { Frame, PlayerFrame } from './playback';
import { armAngles, bodyShape } from './render2d';

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);

interface PlayerMesh {
  group: THREE.Group;
  body: THREE.Mesh;
  head: THREE.Group;
  armNear: THREE.Group;
  armFar: THREE.Group;
  shadow: THREE.Mesh;
  label: THREE.Sprite;
  height: number;
}

export class Render3D implements Renderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 2, 0.1, 200);
  private players = new Map<string, PlayerMesh>();
  private ball: THREE.Mesh;
  private ballShadow: THREE.Mesh;
  private net = new THREE.Group();

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
    const seen = new Set<string>();
    for (const pl of fr.players) {
      seen.add(pl.id);
      let m = this.players.get(pl.id);
      if (!m) {
        m = makePlayer(pl);
        this.players.set(pl.id, m);
        this.scene.add(m.group, m.shadow);
      }
      updatePlayer(m, pl);
    }
    for (const [id, m] of this.players) {
      if (!seen.has(id)) {
        this.scene.remove(m.group, m.shadow);
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
    for (const m of this.players.values()) this.scene.remove(m.group, m.shadow);
    this.players.clear();
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

function makePlayer(pl: PlayerFrame): PlayerMesh {
  const { body: radius, headR } = bodyShape(pl);
  const group = new THREE.Group();
  const color = TEAM_COLOR[pl.team][pl.role === 'L' ? 'libero' : 'main'];
  const bodyLen = Math.max(0.2, pl.height - headR * 2 - radius * 2);
  // 体：上半分がユニフォーム、下半分が少し暗い（パンツと脚）
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(radius, bodyLen, 6, 14), new THREE.MeshLambertMaterial({ color }));
  group.add(body);

  const head = new THREE.Group();
  const face = new THREE.Mesh(new THREE.SphereGeometry(headR, 16, 12), skin);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(headR * 1.03, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), hair);
  cap.position.y = 0.02;
  head.add(face, cap);
  group.add(head);

  const makeArm = () => {
    const pivot = new THREE.Group();
    const len = 0.62 * (pl.height / 1.8);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, len - 0.09, 4, 8), skin);
    arm.position.y = -len / 2;
    pivot.add(arm);
    return pivot;
  };
  const armNear = makeArm();
  const armFar = makeArm();
  group.add(armNear, armFar);

  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.32, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 }));
  shadow.rotation.x = -Math.PI / 2;

  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: numberTexture(pl.number, color), depthTest: false }));
  label.scale.set(0.42, 0.42, 1);
  group.add(label);

  // 向き：A は +x、B は -x を向く（体の前が +x になるように作ってある）
  group.rotation.y = pl.team === 'A' ? 0 : Math.PI;
  return { group, body, head, armNear, armFar, shadow, label, height: pl.height };
}

function updatePlayer(m: PlayerMesh, pl: PlayerFrame) {
  const { body: radius, headR, crouch } = bodyShape(pl);
  const h = m.height;
  m.group.position.copy(v3(pl.x, pl.y, pl.z));
  const bodyH = (h - headR * 2) * crouch;
  m.body.scale.y = crouch;
  m.body.position.y = bodyH / 2;
  m.head.position.y = bodyH + headR * 0.9;
  m.head.position.x = 0.03;
  const shoulderY = bodyH - 0.18;
  const [near, far] = armAngles(pl);
  // 腕は z 軸まわりに回す。0＝真下、π/2＝前（+x）、π＝真上
  m.armNear.position.set(0, shoulderY, radius + 0.04);
  m.armFar.position.set(0, shoulderY, -radius - 0.04);
  m.armNear.rotation.z = near;
  m.armFar.rotation.z = far;
  m.label.position.set(0, bodyH * 0.72, 0);
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
