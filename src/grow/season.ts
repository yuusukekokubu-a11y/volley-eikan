// 1年の進行（双六）。手札から進行カードを1枚選び、書いてある日数だけ進んで、止まったマスのパネル・イベントが起きる。
// 練習の効果は practice.ts。育成用の体力は練習で減り、緑パネルや休みで回復する（低いほど練習の伸びが落ちる）。
// 練習できなくなる「怪我の状態」はない。怪我はイベントの効果の1つ（events.ts）。調子は日々少しずつ変わる。
// お金：部費（年度の初めに入る）と、試合の勝利の報奨。機材を買うと体育館レベルが上がる。
// 描画は知らない。仮の画面（grow.html）はこの状態を見て操作するだけ。

import { Rng } from '../sim/rng';
import type { Gender, Player, Role, Squad, TrainKey } from '../sim/types';
import { gradeOf } from '../sim/player';
import { TRAITS } from '../sim/traits';
import { campOf, dateOf, indexOf, makeBoard, weekdayOf, type BoardDay, type Panel } from './board';
import { drawCard, PRACTICE, type Card, type PracticeDef, type TeamPolicy } from './cards';
import { CAMP, DAYS_IN_YEAR, ENERGY, FIXED_EVENTS, HAND, MONEY, PRACTICE_MATCH, SATURDAY, YELLOW_BONUS } from './constants';
import { SURNAMES } from './names';
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
  /** 練習試合申し込みカードを使った：3校から相手を選ぶ（chooseMatch で続ける） */
  matchChoices?: MatchOpponent[];
  /** 白パネルで他校から練習試合の申し込みが来た（answerInvite で続ける） */
  matchInvite?: MatchOpponent;
  /** 練習試合の日に止まった（試合とつなぐのは第3段階） */
  match?: ScheduledMatch;
  /** 出来事の一言（仮の画面に出す） */
  notes: string[];
}

/** 練習試合の相手（仮。相手校の自動生成は第3段階。level は自チームと比べた強さ） */
export interface MatchOpponent {
  name: string;
  level: 'above' | 'equal' | 'below';
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
  /** 予定している練習試合（1つまで） */
  scheduledMatch: ScheduledMatch | null = null;
  /** 申し込みカードを使って、相手を選ぶのを待っている3校 */
  matchChoices: MatchOpponent[] | null = null;
  /** 他校からの申し込みの返事を待っている */
  matchInvite: MatchOpponent | null = null;

  constructor(o: SeasonOptions) {
    this.board = makeBoard(o.seed);
    this.year = o.year ?? 1;
    this.squad = o.squad;
    this.policy = o.policy ?? 'all';
    this.gender = o.gender ?? 'male';
    this.flags = o.flags ?? {};
    // 年度の初めに部費が入る（評判による増減は第3段階で）
    this.money = o.money ?? MONEY.budget;
    this.equipment = [...(o.equipment ?? [])];
    this.events = o.events ?? EVENTS;
    this.rng = new Rng(o.seed * 131 + 17);
    this.onPractice = o.onPractice;
    for (let i = 0; i < HAND.size; i++) this.hand.push(this.draw());
    // 1年目の6月に1回、マネージャーが練習試合を組む（説明の文章はイベントの中身の側で入れる）
    if (this.year === 1) {
      const d = this.saturdayFrom(indexOf(PRACTICE_MATCH.firstYear.month, PRACTICE_MATCH.firstYear.day));
      this.scheduledMatch = { day: d, opponent: this.makeOpponent(), via: 'manager' };
    }
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
    return { name: `${this.rng.pick(SURNAMES)}高校`, level: this.rng.pick(['above', 'equal', 'below'] as const) };
  }

  /** 大会が近い（closeDays 日以内）ので、練習試合を申し込めない */
  matchClosed(): boolean {
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
  }

  /** 他校からの申し込みに返事をする（受けると次の土曜日に試合） */
  answerInvite(accept: boolean) {
    if (!this.matchInvite) throw new Error('申し込みは来ていません');
    if (accept) this.scheduledMatch = { day: this.saturdayFrom(this.day + 1), opponent: this.matchInvite, via: 'invite' };
    this.matchInvite = null;
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
      return { moved: 0, matchChoices: this.matchChoices, notes: ['練習試合申し込みカード：相手を選んでください'] };
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
    if (this.matchChoices) throw new Error('練習試合の相手を選んでください');
    if (this.matchInvite) throw new Error('練習試合の申し込みに返事をしてください');
    if (this.pending) throw new Error('イベントの選択肢を先に選んでください');
    if (this.branchWait) throw new Error('分かれ道で道を選んでください');
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
        return { moved, needBranch: true, notes };
      }
      resumed = false;
      this.day++;
      if (this.board[this.day].lanes.length === 1) this.lane = 0;
      moved++;
      left--;
      this.passDay(card);
      if (campOf(this.day) && card) campMoved++;
      const here = this.panelAt(this.day);
      // 月初め：練習指示を変える日。通り過ぎても止まる
      const first = dateOf(this.day).day === 1;
      if (first) this.openMonth(notes);
      const matchDay = this.scheduledMatch?.day === this.day;
      // 大会と練習試合の日は必ず止まる。それ以外の行事は止まらず、通り過ぎても起きる（止まった時は下の land で起きる）
      const stop = here.kind === 'fixed' && !!FIXED_EVENTS.find(f => f.id === here.fixedId)?.stop;
      if (first || stop || matchDay) break;
      if (here.kind === 'fixed' && left > 0) this.land(here, card, notes);
    }
    this.afterDays(moved, card, notes, campMoved);
    const panel = this.panelAt(this.day);
    // 練習試合の日：試合をする（つなぐのは第3段階）。マネージャーが組んだものはそのイベントも起きる
    let match: ScheduledMatch | undefined;
    if (this.scheduledMatch?.day === this.day) {
      match = this.scheduledMatch;
      this.scheduledMatch = null;
      notes.push(`練習試合：${match.opponent.name}（試合とつなぐのは第3段階）`);
      this.trigger({ fixed: match.via === 'manager' ? 'managerMatch' : 'practiceMatch' }, '', notes);
    }
    const event = this.land(panel, card, notes);
    this.campHand();
    return {
      moved, panel, event: event ?? undefined, notes,
      ...(this.practiceOpen ? { practiceOpen: true } : {}),
      ...(this.matchInvite ? { matchInvite: this.matchInvite } : {}),
      ...(match ? { match } : {}),
    };
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
  }

  /** 合宿の練習ごとに、確率でランダムな選手1人が、その練習の種類に合った特能を覚える */
  private campTrait(practice: PracticeDef, notes: string[]) {
    if (!this.rng.chance(CAMP.traitChance)) return;
    const players = this.active();
    if (!players.length) return;
    const p = this.rng.pick(players);
    const role = bestRole(p);
    const pool = Object.values(TRAITS).filter(t => t.kind === 'stat' && t.color === 'blue' && !t.upgradeOf && !t.alsoUnlocks
      && (!t.roles || t.roles.includes(role)) && !p.traits.includes(t.id) && t.effects.some(e => practice.abilities.includes(e.ability as TrainKey)));
    if (!pool.length) return;
    const t = this.rng.pick(pool);
    p.traits.push(t.id);
    notes.push(`合宿：${p.number}番が特能「${t.name}」を覚えた`);
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
      case 'branch':
        return null;
      case 'fixed': {
        const name = FIXED_EVENTS.find(f => f.id === panel.fixedId)?.name ?? panel.fixedId;
        this.rosterEvent(panel.fixedId ?? '', notes);
        const def = FIXED_EVENTS.find(f => f.id === panel.fixedId);
        return this.trigger({ fixed: def?.kind ?? panel.fixedId }, `${name}（中身はまだありません）`, notes);
      }
      default: {
        // 白パネル：まれに他校から練習試合の申し込み（大会が近い時・もう予定がある時は来ない）
        if (panel.kind === 'white' && !this.scheduledMatch && !this.matchClosed() && this.saturdayFrom(this.day + 1) < DAYS_IN_YEAR - 1
          && this.rng.chance(PRACTICE_MATCH.whiteInviteChance)) {
          this.matchInvite = this.makeOpponent();
          notes.push(`白：${this.matchInvite.name}から練習試合の申し込み`);
          return null;
        }
        const names: Record<string, string> = { blue: '青', red: '赤', white: '白', training: '特訓' };
        return this.trigger({ panel: panel.kind }, `${names[panel.kind]}パネル（イベントの中身はまだありません）`, notes);
      }
    }
  }

  /** 行事のうち、部員の入れ替わりの仕組み（文章や選択肢はイベントの中身の側で入れる） */
  private rosterEvent(id: string, notes: string[]) {
    if (id === 'entrance') {
      this.newcomers = enroll(this.squad, this.year, this.gender, this.rng);
      notes.push(`新入生が${this.newcomers.length}人入部しました`);
    } else if (id === 'physical') {
      this.measured = measure(this.squad, this.year);
      notes.push(`身体測定：${this.measured.length ? this.measured.map(m => `${this.squad.players.find(p => p.id === m.id)!.number}番 +${m.cm}cm`).join('、') : '身長が伸びた選手はいません'}`);
    } else if (id === 'retire') {
      const n = this.squad.players.filter(p => gradeOf(p, this.year) >= 3 && !p.retired);
      for (const p of n) p.retired = true;
      notes.push(`3年生${n.length}人が引退しました（卒業までは試合にも練習にも出ません）`);
    } else if (id === 'campSummer' || id === 'campWinter') {
      notes.push(`${CAMP[id === 'campSummer' ? 'summer' : 'winter'].name}が始まりました（${CAMP.days}日間。練習カードだけになり、経験が多く入ります）`);
    } else if (id === 'graduation') {
      this.graduates = graduate(this.squad, this.year);
      notes.push(`3年生${this.graduates.length}人が卒業しました`);
    }
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
