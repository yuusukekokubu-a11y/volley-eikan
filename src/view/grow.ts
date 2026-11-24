// 育成（双六）の仮の画面。見た目は第4段階で作り込む。
// 手札から進行カードを選んで進む。止まったマスのパネル・イベントの結果と、選手の体力・調子を見せる。

import { FIXED_EVENTS, MONEY } from '../grow/constants';
import { EQUIPMENT } from '../grow/practice';
import { abilityRank } from './common';
import { bindRows, playerRowHtml, rowHeadHtml, showPlayerDetail, type RowContext } from './parts/player';
import { REPUTATION } from '../grow/constants';
import { POLICY, PRACTICE, type TeamPolicy } from '../grow/cards';
import { Career } from '../grow/career';
import { clearSave, exportSave, importSave, loadFrom, saveTo, type Store } from '../grow/save';
import { enroll } from '../grow/roster';
import type { MatchOpponent, StepResult } from '../grow/season';
import type { MatchOutcome } from '../grow/matchplay';
import { isLibero } from '../grow/school';
import { SQUAD_LIMIT } from '../grow/constants';
import type { Tournament } from '../grow/tournament';
import { rankName, schoolRankName } from '../grow/reputation';
import { MANAGER_SKILLS } from '../sim/manager';
import { fill, TEXTS, type Message } from '../grow/texts';
import { Rng } from '../sim/rng';
import type { BoardDay, Panel } from '../grow/board';
import type { Player, Role, Squad, TrainKey } from '../sim/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
let seed = Number(params.get('seed') || 1);

const ROLE_NAME: Record<Role, string> = { S: 'セッター', OH: 'アウトサイド', MB: 'ミドル', OP: 'オポジット', L: 'リベロ' };
const PANEL_NAME: Record<Panel['kind'], string> = {
  blue: '青', red: '赤', white: '白', green: '緑', yellow: '黄', training: '特訓', seminar: '研修会', ob: 'OB', branch: '分岐', fixed: '行事',
};
const ABILITY_NAME: Record<string, string> = { jump: '跳躍', power: 'パワー', speed: 'スピード', technique: 'テクニック', block: 'ブロック', stamina: 'スタミナ' };

/** 最初の部員：新入生の仕組みで2・3年生を作る（評判は弱小から始まるので、弱小の新入生の決まりで） */
function newSquad(): Squad {
  const sq: Squad = { players: [], captainId: null };
  const rng = new Rng(seed * 3 + 1);
  enroll(sq, -1, 'male', rng, REPUTATION.newcomers[0]);
  enroll(sq, 0, 'male', rng, REPUTATION.newcomers[0]);
  return sq;
}

// ---------------- セーブ（枠は1つ。行動のたびに自動で保存） ----------------

/** ブラウザの保存領域。使えない環境（プライベートモードなど）では保存しないで続ける */
const store: Store | null = (() => {
  try { localStorage.setItem('volley-eikan-test', '1'); localStorage.removeItem('volley-eikan-test'); return localStorage; } catch { return null; }
})();
let saved: Career | null = null;
try { saved = store ? loadFrom(store) : null; } catch { saved = null; }

let career = saved ?? new Career({ seed, squad: newSquad() });
let season = career.season;

/** 自動で保存する（描画のたびに呼ぶ。試合を見ている途中は試合前の状態のまま） */
function autosave() {
  if (!store) return;
  try { saveTo(store, career); } catch (e) { console.error('セーブできませんでした', e); }
}
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
  autosave();
  const { month, day } = season.date;
  $('date').textContent = `${season.year}年目 ${month}月${day}日${season.over ? '（1年が終わりました。「次の年へ」で新しい年度に進みます）' : season.practiceOpen ? '（練習指示を変えられます）' : ''}`;
  const m = season.scheduledMatch;
  const WD = '日月火水木金土';
  $('money').textContent = `お金 ${season.money.toLocaleString()}円${m ? `　練習試合 ${season.board[m.day].month}/${season.board[m.day].day}（${WD[season.weekday(m.day)]}）` : ''}`;
  $('gym').textContent = `体育館Lv${season.gym}　評判 ${rankName(season.reputation.points)}　監督特能 ${season.managerSkills.map(x => MANAGER_SKILLS[x.id].name).join('・') || 'なし'}`;
  $('policy').innerHTML = (Object.keys(POLICY) as TeamPolicy[]).map(k =>
    `<button class="${season.policy === k ? 'on' : ''}" data-policy="${k}">${POLICY[k].name}</button>`).join('');
  for (const b of Array.from($('policy').querySelectorAll<HTMLButtonElement>('button'))) {
    b.onclick = () => { season.policy = b.getAttribute('data-policy') as TeamPolicy; render(); };
  }
  // 今いるマスと、この先14日分
  $('road').innerHTML = dayCol(season.board[season.day], true) + season.ahead(14).map(d => dayCol(d, false)).join('');
  // 手札
  const busy = season.needBranch || !!season.pending || season.over || !!season.matchChoices || !!season.matchInvite || season.paused || !!season.pendingMatch || !!season.skillOffer;
  ($('resume') as HTMLButtonElement).disabled = !season.paused;
  $('hand').innerHTML = '';
  season.hand.forEach((c, i) => {
    const pr = PRACTICE[c.practiceId];
    const b = document.createElement('button');
    b.innerHTML = c.special === 'instruction' ? `<b>指示</b><small>練習指示カード</small><small>練習指示を変える</small>`
      : c.special === 'matchOffer' ? `<b>試合</b><small>練習試合申し込み</small><small>${season.canUse(c) ? '3校から選ぶ' : '今は使えない'}</small>`
      : `<b>${c.days}</b><small>${pr.name}</small><small>${pr.abilities.map(a => ABILITY_NAME[a]).join('・')}</small>`;
    b.disabled = busy || !season.canUse(c);
    b.onclick = () => after(season.useCard(i));
    $('hand').appendChild(b);
  });
  ($('rest') as HTMLButtonElement).disabled = busy;
  ($('nextYear') as HTMLButtonElement).disabled = !season.over;
  // 選手の一覧（共通部品の行）：押すと詳細。練習指示のボタンは月初めなどだけ押せる
  const ctxOf = (p: Player): RowContext => ({
    mode: 'grow', year: season.year, isNew: season.newcomers.includes(p), practiceButton: season.practiceOpen && !p.retired,
    practice: `${p.practice.focus === 'auto' ? 'おまかせ' : ABILITY_NAME[p.practice.focus]}・${ROLE_NAME[p.practice.position].slice(0, 3)}`,
  });
  $('squad').innerHTML = rowHeadHtml('grow') + season.squad.players.map(p => playerRowHtml(p, ctxOf(p))).join('');
  for (const b of Array.from($('squad').querySelectorAll<HTMLButtonElement>('button[data-pr]'))) {
    b.onclick = () => openPractice(b.getAttribute('data-pr')!);
  }
  bindRows($('squad'), id => {
    const p = season.squad.players.find(x => x.id === id);
    if (p) showPlayerDetail($('app'), p, ctxOf(p));
  });
  $('log').innerHTML = log.slice(-30).reverse().map(l => `<div>${l}</div>`).join('');
}

function after(r: StepResult) {
  const { month, day } = season.date;
  const where = r.panel ? `（${PANEL_NAME[r.panel.kind]}）` : '';
  log.push(`${month}/${day}${where} ${r.notes.join('・')}${r.paused ? '（一時停止：練習指示を変えてから「続きを進む」）' : ''}`);
  // 相手選び・申し込みの文章は、その画面の中で出す
  // 3つで手一杯の文章は、手放す・見送るの画面の中で出す
  const skip = new Set([TEXTS.matchAsk, season.matchInvite ? fill(TEXTS.matchInvite, { school: season.matchInvite.name }) : '',
    season.skillOffer ? fill(TEXTS.skillFull, { skill: MANAGER_SKILLS[season.skillOffer.id].name }) : '']);
  showMessages((r.messages ?? []).filter(m => !skip.has(m.text)), () => {
    if (r.needBranch) openBranch();
    else if (season.matchChoices) openMatchChoices();
    else if (season.matchInvite) openInvite();
    else nextModal();
    render();
  });
  render();
}

/** 文章（マネージャーの台詞など）を1つずつ出す。全部見たら then */
function showMessages(list: Message[], then: () => void) {
  if (!list.length) { then(); return; }
  const [m, ...rest] = list;
  $('modalBox').innerHTML = `<div class="text">${m.speaker === 'manager' ? 'マネージャー「' + m.text + '」' : m.text}</div>
    <div class="choices"><button id="ok">OK</button></div>`;
  $('modal').classList.remove('hidden');
  ($('ok') as HTMLButtonElement).onclick = () => { $('modal').classList.add('hidden'); showMessages(rest, then); };
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

const LEVEL_NAME: Record<MatchOpponent['level'], string> = { above: '格上', equal: '同格', below: '格下' };

/** 練習試合申し込みカード：3校から相手を選ぶ（次の土曜日に試合） */
function openMatchChoices() {
  const list = season.matchChoices!;
  $('modalBox').innerHTML = `<div class="text">${TEXTS.matchAsk}</div><div class="choices" id="choices"></div>`;
  list.forEach((o, i) => {
    const b = document.createElement('button');
    b.textContent = `${o.name}（${LEVEL_NAME[o.level]}）`;
    b.onclick = () => { const m = season.chooseMatch(i); log.push(`練習試合の相手：${o.name}`); $('modal').classList.add('hidden'); showMessages([m], closeModal); };
    $('choices').appendChild(b);
  });
  $('modal').classList.remove('hidden');
}

/** 白パネル：他校から練習試合の申し込み */
function openInvite() {
  const o = season.matchInvite!;
  $('modalBox').innerHTML = `<div class="text">マネージャー「${fill(TEXTS.matchInvite, { school: o.name })}」（${LEVEL_NAME[o.level]}）</div>
    <div class="choices"><button id="yes">受ける</button><button id="no">断る</button></div>`;
  $('modal').classList.remove('hidden');
  ($('yes') as HTMLButtonElement).onclick = () => { const m = season.answerInvite(true); log.push(`練習試合を受けた：${o.name}`); $('modal').classList.add('hidden'); showMessages(m ? [m] : [], closeModal); };
  ($('no') as HTMLButtonElement).onclick = () => { season.answerInvite(false); log.push('練習試合を断った'); closeModal(); };
}

function closeModal() {
  $('modal').classList.add('hidden');
  nextModal();
  render();
}

/** 待っているもの（イベント・試合）があれば、その画面を出す */
function nextModal() {
  if (season.needBranch) openBranch();
  else if (season.pending) openEvent();
  else if (season.matchChoices) openMatchChoices();
  else if (season.matchInvite) openInvite();
  else if (season.skillOffer) openSkillOffer();
  else if (season.pendingMatch) openMatch();
}

/** 監督特能を3つ持っている時に新しく覚えられる：手放すか見送るか */
function openSkillOffer() {
  const o = season.skillOffer!;
  $('modalBox').innerHTML = `<div class="text">${fill(TEXTS.skillFull, { skill: MANAGER_SKILLS[o.id].name })}<br><small>（${MANAGER_SKILLS[o.id].desc}）</small></div>
    <div class="choices">${season.managerSkills.map(x => `<button data-sk="${x.id}">${fill(TEXTS.skillRelease, { skill: MANAGER_SKILLS[x.id].name })}<br><small>${x.until}年目まで</small></button>`).join('')}<button id="skip">${TEXTS.skillSkip}</button></div>`;
  $('modal').classList.remove('hidden');
  const done = (id: string | null) => {
    const m = season.answerSkill(id);
    log.push(m.text);
    $('modal').classList.add('hidden');
    showMessages([m], closeModal);
  };
  for (const b of Array.from($('modalBox').querySelectorAll<HTMLButtonElement>('button[data-sk]'))) b.onclick = () => done(b.getAttribute('data-sk'));
  ($('skip') as HTMLButtonElement).onclick = () => done(null);
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
      season.choose(i);
      nextModal();
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
      b.onclick = () => { season.setPractice(p.id, { focus: b.getAttribute('data-f') as TrainKey | 'auto' }); draw(); };
    }
    for (const b of Array.from($('modalBox').querySelectorAll<HTMLButtonElement>('button[data-r]'))) {
      b.onclick = () => { season.setPractice(p.id, { position: b.getAttribute('data-r') as Role }); draw(); };
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

// ---------------- 試合（大会・練習試合） ----------------

/** 試合前：登録（大会だけ）と、結果だけ／試合を見る */
function openMatch() {
  const pm = season.pendingMatch!;
  let reg = season.defaultRegistration();
  const draw = () => {
    const ps = season.squad.players.filter(p => !p.retired);
    const libs = ps.filter(p => reg.includes(p.id) && isLibero(p)).length;
    const regHtml = pm.limit
      ? `<div class="text" style="font-size:13px">登録 ${reg.length}/${SQUAD_LIMIT.size}人（リベロ ${libs}/${SQUAD_LIMIT.libero}人）。押すと入れ替え</div>
         <div class="reg">${ps.map(p => `<button class="${reg.includes(p.id) ? 'on' : 'off'}" data-reg="${p.id}">${p.number} ${p.name} ${ROLE_NAME[bestRole(p)].slice(0, 3)}</button>`).join('')}</div>`
      : '<div class="text" style="font-size:13px">練習試合は全員が出られます</div>';
    let err = '';
    try { season.matchSetup(reg); } catch (e) { err = (e as Error).message; }
    $('modalBox').innerHTML = `<div class="text">${pm.title}：${pm.opponent.name}（評判 ${schoolRankName(pm.opponent.strength)}・強さ ${abilityRank(pm.opponent.strength)}${Math.round(pm.opponent.strength)}）／自校（評判 ${rankName(season.reputation.points)}・強さ ${abilityRank(season.ownStrength())}${Math.round(season.ownStrength())}）／${pm.bestOf}セットマッチ</div>
      ${regHtml}${err ? `<div class="text" style="color:#ff9d7a;font-size:13px">${err}</div>` : ''}
      <div class="choices"><button id="mAuto" ${err ? 'disabled' : ''}>結果だけ</button><button id="mWatch" ${err ? 'disabled' : ''}>試合を見る</button></div>`;
    for (const b of Array.from($('modalBox').querySelectorAll<HTMLButtonElement>('button[data-reg]'))) {
      b.onclick = () => {
        const id = b.getAttribute('data-reg')!;
        reg = reg.includes(id) ? reg.filter(x => x !== id) : [...reg, id];
        draw();
      };
    }
    ($('mAuto') as HTMLButtonElement).onclick = () => { $('modal').classList.add('hidden'); afterMatch(season.playMatch(reg)); };
    ($('mWatch') as HTMLButtonElement).onclick = () => { $('modal').classList.add('hidden'); watchMatch(reg); };
  };
  draw();
  $('modal').classList.remove('hidden');
}

/** 試合を見る：試合の画面（index.html）を重ねて開き、終わったら結果を受け取る */
function watchMatch(reg: string[]) {
  const setup = season.matchSetup(reg);
  const box = $('matchFrame');
  box.innerHTML = '<iframe src="index.html?embed=1"></iframe>';
  box.classList.remove('hidden');
  const frame = box.querySelector('iframe')!;
  const onMsg = (ev: MessageEvent) => {
    if (ev.source !== frame.contentWindow) return;
    if (ev.data?.type === 'matchReady') frame.contentWindow!.postMessage({ type: 'matchSetup', options: setup.options }, '*');
    if (ev.data?.type === 'matchResult') {
      window.removeEventListener('message', onMsg);
      box.classList.add('hidden');
      box.innerHTML = '';
      afterMatch(season.finishMatch(ev.data.outcome as MatchOutcome, setup.registered));
    }
  };
  window.addEventListener('message', onMsg);
}

/** 試合の後：結果を見せ、続けて試合があれば（本戦）次の試合前へ */
function afterMatch(r: StepResult) {
  log.push(r.notes.join('・'));
  const full = season.skillOffer ? fill(TEXTS.skillFull, { skill: MANAGER_SKILLS[season.skillOffer.id].name }) : '';
  showMessages([{ text: r.notes.join('<br>') }, ...(r.messages ?? []).filter(m => m.text !== full)], () => { nextModal(); render(); });
  render();
}

/** 大会：この年度のトーナメント表 */
function openCups(id?: string) {
  const list = Object.values(season.tournaments).filter(Boolean) as Tournament[];
  if (!list.length) {
    showMessages([{ text: 'この年度の大会はまだありません' }], render);
    return;
  }
  const t = list.find(x => x.def.id === id) ?? list[list.length - 1];
  const name = (i: number) => {
    const e = t.entries[i];
    return `<span class="${e.own ? 'own' : ''}">${e.name}（${abilityRank(e.strength)}）</span>`;
  };
  const cols = t.rounds.map((round, ri) => `<div class="col"><b>${['1回戦', '2回戦', '準々決勝', '準決勝', '決勝'][ri]}</b>${round.map(b => {
    const done = b.winner !== undefined;
    const loser = done ? (b.winner === b.a ? b.b : b.a) : -1;
    return `<div class="bout"><div class="${loser === b.a ? 'lost' : ''}">${name(b.a)}</div><div class="${loser === b.b ? 'lost' : ''}">${name(b.b)}</div>${done ? `<small>${b.sets}</small>` : ''}</div>`;
  }).join('')}</div>`).join('');
  $('modalBox').innerHTML = `<div class="choices">${list.map(x => `<button class="${x === t ? 'on' : 'off'}" data-cup="${x.def.id}">${x.def.name}</button>`).join('')}</div>
    <div class="text" style="font-size:13px">${t.def.name}：自校 ${t.ownResult().text}${t.champion ? `／優勝 ${t.champion.name}` : ''}</div>
    <div class="bracket">${cols}</div><div class="choices"><button id="close">閉じる</button></div>`;
  for (const b of Array.from($('modalBox').querySelectorAll<HTMLButtonElement>('button[data-cup]'))) b.onclick = () => openCups(b.getAttribute('data-cup')!);
  ($('close') as HTMLButtonElement).onclick = () => { $('modal').classList.add('hidden'); render(); };
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
($('cups') as HTMLButtonElement).onclick = () => openCups();
($('nextYear') as HTMLButtonElement).onclick = () => {
  const money = season.money;
  season = career.nextYear();
  log.push(`${season.year}年目が始まりました（評判 ${rankName(season.reputation.points)}、部費 ${(season.money - money).toLocaleString()}円）`);
  if (career.expired.length) log.push(`監督特能が失効しました：${career.expired.map(id => MANAGER_SKILLS[id].name).join('・')}`);
  showMessages(career.expiredMessages, render);
  render();
};
($('rest') as HTMLButtonElement).onclick = () => after(season.rest());
($('resume') as HTMLButtonElement).onclick = () => after(season.resume());
/** 最初から：今のセーブを消してよいかを確かめる */
function startOver() {
  $('modalBox').innerHTML = `<div class="text">最初から始めます。今のセーブは消えます。よいですか？</div>
    <div class="choices"><button id="yes">最初から始める</button><button id="no">やめる</button></div>`;
  $('modal').classList.remove('hidden');
  ($('yes') as HTMLButtonElement).onclick = () => {
    if (store) clearSave(store);
    seed = Math.floor(Math.random() * 1000000) + 1;
    career = new Career({ seed, squad: newSquad() });
    season = career.season;
    log.length = 0;
    $('modal').classList.add('hidden');
    render();
  };
  ($('no') as HTMLButtonElement).onclick = () => { $('modal').classList.add('hidden'); render(); };
}

/** セーブの書き出し・読み込み（PCとスマホの間で移すため） */
function openSaveMenu() {
  $('modalBox').innerHTML = `<div class="text">書き出し：下の文字列を全部コピーして、移したい端末の「読み込み」に貼り付けてください</div>
    <textarea id="exportText" readonly style="height:60px;font-size:10px">${exportSave(career)}</textarea>
    <div class="choices"><button id="copy">コピー</button></div>
    <div class="text">読み込み：書き出した文字列を貼り付けてください（今のセーブは上書きされます）</div>
    <textarea id="importText" style="height:50px;font-size:10px"></textarea>
    <div id="saveMsg" class="text" style="font-size:13px"></div>
    <div class="choices"><button id="doImport">読み込む</button><button id="close">閉じる</button></div>`;
  $('modal').classList.remove('hidden');
  ($('copy') as HTMLButtonElement).onclick = async () => {
    const t = ($('exportText') as HTMLTextAreaElement);
    try { await navigator.clipboard.writeText(t.value); $('saveMsg').textContent = 'コピーしました'; } catch { t.select(); $('saveMsg').textContent = '選んだ文字列をコピーしてください'; }
  };
  ($('doImport') as HTMLButtonElement).onclick = () => {
    try {
      career = importSave(($('importText') as HTMLTextAreaElement).value);
      season = career.season;
      log.length = 0;
      log.push('セーブを読み込みました');
      $('modal').classList.add('hidden');
      render();
    } catch (e) {
      $('saveMsg').textContent = `読み込めませんでした：${(e as Error).message}`;
    }
  };
  ($('close') as HTMLButtonElement).onclick = () => { $('modal').classList.add('hidden'); render(); };
}

($('newYear') as HTMLButtonElement).onclick = startOver;
($('saveBtn') as HTMLButtonElement).onclick = openSaveMenu;

// 開いた時：セーブがあれば「続きから」「最初から」
if (saved) {
  log.push(`続きから（${season.year}年目 ${season.date.month}月${season.date.day}日）`);
  $('modalBox').innerHTML = `<div class="text">セーブがあります（${season.year}年目 ${season.date.month}月${season.date.day}日）</div>
    <div class="choices"><button id="cont">続きから</button><button id="fresh">最初から</button></div>`;
  $('modal').classList.remove('hidden');
  ($('cont') as HTMLButtonElement).onclick = () => { $('modal').classList.add('hidden'); render(); nextModal(); };
  ($('fresh') as HTMLButtonElement).onclick = startOver;
}
render();
