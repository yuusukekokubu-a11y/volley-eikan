// 試合の流れの確認用：試合を通したサイドアウト率と、サーブレシーブからの攻撃・切り返しの攻撃の決定率（男女別）。
//   npx tsx scripts/flow-check.ts
import { SetGame } from '../src/sim/match';
import { makeBench, makeTeam } from '../src/sim/sample';
import type { RallyEvent } from '../src/sim/types';

type Act = Extract<RallyEvent, { type: 'action' }>;
const ATK = new Set(['spike', 'tip', 'dump']);
const pct = (a: number, b: number) => `${(100 * a / Math.max(1, b)).toFixed(1)}%`;

for (const g of ['male', 'female'] as const) {
  let rallies = 0, sideout = 0, sets = 0;
  // 種類ごと：本数・決定・ミス・被ブロック
  const st: Record<string, { n: number; kill: number; err: number; blk: number }> = {};
  const add = (k: string, res: 'kill' | 'err' | 'blk' | null) => {
    const o = (st[k] ??= { n: 0, kill: 0, err: 0, blk: 0 });
    o.n++;
    if (res) o[res]++;
  };
  for (let i = 1; i <= 300; i++) {
    const set = new SetGame({
      gender: g, seed: i, serving: i % 2 ? 'A' : 'B',
      teams: { A: makeTeam(100 + i, 'A', g, 55), B: makeTeam(500 + i, 'B', g, 55) },
      bench: { A: makeBench(100 + i, 'A', g, 55), B: makeBench(500 + i, 'B', g, 55) },
      oppManagerSkills: [],
    });
    sets++;
    while (!set.over) {
      const { rec } = set.next();
      rallies++;
      const recv = rec.serving === 'A' ? 'B' : 'A';
      if (rec.winner === recv) sideout++;
      const team = (id: string) => rec.placements.find(p => p.playerId === id)!.team;
      const acts = rec.events.filter((e): e is Act => e.type === 'action');
      const atks = acts.filter(e => ATK.has(e.action));
      atks.forEach((e, k) => {
        const t = team(e.playerId);
        // サーブレシーブからの攻撃：受けた側の最初の攻撃で、それまで相手（サーブ側）がサーブ以外で触っていない
        const before = acts.filter(x => x.t < e.t);
        const oppTouched = before.some(x => team(x.playerId) !== t && x.action !== 'serve' && x.action !== 'toss' && x.action !== 'block');
        const kind = t === recv && !oppTouched && k === atks.findIndex(x => team(x.playerId) === recv) ? 'サーブレシーブからの攻撃' : '切り返しの攻撃';
        const last = k === atks.length - 1;
        let res: 'kill' | 'err' | 'blk' | null = null;
        if (last && rec.winner === t && ['kill', 'tipKill', 'blockOut'].includes(rec.reason)) res = 'kill';
        else if (last && rec.reason === 'attackError' && rec.winner !== t) res = 'err';
        else if (last && rec.reason === 'blockKill' && rec.winner !== t) res = 'blk';
        add(kind, res);
        // 切り返しの中で、相手の攻撃を拾ってから／それ以外（チャンスボールなど）を分ける
        if (kind === '切り返しの攻撃') {
          const prevOppAtk = [...atks.slice(0, k)].reverse().find(x => team(x.playerId) !== t);
          add(prevOppAtk ? '　うち相手の攻撃を拾ってから' : '　うちチャンスボールなどから', res);
        }
      });
    }
  }
  console.log(`== ${g === 'male' ? '男子' : '女子'}（${sets}セット・${rallies}ラリー、同じ強さのチーム同士・相手は采配あり）`);
  console.log(`サイドアウト率 ${pct(sideout, rallies)}（ブレイク率 ${pct(rallies - sideout, rallies)}）`);
  for (const [k, o] of Object.entries(st)) {
    console.log(`${k}：${o.n}本 決定率 ${pct(o.kill, o.n)}  ミス ${pct(o.err, o.n)}  被ブロック ${pct(o.blk, o.n)}  効果率 ${pct(o.kill - o.err - o.blk, o.n)}`);
  }
}
