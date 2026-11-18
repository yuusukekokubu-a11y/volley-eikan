import { describe, expect, it } from 'vitest';
import { outcomes } from '../scripts/outcome-fixture';
import fixture from './fixtures/outcomes.json';

// 記録の「見た目」（立ち位置・移動の時刻）を変える修正で、試合の結果が変わっていないことを確かめる。
// 結果＝得点した側・理由・関係した選手・打数・誰がいつどこで何に触ったか・ボールが落ちた時刻と場所。
describe('試合の結果は記録の見た目の修正で変わらない', () => {
  it('同じ乱数の種なら、保存してある結果と完全に一致する', () => {
    const now = outcomes();
    const old = fixture as unknown as typeof now;
    expect(Object.keys(now)).toEqual(Object.keys(old));
    for (const k of Object.keys(old)) expect(now[k], k).toEqual(old[k]);
  });
});
