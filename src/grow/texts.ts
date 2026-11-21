// 仕組みが出す文章（こくぶさん作の骨組み）。{name} などは差し込み。描画は知らない。
// 話し手：'manager'＝マネージャー、なし＝地の文

export interface Message {
  speaker?: 'manager';
  text: string;
}

export const TEXTS = {
  campStart: {
    summer: '今日から夏合宿です！5日間、みっちり練習しましょう！',
    winter: '冬合宿です！春高に向けて、ここで一気に伸ばしましょう！',
  },
  campTrait: '{name}が合宿で『{trait}』を身につけた！',
  campEnd: '合宿おつかれさまでした！みんな、ひと回りたくましくなりましたね',
  managerMatch: '監督、{day}日（土）に{school}との練習試合を組んでおきました！公式戦の前に、チームの力を試してみましょう。試合に出た選手は練習より多くの経験を積めますし、勝てば学校の評判が上がることもありますよ',
  matchAsk: 'どの高校に練習試合を申し込みますか？',
  matchDecided: '{school}との練習試合が{day}日（土）に決まりました',
  matchInvite: '監督、{school}から練習試合の申し込みが来ています！',
};

/** {key} を差し込む */
export function fill(text: string, v: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? `{${k}}`));
}
