// 1年の進行（双六）。手札から進行カードを1枚選び、書いてある日数だけ進んで、止まったマスのパネル・イベントが起きる。
// 練習の効果は「練習」の段階で作る（onPractice で渡す口だけ用意する）。育成用の体力は練習で減り、緑パネルや休みで回復する。
// 描画は知らない。仮の画面（grow.html）はこの状態を見て操作するだけ。

import { Rng } from '../sim/rng';
import type { Player, Squad } from '../sim/types';
import { dateOf, makeBoard, type BoardDay, type Panel } from './board';
import { drawCard, PRACTICE, type Card, type PracticeDef, type TeamPolicy } from './cards';
import { DAYS_IN_YEAR, ENERGY, FIXED_EVENTS, HAND, YELLOW_BONUS } from './constants';
import { EVENTS, pickEvent, resolveEvent, type EventDef, type EventWorld, type PendingEvent } from './events';

/** 練習を渡す口：使ったカードの練習・練習した日数・経験値の倍率（黄パネルで増える）・練習した選手 */
export type PracticeHook = (practice: PracticeDef, days: number, mul: number, players: Player[]) => void;

export interface SeasonOptions {
  seed: number;
  squad: Squad;
  year?: number;
  policy?: TeamPolicy;
  money?: number;
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
  /** 出来事の一言（仮の画面に出す） */
  notes: string[];
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
  /** 選択肢を待っているイベント */
  pending: PendingEvent | null = null;
  /** 分かれ道で止まっている時の、残りの日数と使ったカード */
  private branchWait: { left: number; card: Card | null } | null = null;
  readonly events: EventDef[];
  private rng: Rng;
  private onPractice?: PracticeHook;
  log: string[] = [];

  constructor(o: SeasonOptions) {
    this.board = makeBoard(o.seed);
    this.year = o.year ?? 1;
    this.squad = o.squad;
    this.policy = o.policy ?? 'all';
    this.money = o.money ?? 0;
    this.events = o.events ?? EVENTS;
    this.rng = new Rng(o.seed * 131 + 17);
    this.onPractice = o.onPractice;
    for (let i = 0; i < HAND.size; i++) this.hand.push(drawCard(this.rng, this.policy));
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
    this.hand.splice(i, 1);
    this.hand.push(drawCard(this.rng, this.policy));
    return this.move(card.days, card);
  }

  /** 休む：1日進み、練習をしないで全員の体力を回復する */
  rest(): StepResult {
    this.ready();
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
    this.pending = resolveEvent(this.pending, w, this.events, index);
    this.money = w.money;
    return this.pending;
  }

  private ready() {
    if (this.pending) throw new Error('イベントの選択肢を先に選んでください');
    if (this.branchWait) throw new Error('分かれ道で道を選んでください');
    if (this.over) throw new Error('1年が終わりました');
  }

  private world(): EventWorld {
    return { year: this.year, month: this.date.month, players: this.players(), flags: this.flags, money: this.money };
  }

  private players(): Player[] {
    return this.squad.players;
  }

  /**
   * days 日進む。card が練習の進行カードなら、その日数だけ練習する（休みなら回復する）。
   * 定期イベントのマスでは、残りの日数があっても止まる。分かれ道の手前では、道を選ぶまで止まる
   */
  private move(days: number, card: Card | null, resumed = false): StepResult {
    const notes: string[] = [];
    let moved = 0;
    let left = days;
    while (left > 0 && !this.over) {
      const next = this.board[this.day + 1];
      // 1本の道から分かれ道に入る時は、どちらの道を通るかを選ぶ
      if (next.lanes.length > 1 && this.board[this.day].lanes.length === 1 && !resumed) {
        this.branchWait = { left, card };
        this.afterDays(moved, card, notes);
        return { moved, needBranch: true, notes };
      }
      resumed = false;
      this.day++;
      if (this.board[this.day].lanes.length === 1) this.lane = 0;
      moved++;
      left--;
      this.passDay(card, notes);
      // 定期イベントのマスでは止まる
      if (this.panelAt(this.day).kind === 'fixed') break;
    }
    this.afterDays(moved, card, notes);
    const panel = this.panelAt(this.day);
    const event = this.land(panel, card, notes);
    return { moved, panel, event: event ?? undefined, notes };
  }

  /** 1日が過ぎる：練習（体力が減り、減っていると怪我をしやすい）か休み。怪我は1日ずつ治る */
  private passDay(card: Card | null, notes: string[]) {
    for (const p of this.players()) {
      if (p.injuryDays > 0) {
        p.injuryDays--;
        p.energy = Math.min(ENERGY.max, p.energy + ENERGY.rest);
        continue;
      }
      if (!card) {
        p.energy = Math.min(ENERGY.max, p.energy + ENERGY.rest);
        continue;
      }
      p.energy = Math.max(0, p.energy - ENERGY.perPracticeDay);
      // 体力が減っていると、練習で怪我をしやすい
      const risk = Math.max(0, ENERGY.injuryBelow - p.energy) * ENERGY.injuryPerPoint;
      if (risk > 0 && this.rng.chance(risk)) {
        const [lo, hi] = ENERGY.injuryDays;
        p.injuryDays = lo + Math.floor(this.rng.range(0, hi - lo + 1));
        notes.push(`${p.number}番が怪我をした（${p.injuryDays}日）`);
      }
    }
  }

  /** 進んだ日数分の練習を、練習の口に渡す（怪我をしていない選手だけ） */
  private afterDays(moved: number, card: Card | null, notes: string[], mul = 1) {
    if (!card || moved === 0) return;
    const practice = PRACTICE[card.practiceId];
    this.onPractice?.(practice, moved, mul, this.players().filter(p => p.injuryDays === 0));
    notes.push(`${practice.name}を${moved}日`);
  }

  /** 止まったマスのパネル */
  private land(panel: Panel, card: Card | null, notes: string[]): PendingEvent | null {
    switch (panel.kind) {
      case 'green':
        for (const p of this.players()) p.energy = Math.min(ENERGY.max, p.energy + ENERGY.green);
        notes.push('緑：体力が回復した');
        return null;
      case 'yellow':
        // 練習の進行カードで止まると、その練習の経験値が増える
        if (card) {
          const practice = PRACTICE[card.practiceId];
          this.onPractice?.(practice, 1, YELLOW_BONUS - 1, this.players().filter(p => p.injuryDays === 0));
          notes.push(`黄：${practice.name}の経験値が増えた`);
        }
        return null;
      case 'branch':
        return null;
      case 'fixed': {
        const name = FIXED_EVENTS.find(f => f.id === panel.fixedId)?.name ?? panel.fixedId;
        return this.trigger({ fixed: panel.fixedId }, `${name}（中身はまだありません）`, notes);
      }
      default: {
        const names: Record<string, string> = { blue: '青', red: '赤', white: '白', training: '特訓' };
        return this.trigger({ panel: panel.kind }, `${names[panel.kind]}パネル（イベントの中身はまだありません）`, notes);
      }
    }
  }

  private trigger(t: { panel?: Panel['kind']; fixed?: string }, empty: string, notes: string[]): PendingEvent | null {
    const ev = pickEvent(this.events, t, this.world(), this.rng);
    if (!ev) { notes.push(empty); return null; }
    this.pending = ev;
    // 選択肢のないイベントは、すぐに効果をかける
    if (!ev.def.choices?.length) this.choose();
    return ev;
  }
}
