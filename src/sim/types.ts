// 試合計算の入出力の型。描画側はここの RallyRecord だけを読む。

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

export interface Player extends Abilities {
  id: string;
  name: string;
  number: number;
  /** ポジション適性 0〜100 */
  aptitude: Record<Role, number>;
  serveType: ServeType;
  /** 特殊能力の ID。今の段階では効果なし（traits.ts の差し込み口から効かせる） */
  traits: string[];
  /** 調子 -2（絶不調）〜 +2（絶好調） */
  condition: number;
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
}

export interface RallyContext {
  setNumber: number;
  isFinalSet: boolean;
  score: Record<TeamId, number>;
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
  | 'freeball' | 'cover' | 'fakeJump';

export type RallyEvent =
  | { type: 'move'; t: number; playerId: string; to: Vec2; dur: number }
  | { type: 'jump'; t: number; playerId: string; dur: number; height: number }
  | { type: 'action'; t: number; playerId: string; team: TeamId; action: ActionType; pos: Vec3; info?: ActionInfo }
  | { type: 'land'; t: number; pos: Vec3; inCourt: boolean }
  | { type: 'point'; t: number; winner: TeamId; reason: PointReason; playerId?: string };

export interface ActionInfo {
  /** レシーブ・ディグの質（位置のずれ m と 回転・勢い 0〜1） */
  offset?: number;
  spin?: number;
  setType?: SetType;
  /** スパイクの打点（cm） */
  hitHeight?: number;
  /** ブロックの到達点（cm）。複数枚なら最も高いもの */
  blockReach?: number;
  blockers?: string[];
  overBlock?: boolean;
  serveType?: ServeType;
  /** 二段トス（セッター以外のトス） */
  secondary?: boolean;
}

export type SetType = 'quick' | 'timeDiff' | 'fast' | 'high';

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
