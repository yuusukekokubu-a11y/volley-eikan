// セーブ：育成全体（Career）を文字列にして、ブラウザの保存領域（localStorage）に置く。描画は知らない。
// 枠は1つ。行動のたびに自動で保存する（やり直しはできない形）。書き出し・読み込みで端末の間を移せる。
// 形に版の番号を付け、古い版のセーブは migrate で今の形に直してから読む。

import { Career, type CareerData } from './career';
import type { EventDef } from './events';
import type { PracticeHook } from './season';

/** セーブの形の版。形を変えたら上げ、MIGRATIONS に直し方を足す */
export const SAVE_VERSION = 1;
export const SAVE_KEY = 'volley-eikan-save';

export interface SaveFile {
  version: number;
  /** 保存した日時（ISO 形式） */
  savedAt: string;
  career: CareerData;
}

/** 古い版から1つ新しい版へ直す（版 n → n+1）。今は版1だけなので空 */
export const MIGRATIONS: Record<number, (d: SaveFile) => SaveFile> = {};

/** 文字列にする */
export function serialize(c: Career, now = new Date()): string {
  const f: SaveFile = { version: SAVE_VERSION, savedAt: now.toISOString(), career: c.toData() };
  return JSON.stringify(f);
}

/** 文字列から読み戻す。古い版は順に直す。壊れていれば例外 */
export function deserialize(text: string, o: { events?: EventDef[]; onPractice?: PracticeHook } = {}): Career {
  let f = JSON.parse(text) as SaveFile;
  if (typeof f?.version !== 'number' || !f.career) throw new Error('セーブの形がちがいます');
  if (f.version > SAVE_VERSION) throw new Error('新しい版のセーブです。ゲームを新しくしてください');
  while (f.version < SAVE_VERSION) {
    const step = MIGRATIONS[f.version];
    if (!step) throw new Error(`版${f.version}のセーブは読めません`);
    f = step(f);
  }
  return Career.fromData(f.career, o);
}

/** ブラウザの保存領域（テストでは代わりのものを渡す） */
export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function saveTo(store: Store, c: Career) {
  store.setItem(SAVE_KEY, serialize(c));
}

export function loadFrom(store: Store): Career | null {
  const t = store.getItem(SAVE_KEY);
  return t ? deserialize(t) : null;
}

export function clearSave(store: Store) {
  store.removeItem(SAVE_KEY);
}

/** 書き出し：別の端末へ移すための文字列（セーブそのもの） */
export const exportSave = (c: Career): string => serialize(c);

/** 読み込み：書き出した文字列から読み戻す（読めなければ例外。今のセーブは消さない） */
export const importSave = (text: string): Career => deserialize(text.trim());
