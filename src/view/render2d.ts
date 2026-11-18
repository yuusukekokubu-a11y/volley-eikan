// 2D（擬似的な奥行き）の描画。Canvas 2D だけで描く。
// テレビ中継のように手前の横から斜め上に見下ろした形を、簡単な投影で表す：
//   奥（y が大きい）ほど少し小さく・上に、さらに少し右へずらしてネットを面として見せる。

import { COURT } from '../sim/constants';
import type { Gender } from '../sim/types';
import type { Frame, PlayerFrame } from './playback';
import { TEAM_COLOR, type Renderer } from './common';

const DEPTH_SHRINK = 0.22; // 一番奥での縮み
const DEPTH_RISE = 0.42;   // 奥行き1mあたり、画面で上に動く量（倍率）
const SHEAR = 0.12;        // 奥行き1mあたり、画面で右に動く量（倍率）
const VIEW_W = 20.5;       // 横に見せる幅（m）
const VIEW_H = 8.6;        // 縦に見せる高さ（m相当）

export class Render2D implements Renderer {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private s = 1;
  private cx = 0;
  private nearY = 0;

  constructor(private canvas: HTMLCanvasElement, private gender: Gender) {
    this.ctx = canvas.getContext('2d')!;
  }

  setGender(g: Gender) {
    this.gender = g;
  }

  resize(w: number, h: number) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w;
    this.h = h;
    this.s = Math.min(w / VIEW_W, h / VIEW_H);
    this.cx = w / 2 - 4.5 * SHEAR * this.s * 0.5;
    this.nearY = h - this.s * 0.45;
  }

  private f(y: number) {
    return 1 - DEPTH_SHRINK * ((y + 4.5) / 9);
  }

  /** 世界座標 → 画面座標と縮尺 */
  private p(x: number, y: number, z = 0): { x: number; y: number; k: number } {
    const d = y + 4.5;
    const k = this.f(y);
    const gy = this.nearY - d * this.s * DEPTH_RISE * (1 - (DEPTH_SHRINK / 2) * (d / 9));
    return { x: this.cx + x * this.s * k + d * this.s * SHEAR, y: gy - z * this.s * k, k };
  }

  draw(fr: Frame) {
    const c = this.ctx;
    c.fillStyle = '#2f5d8a';
    c.fillRect(0, 0, this.w, this.h);
    this.drawFloor();

    // 影（床に描くので先に）
    for (const pl of fr.players) {
      const q = this.p(pl.x, pl.y);
      const r = 0.32 * this.s * q.k * (1 - Math.min(0.4, pl.z * 0.3));
      ellipse(c, q.x, q.y, r, r * 0.35, 'rgba(0,0,0,0.28)');
    }
    if (fr.ballVisible) {
      const q = this.p(fr.ball.x, fr.ball.y);
      const r = 0.16 * this.s * q.k * Math.max(0.5, 1 - fr.ball.z * 0.06);
      ellipse(c, q.x, q.y, r, r * 0.4, 'rgba(0,0,0,0.45)');
    }

    // 奥から順に：選手・ネット・ボール
    type Item = { y: number; draw: () => void };
    const items: Item[] = fr.players.map(pl => ({ y: pl.y, draw: () => this.drawPlayer(pl) }));
    items.push({ y: 0.001, draw: () => this.drawNet() });
    if (fr.ballVisible) items.push({ y: fr.ball.y - 0.3, draw: () => this.drawBall(fr.ball.x, fr.ball.y, fr.ball.z) });
    items.sort((a, b) => b.y - a.y);
    for (const it of items) it.draw();
  }

  private drawFloor() {
    const c = this.ctx;
    const poly = (pts: [number, number][], fill: string) => {
      c.beginPath();
      pts.forEach(([x, y], i) => {
        const q = this.p(x, y);
        if (i) c.lineTo(q.x, q.y); else c.moveTo(q.x, q.y);
      });
      c.closePath();
      c.fillStyle = fill;
      c.fill();
    };
    poly([[-12.5, -6.5], [12.5, -6.5], [12.5, 7.5], [-12.5, 7.5]], '#3c7d5a');
    poly([[-9, -4.5], [9, -4.5], [9, 4.5], [-9, 4.5]], '#d9874a');
    const line = (x0: number, y0: number, x1: number, y1: number, w = 0.05) => {
      const a = this.p(x0, y0);
      const b = this.p(x1, y1);
      c.strokeStyle = '#fff';
      c.lineWidth = Math.max(1, w * this.s * a.k);
      c.beginPath();
      c.moveTo(a.x, a.y);
      c.lineTo(b.x, b.y);
      c.stroke();
    };
    line(-9, -4.5, 9, -4.5); line(-9, 4.5, 9, 4.5);
    line(-9, -4.5, -9, 4.5); line(9, -4.5, 9, 4.5);
    line(0, -4.5, 0, 4.5);
    line(-3, -4.5, -3, 4.5); line(3, -4.5, 3, 4.5);
  }

  private drawNet() {
    const c = this.ctx;
    const top = COURT.netHeight[this.gender];
    const bottom = top - 1;
    const y0 = -5.0;
    const y1 = 5.0;
    const a = this.p(0, y0, top), b = this.p(0, y1, top), d = this.p(0, y0, bottom), e = this.p(0, y1, bottom);
    // 支柱
    for (const y of [y0, y1]) {
      const g = this.p(0, y, 0), t = this.p(0, y, top + 0.1);
      c.strokeStyle = '#ddd';
      c.lineWidth = Math.max(2, 0.08 * this.s * g.k);
      c.beginPath(); c.moveTo(g.x, g.y); c.lineTo(t.x, t.y); c.stroke();
    }
    c.fillStyle = 'rgba(20,20,20,0.35)';
    c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineTo(e.x, e.y); c.lineTo(d.x, d.y); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.35)';
    c.lineWidth = 1;
    for (let i = 1; i < 10; i++) {
      const y = y0 + ((y1 - y0) * i) / 10;
      const u = this.p(0, y, top), v = this.p(0, y, bottom);
      c.beginPath(); c.moveTo(u.x, u.y); c.lineTo(v.x, v.y); c.stroke();
    }
    c.strokeStyle = '#fff';
    c.lineWidth = Math.max(2, 0.07 * this.s);
    c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(d.x, d.y); c.lineTo(e.x, e.y); c.stroke();
  }

  private drawBall(x: number, y: number, z: number) {
    const q = this.p(x, y, z);
    const r = Math.max(3, 0.13 * this.s * q.k);
    const c = this.ctx;
    c.fillStyle = '#ffe14d';
    c.beginPath(); c.arc(q.x, q.y, r, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#1d4fb8';
    c.lineWidth = Math.max(1, r * 0.35);
    c.beginPath(); c.arc(q.x, q.y, r * 0.65, -0.6, 1.6); c.stroke();
    c.strokeStyle = 'rgba(0,0,0,0.4)';
    c.lineWidth = 1;
    c.beginPath(); c.arc(q.x, q.y, r, 0, Math.PI * 2); c.stroke();
  }

  private drawPlayer(pl: PlayerFrame) {
    const c = this.ctx;
    const { body, headR, crouch } = bodyShape(pl);
    const foot = this.p(pl.x, pl.y, pl.z);
    const k = foot.k;
    const S = this.s * k;
    const hTop = (pl.height - headR * 2) * crouch; // 頭の下まで
    const top = { x: foot.x, y: foot.y - hTop * S };
    const halfW = body * S;
    const dir = pl.team === 'A' ? 1 : -1; // 向いている方向（画面の左右）

    // 腕（後ろ側）
    const shoulder = { x: top.x, y: top.y + 0.18 * S };
    const arms = armAngles(pl);
    const armLen = 0.62 * S * (pl.height / 1.8);
    const drawArm = (ang: number, width: number) => {
      // ang：0＝真下、π/2＝前、π＝真上
      const ex = shoulder.x + Math.sin(ang) * armLen * dir;
      const ey = shoulder.y + Math.cos(ang) * armLen;
      c.strokeStyle = skin;
      c.lineWidth = width;
      c.lineCap = 'round';
      c.beginPath(); c.moveTo(shoulder.x, shoulder.y); c.lineTo(ex, ey); c.stroke();
    };
    drawArm(arms[1], Math.max(2, 0.1 * S));

    // 体（カプセル）
    const col = TEAM_COLOR[pl.team][pl.role === 'L' ? 'libero' : 'main'];
    c.fillStyle = col;
    roundRect(c, foot.x - halfW, top.y, halfW * 2, foot.y - top.y, halfW);
    c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.35)';
    c.lineWidth = 1;
    c.stroke();
    // パンツの色で下半身を分ける
    c.fillStyle = 'rgba(0,0,0,0.25)';
    roundRect(c, foot.x - halfW, top.y + (foot.y - top.y) * 0.5, halfW * 2, (foot.y - top.y) * 0.5, halfW);
    c.fill();

    // 頭
    const hr = headR * S;
    c.fillStyle = skin;
    c.beginPath(); c.arc(top.x + dir * hr * 0.15, top.y - hr * 0.9, hr, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#222';
    c.beginPath(); c.arc(top.x + dir * hr * 0.15, top.y - hr * 1.15, hr * 0.92, Math.PI, Math.PI * 2); c.fill();

    // 腕（手前側）
    drawArm(arms[0], Math.max(2, 0.11 * S));

    // 背番号
    c.fillStyle = '#fff';
    c.font = `bold ${Math.max(9, Math.round(0.36 * S))}px system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(String(pl.number), foot.x, top.y + (foot.y - top.y) * 0.28);
  }
}

const skin = '#f1c7a1';

/** 体の太さ・頭の大きさ・かがみ具合 */
export function bodyShape(pl: PlayerFrame) {
  let crouch = 1;
  if (pl.pose === 'receive') crouch = 0.82;
  if (pl.pose === 'dig') crouch = 0.68;
  if (pl.pose === 'ready' && pl.z === 0) crouch = 0.94;
  return { body: 0.21, headR: 0.12, crouch };
}

/** 腕の角度 [手前の腕, 奥の腕]。0＝真下、π/2＝前、π＝真上 */
export function armAngles(pl: PlayerFrame): [number, number] {
  const t = pl.poseT;
  switch (pl.pose) {
    case 'spike': {
      // 振りかぶって（後ろ上）から前へ振り下ろす
      const a = t < 0.6 ? Math.PI * (1.25 - 0.1 * (t / 0.6)) : Math.PI * (1.15 - 0.7 * ((t - 0.6) / 0.4));
      return [a, Math.PI * 0.75];
    }
    case 'tip':
      return [Math.PI * 0.95, Math.PI * 0.6];
    case 'block':
      return [Math.PI * 0.97, Math.PI * 0.97];
    case 'set':
      return [Math.PI * 0.85, Math.PI * 0.85];
    case 'serve':
      return t < 0.5 ? [Math.PI * 0.4, Math.PI * 0.9] : [Math.PI * (1.2 - 0.5 * (t - 0.5) * 2), Math.PI * 0.5];
    case 'receive':
    case 'dig':
    case 'cover':
      return [Math.PI * 0.32, Math.PI * 0.32];
    default:
      return [Math.PI * 0.12, Math.PI * 0.12];
  }
}

function ellipse(c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string) {
  c.fillStyle = fill;
  c.beginPath();
  c.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
  c.fill();
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}

