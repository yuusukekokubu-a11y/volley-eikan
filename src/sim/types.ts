// 試合計算の入出力の型。描画側はここの RallyRecord だけを読む。

import type { StatEffect } from './traits';

export type Gender = 'male' | 'female';
export type TeamId = 'A' | 'B';

/** コート上の役割（ポジション適性と同じ5種） */
export type Role = 'S' | 'OH' | 'MB' | 'OP' | 'L';

export type ServeType = 'float' | 'jumpFloat' | 'spike';

/** 基本能力。身長は cm、ほかは 0〜100 */
export interface Abilities {
  height: number;
  jump: number;
  power: number;
  speed: number;
  technique: number;
  block: number;
  stamina: number;
}

/** ポジション適性の段階：0＝－（ほぼできない）、1＝△（不慣れ）、2＝○（こなせる）、3＝◎（本職） */
export type AptStage = 0 | 1 | 2 | 3;

/** 練習で伸びる能力（身長以外の6つ） */
export type TrainKey = Exclude<keyof Abilities, 'height'>;

export type Hand = 'right' | 'left';

/** 見た目（それぞれ見た目の候補の番号。描画側が色や形に直す） */
export interface Looks {
  hairStyle: number;
  hairColor: number;
  skin: number;
}

/** 通算成績 */
export interface CareerStats {
  /** 出場した試合・セット */
  matches: number;
  sets: number;
  /** スパイク得点（フェイント・ブロックアウトを含む）、ブロック得点、サービスエース */
  kills: number;
  blockPoints: number;
  aces: number;
}

/**
 * 選手のデータ（育成でセーブするもの）。試合の計算は能力・適性・特能・調子・信頼度だけを読む。
 * 試合中だけの状態（疲れ・一時的な上下・コート上の位置）はここに持たず、試合の側で持つ。
 */
export interface Player extends Abilities {
  // ---- 最初に決まって変わらないもの ----
  /** 選手を見分ける番号（卒業まで変わらない） */
  id: string;
  name: string;
  /** 入学した年度（学年はここから計算する） */
  enrollYear: number;
  /** 身長の伸びしろ（cm、見えない）。4月の身体測定で身長に反映する */
  heightPotential: number;
  /** 利き腕（効き方は特能の段階で決める。今は持つだけ） */
  hand: Hand;
  looks: Looks;

  // ---- 育成で変わるもの ----
  number: number;
  /** ポジション適性（4段階） */
  aptitude: Record<Role, AptStage>;
  /** 特殊能力の ID（traits.ts の TRAITS に登録されたもの）。サーブの種類も解禁特能で決まる */
  traits: string[];
  /** 調子 -2（絶不調）〜 +2（絶好調）。試合中は変えない */
  condition: number;
  /** 信頼度（見えない値 0〜100）。試合に出るほど上がり、試合中だけ全能力が少し上がる */
  trust: number;
  /** 怪我の残り日数（0なら怪我なし） */
  injuryDays: number;
  /** 能力ごとの経験の端数（1たまると能力が1上がる） */
  exp: Record<TrainKey, number>;
  /** 位置ごとの適性の経験（たまると適性が1段階上がる） */
  aptExp: Record<Role, number>;
  /** 特能のきっかけの進み具合（特能 ID ごと） */
  traitProgress: Record<string, number>;
  stats: CareerStats;
  /** 卒業後の進路（決まるまでは null） */
  career: string | null;

  // ---- 枠だけ（中身は後の段階で） ----
  personality: string | null;
  middleSchool: string | null;
}

/** 部員全体（育成でセーブするもの） */
export interface Squad {
  players: Player[];
  /** 主将（枠だけ。中身は後の段階で） */
  captainId: string | null;
}

export type AttackTactic = 'ace' | 'balance' | 'quick';
export type BlockTactic = 'bunch' | 'spread' | 'dedicate';
export type ReceiveTactic = 'front' | 'back';

export interface Tactics {
  attack: AttackTactic;
  block: BlockTactic;
  receive: ReceiveTactic;
}

export interface LineupSlot {
  player: Player;
  role: Exclude<Role, 'L'>;
}

export interface TeamState {
  name: string;
  /** ローテーション順。[0]=ゾーン1（サーブ位置）, [1]=ゾーン2, … [5]=ゾーン6 */
  rotation: LineupSlot[];
  libero?: Player;
  tactics: Tactics;
  /** 選手ごとの疲れ 0〜1。試合側で積み上げて渡す */
  fatigue?: Record<string, number>;
  /** チーム全員にかかる一時的な能力の上下（タイムアウトの監督特能など）。特能と同じ「場面・能力・段階」の形 */
  buffs?: StatEffect[];
}

export interface RallyContext {
  setNumber: number;
  isFinalSet: boolean;
  score: Record<TeamId, number>;
  /** 今のサーバーのサーブで続けて取っている点（連続サーブの場面用） */
  serveStreak?: number;
  /** 途中から入った選手の ID（ピンチサーバーの場面用） */
  subbedIn?: string[];
}

export interface RallyInput {
  gender: Gender;
  teams: Record<TeamId, TeamState>;
  serving: TeamId;
  seed: number;
  context?: RallyContext;
}

// ---------------------------------------------------------------
// 記録（出力）
// 座標はメートル。x はコートの長辺方向でネットが x=0。チームAは x<0、チームBは x>0。
// y は短辺方向（-4.5〜4.5）、z は高さ（床が0）。
// ---------------------------------------------------------------

export interface Vec2 { x: number; y: number }
export interface Vec3 { x: number; y: number; z: number }

/**
 * ボールの1区間。始点→終点を t0→t1 で飛ぶ。
 * 高さは z(s) = z0 + (z1 - z0) * s + 4 * bulge * s * (1 - s)（s は 0→1 の進み具合）。
 * 水平方向は等速。
 */
export interface BallSegment {
  t0: number;
  t1: number;
  from: Vec3;
  to: Vec3;
  bulge: number;
  kind: BallKind;
}

export type BallKind =
  | 'serve' | 'pass' | 'set' | 'spike' | 'tip' | 'freeball'
  | 'blockRebound' | 'deflect' | 'drop';

export type ActionType =
  | 'serve' | 'receive' | 'dig' | 'set' | 'spike' | 'tip' | 'block'
  | 'freeball' | 'cover' | 'fakeJump'
  /** ツーアタック：セッターが2本目を片手で相手コートに落とす */
  | 'dump'
  /** サーブトスを上げる */
  | 'toss';

export type RallyEvent =
  | { type: 'move'; t: number; playerId: string; to: Vec2; dur: number }
  /** oneFoot：片足で踏み切る（ブロード） */
  | { type: 'jump'; t: number; playerId: string; dur: number; height: number; oneFoot?: boolean }
  | { type: 'action'; t: number; playerId: string; team: TeamId; action: ActionType; pos: Vec3; info?: ActionInfo }
  | { type: 'land'; t: number; pos: Vec3; inCourt: boolean }
  | { type: 'point'; t: number; winner: TeamId; reason: PointReason; playerId?: string };

export interface ActionInfo {
  /** レシーブ・ディグの質（位置のずれ m と 回転・勢い 0〜1） */
  offset?: number;
  spin?: number;
  setType?: SetType;
  /** スパイクの最高の打点（cm）。身長と跳躍だけで決まる */
  hitHeight?: number;
  /** 実際にボールに触った高さ（cm）。助走が短い・踏み切りのタイミングがずれると最高の打点より低くなる */
  contactHeight?: number;
  /** ブロックの到達点（cm）。複数枚なら最も高いもの */
  blockReach?: number;
  blockers?: string[];
  overBlock?: boolean;
  serveType?: ServeType;
  /** 二段トス（セッター以外のトス） */
  secondary?: boolean;
  /** 相手の返球を直接打った（ダイレクト） */
  direct?: boolean;
}

/**
 * トスの種類：速攻・時間差・平行・オープン・バックアタック（後衛がアタックラインの後ろから打つ）・
 * ブロード（ミドルが横に走って片足で踏み切る移動攻撃）
 */
export type SetType = 'quick' | 'timeDiff' | 'fast' | 'high' | 'back' | 'broad';

export type PointReason =
  | 'ace'            // サービスエース
  | 'serveFault'     // サーブミス
  | 'kill'           // スパイク決定
  | 'tipKill'        // フェイント・軟打の決定
  | 'blockKill'      // ブロック得点
  | 'blockOut'       // ブロックアウト
  | 'attackError'    // スパイクミス（アウト・ネット）
  | 'freeballDrop'   // 返球・つなぎが落ちた
  | 'receiveError';  // つなぎのミス（ボールが続かない）

export interface PlayerPlacement {
  playerId: string;
  team: TeamId;
  number: number;
  role: Role;
  height: number;
  pos: Vec2;
  /** 左利き（打つ腕。描画で打つ手を決める）。右利きなら省く */
  hand?: 'left';
}

export interface RallyRecord {
  seed: number;
  serving: TeamId;
  winner: TeamId;
  reason: PointReason;
  /** 得点（または失点）に関わった選手。「〇〇のスパイク」などの一言用 */
  keyPlayerId?: string;
  duration: number;
  placements: PlayerPlacement[];
  events: RallyEvent[];
  ball: BallSegment[];
  /** 選手ごとの負荷（跳んだ回数・動いた量など）。疲れの計算は試合側で行う */
  load: Record<string, number>;
  /** 打数などの集計用 */
  touches: number;
}
