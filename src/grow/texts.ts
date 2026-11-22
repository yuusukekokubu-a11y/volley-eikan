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
  // 監督特能（{skill} は監督特能の名前）
  seminarIntro: '監督、近くで指導者の研修会があるそうですよ！',
  seminarGot: '研修会で、監督特能『{skill}』を学んだ！',
  seminarNone: '研修会に参加した。今回は特に得るものはなかった……',
  obVisit: 'OBの{name}（{year}年度卒）が練習を見に来てくれた！',
  obGotLine: '{name}「監督、卒業してから気づいたことがあるんです」',
  obNoneLine: '{name}「後輩たち、いい顔してますね。また来ます！」',
  coachLine: '{school}の監督「いい試合でした。うちでやっている作戦、よかったら参考にしてください」',
  cupGot: '{cup}での戦いを通して、監督特能『{skill}』をつかんだ！',
  skillGot: '監督特能『{skill}』を覚えた！',
  skillRefresh: '監督特能『{skill}』を磨き直した！（期限が延びた）',
  skillExpire: [
    '戦術の流行が変わり、監督特能『{skill}』が通用しなくなった……',
    '他校に研究され、監督特能『{skill}』が通用しなくなった……',
  ],
  skillFull: '監督特能『{skill}』を覚えられそうだ。でも、今は3つで手一杯……',
  skillRelease: '{skill}を手放す',
  skillSkip: '見送る',
  skillReplaced: '『{old}』を手放し、『{skill}』を覚えた！',
  skillSkipped: '今回は見送った',
};

/** {key} を差し込む */
export function fill(text: string, v: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? `{${k}}`));
}
