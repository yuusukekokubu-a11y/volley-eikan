// 描画で共通に使うもの。

import type { TeamId } from '../sim/types';

export const TEAM_COLOR: Record<TeamId, { main: string; libero: string }> = {
  A: { main: '#d23b3b', libero: '#f2a33a' },
  B: { main: '#2f63c9', libero: '#2bb3a3' },
};

/**
 * 再生の基準の速さ（現実の何倍で見せるか）。「1倍」はこの速さで、2倍・4倍もこれが基準。
 * 試合の計算と記録の時刻は変えず、描画の時間の進め方だけを変える。スマホで見て調整する
 */
export const PLAYBACK_RATE = 0.8;
