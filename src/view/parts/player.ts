// 共通部品：選手一覧の1行と、選手の詳細。試合前・停止画面・相手の一覧・育成のステータスで同じものを使う。
// 部品は「選手のデータ＋その画面の事情（RowContext）」を受け取って HTML を作るだけ。計算は知らない。
// 操作はタップ前提：行を押すと詳細を出す（ホバーでは何も出さない）。

import { gradeOf } from '../../sim/player';
import { TRAITS, type TraitDef } from '../../sim/traits';
import type { Player, Role, TrainKey } from '../../sim/types';
import { abilityRank, APT_MARK } from '../common';

export type RowMode = 'pregame' | 'stop' | 'opponent' | 'grow';

/** その画面の事情（出せるものだけ渡す） */
export interface RowContext {
  mode: RowMode;
  /** 区分（コート・リベロ・控え など。試合前） */
  where?: string;
  /** 担当している位置（省くと一番適性の高い位置） */
  role?: Role;
  /** 年度（学年の計算。育成） */
  year?: number;
  /** 疲れの一言（停止画面。「足が止まってきた」など） */
  tired?: string;
  /** 練習指示の文字（育成）。practiceButton なら押せるボタンにする（data-pr に選手の ID） */
  practice?: string;
  practiceButton?: boolean;
  /** 新入生・引退（育成） */
  isNew?: boolean;
  /** 選んでいる（入れ替えの途中など） */
  selected?: boolean;
  /** 薄く出す（控えなど） */
  dim?: boolean;
}

export const ROLE_NAME: Record<Role, string> = { S: 'セッター', OH: 'アウトサイド', MB: 'ミドル', OP: 'オポジット', L: 'リベロ' };
export const ROLE_SHORT: Record<Role, string> = { S: 'S', OH: 'OH', MB: 'MB', OP: 'OP', L: 'L' };
export const ABILITY_KEYS: TrainKey[] = ['jump', 'power', 'speed', 'technique', 'block', 'stamina'];
export const ABILITY_NAME: Record<TrainKey, string> = { jump: '跳躍', power: 'パワー', speed: 'スピード', technique: 'テクニック', block: 'ブロック', stamina: 'スタミナ' };
export const ABILITY_SHORT: Record<TrainKey, string> = { jump: '跳', power: '力', speed: '速', technique: '技', block: 'ブ', stamina: '体' };
export const COND_NAME = ['絶不調', '不調', '普通', '好調', '絶好調'];
const COND_CLASS = ['c-worst', 'c-bad', 'c-normal', 'c-good', 'c-best'];

export const bestRole = (p: Player): Role => (Object.entries(p.aptitude) as [Role, number][]).sort((a, b) => b[1] - a[1])[0][0];

/** 能力の段階と数値（「B 72」）。段階は色つき */
export function abilityHtml(v: number): string {
  const r = abilityRank(v);
  return `<span class="ab"><b class="rk rk-${r}">${r}</b><small>${v}</small></span>`;
}

export function conditionHtml(c: number): string {
  return `<span class="cond ${COND_CLASS[c + 2]}">${COND_NAME[c + 2]}</span>`;
}

/** 特能の色の区分：金・青・赤・緑（スタイル）・解禁 */
export function traitClass(t: TraitDef): string {
  if (t.kind === 'stat') return t.color === 'other' ? 'tr-other' : `tr-${t.color}`;
  return t.kind === 'style' ? 'tr-style' : 'tr-unlock';
}

const TRAIT_ORDER = ['tr-gold', 'tr-blue', 'tr-unlock', 'tr-style', 'tr-other', 'tr-red'];

export function traitChip(t: TraitDef): string {
  return `<span class="tr ${traitClass(t)}">${t.name}</span>`;
}

/** 主な特能：金 → 青 → 解禁 → 緑 → 赤 の順に2つまで。残りは「＋n」 */
export function mainTraitsHtml(p: Player, max = 2): string {
  const list = p.traits.map(id => TRAITS[id]).filter((t): t is TraitDef => !!t)
    .sort((a, b) => TRAIT_ORDER.indexOf(traitClass(a)) - TRAIT_ORDER.indexOf(traitClass(b)));
  if (!list.length) return '<span class="none">－</span>';
  const more = list.length - max;
  return list.slice(0, max).map(traitChip).join('') + (more > 0 ? `<span class="more">＋${more}</span>` : '');
}

/** 列（画面ごとに出し分ける） */
type Col = 'where' | 'no' | 'name' | 'grade' | 'role' | 'height' | 'cond' | 'abilities' | 'energy' | 'practice' | 'traits' | 'tired';
const COLS: Record<RowMode, Col[]> = {
  pregame: ['where', 'no', 'name', 'role', 'height', 'cond', 'abilities', 'traits'],
  stop: ['no', 'name', 'role', 'cond', 'traits', 'tired'],
  opponent: ['no', 'name', 'role', 'height', 'abilities', 'traits'],
  grow: ['no', 'name', 'grade', 'role', 'height', 'cond', 'abilities', 'energy', 'practice', 'traits'],
};
const HEAD: Record<Col, string> = {
  where: '区分', no: '番', name: '名前', grade: '年', role: 'ポジ', height: '身長', cond: '調子', abilities: '', energy: '体力', practice: '練習指示', traits: '主な特能', tired: '',
};

/** 見出しの行 */
export function rowHeadHtml(mode: RowMode): string {
  return `<div class="prow head m-${mode}">${COLS[mode].map(c => c === 'abilities'
    ? `<span class="c-abilities">${ABILITY_KEYS.map(k => `<span class="ab">${ABILITY_SHORT[k]}</span>`).join('')}</span>`
    : `<span class="c-${c}">${HEAD[c]}</span>`).join('')}</div>`;
}

/** 一覧の1行。押すと詳細を出すため、行には data-player に選手の ID を持たせる */
export function playerRowHtml(p: Player, ctx: RowContext): string {
  const role = ctx.role ?? bestRole(p);
  const cell = (c: Col): string => {
    switch (c) {
      case 'where': return `<span class="c-where">${ctx.where ?? ''}</span>`;
      case 'no': return `<span class="c-no">${p.number}</span>`;
      case 'name': return `<span class="c-name">${p.name}${ctx.isNew ? '<small class="new">新</small>' : ''}</span>`;
      case 'grade': return `<span class="c-grade">${ctx.year !== undefined ? gradeOf(p, ctx.year) : ''}</span>`;
      case 'role': return `<span class="c-role">${ROLE_SHORT[role]}</span>`;
      case 'height': return `<span class="c-height">${p.height}</span>`;
      case 'cond': return `<span class="c-cond">${conditionHtml(p.condition)}</span>`;
      case 'abilities': return `<span class="c-abilities">${ABILITY_KEYS.map(k => abilityHtml(p[k])).join('')}</span>`;
      case 'energy': return `<span class="c-energy"><span class="bar"><i style="width:${Math.round(p.energy)}%"></i></span><small>${Math.round(p.energy)}</small></span>`;
      case 'practice': return `<span class="c-practice">${p.retired ? '<span class="retired">引退</span>'
        : ctx.practiceButton ? `<button class="pbtn" data-pr="${p.id}">${ctx.practice ?? ''}</button>` : `<small>${ctx.practice ?? ''}</small>`}</span>`;
      case 'traits': return `<span class="c-traits">${mainTraitsHtml(p)}</span>`;
      case 'tired': return `<span class="c-tired">${ctx.tired ?? ''}</span>`;
    }
  };
  const cls = ['prow', `m-${ctx.mode}`, ctx.selected ? 'sel' : '', ctx.dim ? 'dim' : '', p.retired ? 'dim' : ''].join(' ');
  return `<div class="${cls}" data-player="${p.id}" role="button">${COLS[ctx.mode].map(cell).join('')}</div>`;
}

/** 選手の詳細（真ん中に大きく出す中身）。特能は名前（色つき）だけ。説明文はゲームとは別の「特能の一覧」のページに載せる */
export function playerDetailHtml(p: Player, ctx: RowContext): string {
  const role = ctx.role ?? bestRole(p);
  const roles = Object.keys(ROLE_NAME) as Role[];
  const traits = p.traits.map(id => TRAITS[id]).filter((t): t is TraitDef => !!t)
    .sort((a, b) => TRAIT_ORDER.indexOf(traitClass(a)) - TRAIT_ORDER.indexOf(traitClass(b)));
  const st = p.stats;
  const grow = ctx.mode === 'grow';
  return `<div class="pd">
    <div class="pd-head"><b class="pd-no">${p.number}</b><b class="pd-name">${p.name}</b>
      <span>${ROLE_NAME[role]}</span>${ctx.year !== undefined ? `<span>${gradeOf(p, ctx.year)}年</span>` : ''}
      <span>${p.height}cm</span><span>${p.hand === 'left' ? '左利き' : '右利き'}</span>${conditionHtml(p.condition)}${p.retired ? '<span class="retired">引退</span>' : ''}</div>
    <div class="pd-sec"><div class="pd-abil">${ABILITY_KEYS.map(k => `<div><span class="lbl">${ABILITY_NAME[k]}</span>${abilityHtml(p[k])}</div>`).join('')}</div></div>
    <div class="pd-sec"><span class="lbl">適性</span><span class="pd-apt">${roles.map(r => `<span>${ROLE_SHORT[r]}<b>${APT_MARK[p.aptitude[r]]}</b></span>`).join('')}</span></div>
    <div class="pd-sec"><div class="lbl">特能</div><div class="pd-traits">${traits.length ? traits.map(traitChip).join('') : '<span class="none">なし</span>'}</div></div>
    ${grow ? `<div class="pd-sec"><span class="lbl">体力</span><span class="bar"><i style="width:${Math.round(p.energy)}%"></i></span> ${Math.round(p.energy)}　<span class="lbl">練習指示</span>${ctx.practice ?? ''}</div>` : ''}
    ${ctx.tired ? `<div class="pd-sec">${ctx.tired}</div>` : ''}
    <div class="pd-sec"><span class="lbl">通算</span>${st.matches}試合・${st.sets}セット・スパイク得点 ${st.kills}・ブロック得点 ${st.blockPoints}・サービスエース ${st.aces}</div>
  </div>`;
}

/**
 * 詳細を真ん中に大きく出す。root は画面全体の入れ物。閉じるボタンか、詳細の外を押すと閉じる
 */
export function showPlayerDetail(root: HTMLElement, p: Player, ctx: RowContext, onClose?: () => void) {
  closePlayerDetail(root);
  const layer = document.createElement('div');
  layer.className = 'pd-layer';
  layer.innerHTML = `<div class="pd-panel">${playerDetailHtml(p, ctx)}<button class="pd-close">閉じる</button></div>`;
  const close = () => { layer.remove(); onClose?.(); };
  layer.addEventListener('click', e => { if (e.target === layer) close(); });
  (layer.querySelector('.pd-close') as HTMLButtonElement).onclick = close;
  root.appendChild(layer);
}

export function closePlayerDetail(root: HTMLElement) {
  root.querySelector(':scope > .pd-layer')?.remove();
}

/** 一覧の入れ物の中の行に、押した時の動き（詳細を出す）をつける。練習指示のボタンは行の動きにしない */
export function bindRows(list: HTMLElement, onTap: (playerId: string) => void) {
  for (const row of Array.from(list.querySelectorAll<HTMLElement>('.prow[data-player]'))) {
    row.onclick = e => {
      if ((e.target as HTMLElement).closest('button')) return;
      onTap(row.getAttribute('data-player')!);
    };
  }
}
