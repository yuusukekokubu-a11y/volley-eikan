// 2D・3Dの描画で共通のもの。

import type { Gender, TeamId } from '../sim/types';
import type { Frame } from './playback';

export interface Renderer {
  resize(w: number, h: number): void;
  draw(frame: Frame): void;
  setGender(g: Gender): void;
}

export const TEAM_COLOR: Record<TeamId, { main: string; libero: string }> = {
  A: { main: '#d23b3b', libero: '#f2a33a' },
  B: { main: '#2f63c9', libero: '#2bb3a3' },
};
