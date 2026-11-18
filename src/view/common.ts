// 描画で共通に使うもの。

import type { TeamId } from '../sim/types';

export const TEAM_COLOR: Record<TeamId, { main: string; libero: string }> = {
  A: { main: '#d23b3b', libero: '#f2a33a' },
  B: { main: '#2f63c9', libero: '#2bb3a3' },
};
