import { describe, expect, it } from 'vitest';
import type { PlayerFrame } from '../src/view/playback';
import { hipHeight, targetJoints } from '../src/view/pose';

const base: PlayerFrame = {
  id: 'p', team: 'A', number: 1, role: 'OH', height: 1.85, x: 0, y: 0, z: 0,
  pose: 'ready', poseT: 0, speed: 0, jumpPhase: 'none', jumpT: 0,
};
const L = 1.85 * 0.47 / 2;

describe('人形のポーズ', () => {
  it('待機は軽く、レシーブの構えは深く膝を曲げて腰が低い', () => {
    const ready = targetJoints(base, 0);
    const recv = targetJoints({ ...base, pose: 'receive', poseT: 0.5 }, 0);
    expect(ready.kneeN).toBeGreaterThan(0.3);
    expect(recv.kneeN).toBeGreaterThan(ready.kneeN);
    expect(hipHeight(recv, L, L)).toBeLessThan(hipHeight(ready, L, L));
  });

  it('移動中は脚を交互に振る', () => {
    const a = targetJoints({ ...base, speed: 4 }, Math.PI / 2);
    expect(a.thighN).toBeGreaterThan(a.thighF);
    const b = targetJoints({ ...base, speed: 4 }, -Math.PI / 2);
    expect(b.thighN).toBeLessThan(b.thighF);
  });

  it('踏み込みで沈み、空中の真ん中で脚をたたみ、着地で沈む', () => {
    const prep = targetJoints({ ...base, jumpPhase: 'prep', jumpT: 1 }, 0);
    const air = targetJoints({ ...base, jumpPhase: 'air', jumpT: 0.5 }, 0);
    const takeoff = targetJoints({ ...base, jumpPhase: 'air', jumpT: 0 }, 0);
    const land = targetJoints({ ...base, jumpPhase: 'land', jumpT: 0.35 }, 0);
    const ready = targetJoints(base, 0);
    expect(prep.kneeN).toBeGreaterThan(ready.kneeN);
    expect(air.kneeN).toBeGreaterThan(takeoff.kneeN);
    expect(land.kneeN).toBeGreaterThan(ready.kneeN);
  });

  it('飛びつきでは体ごと前に倒れる', () => {
    const d = targetJoints({ ...base, pose: 'dive', poseT: 0.45 }, 0);
    expect(d.pitch).toBeGreaterThan(1);
  });

  it('動作の腕のポーズは脚のポーズと組み合わさる（ブロック中に空中で脚をたたむ）', () => {
    const j = targetJoints({ ...base, pose: 'block', poseT: 0.5, jumpPhase: 'air', jumpT: 0.5 }, 0);
    expect(j.armN).toBeGreaterThan(Math.PI * 0.9);
    expect(j.kneeN).toBeGreaterThan(1);
  });
});
