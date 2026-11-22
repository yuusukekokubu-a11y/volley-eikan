// 1年の進行（双六）。手札から進行カードを1枚選び、書いてある日数だけ進んで、止まったマスのパネル・イベントが起きる。
// 練習の効果は practice.ts。育成用の体力は練習で減り、緑パネルや休みで回復する（低いほど練習の伸びが落ちる）。
// 練習できなくなる「怪我の状態」はない。怪我はイベントの効果の1つ（events.ts）。調子は日々少しずつ変わる。
// お金：部費（年度の初めに入る）と、試合の勝利の報奨。機材を買うと体育館レベルが上がる。
// 描画は知らない。仮の画面（grow.html）はこの状態を見て操作するだけ。

import { Rng } from '../sim/rng';
import type { Gender, Player, Role, Squad, TrainKey } from '../sim/types';
import { gradeOf } from '../sim/player';
import { TRAITS } from '../sim/traits';
import { MANAGER_SKILLS } from '../sim/manager';
import { campOf, dateOf, indexOf, makeBoard, weekdayOf, type BoardDay, type Panel } from './board';
import { drawCard, PRACTICE, type Card, type PracticeDef, type TeamPolicy } from './cards';
import { CAMP, DAYS_IN_YEAR, ENERGY, FIXED_EVENTS, HAND, MONEY, PRACTICE_MATCH, SATURDAY, SCHOOLS, TOURNAMENTS, REPUTATION, YELLOW_BONUS, type TournamentDef } from './constants';
import { autoLineup, autoRegister, checkRegistration, makeNationals, makePrefecture, makeSchoolPlayers, randomTactics, teamStrength, type School } from './school';
import { Tournament, type BoutSim, type Entry } from './tournament';
import { applyMatchExp, outcomeOf, runMatch, setCount, type MatchOutcome } from './matchplay';
import { addReputation, learnSkill, rankOf, rollSkill, type OwnedSkill, type Reputation, type SkillSource } from './reputation';
import type { MatchOptions } from '../sim/game';
import { SURNAMES } from './names';
import { fill, TEXTS, type Message } from './texts';
import { applyPractice, dailyCondition, EQUIPMENT, gymLevel } from './practice';
import { bestRole, enroll, graduate, measure, type Graduate } from './roster';
import { EVENTS, pickEvent, resolveEvent, type EventDef, type EventWorld, type PendingEvent } from './events';

/** 練習を渡す口：使ったカードの練習・練習した日数・経験値の倍率（黄パネルで増える）・練習した選手 */
export type PracticeHook = (practice: PracticeDef, days: number, mul: number, players: Player[]) => void;

export interface SeasonOptions {
  seed: number;
  squad: Squad;
  year?: number;
  /** 男女（新入生を作る時に使う） */
  gender?: Gender;
  policy?: TeamPolicy;
  /** 印（年度をまたいで引き継ぐ） */
  flags?: Record<string, boolean>;
  money?: number;
  /** 持っている機材（ID） */
  equipment?: string[];
  /** イベントの一覧（省くとゲームのイベント。テストでは仮のイベントを渡す） */
  events?: EventDef[];
  onPractice?: PracticeHook;
  /** 県内の学校（育成全体で持つ。省くと seed から作る） */
  schools?: School[];
  /** 評判（育成全体で持つ。省くと弱小から） */
  reputation?: Reputation;
  /** 持っている監督特能（育成全体で持つ） */
  managerSkills?: OwnedSkill[];
  /** 卒業生がいる（OBパネルを置く） */
  hasOB?: boolean;
}

/** 試合を待っている（大会の1試合・練習試合）。playMatch（結果だけ）か、試合画面で行って finishMatch で続ける */
export interface PendingMatch {
  kind: 'tournament' | 'practice';
  tournamentId?: TournamentDef['id'];
  /** 「インターハイ予選 2回戦」「練習試合」など */
  title: string;
  opponent: { id: string; name: string; strength: number };
  bestOf: 3 | 5;
  /** 登録の人数の決まりがある（大会） */
  limit: boolean;
  /** 練習試合の相手の格（同格以上に勝つと評判が上がる） */
  level?: MatchOpponent['level'];
}

/** 監督特能を覚えられるが、3つ持っているので入れ替えか見送りを選ぶ（answerSkill で続ける） */
export interface SkillOffer {
  id: string;
  source: SkillSource;
}

const SOURCE_NAME: Record<SkillSource, string> = { seminar: '研修会', ob: 'OB', coach: '他校の監督', cup: '大会の実績' };

/** 試合の画面に渡すもの（自チーム＝A） */
export interface MatchSetup {
  options: MatchOptions;
  /** 先発（第1セットの始まり） */
  starters: string[];
  registered: string[];
}

const STOP_TOURNAMENTS = new Set<string>(Object.keys(TOURNAMENTS));

/** テスト用：他校同士の試合を、試合の計算ではなく強さの差の確率で決める（速く回すため） */
let quickBouts = false;
export function useQuickBouts(on = true) {
  quickBouts = on;
}

/** 文字列から種を作る */
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 1000000007;
}

/** 1回の行動（カード・休み）の結果 */
export interface StepResult {
  /** 進んだ日数 */
  moved: number;
  /** 止まったマス */
  panel?: Panel;
  /** 分かれ道で、どちらの道を通るかを選ぶ必要がある（chooseBranch で続ける） */
  needBranch?: boolean;
  /** 起きたイベント（選択肢を待っている時は choose で続ける） */
  event?: PendingEvent;
  /** 練習指示を変えられる（月初め・練習指示カード） */
  practiceOpen?: boolean;
  /** 月初めを通り過ぎる途中で一時停止した（練習指示を変えてから resume で残りの日数を進む） */
  paused?: boolean;
  /** 練習試合申し込みカードを使った：3校から相手を選ぶ（chooseMatch で続ける） */
  matchChoices?: MatchOpponent[];
  /** 白パネルで他校から練習試合の申し込みが来た（answerInvite で続ける） */
  matchInvite?: MatchOpponent;
  /** 練習試合の日に止まった（試合とつなぐのは第3段階） */
  match?: ScheduledMatch;
  /** 監督特能の入れ替えか見送りを待っている（answerSkill で続ける） */
  skillOffer?: SkillOffer;
  /** 出来事の一言（仮の画面に出す） */
  notes: string[];
  /** 見せる文章（マネージャーの台詞など。仮の画面では順に出す） */
  messages?: Message[];
}

/** 練習試合の相手（仮。相手校の自動生成は第3段階。level は自チームと比べた強さ） */
export interface MatchOpponent {
  name: string;
  level: 'above' | 'equal' | 'below';
  /** 強さ（自チームの強さと level から決める） */
  strength: number;
}

/** 予定している練習試合。via：申し込みカード／他校からの申し込み／マネージャー（1年目の6月） */
export interface ScheduledMatch {
  day: number;
  opponent: MatchOpponent;
  via: 'card' | 'invite' | 'manager';
}

export class Season {
  readonly board: BoardDay[];
  year: number;
  /** 今いる日（年の中の日。0＝4月1日）と道（分かれ道の中では0か1） */
  day = 0;
  lane = 0;
  hand: Card[] = [];
  squad: Squad;
  policy: TeamPolicy;
  flags: Record<string, boolean> = {};
  money: number;
  /** 持っている機材（ID）。持っていると、その練習のカードが手札に出る。体育館レベルが上がる */
  equipment: string[];
  /** 選択肢を待っているイベント */
  pending: PendingEvent | null = null;
  /** 続けて起きるのを待っているイベント（通り過ぎた行事など。今のイベントが終わったら順に出す） */
  private queue: PendingEvent[] = [];
  /** 分かれ道で止まっている時の、残りの日数と使ったカード */
  private branchWait: { left: number; card: Card | null } | null = null;
  /** 月初めを通り過ぎる時に一時停止している時の、残りの日数と使ったカード（練習指示を変えてから resume で続ける） */
  private monthWait: { left: number; card: Card | null } | null = null;
  readonly events: EventDef[];
  private rng: Rng;
  private onPractice?: PracticeHook;
  log: string[] = [];
  readonly gender: Gender;
  /** この年度に卒業した選手（卒業式で入る。名簿は育成全体の側で持つ） */
  graduates: Graduate[] = [];
  /** この年度に入部した選手と、身体測定の結果（仮の画面で見せる用） */
  newcomers: Player[] = [];
  measured: { id: string; cm: number }[] = [];
  /** 練習指示を変えられる状態（月初めに止まった時・練習指示カードを使った時。次に進むと閉じる）。4月1日は最初から開いている */
  practiceOpen = true;
  /** 見せる文章（次の行動の結果で返す） */
  private outbox: Message[] = [];
  /** 合宿の最後の日を過ぎた（その日の練習の後に、終わりの台詞を出す） */
  private campEnding = false;
  /** 県内の学校 */
  readonly schools: School[];
  private readonly seed: number;
  /** この年度の大会 */
  tournaments: Partial<Record<TournamentDef['id'], Tournament>> = {};
  /** 予選を勝ち抜いて出られる本戦 */
  qualified: Partial<Record<TournamentDef['id'], boolean>> = {};
  /** 予選の次の回戦の日（その日に止まる） */
  tournamentDay: number | null = null;
  /** 試合を待っている */
  pendingMatch: PendingMatch | null = null;
  /** 評判（育成全体と共有） */
  readonly reputation: Reputation;
  /** 持っている監督特能（育成全体と共有） */
  readonly managerSkills: OwnedSkill[];
  /** この年度に得た評判の点（年度の終わりの下がり方に使う） */
  repGained = 0;
  /** 監督特能の入れ替えか見送りを待っている */
  skillOffer: SkillOffer | null = null;
  /** 予定している練習試合（1つまで） */
  scheduledMatch: ScheduledMatch | null = null;
  /** 申し込みカードを使って、相手を選ぶのを待っている3校 */
  matchChoices: MatchOpponent[] | null = null;
  /** 他校からの申し込みの返事を待っている */
  matchInvite: MatchOpponent | null = null;

  constructor(o: SeasonOptions) {
    this.board = makeBoard(o.seed, { ob: !!o.hasOB });
    this.year = o.year ?? 1;
    this.squad = o.squad;
    this.policy = o.policy ?? 'all';
    this.gender = o.gender ?? 'male';
    this.flags = o.flags ?? {};
    // 年度の初めに部費が入る（評判による増減は第3段階で）
    this.reputation = o.reputation ?? { points: 0 };
    this.managerSkills = o.managerSkills ?? [];
    this.money = o.money ?? REPUTATION.budget[rankOf(this.reputation.points)];
    this.equipment = [...(o.equipment ?? [])];
    this.events = o.events ?? EVENTS;
    this.rng = new Rng(o.seed * 131 + 17);
    this.onPractice = o.onPractice;
    this.seed = o.seed;
    this.schools = o.schools ?? makePrefecture(o.seed);
    for (let i = 0; i < HAND.size; i++) this.hand.push(this.draw());
  }

  /** 見せる文章をためる（行動の結果で返す） */
  private say(text: string, speaker?: 'manager') {
    this.outbox.push(speaker ? { speaker, text } : { text });
  }

  /** ためた文章を取り出す */
  private drain(): { messages?: Message[] } {
    if (!this.outbox.length) return {};
    const messages = this.outbox;
    this.outbox = [];
    return { messages };
  }

  /** 日付の「〇日」 */
  private dayOfMonth(day: number): number {
    return dateOf(day).day;
  }

  /** 1年目の6月に1回、マネージャーが練習試合を組む（6月に入って最初に止まった時に知らせる） */
  private managerMatch() {
    if (this.year !== 1 || this.flags.managerMatchDone || this.scheduledMatch) return;
    if (this.day < indexOf(6, 2) || this.date.month !== 6) return;
    const d = this.saturdayFrom(indexOf(PRACTICE_MATCH.firstYear.month, PRACTICE_MATCH.firstYear.day));
    const opponent = this.makeOpponent();
    this.scheduledMatch = { day: d, opponent, via: 'manager' };
    this.flags.managerMatchDone = true;
    this.say(fill(TEXTS.managerMatch, { day: this.dayOfMonth(d), school: opponent.name }), 'manager');
  }

  /** 曜日（0＝日曜 … 6＝土曜） */
  weekday(day = this.day): number {
    return weekdayOf(this.year, day);
  }

  /** from 以降で最初の土曜日 */
  private saturdayFrom(from: number): number {
    let d = from;
    while (this.weekday(d) !== SATURDAY) d++;
    return d;
  }

  /** 練習試合の相手（仮の名前と強さ） */
  private makeOpponent(): MatchOpponent {
    const level = this.rng.pick(['above', 'equal', 'below'] as const);
    const g = SCHOOLS.practiceGap;
    const strength = Math.round((this.ownStrength() + g[level] + this.rng.normal() * g.noise) * 10) / 10;
    return { name: `${this.rng.pick(SURNAMES)}高校`, level, strength };
  }

  /** 自チームの強さ（自動で決めた先発7人の6能力の平均） */
  ownStrength(): number {
    const ps = this.active();
    return ps.length >= 6 ? teamStrength(ps) : 0;
  }

  /** 大会が近い（closeDays 日以内）ので、練習試合を申し込めない */
  matchClosed(): boolean {
    if (this.tournamentDay !== null && this.tournamentDay - this.day <= PRACTICE_MATCH.closeDays) return true;
    return FIXED_EVENTS.some(f => {
      if (!f.stop) return false;
      const d = indexOf(f.month, f.day);
      return d >= this.day && d - this.day <= PRACTICE_MATCH.closeDays;
    });
  }

  /** そのカードを今使えるか（申し込みカードは、大会が近い時・もう予定がある時は使えない） */
  canUse(card: Card): boolean {
    if (card.special === 'matchOffer') return !this.matchClosed() && !this.scheduledMatch && this.saturdayFrom(this.day + 1) < DAYS_IN_YEAR - 1;
    return true;
  }

  /** 今使える最初のカードの番号（確認用スクリプト・テスト用） */
  firstUsable(): number {
    return this.hand.findIndex(c => this.canUse(c));
  }

  /** 申し込みカードの3校から、相手を選ぶ（次の土曜日に試合） */
  chooseMatch(i: number) {
    if (!this.matchChoices) throw new Error('相手を選ぶ場面ではありません');
    const opp = this.matchChoices[i];
    if (!opp) throw new Error('その学校はありません');
    this.matchChoices = null;
    this.scheduledMatch = { day: this.saturdayFrom(this.day + 1), opponent: opp, via: 'card' };
    return { text: fill(TEXTS.matchDecided, { school: opp.name, day: this.dayOfMonth(this.scheduledMatch.day) }) } as Message;
  }

  /** 他校からの申し込みに返事をする（受けると次の土曜日に試合） */
  answerInvite(accept: boolean) {
    if (!this.matchInvite) throw new Error('申し込みは来ていません');
    const opp = this.matchInvite;
    this.matchInvite = null;
    if (!accept) return null;
    this.scheduledMatch = { day: this.saturdayFrom(this.day + 1), opponent: opp, via: 'invite' };
    return { text: fill(TEXTS.matchDecided, { school: opp.name, day: this.dayOfMonth(this.scheduledMatch.day) }) } as Message;
  }

  /** 1枚引く。合宿中は練習カードだけ。練習試合申し込みカードは手札に1枚まで（使えない時期に手札が埋まらないように） */
  private draw(): Card {
    for (;;) {
      const c = drawCard(this.rng, this.policy, this.equipment, !!campOf(this.day));
      if (c.special !== 'matchOffer' || !this.hand.some(h => h.special === 'matchOffer')) return c;
    }
  }

  /** 合宿中は手札が練習カードだけになる（ほかのカードは練習カードに入れ替わる） */
  private campHand() {
    if (!campOf(this.day)) return;
    this.hand = this.hand.map(c => c.special ? drawCard(this.rng, this.policy, this.equipment, true) : c);
  }

  get date(): { month: number; day: number } {
    return dateOf(this.day);
  }

  get over(): boolean {
    return this.day >= DAYS_IN_YEAR - 1;
  }

  /** その日の、今の道のパネル */
  panelAt(day: number, lane = this.lane): Panel {
    const d = this.board[day];
    return d.lanes[Math.min(lane, d.lanes.length - 1)];
  }

  /** この先 n 日分のマス（仮の画面で見せる用） */
  ahead(n: number): BoardDay[] {
    return this.board.slice(this.day + 1, this.day + 1 + n);
  }

  /** 手札の i 枚目のカードを使う */
  useCard(i: number): StepResult {
    this.ready();
    const card = this.hand[i];
    if (!card) throw new Error('そのカードはありません');
    if (!this.canUse(card)) throw new Error(this.scheduledMatch ? 'もう練習試合の予定があります' : '大会が近いので、練習試合は申し込めません');
    this.hand.splice(i, 1);
    this.hand.push(this.draw());
    if (card.special === 'instruction') {
      this.practiceOpen = true;
      return { moved: 0, practiceOpen: true, notes: ['練習指示カード：練習指示を変えられます'] };
    }
    if (card.special === 'matchOffer') {
      this.matchChoices = Array.from({ length: PRACTICE_MATCH.candidates }, () => this.makeOpponent());
      return { moved: 0, matchChoices: this.matchChoices, notes: ['練習試合申し込みカード'], messages: [{ text: TEXTS.matchAsk }] };
    }
    this.practiceOpen = false;
    return this.move(card.days, card);
  }

  /** 体育館レベル（持っている機材の数と種類で決まる） */
  get gym(): number {
    return gymLevel(this.equipment);
  }

  /** 機材を買う。値段が足りなければ買えない */
  buy(id: string) {
    const eq = EQUIPMENT.find(e => e.id === id);
    if (!eq) throw new Error(`機材がありません: ${id}`);
    if (this.equipment.includes(id)) throw new Error('もう持っています');
    const price = MONEY.price[eq.equipment as 'basic' | 'advanced'];
    if (this.money < price) throw new Error('お金が足りません');
    this.money -= price;
    this.equipment.push(id);
  }

  /** 試合に勝った時の報奨（練習試合／大会。大会は round 回戦ほど多い）。試合とつなぐのは練習試合・大会の段階で */
  rewardWin(kind: 'practice' | 'tournament', round = 1): number {
    const v = kind === 'practice' ? MONEY.winPractice : Math.round(MONEY.winTournament * Math.pow(MONEY.roundMul, round - 1));
    this.money += v;
    return v;
  }

  /** 休む：1日進み、練習をしないで全員の体力を回復する */
  rest(): StepResult {
    this.ready();
    this.practiceOpen = false;
    return this.move(1, null);
  }

  /** 分かれ道で、通る道を選んで続きを進む */
  chooseBranch(lane: 0 | 1): StepResult {
    if (!this.branchWait) throw new Error('分かれ道ではありません');
    const { left, card } = this.branchWait;
    this.branchWait = null;
    this.lane = lane;
    return this.move(left, card, true);
  }

  /** 月初めを通り過ぎる途中で一時停止している */
  get paused(): boolean {
    return !!this.monthWait;
  }

  /** 月初めの一時停止から、残りの日数を進む（練習指示はここで閉じる） */
  resume(): StepResult {
    if (!this.monthWait) throw new Error('一時停止していません');
    const { left, card } = this.monthWait;
    this.monthWait = null;
    this.practiceOpen = false;
    return this.move(left, card);
  }

  /** 起きているイベントの選択肢を選ぶ。続けて起きるイベントがあれば、それを返す */
  choose(index?: number): PendingEvent | null {
    if (!this.pending) throw new Error('イベントは起きていません');
    const w = this.world();
    this.pending = resolveEvent(this.pending, w, this.events, this.rng, index) ?? this.queue.shift() ?? null;
    this.money = w.money;
    // 待っていたイベントが選択肢のないものなら、すぐに効果をかけて次へ
    if (this.pending && !this.pending.def.choices?.length) return this.choose();
    return this.pending;
  }

  /** 練習指示を変える（月初めと、練習指示カードを使った時だけ。引退した選手は変えられない） */
  setPractice(playerId: string, change: { focus?: TrainKey | 'auto'; position?: Role }) {
    if (!this.practiceOpen) throw new Error('練習指示を変えられるのは、毎月1日と練習指示カードを使った時です');
    const p = this.players().find(x => x.id === playerId);
    if (!p) throw new Error('部員がいません');
    if (p.retired) throw new Error('引退した選手です');
    if (change.focus) p.practice.focus = change.focus;
    if (change.position) p.practice.position = change.position;
  }

  private ready() {
    if (this.pendingMatch) throw new Error('試合をしてください');
    if (this.skillOffer) throw new Error('監督特能を入れ替えるか見送るかを選んでください');
    if (this.matchChoices) throw new Error('練習試合の相手を選んでください');
    if (this.matchInvite) throw new Error('練習試合の申し込みに返事をしてください');
    if (this.pending) throw new Error('イベントの選択肢を先に選んでください');
    if (this.branchWait) throw new Error('分かれ道で道を選んでください');
    if (this.monthWait) throw new Error('練習指示を変えたら、続きを進んでください');
    if (this.over) throw new Error('1年が終わりました');
  }

  private world(): EventWorld {
    return { year: this.year, month: this.date.month, players: this.active(), flags: this.flags, money: this.money };
  }

  private players(): Player[] {
    return this.squad.players;
  }

  /** 練習・イベントに出る部員（引退した3年生は出ない） */
  private active(): Player[] {
    return this.squad.players.filter(p => !p.retired);
  }

  /**
   * days 日進む。card が練習の進行カードなら、その日数だけ練習する（休みなら回復する）。
   * 定期イベントのマスでは、残りの日数があっても止まる。分かれ道の手前では、道を選ぶまで止まる
   */
  private move(days: number, card: Card | null, resumed = false): StepResult {
    const notes: string[] = [];
    let moved = 0;
    let campMoved = 0;
    let left = days;
    while (left > 0 && !this.over) {
      const next = this.board[this.day + 1];
      // 1本の道から分かれ道に入る時は、どちらの道を通るかを選ぶ
      if (next.lanes.length > 1 && this.board[this.day].lanes.length === 1 && !resumed) {
        this.branchWait = { left, card };
        this.afterDays(moved, card, notes, campMoved);
        return { moved, needBranch: true, notes, ...this.drain() };
      }
      resumed = false;
      this.day++;
      if (this.board[this.day].lanes.length === 1) this.lane = 0;
      moved++;
      left--;
      this.passDay(card);
      if (campOf(this.day) && card) campMoved++;
      if (campOf(this.day) && !campOf(this.day + 1)) this.campEnding = true;
      const here = this.panelAt(this.day);
      // 月初め：練習指示を変える日。通り過ぎても止まる
      const first = dateOf(this.day).day === 1;
      if (first) this.openMonth(notes);
      const matchDay = this.scheduledMatch?.day === this.day;
      // 大会と練習試合の日は必ず止まる。それ以外の行事は止まらず、通り過ぎても起きる（止まった時は下の land で起きる）
      const stop = here.kind === 'fixed' && this.stopsAt(here.fixedId!);
      const tourDay = this.tournamentDay === this.day;
      if (stop || matchDay || tourDay) break;
      // 月初めは一時停止するだけ（練習指示を変えてから残りの日数を進む）。ちょうど止まった時は普通に止まる
      if (first && left > 0) {
        if (here.kind === 'fixed') this.land(here, card, notes);
        this.monthWait = { left, card };
        this.afterDays(moved, card, notes, campMoved);
        this.managerMatch();
        return { moved, paused: true, practiceOpen: true, notes, ...this.drain() };
      }
      if (here.kind === 'fixed' && left > 0) this.land(here, card, notes);
    }
    this.afterDays(moved, card, notes, campMoved);
    const panel = this.panelAt(this.day);
    // 練習試合の日：試合をする（つなぐのは第3段階）。マネージャーが組んだものはそのイベントも起きる
    let match: ScheduledMatch | undefined;
    if (this.scheduledMatch?.day === this.day) {
      match = this.scheduledMatch;
      this.scheduledMatch = null;
      notes.push(`練習試合：${match.opponent.name}`);
      const o = match.opponent;
      this.pendingMatch = { kind: 'practice', title: '練習試合', opponent: { id: `pm-${this.day}`, name: o.name, strength: o.strength }, bestOf: 3, limit: false, level: o.level };
      this.trigger({ fixed: match.via === 'manager' ? 'managerMatch' : 'practiceMatch' }, '', notes);
    }
    // 予選の次の回戦の日
    if (this.tournamentDay === this.day) {
      this.tournamentDay = null;
      this.nextBout(notes);
    }
    const event = this.land(panel, card, notes);
    this.campHand();
    this.managerMatch();
    return {
      ...this.drain(),
      moved, panel, event: event ?? undefined, notes,
      ...(this.practiceOpen ? { practiceOpen: true } : {}),
      ...(this.matchInvite ? { matchInvite: this.matchInvite } : {}),
      ...(this.skillOffer ? { skillOffer: this.skillOffer } : {}),
      ...(match ? { match } : {}),
    };
  }

  // ---------------- 大会・試合 ----------------

  /** その行事の日に止まるか：大会以外は stop のとおり。本戦は予選を勝ち抜いた時だけ */
  private stopsAt(fixedId: string): boolean {
    const f = FIXED_EVENTS.find(x => x.id === fixedId);
    if (!f?.stop) return false;
    if (STOP_TOURNAMENTS.has(fixedId)) {
      const def = TOURNAMENTS[fixedId as TournamentDef['id']];
      return def.kind === 'prelim' || !!this.qualified[def.id];
    }
    return true;
  }

  /** 大会が始まる：出場校を決めてトーナメントを作り、自チームの1回戦を待つ */
  private startTournament(id: TournamentDef['id'], notes: string[]) {
    const def = TOURNAMENTS[id];
    if (def.kind === 'national' && !this.qualified[id]) { notes.push(`${def.name}（出場なし）`); return; }
    const own: Entry = { id: 'own', name: '自校', strength: this.ownStrength(), own: true };
    const rng = new Rng(hashSeed(`${id}-${this.year}-${this.seed}`));
    const others: Entry[] = def.kind === 'prelim'
      ? this.schools.map(sc => ({ id: sc.id, name: sc.name, strength: sc.strength }))
      : makeNationals(rng, 31, new Set(this.schools.map(sc => sc.name)));
    const t = new Tournament(def, [own, ...others], rng, this.year);
    this.tournaments[id] = t;
    notes.push(`${def.name}が始まりました`);
    if (def.kind === 'national') this.gainRep(REPUTATION.gain.nationalEntry, notes);
    this.nextBout(notes);
  }

  /** 自チームの次の試合を待つ（人数が足りなければ不戦敗） */
  private nextBout(notes: string[]) {
    const t = Object.values(this.tournaments).find(x => x && !x.over && x.ownBout());
    if (!t) return;
    const opp = t.ownOpponent()!;
    if (this.active().length < 6) {
      notes.push(`${t.def.name} ${t.roundName}：人数が足りず不戦敗`);
      this.afterBout(t, false, '0-' + (t.bestOf === 5 ? 3 : 2), notes);
      return;
    }
    this.pendingMatch = {
      kind: 'tournament', tournamentId: t.def.id, title: `${t.def.name} ${t.roundName}`,
      opponent: { id: opp.id, name: opp.name, strength: opp.strength }, bestOf: t.bestOf, limit: true,
    };
  }

  /** 他校同士の試合（試合の計算を結果だけで回す） */
  private boutSim(t: Tournament): BoutSim {
    return (a, b, bestOf, key) => {
      if (quickBouts) {
        const aWins = new Rng(hashSeed(key + t.year)).chance(1 / (1 + Math.exp(-(a.strength - b.strength) / 4)));
        return { aWins, sets: bestOf === 5 ? '3-1' : '2-1' };
      }
      const ta = this.schoolTeam(a, `${key}-a`);
      const tb = this.schoolTeam(b, `${key}-b`);
      const m = runMatch({ gender: this.gender, bestOf, seed: hashSeed(`${key}-${t.year}`), teams: { A: ta.team, B: tb.team }, bench: { A: ta.bench, B: tb.bench } });
      const sets = m.results.map(x => ({ own: x.A, opp: x.B }));
      return { aWins: m.winner === 'A', sets: setCount(sets) };
    };
  }

  /** 学校の部員と並び（その学校・年度で同じ部員） */
  private schoolTeam(e: { id: string; name: string; strength: number }, key: string) {
    const seed = hashSeed(`${e.id}-${this.year}-${this.seed}`);
    const players = makeSchoolPlayers(e, this.gender, seed, this.year);
    return autoLineup(players, e.name, randomTactics(new Rng(hashSeed(key))));
  }

  /** 登録の初期値（大会は12人まで。練習試合は全員） */
  defaultRegistration(): string[] {
    const ps = this.active();
    return this.pendingMatch?.limit ? autoRegister(ps) : ps.map(p => p.id);
  }

  /** 試合の画面に渡すもの。registered を省くと登録の初期値 */
  matchSetup(registered = this.defaultRegistration()): MatchSetup {
    const pm = this.pendingMatch;
    if (!pm) throw new Error('試合はありません');
    const ps = this.active();
    if (pm.limit) {
      const err = checkRegistration(ps, registered);
      if (err) throw new Error(err);
    }
    const own = autoLineup(ps.filter(p => registered.includes(p.id)), '自校', { attack: 'balance', block: 'spread', receive: 'back' });
    const opp = this.schoolTeam(pm.opponent, `${pm.title}-${this.day}-opp`);
    const starters = [...own.team.rotation.map(s => s.player.id), ...(own.team.libero ? [own.team.libero.id] : [])];
    return {
      options: { managerSkills: this.managerSkills.map(x => x.id), gender: this.gender, bestOf: pm.bestOf, seed: hashSeed(`${pm.title}-${this.year}-${this.day}`), teams: { A: own.team, B: opp.team }, bench: { A: own.bench, B: opp.bench } },
      starters, registered,
    };
  }

  /** 評判が上がる */
  private gainRep(v: number, notes: string[]) {
    addReputation(this.reputation, v);
    this.repGained += v;
    notes.push(`評判 +${v}`);
  }

  /** 監督特能の獲得の機会（確率は獲得の場と評判で決まる） */
  private trySkill(source: SkillSource, notes: string[]) {
    const id = rollSkill(this.rng, source, this.reputation.points);
    if (!id) return;
    const name = MANAGER_SKILLS[id].name;
    if (learnSkill(this.managerSkills, id, this.year)) {
      notes.push(`${SOURCE_NAME[source]}：監督特能「${name}」を覚えた`);
      this.say(`監督特能「${name}」を覚えた（${SOURCE_NAME[source]}）`);
    } else {
      this.skillOffer = { id, source };
      notes.push(`${SOURCE_NAME[source]}：監督特能「${name}」を覚えられる（3つ持っているので入れ替えるか見送るかを選ぶ）`);
    }
  }

  /** 3つ持っている時：replaceId と入れ替える（null なら見送る） */
  answerSkill(replaceId: string | null): Message | null {
    const offer = this.skillOffer;
    if (!offer) throw new Error('監督特能の入れ替えは待っていません');
    this.skillOffer = null;
    if (!replaceId) return null;
    const i = this.managerSkills.findIndex(x => x.id === replaceId);
    if (i < 0) throw new Error('その監督特能は持っていません');
    this.managerSkills.splice(i, 1);
    learnSkill(this.managerSkills, offer.id, this.year);
    return { text: `監督特能「${MANAGER_SKILLS[replaceId].name}」を「${MANAGER_SKILLS[offer.id].name}」に入れ替えた` };
  }

  /** 結果だけ：試合を全部おまかせで計算して、結果を入れる */
  playMatch(registered?: string[]): StepResult {
    const setup = this.matchSetup(registered);
    const m = runMatch(setup.options);
    return this.finishMatch(outcomeOf(m, setup.starters), setup.registered);
  }

  /** 試合の結果を入れる（試合画面で行った時もここ）。経験・報奨・大会の進み */
  finishMatch(o: MatchOutcome, registered: string[]): StepResult {
    const pm = this.pendingMatch;
    if (!pm) throw new Error('試合はありません');
    this.pendingMatch = null;
    const notes: string[] = [];
    applyMatchExp(this.active(), o, registered);
    notes.push(`${pm.title}：${pm.opponent.name}に${setCount(o.sets, false)}で${o.win ? '勝ち' : '負け'}`);
    if (pm.kind === 'practice') {
      if (o.win) notes.push(`報奨 ${this.rewardWin('practice').toLocaleString()}円`);
      if (o.win && pm.level !== 'below') this.gainRep(REPUTATION.gain.practiceWin, notes);
      // 練習試合の後：他校の監督から教わることがある
      this.trySkill('coach', notes);
    } else {
      const t = this.tournaments[pm.tournamentId!]!;
      if (o.win) notes.push(`報奨 ${this.rewardWin('tournament', t.round + 1).toLocaleString()}円`);
      if (o.win) this.gainRep(t.def.kind === 'prelim' ? REPUTATION.gain.prelimWin : REPUTATION.gain.nationalWin, notes);
      this.afterBout(t, o.win, setCount(o.sets), notes);
    }
    return { moved: 0, notes, ...this.drain() };
  }

  /** 自チームの試合の後：他校同士の試合を決め、次の回戦へ。負ければ最後まで決めて大会を終える */
  private afterBout(t: Tournament, win: boolean, sets: string, notes: string[]) {
    t.recordOwn(win, sets);
    const sim = this.boutSim(t);
    t.playOthers(sim);
    t.advance();
    if (!win || t.over) {
      t.finish(sim);
      const res = t.ownResult();
      notes.push(`${t.def.name}：${res.text}（優勝 ${t.champion!.name}）`);
      if (t.over && t.ownAlive && t.def.next) {
        this.qualified[t.def.next] = true;
        notes.push(`${TOURNAMENTS[t.def.next].name}に出場します`);
        this.gainRep(REPUTATION.gain.qualify, notes);
        this.trySkill('cup', notes);
      }
      if (t.def.kind === 'national') {
        if (t.over && t.ownAlive) this.gainRep(REPUTATION.gain.nationalChampion, notes);
        // 本戦でベスト4以上：大会の実績で監督特能を覚えることがある
        if (res.wins >= 3) this.trySkill('cup', notes);
      }
      return;
    }
    if (t.def.kind === 'prelim') {
      const d = t.def.dates[t.round];
      this.tournamentDay = indexOf(d.month, d.day);
      notes.push(`次は${t.roundName}（${d.month}/${d.day}）`);
    } else {
      // 本戦は続けて試合をする（間に練習なし。日付だけ進む）
      this.day++;
      for (const p of this.active()) dailyCondition(p, this.rng);
      this.nextBout(notes);
    }
  }

  /** 月初め：練習指示を変えられるようにする。合宿の1ヶ月前なら、開催するかの返事を待つ */
  private openMonth(notes: string[]) {
    this.practiceOpen = true;
    notes.push('月初め：練習指示を変えられます');
  }

  /** 1日が過ぎる：練習（体力が減る）か休み（体力が回復する）。調子が少し変わる */
  private passDay(card: Card | null) {
    const drop = ENERGY.perPracticeDay * (campOf(this.day) ? CAMP.energyMul : 1);
    for (const p of this.active()) {
      dailyCondition(p, this.rng);
      p.energy = card ? Math.max(0, p.energy - drop) : Math.min(ENERGY.max, p.energy + ENERGY.rest);
    }
  }

  /** 進んだ日数分の練習をする */
  private afterDays(moved: number, card: Card | null, notes: string[], campMoved = 0) {
    if (card && moved > 0) {
      const practice = PRACTICE[card.practiceId];
      const players = this.active();
      applyPractice(players, practice, moved, this.gym);
      this.onPractice?.(practice, moved, 1, players);
      notes.push(`${practice.name}を${moved}日`);
      // 合宿の間は経験が多く入る
      if (campMoved > 0) {
        applyPractice(players, practice, campMoved, this.gym, CAMP.expMul - 1);
        this.onPractice?.(practice, campMoved, CAMP.expMul - 1, players);
        notes.push(`合宿で${campMoved}日`);
        this.campTrait(practice, notes);
      }
    }
    if (this.campEnding) {
      this.campEnding = false;
      this.say(TEXTS.campEnd, 'manager');
    }
  }

  /** 合宿の練習ごとに、確率でランダムな選手1人が、その練習の種類に合った特能を覚える */
  private campTrait(practice: PracticeDef, notes: string[]) {
    const players = this.active();
    if (!players.length) return;
    for (let i = 0; i < CAMP.traitRolls; i++) {
      if (!this.rng.chance(CAMP.traitChance)) continue;
      const p = this.rng.pick(players);
      const role = bestRole(p);
      const pool = Object.values(TRAITS).filter(t => t.kind === 'stat' && t.color === 'blue' && !t.upgradeOf && !t.alsoUnlocks
        && (!t.roles || t.roles.includes(role)) && !p.traits.includes(t.id) && t.effects.some(e => practice.abilities.includes(e.ability as TrainKey)));
      if (!pool.length) continue;
      const t = this.rng.pick(pool);
      p.traits.push(t.id);
      notes.push(`合宿：${p.number}番が特能「${t.name}」を覚えた`);
      this.say(fill(TEXTS.campTrait, { name: p.name, trait: t.name }));
    }
  }

  /** 止まったマスのパネル */
  private land(panel: Panel, card: Card | null, notes: string[]): PendingEvent | null {
    switch (panel.kind) {
      case 'green':
        for (const p of this.active()) p.energy = Math.min(ENERGY.max, p.energy + ENERGY.green);
        notes.push('緑：体力が回復した');
        return null;
      case 'yellow':
        // 練習の進行カードで止まると、その練習の経験値が増える
        if (card) {
          const practice = PRACTICE[card.practiceId];
          const players = this.active();
          applyPractice(players, practice, 1, this.gym, YELLOW_BONUS - 1);
          this.onPractice?.(practice, 1, YELLOW_BONUS - 1, players);
          notes.push(`黄：${practice.name}の経験値が増えた`);
        }
        return null;
      case 'seminar':
      case 'ob':
        notes.push(panel.kind === 'seminar' ? '研修会パネル' : 'OBパネル');
        this.trySkill(panel.kind, notes);
        return null;
      case 'branch':
        return null;
      case 'fixed': {
        const name = FIXED_EVENTS.find(f => f.id === panel.fixedId)?.name ?? panel.fixedId;
        // 結果を出すだけの行事（入学式・身体測定・引退・卒業式・合宿）は「中身はまだありません」を出さない
        if (STOP_TOURNAMENTS.has(panel.fixedId ?? '')) {
          this.startTournament(panel.fixedId as TournamentDef['id'], notes);
          return null;
        }
        const system = this.rosterEvent(panel.fixedId ?? '', notes);
        const def = FIXED_EVENTS.find(f => f.id === panel.fixedId);
        return this.trigger({ fixed: def?.kind ?? panel.fixedId }, system ? '' : `${name}（中身はまだありません）`, notes);
      }
      default: {
        // 白パネル：まれに他校から練習試合の申し込み（大会が近い時・もう予定がある時は来ない）
        if (panel.kind === 'white' && !this.scheduledMatch && !this.matchClosed() && this.saturdayFrom(this.day + 1) < DAYS_IN_YEAR - 1
          && this.rng.chance(PRACTICE_MATCH.whiteInviteChance)) {
          this.matchInvite = this.makeOpponent();
          notes.push(`白：${this.matchInvite.name}から練習試合の申し込み`);
          this.say(fill(TEXTS.matchInvite, { school: this.matchInvite.name }), 'manager');
          return null;
        }
        const names: Record<string, string> = { blue: '青', red: '赤', white: '白', training: '特訓' };
        return this.trigger({ panel: panel.kind }, `${names[panel.kind]}パネル（イベントの中身はまだありません）`, notes);
      }
    }
  }

  /** 行事のうち、部員の入れ替わりの仕組み（文章や選択肢はイベントの中身の側で入れる） */
  private rosterEvent(id: string, notes: string[]): boolean {
    if (!['entrance', 'physical', 'retire', 'campSummer', 'campWinter', 'graduation'].includes(id)) return false;
    if (id === 'entrance') {
      this.newcomers = enroll(this.squad, this.year, this.gender, this.rng, REPUTATION.newcomers[rankOf(this.reputation.points)]);
      notes.push(`新入生が${this.newcomers.length}人入部しました`);
    } else if (id === 'physical') {
      this.measured = measure(this.squad, this.year);
      notes.push(`身体測定：${this.measured.length ? this.measured.map(m => `${this.squad.players.find(p => p.id === m.id)!.number}番 +${m.cm}cm`).join('、') : '身長が伸びた選手はいません'}`);
    } else if (id === 'retire') {
      const n = this.squad.players.filter(p => gradeOf(p, this.year) >= 3 && !p.retired);
      for (const p of n) p.retired = true;
      notes.push(`3年生${n.length}人が引退しました（卒業までは試合にも練習にも出ません）`);
    } else if (id === 'campSummer' || id === 'campWinter') {
      const k = id === 'campSummer' ? 'summer' : 'winter';
      notes.push(`${CAMP[k].name}が始まりました`);
      this.say(TEXTS.campStart[k], 'manager');
    } else if (id === 'graduation') {
      this.graduates = graduate(this.squad, this.year);
      notes.push(`3年生${this.graduates.length}人が卒業しました`);
    }
    return true;
  }

  private trigger(t: { panel?: Panel['kind']; fixed?: string }, empty: string, notes: string[]): PendingEvent | null {
    const ev = pickEvent(this.events, t, this.world(), this.rng);
    if (!ev) { if (empty) notes.push(empty); return null; }
    // 前のイベントが選択肢を待っていれば、その後に出す
    if (this.pending) { this.queue.push(ev); return ev; }
    this.pending = ev;
    // 選択肢のないイベントは、すぐに効果をかける
    if (!ev.def.choices?.length) this.choose();
    return ev;
  }
}

/**
 * 分かれ道（lane の道を選ぶ）と月初めの一時停止（そのまま続ける）を、なくなるまで進める。
 * 確認用スクリプト・テストで、1回の行動を最後まで進める時に使う
 */
export function finishStep(s: Season, r: StepResult, lane: 0 | 1 = 0): StepResult {
  const notes = [...r.notes];
  const messages = [...(r.messages ?? [])];
  let moved = r.moved;
  while (r.needBranch || r.paused) {
    r = r.needBranch ? s.chooseBranch(lane) : s.resume();
    notes.push(...r.notes);
    messages.push(...(r.messages ?? []));
    moved += r.moved;
  }
  return { ...r, moved, notes, ...(messages.length ? { messages } : {}) };
}
