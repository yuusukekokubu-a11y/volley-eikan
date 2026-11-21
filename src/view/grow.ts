// 育成（双六）の仮の画面。見た目は第4段階で作り込む。
// 手札から進行カードを選んで進む。止まったマスのパネル・イベントの結果と、選手の体力・調子を見せる。

import { FIXED_EVENTS, MONEY } from '../grow/constants';
import { EQUIPMENT } from '../grow/practice';
import { abilityRank } from './common';
import { POLICY, PRACTICE, type TeamPolicy } from '../grow/cards';
import { Career } from '../grow/career';
import { SURNAMES } from '../grow/names';
import type { StepResult } from '../grow/season';
import { Rng } from '../sim/rng';
import type { BoardDay, Panel } from '../grow/board';
import { gradeOf } from '../sim/player';
import { makeBench, makeTeam } from '../sim/sample';
import type { Player, Role, Squad, TrainKey } from '../sim/types';

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
  const players = [...t.rotation.map(s => s.player), t.libero!, ...makeBench(seed, 'A', 'male', 55)];
  // 試作用の部員にも名字を付ける
  const rng = new Rng(seed * 3 + 1);
  for (const p of players) p.name = rng.pick(SURNAMES);
  return { players, captainId: null };
}

let career = new Career({ seed, squad: newSquad() });
let season = career.season;
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
  $('date').textContent = `${season.year}年目 ${month}月${day}日${season.over ? '（1年が終わりました。「次の年へ」で新しい年度に進みます）' : ''}`;
  $('money').textContent = `お金 ${season.money.toLocaleString()}円`;
  $('gym').textContent = `体育館レベル ${season.gym}`;
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
  ($('nextYear') as HTMLButtonElement).disabled = !season.over;
  // 選手：能力（段階＋数値）、体力、調子、練習指示（押すと変える）
  const KEYS: TrainKey[] = ['jump', 'power', 'speed', 'technique', 'block', 'stamina'];
  const COND = ['絶不調', '不調', '普通', '好調', '絶好調'];
  const rows = season.squad.players.map(p => {
    const ab = KEYS.map(k => `<td>${abilityRank(p[k])}${p[k]}</td>`).join('');
    const focus = p.practice.focus === 'auto' ? 'おまかせ' : ABILITY_NAME[p.practice.focus];
    const isNew = season.newcomers.includes(p) ? '（新）' : '';
    return `<tr><td>${p.number}</td><td>${p.name}${isNew}</td><td>${p.height}</td><td>${ROLE_NAME[bestRole(p)].slice(0, 3)}</td><td>${gradeOf(p, season.year)}</td>${ab}
      <td><span class="bar"><i style="width:${p.energy}%"></i></span>${Math.round(p.energy)}</td><td>${COND[p.condition + 2]}</td>
      <td><button class="small" data-pr="${p.id}">${focus}・${ROLE_NAME[p.practice.position].slice(0, 3)}</button></td></tr>`;
  }).join('');
  $('squad').innerHTML = `<tr><th>番</th><th>名前</th><th>身長</th><th>位置</th><th>年</th>${KEYS.map(k => `<th>${ABILITY_NAME[k].slice(0, 2)}</th>`).join('')}<th>体力</th><th>調子</th><th>練習指示</th></tr>${rows}`;
  for (const b of Array.from($('squad').querySelectorAll<HTMLButtonElement>('button[data-pr]'))) {
    b.onclick = () => openPractice(b.getAttribute('data-pr')!);
  }
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

/** 練習指示：伸ばす能力と、練習するポジション */
function openPractice(id: string) {
  const p = season.squad.players.find(x => x.id === id)!;
  const draw = () => {
    const focus: (TrainKey | 'auto')[] = ['auto', 'jump', 'power', 'speed', 'technique', 'block', 'stamina'];
    $('modalBox').innerHTML = `<div class="text">${p.number}番の練習指示</div>
      <div class="choices">${focus.map(f => `<button class="${p.practice.focus === f ? 'on' : 'off'}" data-f="${f}">${f === 'auto' ? 'おまかせ' : ABILITY_NAME[f]}</button>`).join('')}</div>
      <div class="text">練習するポジション</div>
      <div class="choices">${(Object.keys(ROLE_NAME) as Role[]).map(r => `<button class="${p.practice.position === r ? 'on' : 'off'}" data-r="${r}">${ROLE_NAME[r]}</button>`).join('')}</div>
      <div class="choices"><button id="close">閉じる</button></div>`;
    for (const b of Array.from($('modalBox').querySelectorAll<HTMLButtonElement>('button[data-f]'))) {
      b.onclick = () => { p.practice.focus = b.getAttribute('data-f') as TrainKey | 'auto'; draw(); };
    }
    for (const b of Array.from($('modalBox').querySelectorAll<HTMLButtonElement>('button[data-r]'))) {
      b.onclick = () => { p.practice.position = b.getAttribute('data-r') as Role; draw(); };
    }
    ($('close') as HTMLButtonElement).onclick = () => { $('modal').classList.add('hidden'); render(); };
  };
  draw();
  $('modal').classList.remove('hidden');
}

/** 買い物：機材を買う（持つと、その練習のカードが出る。体育館レベルが上がる） */
function openShop() {
  const draw = () => {
    const rows = EQUIPMENT.map(e => {
      const owned = season.equipment.includes(e.id);
      const price = MONEY.price[e.equipment as 'basic' | 'advanced'];
      return `<tr><td>${e.name}</td><td>${e.abilities.map(a => ABILITY_NAME[a]).join('・')}</td><td>${e.equipment === 'basic' ? '下位' : '上位'}</td>
        <td>${price.toLocaleString()}円</td><td>${owned ? '持っている' : `<button data-buy="${e.id}" ${season.money < price ? 'disabled' : ''}>買う</button>`}</td></tr>`;
    }).join('');
    $('modalBox').innerHTML = `<div class="text">買い物（お金 ${season.money.toLocaleString()}円・体育館レベル ${season.gym}）</div>
      <div style="max-height:250px;overflow-y:auto"><table id="shopTable">${rows}</table></div>
      <div class="choices"><button id="close">閉じる</button></div>`;
    for (const b of Array.from($('modalBox').querySelectorAll<HTMLButtonElement>('button[data-buy]'))) {
      b.onclick = () => { season.buy(b.getAttribute('data-buy')!); log.push(`機材を買った：${PRACTICE[b.getAttribute('data-buy')!].name}`); draw(); };
    }
    ($('close') as HTMLButtonElement).onclick = () => { $('modal').classList.add('hidden'); render(); };
  };
  draw();
  $('modal').classList.remove('hidden');
}

/** 卒業生の名簿 */
function openGraduates() {
  const KEYS: TrainKey[] = ['jump', 'power', 'speed', 'technique', 'block', 'stamina'];
  const rows = career.graduates.concat(season.graduates).map(g =>
    `<tr><td>${g.gradYear}年目</td><td>${g.number}</td><td>${g.name}</td><td>${ROLE_NAME[g.role].slice(0, 3)}</td><td>${g.height}</td>${KEYS.map(k => `<td>${abilityRank(g.abilities[k])}${g.abilities[k]}</td>`).join('')}</tr>`).join('');
  $('modalBox').innerHTML = `<div class="text">卒業生の名簿</div>
    <div style="max-height:250px;overflow-y:auto"><table>${rows ? `<tr><th>卒業</th><th>番</th><th>名前</th><th>位置</th><th>身長</th>${KEYS.map(k => `<th>${ABILITY_NAME[k].slice(0, 2)}</th>`).join('')}</tr>${rows}` : '<tr><td>まだいません</td></tr>'}</table></div>
    <div class="choices"><button id="close">閉じる</button></div>`;
  ($('close') as HTMLButtonElement).onclick = () => { $('modal').classList.add('hidden'); render(); };
  $('modal').classList.remove('hidden');
}

($('shop') as HTMLButtonElement).onclick = openShop;
($('grads') as HTMLButtonElement).onclick = openGraduates;
($('nextYear') as HTMLButtonElement).onclick = () => {
  season = career.nextYear();
  log.push(`${season.year}年目が始まりました（部費 ${MONEY.budget.toLocaleString()}円）`);
  render();
};
($('rest') as HTMLButtonElement).onclick = () => after(season.rest());
($('newYear') as HTMLButtonElement).onclick = () => {
  seed++;
  career = new Career({ seed, squad: newSquad() });
  season = career.season;
  log.length = 0;
  render();
};
render();
