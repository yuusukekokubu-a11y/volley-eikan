// 選手の人形に使う部品（影・背番号・頭でボールを追う・手の置き場所など）。

import * as THREE from 'three';
import type { MotionState } from './motion';
import { clampN } from './motion';
import type { Frame, PlayerFrame } from './playback';

/** 計算の座標 (x, y, z) → Three.js（y が上）の (x, z, -y) */
export const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);

export const BALL_R = 0.13;

export interface Figure {
  /** 足元（床またはジャンプの高さ）に置き、体の向きで回す */
  root: THREE.Group;
  shadow: THREE.Mesh;
  update(pl: PlayerFrame, ms: MotionState, fr: Frame): void;
}

export const SKIN = new THREE.MeshLambertMaterial({ color: '#f1c7a1' });

export function makeShadow(): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CircleGeometry(0.32, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

export function placeShadow(shadow: THREE.Mesh, pl: PlayerFrame, size = 1) {
  shadow.position.copy(v3(pl.x, pl.y, 0.01));
  const s = size * (1 - Math.min(0.4, pl.z * 0.3));
  shadow.scale.set(s, s, s);
}

/**
 * 記録の座標（コートの座標）を obj の座標に直す。選手とボールはコートチェンジで回す入れ物（userData.court）に
 * 入っているので、その入れ物の座標として世界座標に直してから obj の座標にする
 */
function courtToLocal(obj: THREE.Object3D, p: { x: number; y: number; z: number }): THREE.Vector3 {
  const w = v3(p.x, p.y, p.z);
  let c: THREE.Object3D | null = obj;
  while (c && !c.userData.court) c = c.parent;
  if (c) c.localToWorld(w);
  return obj.worldToLocal(w);
}

/** 頭がボールを目で追う（head は upper の子） */
export function trackHead(upper: THREE.Object3D, head: THREE.Object3D, fr: Frame) {
  if (!fr.ballVisible) return;
  const b = courtToLocal(upper, fr.ball);
  const d = b.sub(head.position);
  const yaw = clampN(Math.atan2(-d.z, d.x), -1.1, 1.1);
  const pitch = clampN(Math.atan2(d.y, Math.hypot(d.x, d.z)), -0.7, 0.9);
  head.rotation.set(0, yaw, pitch);
}

/**
 * 触る点（世界座標）を upper の座標に直し、ボールの表面に手が来るよう、肩の方へボールの半径だけ戻す。
 * side は左右の手の間隔（upper の z 方向）。
 */
export function handGoal(upper: THREE.Object3D, contact: { x: number; y: number; z: number }, from: THREE.Vector3, side: number): THREE.Vector3 {
  const g = courtToLocal(upper, contact);
  g.z += side;
  const back = from.clone().sub(g);
  const len = back.length();
  if (len > BALL_R) g.add(back.multiplyScalar(BALL_R / len));
  return g;
}

/** 手の間隔：ブロックは広く、トスは少し、レシーブは手を組む */
export function handSpread(action: string): number {
  return action === 'block' ? 0.18 : action === 'set' ? 0.08 : 0.04;
}

export function canvasTexture(w: number, h: number, paint: (c: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  paint(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function numberSprite(n: number, color: string, size: number): THREE.Sprite {
  const map = canvasTexture(64, 64, c => {
    c.fillStyle = color;
    c.beginPath(); c.arc(32, 32, 30, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fff';
    c.font = 'bold 38px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(String(n), 32, 34);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, depthTest: false }));
  s.scale.set(size, size, 1);
  return s;
}

/** 腰の高さをなめらかに寄せる */
export function smoothHip(cur: number | undefined, target: number, ms: MotionState): number {
  if (cur === undefined || ms.k === 0) return target;
  const k = 1 - Math.pow(1 - ms.k, 1.5);
  return cur + (target - cur) * k;
}
