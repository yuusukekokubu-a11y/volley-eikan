// 試合の描画（簡易3D・Three.js）。
// 計算の座標 (x, y, z) は Three.js では (x, z, -y) に置く（Three.js は y が上）。
// カメラはテレビ中継のように手前の横（y が負の側）の斜め上に置く。

import * as THREE from 'three';
import { COURT } from '../sim/constants';
import type { Gender } from '../sim/types';
import { canvasTexture, v3, type Figure } from './figure';
import { FigureB } from './figureB';
import { Motion } from './motion';
import type { Frame, PlayerFrame } from './playback';

/** テレビ中継の角度のカメラ */
const TV_CAMERA = v3(-1.0, -25, 12);
const TV_LOOK = v3(0, 0.9, 1.6);
/** 確認用の追いかけるカメラ */
const FOLLOW_DIST = 6.5;
const FOLLOW_FOV = 42;

export type FollowView = 'side' | 'back' | 'front';

/** 人形を薄くする（確認用）。元の材質は覚えておいて戻せるようにする */
function setDim(fig: Figure, on: boolean) {
  const apply = (o: THREE.Object3D) => {
    const m = o as THREE.Mesh | THREE.Sprite;
    if (!m.material || Array.isArray(m.material)) return;
    const base = (m.userData.baseMat as THREE.Material | undefined) ?? m.material;
    m.userData.baseMat = base;
    if (on) {
      const c = base.clone();
      c.transparent = true;
      c.opacity = 0.15;
      c.depthWrite = false;
      m.material = c;
    } else m.material = base;
  };
  fig.root.traverse(apply);
  apply(fig.shadow);
}

interface PlayerView {
  motion: Motion;
  fig: Figure;
}

export class Render3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 2, 0.1, 200);
  private players = new Map<string, PlayerView>();
  private ball: THREE.Mesh;
  private ballShadow: THREE.Mesh;
  private net = new THREE.Group();
  private lastT = 0;
  /** 選手とボールの入れ物。コートチェンジの時はコートの中心で180度回す（記録の座標はそのまま） */
  private dyn = new THREE.Group();
  private size = { w: 844, h: 390 };
  /** 確認用：追いかける選手と見る角度、ほかの選手を薄くするか */
  private follow: { id: string; view: FollowView; dim: boolean } | null = null;
  private camLook = new THREE.Vector3();

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
    this.dyn.add(this.ball);
    this.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.16, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45 }));
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.dyn.add(this.ballShadow);
    // 選手とボールはまとめて動かす入れ物に入れる（コートチェンジで180度回す）
    this.dyn.userData.court = true;
    this.scene.add(this.dyn);

    this.camera.position.copy(TV_CAMERA);
    this.camera.lookAt(TV_LOOK);
  }

  setGender(g: Gender) {
    this.gender = g;
    this.net.clear();
    this.buildNet();
  }

  resize(w: number, h: number) {
    this.size = { w, h };
    this.renderer.setSize(w, h, true);
    this.camera.aspect = w / h;
    if (this.follow) {
      this.camera.fov = FOLLOW_FOV;
      this.camera.updateProjectionMatrix();
      return;
    }
    this.camera.position.copy(TV_CAMERA);
    this.camera.lookAt(TV_LOOK);
    // 横幅いっぱいに約23mが入るよう、縦の視野角を合わせる
    const halfW = 11.2;
    const dist = this.camera.position.distanceTo(TV_LOOK);
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
      let v = this.players.get(pl.id);
      if (!v) {
        v = { motion: new Motion(pl), fig: this.makeFigure(pl) };
        this.players.set(pl.id, v);
        this.dyn.add(v.fig.root, v.fig.shadow);
        setDim(v.fig, !!this.follow?.dim && this.follow.id !== pl.id);
      }
      const ms = v.motion.update(pl, snap ? 0 : dt, fr);
      v.fig.update(pl, ms, fr);
    }
    for (const [id, v] of this.players) {
      if (!seen.has(id)) {
        this.dyn.remove(v.fig.root, v.fig.shadow);
        this.players.delete(id);
      }
    }
    this.ball.visible = this.ballShadow.visible = fr.ballVisible;
    this.ball.position.copy(v3(fr.ball.x, fr.ball.y, fr.ball.z));
    this.ball.rotation.x = fr.t * 6;
    this.ballShadow.position.copy(v3(fr.ball.x, fr.ball.y, 0.012));
    const s = Math.max(0.5, 1 - fr.ball.z * 0.06);
    this.ballShadow.scale.set(s, s, s);
    if (this.follow) this.followCamera(fr, snap ? 0 : dt);
    this.renderer.render(this.scene, this.camera);
  }

  /** コートチェンジ：自チーム（赤）を右側のコートに見せる */
  setSwapped(on: boolean) {
    this.dyn.rotation.y = on ? Math.PI : 0;
  }

  /**
   * 確認用：1人の選手をカメラで追いかける（id が null なら中継の角度に戻す）。
   * view：side＝手前の横から、back＝後ろから、front＝前から。dim ならほかの選手を薄くする
   */
  setFollow(id: string | null, view: FollowView = 'side', dim = true) {
    this.follow = id ? { id, view, dim } : null;
    for (const [pid, v] of this.players) setDim(v.fig, !!this.follow?.dim && this.follow.id !== pid);
    this.lastT = -1; // 次の描画でカメラをそのまま合わせる
    this.resize(this.size.w, this.size.h);
  }

  private followCamera(fr: Frame, dt: number) {
    const f = this.follow!;
    const pl = fr.players.find(p => p.id === f.id);
    if (!pl) return;
    // コートチェンジで回している分を、カメラの位置にも反映する
    const k0 = this.dyn.rotation.y !== 0 ? -1 : 1;
    const forward = (pl.team === 'A' ? 1 : -1) * k0; // 相手コートの方向（x）
    const off = f.view === 'side' ? v3(0, -FOLLOW_DIST, 1.6)
      : f.view === 'back' ? v3(-forward * FOLLOW_DIST * 0.9, -1.8, 2.0)
      : v3(forward * FOLLOW_DIST * 0.9, -1.8, 2.0);
    // 下の操作ボタンに足元が隠れないよう、見る点を低めにして選手を画面の上寄りに映す
    const look = v3(pl.x * k0, pl.y * k0, pl.z + 0.45);
    const want = look.clone().add(off);
    const k = dt <= 0 ? 1 : 1 - Math.exp(-6 * dt);
    this.camera.position.lerp(want, k);
    this.camLook.lerp(look, k);
    if (dt <= 0) { this.camera.position.copy(want); this.camLook.copy(look); }
    this.camera.lookAt(this.camLook);
  }

  /** 選手が入れ替わった時（新しいラリー）に古い人形を消す */
  reset() {
    for (const v of this.players.values()) this.dyn.remove(v.fig.root, v.fig.shadow);
    this.players.clear();
    this.lastT = 0;
  }

  private makeFigure(pl: PlayerFrame): Figure {
    return new FigureB(pl);
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
