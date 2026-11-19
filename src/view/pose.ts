// 選手の人形の関節の角度を決める。描画（Three.js）とは切り離してあり、角度の数値だけを返す。
// 角度はラジアン。体の前（向いている方向）へ振るのを＋とする。
//   脚・腕：0＝真下にまっすぐ、＋で前へ振る（腕は π で真上）
//   膝：0＝まっすぐ、＋で曲げる（すねが後ろへ）
//   肘：0＝まっすぐ、＋で曲げる（前腕が体の前へ）
//   lean：上体の前傾、pitch：体ごと前に倒れる（飛びつき）

import type { PlayerFrame } from './playback';

export interface Joints {
  pitch: number;
  lean: number;
  thighN: number;
  kneeN: number;
  thighF: number;
  kneeF: number;
  armN: number;
  armF: number;
  elbowN: number;
  elbowF: number;
}

const PI = Math.PI;

/** 決まったポーズ（脚と上体） */
export const LEG_POSES = {
  ready: { thigh: 0.35, knee: 0.65, lean: 0.15 },     // 待機：軽く膝を曲げる
  receive: { thigh: 1.05, knee: 1.6, lean: 0.5 },     // レシーブの構え：深く腰を落とす
  prep: { thigh: 0.95, knee: 1.5, lean: 0.45 },       // 踏み込み
  airTucked: { thigh: 0.75, knee: 1.5, lean: 0.05 },  // 空中で脚をたたんだ形
  airStraight: { thigh: 0.15, knee: 0.3, lean: 0.05 },// 踏み切り直後・着地直前
  land: { thigh: 0.95, knee: 1.4, lean: 0.35 },       // 着地で膝が沈んだ形
  dive: { thigh: -0.15, knee: 0.35, lean: 0.15 },     // 飛びつき（体ごと前に倒れる）
};

const mix = (a: number, b: number, k: number) => a + (b - a) * k;
/** 踏み切り前に腕を後ろへ引いた角度 */
const ARM_BACK = -PI * 0.6;
const smooth = (k: number) => {
  const c = Math.min(1, Math.max(0, k));
  return c * c * (3 - 2 * c);
};

/** 腕の角度 [手前の腕, 奥の腕]。動作の腕のポーズ（スパイクの腕振り・ブロック・トスなど） */
export function armAngles(pl: PlayerFrame): [number, number] | undefined {
  const t = pl.poseT;
  switch (pl.pose) {
    case 'spike': {
      // 振りかぶって（後ろ上）から前へ振り下ろす
      const a = t < 0.6 ? PI * (1.25 - 0.1 * (t / 0.6)) : PI * (1.15 - 0.7 * ((t - 0.6) / 0.4));
      return [a, PI * 0.75];
    }
    case 'tip':
      return [PI * 0.95, PI * 0.6];
    case 'toss':
      // サーブトス：奥の手（ボールを持つ手）で上へ放り上げる
      return [PI * 0.2, PI * (0.5 + 0.45 * smooth(t / 0.5))];
    case 'block':
      return [PI * 0.97, PI * 0.97];
    case 'set':
      return [PI * 0.85, PI * 0.85];
    case 'dump':
      // ツーアタック：トスの構えから、手前の手だけを伸ばして押し込む
      return t < 0.5 ? [PI * 0.85, PI * 0.85] : [PI * 0.95, PI * 0.6];
    case 'serve':
      return t < 0.5 ? [PI * 0.4, PI * 0.9] : [PI * (1.2 - 0.5 * (t - 0.5) * 2), PI * 0.5];
    case 'receive':
    case 'dig':
    case 'cover':
      return [PI * 0.32, PI * 0.32];
    case 'dive':
      return [PI * 0.55, PI * 0.55];
    default:
      return undefined;
  }
}

/**
 * その時刻の目標の関節角度。
 * runPhase は走る脚の振りの位相（描画側が移動距離から進める）。
 */
export function targetJoints(pl: PlayerFrame, runPhase: number): Joints {
  let leg = LEG_POSES.ready;
  let thighN: number, kneeN: number, thighF: number, kneeF: number, lean: number;
  let pitch = 0;
  let arms = armAngles(pl);

  if (pl.pose === 'dive') {
    // 倒れ込む → 床に伏せる → 少し起き上がる
    const t = pl.poseT;
    const down = t < 0.45 ? smooth(t / 0.45) : 1 - 0.35 * smooth((t - 0.45) / 0.55);
    pitch = 1.25 * down;
    leg = LEG_POSES.dive;
    thighN = mix(LEG_POSES.receive.thigh, leg.thigh, down);
    kneeN = mix(LEG_POSES.receive.knee, leg.knee, down);
    thighF = thighN - 0.25;
    kneeF = kneeN + 0.2;
    lean = mix(LEG_POSES.receive.lean, leg.lean, down);
  } else if (pl.jumpPhase !== 'none') {
    const k = pl.jumpT;
    if (pl.jumpPhase === 'prep') {
      // 踏み込み：沈み込む
      const c = smooth(k);
      leg = { thigh: mix(LEG_POSES.ready.thigh, LEG_POSES.prep.thigh, c), knee: mix(LEG_POSES.ready.knee, LEG_POSES.prep.knee, c), lean: mix(LEG_POSES.ready.lean, LEG_POSES.prep.lean, c) };
      if (!arms) arms = [ARM_BACK, ARM_BACK];
    } else if (pl.jumpPhase === 'air') {
      // 空中：踏み切りで伸びて → 脚をたたむ → 着地に向けて伸ばす
      const fold = Math.sin(PI * k);
      leg = { thigh: mix(LEG_POSES.airStraight.thigh, LEG_POSES.airTucked.thigh, fold), knee: mix(LEG_POSES.airStraight.knee, LEG_POSES.airTucked.knee, fold), lean: LEG_POSES.airTucked.lean };
      if (!arms) arms = [PI * 0.8, PI * 0.8];
    } else {
      // 着地：膝で沈んでから戻る
      const c = k < 0.35 ? smooth(k / 0.35) : 1 - smooth((k - 0.35) / 0.65);
      leg = { thigh: mix(LEG_POSES.airStraight.thigh, LEG_POSES.land.thigh, c), knee: mix(LEG_POSES.airStraight.knee, LEG_POSES.land.knee, c), lean: mix(LEG_POSES.ready.lean, LEG_POSES.land.lean, c) };
    }
    thighN = leg.thigh; kneeN = leg.knee; thighF = leg.thigh - 0.1; kneeF = leg.knee + 0.05;
    lean = leg.lean;
  } else if (pl.pose === 'receive' || pl.pose === 'dig' || pl.pose === 'cover') {
    leg = LEG_POSES.receive;
    thighN = leg.thigh; kneeN = leg.knee; thighF = leg.thigh - 0.15; kneeF = leg.knee; lean = leg.lean;
  } else if (pl.speed > 0.5) {
    // 移動：脚を交互に振る。速いほど大きく
    const a = Math.min(1.2, pl.speed / 4.5);
    const s = Math.sin(runPhase);
    thighN = 0.3 + 0.75 * a * s;
    thighF = 0.3 - 0.75 * a * s;
    kneeN = 0.45 + 1.1 * a * Math.max(0, -Math.cos(runPhase + 0.4));
    kneeF = 0.45 + 1.1 * a * Math.max(0, Math.cos(runPhase + 0.4));
    lean = 0.15 + 0.2 * a;
    if (!arms) {
      const swing: [number, number] = [PI * 0.1 - 0.7 * a * s, PI * 0.1 + 0.7 * a * s];
      if (pl.moveKind === 'approach') {
        // 助走の後半は、踏み切りに向けて両腕を後ろへ大きく引く
        const back = smooth((pl.moveT - 0.55) / 0.45);
        arms = [mix(swing[0], ARM_BACK, back), mix(swing[1], ARM_BACK, back)];
        lean += 0.15 * back;
      } else arms = swing;
    }
  } else {
    thighN = leg.thigh; kneeN = leg.knee; thighF = leg.thigh - 0.1; kneeF = leg.knee; lean = leg.lean;
  }

  const [armN, armF] = arms ?? [PI * 0.15, PI * 0.15];
  const [elbowN, elbowF] = elbowAngles(pl);
  return { pitch, lean, thighN, kneeN, thighF, kneeF, armN, armF, elbowN, elbowF };
}

/** 肘の曲げ [手前の腕, 奥の腕]。動作の腕のポーズ → 跳ぶ動き → 走り → 待機 の順に決める */
export function elbowAngles(pl: PlayerFrame): [number, number] {
  const t = pl.poseT;
  switch (pl.pose) {
    case 'spike': return t < 0.6 ? [1.5, 0.35] : [0.12, 0.45]; // 肘を引いて振りかぶり、伸ばして打つ
    case 'tip': return [0.45, 0.4];
    case 'toss': return [0.4, 0.15];
    case 'block': return [0.06, 0.06];
    case 'set': return [1.35, 1.35];                           // 額の上で肘を曲げて受ける
    case 'dump': return t < 0.5 ? [1.35, 1.35] : [0.3, 0.8];
    case 'serve': return t < 0.5 ? [0.3, 0.2] : [0.15, 0.3];
    case 'receive': case 'dig': case 'cover': case 'dive': return [0.04, 0.04];
  }
  if (pl.jumpPhase === 'prep') return [0.15, 0.15];
  if (pl.jumpPhase === 'air') return [0.5, 0.5];
  if (pl.speed > 0.5) {
    const a = Math.min(1, pl.speed / 3);
    const bend = 0.35 + 1.0 * a;
    if (pl.moveKind === 'approach') {
      const back = smooth((pl.moveT - 0.55) / 0.45);
      return [mix(bend, 0.15, back), mix(bend, 0.15, back)];
    }
    return [bend, bend];
  }
  return [0.35, 0.35];
}

/** 脚の長さと角度から、足が床に着く腰の高さを求める（低い方の足が床に着く） */
export function hipHeight(j: Joints, thigh: number, shin: number): number {
  const foot = (t: number, k: number) => thigh * Math.cos(t - j.pitch) + shin * Math.cos(t - k - j.pitch);
  return Math.max(foot(j.thighN, j.kneeN), foot(j.thighF, j.kneeF), 0.28);
}

export function blendJoints(cur: Joints, target: Joints, k: number): Joints {
  const out = { ...cur };
  for (const key of Object.keys(target) as (keyof Joints)[]) out[key] = mix(cur[key], target[key], k);
  return out;
}
