// 育成（双六）の仮の画面。見た目は第4段階で作り込む。
// 手札から進行カードを選んで進む。止まったマスのパネル・イベントの結果と、選手の体力・怪我を見せる。

import { FIXED_EVENTS } from '../grow/constants';
import { POLICY, PRACTICE, type TeamPolicy } from '../grow/cards';
import { Season, type StepResult } from '../grow/season';
import type { BoardDay, Panel } from '../grow/board';
import { gradeOf } from '../sim/player';
import { makeBench, makeTeam } from '../sim/sample';
import type { Player, Role, Squad } from '../sim/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
let seed = Number(params.get('seed') || 1);

const ROLE_NAME: Record<Role, string> = { S: 'セッター', OH: 'アウトサイド', MB: 'ミドル', OP: 'オポジット', L: 'リベロ' };
const PANEL_NAME: Record<Panel['kind'], string> = {
  blue: '青', red: '赤', white: '白', green: '緑', yellow: '黄', training: '特訓', branch: '分岐', fixed: '行事',
};
const ABILITY_NAME: Record<string, string> = { jump: '跳躍', power: 'パワー', speed: 'スピード', technique: 'テクニック', block: 'ブロック', stamina: 'スタミナ' };

function newSquad(): Squad {
  const t = makeTeam(seed, 'A', 'male', 55);
  return { players: [...t.rotation.map(s => s.player), t.libero!, ...makeBench(seed, 'A', 'male', 55)], captainId: null };
}

let season = new Season({ seed, squad: newSquad() });
const log: string[] = [];

const bestRole = (p: Player): Role => (Object.entries(p.aptitude) as [Role, number][]).sort((a, b) => b[1] - a[1])[0][0];

function cellHtml(panel: Panel, here: boolean): string {
  const name = panel.kind === 'fixed' ? FIXED_EVENTS.find(f => f.id === panel.fixedId)?.name ?? '行事' : PANEL_NAME[panel.kind];
  return `<div class="cell ${panel.kind}${here ? ' here' : ''}">${name}</div>`;
}

function dayCol(d: BoardDay, here: boolean): string {
  return `<div class="dayCol"><div class="d">${d.month}/${d.day}</div>${d.lanes.map((p, i) => cellHtml(p, here && i === Math.min(season.lane, d.lanes.length - 1))).join('')}</div>`;
}

function render() {
  const { month, day } = season.date;
  $('date').textContent = `${season.year}年目 ${month}月${day}日${season.over ? '（1年が終わりました）' : ''}`;
  $('money').textContent = `お金 ${season.money}`;
  $('policy').innerHTML = (Object.keys(POLICY) as TeamPolicy[]).map(k =>
    `<button class="${season.policy === k ? 'on' : ''}" data-policy="${k}">${POLICY[k].name}</button>`).join('');
  for (const b of Array.from($('policy').querySelectorAll<HTMLButtonElement>('button'))) {
    b.onclick = () => { season.policy = b.getAttribute('data-policy') as TeamPolicy; render(); };
  }
  // 今いるマスと、この先14日分
  $('road').innerHTML = dayCol(season.board[season.day], true) + season.ahead(14).map(d => dayCol(d, false)).join('');
  // 手札
  const busy = !!season.pending || season.over;
  $('hand').innerHTML = '';
  season.hand.forEach((c, i) => {
    const pr = PRACTICE[c.practiceId];
    const b = document.createElement('button');
    b.innerHTML = `<b>${c.days}</b><small>${pr.name}</small><small>${pr.abilities.map(a => ABILITY_NAME[a]).join('・')}</small>`;
    b.disabled = busy;
    b.onclick = () => after(season.useCard(i));
    $('hand').appendChild(b);
  });
  ($('rest') as HTMLButtonElement).disabled = busy;
  // 選手
  const rows = season.squad.players.map(p => {
    const hurt = p.injuryDays > 0 ? `<span class="hurt">怪我 ${p.injuryDays}日</span>` : '';
    return `<tr><td>${p.number}</td><td>${ROLE_NAME[bestRole(p)]}</td><td>${gradeOf(p, season.year)}年</td>
      <td><span class="bar"><i style="width:${p.energy}%"></i></span> ${Math.round(p.energy)}</td><td>${hurt}</td></tr>`;
  }).join('');
  $('squad').innerHTML = `<tr><th>背番号</th><th>ポジション</th><th>学年</th><th>体力</th><th></th></tr>${rows}`;
  $('log').innerHTML = log.slice(-30).reverse().map(l => `<div>${l}</div>`).join('');
}

function after(r: StepResult) {
  const { month, day } = season.date;
  const where = r.panel ? `（${PANEL_NAME[r.panel.kind]}）` : '';
  log.push(`${month}/${day}${where} ${r.notes.join('・')}`);
  if (r.needBranch) openBranch();
  else if (season.pending) openEvent();
  render();
}

/** 分かれ道：どちらの道を通るか（それぞれの道の先のマスを見せる） */
function openBranch() {
  const ahead = season.ahead(6).filter(d => d.lanes.length === 2);
  const lane = (i: 0 | 1) => ahead.map(d => `<div class="dayCol">${cellHtml(d.lanes[i], false)}</div>`).join('');
  $('modalBox').innerHTML = `<div class="text">分かれ道：どちらの道を通りますか</div>
    <div style="display:flex;gap:4px">${lane(0)}</div><div style="display:flex;gap:4px">${lane(1)}</div>
    <div class="choices"><button id="lane0">上の道</button><button id="lane1">下の道</button></div>`;
  $('modal').classList.remove('hidden');
  ($('lane0') as HTMLButtonElement).onclick = () => { $('modal').classList.add('hidden'); after(season.chooseBranch(0)); };
  ($('lane1') as HTMLButtonElement).onclick = () => { $('modal').classList.add('hidden'); after(season.chooseBranch(1)); };
}

/** イベント：文章と選択肢 */
function openEvent() {
  const ev = season.pending!;
  const choices = ev.def.choices ?? [];
  $('modalBox').innerHTML = `<div class="text">${ev.text}</div><div class="choices" id="choices"></div>`;
  choices.forEach((c, i) => {
    const b = document.createElement('button');
    b.textContent = c.label;
    b.onclick = () => {
      $('modal').classList.add('hidden');
      log.push(`イベント：${c.label}`);
      if (season.choose(i)) openEvent();
      render();
    };
    $('choices').appendChild(b);
  });
  $('modal').classList.remove('hidden');
}

($('rest') as HTMLButtonElement).onclick = () => after(season.rest());
($('newYear') as HTMLButtonElement).onclick = () => {
  seed++;
  season = new Season({ seed, squad: newSquad() });
  log.length = 0;
  render();
};
render();
