// HUD and panels, laid out like the reference: the "Stage X/12 (Y%)" bar with the lucky block and
// Fling All / Wins / Trails along the top, Skip to End / Kill All / Skip Stage on the left, the
// gear buttons and 2x on the right, the menu icons top right (the top left stays free for the
// Bloxity overlay), the gear hotbar, gear pad popups, the welcome-back card, the cheers, the win
// banner and every panel.
import { $ } from './engine.js';
import { S, actions, net } from './state.js';
import { sfx, setMusicDuck, getVolumes, setVolume } from './audio.js';
import * as BX from './bloxity.js';
import { getQuality, setQuality } from './fx.js';
import {
    CFG, STAGES, DIFFS, TRAILS, GEAR, gearById, PASSES, PRODUCTS, priceOf, tpPrice, LUCKY,
    GIFTS, DAILY, dailyStatus, rewardText, passForGear, fmt, fmtComma, clock, playtimeText,
} from '../../shared/config.js';
import { CHECKPOINTS } from '../../shared/maze.js';

const C = (n) => '<span class="cup">🏆</span>' + fmt(n);
function setHtml(node, html) { if (node && node.innerHTML !== html) node.innerHTML = html; }
function setText(node, t) { if (node && node.textContent !== t) node.textContent = t; }
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const promptEl = $('#promptBtn'), promptTxtEl = $('#promptTxt');

// Every button clicks
document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('button'); if (b) sfx(b.classList.contains('g-green') ? 'clickBuy' : 'click'); }, true);

// ----- Wins counter (counts up smoothly) -----
let shownCoins = 0, shownText = -1;
export function animateCounters(dt) {
    if (Math.abs(shownCoins - S.wins) < 0.5) shownCoins = S.wins;
    else shownCoins += (S.wins - shownCoins) * Math.min(1, dt * 8);
    const n = Math.round(shownCoins);
    if (n !== shownText) { shownText = n; setText($('#coinVal'), fmtComma(n)); }
}
export function bumpCoins() { const p = $('#coinBar'); p.classList.remove('bump'); void p.offsetWidth; p.classList.add('bump'); }

// ----- HUD refresh (10x a second) -----
const sessionSecs = () => (S.sessionSecs || 0) + (Date.now() - S.profileAt) / 1000;
export function updateHud() {
    const now = net.now();
    const secs = sessionSecs();
    const next = GIFTS.findIndex((g, k) => !S.giftClaimed[k]);
    const ready = GIFTS.some((g, k) => !S.giftClaimed[k] && secs >= g.min * 60);
    $('#giftBadge').hidden = !ready;
    setText($('#giftLb'), ready ? 'READY' : next < 0 ? 'DONE' : Math.max(1, Math.ceil((GIFTS[next].min * 60 - secs) / 60)) + 'm');
    $('#dailyBadge').hidden = !dailyStatus(S.daily, now).can;
    const luckyReady = now - (S.luckyAt || 0) > CFG.luckyMinutes * 60000;
    $('#luckyBadge').hidden = !luckyReady;
    $('#luckyBtn').classList.toggle('ready', luckyReady);
    $('#boostTag').hidden = !((S.boostUntil || 0) > now || (S.passes && S.passes.DoubleWins));
    $('#x2Btn').classList.toggle('own', !!(S.passes && S.passes.DoubleWins));
    setText($('#friendBoost'), 'Friend Boost: ' + Math.round(Math.min(CFG.friendMax, S.friends || 0) * CFG.friendBoost * 100) + '%');
    // the gear buttons light up while their gear is on
    for (const [id, gear] of [['#btnSpeed', 'speedCoil'], ['#btnGravity', 'gravityCoil'], ['#btnCarpet', 'carpet'], ['#btnRay', 'rayGun']]) $(id).classList.toggle('on', S.tool === gear);
    if (!$('#lucky').hidden) renderLuckyLeft();
}

// ----- the stage bar along the top: "Stage 3/12 (25%)" -----
let progKey = '';
export function renderProgress(stage) {
    const n = Math.min(STAGES.length, Math.max(1, (stage ?? -1) + 2));
    const key = String(n);
    if (key === progKey) return;
    progKey = key;
    const pct = Math.floor(n / STAGES.length * 100);
    setText($('#stageText'), 'Stage ' + n + '/' + STAGES.length + ' (' + pct + '%)');
    $('#stageFill').style.width = Math.max(6, n / STAGES.length * 100) + '%';
}

// ----- toasts, banners, cheers -----
export function toast(text, color) {
    const d = document.createElement('div');
    d.className = 'toast o';
    d.style.color = color || '#fff';
    d.textContent = text;
    const box = $('#toasts');
    box.appendChild(d);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => d.remove(), 2900);
}
let titleTimer;
export function showStageTitle(i) {
    const s = STAGES[i];
    if (!s) return;
    setText($('#stageName'), s.ic + ' Stage ' + (i + 1) + ': ' + s.name);
    const d = DIFFS[s.diff];
    setHtml($('#stageSub'), `<span class="diff" style="background:${d.color}">${d.label}</span> ${esc(s.sub)}${s.wins ? ' · <span class="cup">🏆</span>+' + s.wins : ' · <span class="cup">🏆</span>+' + CFG.finishWins + ' at the finish'}`);
    const t = $('#stageTitle');
    t.style.opacity = 1;
    clearTimeout(titleTimer);
    titleTimer = setTimeout(() => { t.style.opacity = 0; }, 2600);
}
export function showWin(m) {
    setText($('#winSub'), '+' + fmt(m.wins) + ' Wins · escape #' + m.climbs + ' · ' + m.secs + 's' + (m.best && m.best === m.secs ? ' (new best!)' : '') + (m.short ? ' · skipped' : ''));
    $('#winBanner').hidden = false;
    setTimeout(() => { $('#winBanner').hidden = true; }, 4200);
}
let clearTimer;
export function showStageClear(i, n) {
    const next = STAGES[i + 1];
    setText($('#clearT'), 'STAGE ' + (i + 1) + ' CLEAR!');
    const d = next && DIFFS[next.diff];
    setHtml($('#clearS'), '<span class="cup">🏆</span>+' + fmt(n) + ' Wins' + (d ? ' · next: <span class="diff" style="background:' + d.color + '">' + d.label + '</span>' : ''));
    const b = $('#clearBanner');
    b.hidden = false; b.classList.remove('go'); void b.offsetWidth; b.classList.add('go');
    clearTimeout(clearTimer);
    clearTimer = setTimeout(() => { b.hidden = true; }, 1900);
}
// The reference's cheers after a maze
const CHEERS = ['💪 You\'re unstoppable!', '👌 You\'re doing an amazing job!', '🔥 Maze master!', '⭐ Keep it up!', '🧠 Big brain moves!', '🚀 Nothing can stop you!'];
let cheerN = 0, cheerTimer;
export function cheer() {
    const el = $('#cheer');
    setText(el, CHEERS[cheerN++ % CHEERS.length]);
    el.hidden = false; el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
    clearTimeout(cheerTimer);
    cheerTimer = setTimeout(() => { el.hidden = true; }, 2600);
}
export function showOof() { const o = $('#oof'); o.hidden = false; setTimeout(() => { o.hidden = true; }, 900); }
export function flash(color, ms) {
    const f = $('#flash');
    f.style.transition = 'none'; f.style.background = color || '#fff'; f.style.opacity = 0.9;
    requestAnimationFrame(() => { f.style.transition = 'opacity ' + ((ms || 600) / 1000) + 's ease'; f.style.opacity = 0; });
}
export function teleportFx() { const t = $('#tpFx'); t.classList.remove('go'); void t.offsetWidth; t.classList.add('go'); }

// ----- the welcome-back card: continue from your checkpoint (free) -----
let oopsTimer = null, oopsUntil = 0;
export function showOops(text, title) {
    if (S.stage < 0) return;
    setText($('#oopsTitle'), title || 'Welcome back!');
    setText($('#oopsText'), text || 'Continue from your checkpoint.');
    setText($('#oopsTp'), 'Teleport (Free)');
    $('#gearPop').hidden = true;
    $('#oops').hidden = false;
    oopsUntil = Date.now() + 15000;
    clearInterval(oopsTimer);
    oopsTimer = setInterval(() => {
        const k = Math.max(0, (oopsUntil - Date.now()) / 15000);
        $('#oopsTimer').style.width = (k * 100) + '%';
        if (k <= 0) hideOops();
    }, 100);
}
export function hideOops() { $('#oops').hidden = true; clearInterval(oopsTimer); }
$('#oopsTp').addEventListener('click', () => { hideOops(); actions.teleportCheckpoint(); });
$('#oopsClose').addEventListener('click', hideOops);

// ----- gear pad popup -----
let gearPopId = null, gearPopTimer;
export function showGearPop(id) {
    const g = gearById[id], pass = PASSES[passForGear(id)];
    gearPopId = id;
    hideOops();
    setText($('#gpIc'), g.ic); setText($('#gpName'), g.name); setText($('#gpDesc'), g.desc + '.');
    setHtml($('#gpBuy'), S.gear[id] ? (S.tool === id ? 'Unequip' : 'Equip') : C(pass.price));
    $('#gearPop').hidden = false;
    clearTimeout(gearPopTimer);
    gearPopTimer = setTimeout(() => { $('#gearPop').hidden = true; }, 7000);
}
$('#gpBuy').addEventListener('click', () => {
    $('#gearPop').hidden = true;
    if (!gearPopId) return;
    if (S.gear[gearPopId]) actions.equip(gearPopId); else buy('pass', passForGear(gearPopId));
});
$('#gpClose').addEventListener('click', () => { $('#gearPop').hidden = true; });

// ----- hotbar (gear you own) -----
let hotKey = '';
export function renderHotbar() {
    const owned = GEAR.filter((g) => S.gear[g.id]);
    const key = owned.map((g) => g.id).join(',') + '|' + S.tool;
    if (key === hotKey) return;
    hotKey = key;
    const bar = $('#hotbar');
    bar.innerHTML = '';
    owned.forEach((g, i) => {
        const b = document.createElement('button');
        b.className = 'slot' + (S.tool === g.id ? ' on' : '');
        b.innerHTML = `<span class="n o1">${i + 1}</span>${g.ic}<span class="nm o1">${esc(g.name)}</span>`;
        b.title = g.name + ' (' + (i + 1) + ')';
        b.addEventListener('click', () => actions.equip(g.id));
        bar.appendChild(b);
    });
}
export const hotbarGear = () => GEAR.filter((g) => S.gear[g.id]);

// =====================================================================================
// Purchases: everything costs Wins. A confirm shows the price; the server checks it and takes
// the Wins.
// =====================================================================================
let pendingBuy = null;
export function buy(kind, key) {
    const item = kind === 'pass' ? PASSES[key] : PRODUCTS[key];
    if (!item) return;
    if (kind === 'pass' && S.passes[key]) { toast(item.name + ' already owned!', '#6fe0ff'); if (item.gear) actions.equip(item.gear); return; }
    pendingBuy = { kind, key };
    const price = priceOf(kind, key, S);
    const short = price - (S.wins || 0);
    setText($('#confirmIc'), item.ic || '🛒');
    setText($('#confirmTitle'), item.name);
    setText($('#confirmText'), item.desc || '');
    setHtml($('#confirmCost'), C(price) + ' Wins');
    const yes = $('#confirmYes');
    yes.disabled = short > 0;
    setText(yes, short > 0 ? 'Need ' + fmt(short) + ' more' : 'Buy');
    setText($('#confirmNote'), short > 0 ? 'Clear mazes to earn Wins: every checkpoint pays more the further you go!' : 'You have ' + fmtComma(S.wins) + ' Wins');
    $('#confirm').hidden = false;
    setMusicDuck(true);
}
// The server said you can't afford it (prices can change while the dialog is open)
export function notEnough(m) { toast('Not enough Wins! You need ' + fmt(m.need) + ' more for ' + m.name, '#ff5a7a'); }
function closeConfirm() { $('#confirm').hidden = true; pendingBuy = null; if (!modalOpen()) setMusicDuck(false); }
$('#confirmYes').addEventListener('click', () => { const p = pendingBuy; closeConfirm(); if (p) net.send('buy', p); });
$('#confirmNo').addEventListener('click', closeConfirm);
$('#confirmClose').addEventListener('click', closeConfirm);

// =====================================================================================
// Panels
// =====================================================================================
let modalKind = null, modalTab = null;
export function openModal(kind, tab) { modalKind = kind; modalTab = tab || null; renderModal(); $('#modal').hidden = false; setMusicDuck(true); }
export function closeModal() { $('#modal').hidden = true; modalKind = null; setMusicDuck(false); }
export function refreshModal() { if (!$('#modal').hidden) renderModal(); }
export const modalOpen = () => !$('#modal').hidden;
$('#modalClose').addEventListener('click', closeModal);
$('#modal').addEventListener('pointerdown', (e) => { if (e.target.id === 'modal') closeModal(); });

function el(tag, cls, html) { const d = document.createElement(tag); if (cls) d.className = cls; if (html !== undefined) d.innerHTML = html; return d; }
function sec(body, text) { body.appendChild(el('div', 'sec o1', esc(text))); }
function note(body, text) { body.appendChild(el('p', 'note o1', text)); }
function card(o) {
    const d = el('div', 'card' + (o.cls ? ' ' + o.cls : ''));
    d.innerHTML = `<div class="ic">${o.ic}</div><div class="nm o1">${esc(o.name)}</div>${o.desc ? `<div class="ds o1">${esc(o.desc)}</div>` : ''}`;
    if (o.btn) {
        const b = el('button', 'btn ' + (o.btnCls || 'g-green') + ' o1', o.btn);
        b.disabled = !!o.disabled;
        b.addEventListener('click', o.onClick);
        d.appendChild(b);
    }
    return d;
}
function tabs(list) {
    const t = $('#modalTabs');
    t.innerHTML = '';
    if (!list) return;
    for (const [id, label] of list) {
        const b = el('button', 'btn g-blue o1' + (modalTab === id ? ' on' : ''), label);
        b.addEventListener('click', () => { modalTab = id; renderModal(); });
        t.appendChild(b);
    }
}
function renderModal() {
    const body = $('#modalBody');
    const scroll = body.scrollTop;
    body.innerHTML = '';
    const titles = { store: 'SHOP!', trails: 'TRAILS', config: 'SETTINGS', gifts: 'GIFTS', invite: 'INVITE', teleport: 'TELEPORT' };
    setText($('#modalTitle'), titles[modalKind] || '');
    tabs(null);
    ({ store: renderStore, trails: renderTrails, config: renderConfig, gifts: renderGifts, invite: renderInvite, teleport: renderTeleport }[modalKind] || (() => {}))(body);
    body.scrollTop = scroll;
}

// ----- Shop -----
function passCard(key, cls) {
    const p = PASSES[key], own = !!S.passes[key];
    return card({ ic: p.ic, name: p.name, desc: p.desc, cls: (cls || '') + (own ? ' own' : ''), btn: own ? (p.gear ? (S.tool === p.gear ? 'Equipped' : 'Equip') : 'Owned') : C(p.price), btnCls: own ? 'g-blue' : S.wins >= p.price ? 'g-green' : 'g-grey', disabled: own && !p.gear, onClick: () => (own && p.gear ? actions.equip(p.gear) : buy('pass', key)) });
}
function prodCard(key, cls) {
    const p = PRODUCTS[key];
    const price = priceOf('product', key, S);
    return card({ ic: p.ic, name: p.name, desc: p.desc, cls, btn: C(price), btnCls: S.wins >= price ? 'g-green' : 'g-grey', onClick: () => buy('product', key) });
}
function renderStore(body) {
    tabs([['gear', '🌀 Gear'], ['boosts', '⏱️ Boosts & Skips'], ['fun', '🌪️ Fun']]);
    const tab = modalTab || 'gear';
    const g = el('div', 'grid');
    if (tab === 'gear') for (const k of ['SpeedCoil', 'GravityCoil', 'SuperCoil', 'RayGun', 'Sword', 'MagicCarpet']) g.appendChild(passCard(k, k === 'MagicCarpet' ? 'carpet' : ''));
    else if (tab === 'boosts') { g.appendChild(passCard('DoubleWins', 'hot')); g.appendChild(prodCard('WinsBoost')); g.appendChild(prodCard('Skip')); g.appendChild(prodCard('SkipEnd')); }
    else { g.appendChild(prodCard('FlingAll', 'hot')); g.appendChild(prodCard('KillAll', 'danger')); }
    body.appendChild(g);
    note(body, 'Everything is bought with Wins. Earn them at every checkpoint (more in the bigger mazes), from gems hidden in dead ends and at the finish!');
}

// ----- Trails -----
function renderTrails(body) {
    const g = el('div', 'grid');
    for (const t of TRAILS) {
        const own = !!S.trails[t.id], on = S.trail === t.id;
        const hex = '#' + t.color.toString(16).padStart(6, '0');
        const sw = `<span style="display:inline-block;width:3.6rem;height:1.2rem;border-radius:1rem;border:3px solid #12204a;background:${t.rainbow ? 'linear-gradient(90deg,#ff3c5a,#ffb51c,#46ec50,#28c8ff,#8a5aff)' : hex};box-shadow:0 0 0.8rem ${hex}"></span>`;
        g.appendChild(card({
            ic: sw, name: t.name, desc: t.price ? '' : 'Free', cls: on ? 'own' : '',
            btn: on ? 'Equipped' : own ? 'Equip' : C(t.price), btnCls: own ? 'g-blue' : 'g-green',
            disabled: on || (!own && S.wins < t.price),
            onClick: () => net.send('trail', { id: t.id }),
        }));
    }
    body.appendChild(g);
}

// ----- Teleport -----
function renderTeleport(body) {
    const g = el('div', 'grid');
    g.appendChild(card({ ic: '🏠', name: 'Lobby', desc: 'Back to the start', btn: 'Free', onClick: () => { closeModal(); actions.teleportLobby(); } }));
    if (S.stage >= 0) g.appendChild(card({ ic: '🚩', name: 'My checkpoint', desc: 'Stage ' + Math.min(STAGES.length, S.stage + 2), btn: 'Free', onClick: () => { closeModal(); actions.teleportCheckpoint(); } }));
    if ((S.stage ?? -1) < CHECKPOINTS.length - 1) g.appendChild(prodCard('Skip', 'hot'));
    g.appendChild(prodCard('SkipEnd'));
    body.appendChild(g);
    sec(body, 'Stages you have reached');
    const r = el('div', 'grid');
    CHECKPOINTS.forEach((cp, i) => {
        const ok = i < (S.maxStage || 0) || i === S.stage, s = STAGES[i + 1], own = i === S.stage, price = tpPrice(i, own);
        r.appendChild(card({ ic: ok ? s.ic : '🔒', name: 'Stage ' + (i + 2), desc: s.name, btn: ok ? (price ? C(price) : 'Free') : 'Not reached', btnCls: ok && S.wins >= price ? 'g-green' : 'g-grey', disabled: !ok, onClick: () => { closeModal(); actions.teleportTo(i); } }));
    });
    body.appendChild(r);
    note(body, 'Your own checkpoint is always free. Going back to another stage you reached costs a little, and a run that skips ahead pays a quarter at the finish.');
}

// ----- Settings -----
function slider(body, ic, label, kind) {
    const r = el('div', 'row');
    r.innerHTML = `<span class="ic">${ic}</span><span class="tx" style="flex:0 0 9rem"><b class="o1">${label}</b></span>`;
    const s = el('input');
    s.type = 'range'; s.min = 0; s.max = 100; s.value = Math.round((getVolumes()[kind] ?? 1) * 100);
    s.setAttribute('aria-label', label);
    s.addEventListener('input', () => setVolume(kind, s.value / 100));
    r.appendChild(s);
    body.appendChild(r);
}
function renderConfig(body) {
    sec(body, 'Sound');
    slider(body, '🎵', 'Music', 'music');
    slider(body, '👣', 'Footsteps', 'asmr');
    slider(body, '🔔', 'Effects', 'sfx');
    sec(body, 'Graphics');
    const q = el('div', 'row');
    q.innerHTML = '<span class="ic">✨</span><span class="tx"><b class="o1">Quality</b><small class="o1">Low is smoothest on older PCs and phones</small></span>';
    for (const [k, n] of [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]) {
        const b = el('button', 'btn ' + (getQuality() === k ? 'g-green' : 'g-grey') + ' o1', n);
        b.addEventListener('click', () => { setQuality(k); renderModal(); });
        q.appendChild(b);
    }
    body.appendChild(q);
    sec(body, 'Codes');
    const c = el('div', 'row');
    c.innerHTML = '<span class="ic">🎟️</span>';
    const inp = el('input', 'input'); inp.placeholder = 'Enter a code'; inp.maxLength = 24;
    const go = el('button', 'btn g-green o1', 'Redeem');
    go.addEventListener('click', () => { if (inp.value.trim()) net.send('code', { code: inp.value.trim() }); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); e.stopPropagation(); });
    c.appendChild(inp); c.appendChild(go);
    body.appendChild(c);
    const stats = el('div', 'row');
    stats.innerHTML = `<span class="ic">📊</span><span class="tx"><b class="o1">Escapes ${fmt(S.climbs)} · Best run ${S.best ? S.best + 's' : '—'}</b><small class="o1">Playtime ${playtimeText(S.playtime)} · Wins earned ${fmt(S.totalWins)}</small></span>`;
    body.appendChild(stats);
}
export function codeResult(m) { toast(m.ok ? '🎟️ ' + m.text : m.text, m.ok ? '#7dff6b' : '#ff5a7a'); }

// ----- Gifts (playtime) -----
function renderGifts(body) {
    note(body, 'Keep playing to unlock gifts! (' + Math.floor(sessionSecs() / 60) + ' min played this session)');
    const g = el('div', 'grid');
    const secs = sessionSecs();
    GIFTS.forEach((gift, k) => {
        const claimed = !!S.giftClaimed[k], ready = secs >= gift.min * 60;
        const left = Math.max(0, gift.min * 60 - secs);
        g.appendChild(card({
            ic: gift.boost ? '⏱️' : '🎁', name: rewardText(gift), desc: gift.min + ' min',
            cls: claimed ? 'own' : ready ? 'hot' : '', btn: claimed ? 'Claimed' : ready ? 'CLAIM' : clock(left), btnCls: ready && !claimed ? 'g-green' : 'g-grey',
            disabled: claimed || !ready, onClick: () => net.send('gift', { k }),
        }));
    });
    body.appendChild(g);
}

// ----- Invite -----
function renderInvite(body) {
    note(body, 'Play with friends! Friend Boost gives +' + Math.round(CFG.friendBoost * 100) + '% Wins for every Bloxity friend in your server (up to +' + Math.round(CFG.friendBoost * CFG.friendMax * 100) + '%).');
    const r = el('div', 'row');
    r.innerHTML = '<span class="ic">🔗</span><span class="tx"><b class="o1">Invite link</b><small class="o1">Send it to a friend</small></span>';
    const b = el('button', 'btn g-green o1', 'Copy');
    b.addEventListener('click', async () => {
        const link = BX.getInviteLink() || location.href;
        try { await navigator.clipboard.writeText(link); toast('Invite link copied!', '#7dff6b'); } catch (e) { toast(link, '#ffffff'); }
    });
    r.appendChild(b);
    body.appendChild(r);
    const list = el('div', 'grid');
    body.appendChild(list);
    if (BX.bloxity.ready && BX.identity().loggedIn) {
        BX.getFriends().then((fr) => {
            if (!fr.length) { list.appendChild(el('p', 'note o1', 'No Bloxity friends yet.')); return; }
            for (const f of fr.slice(0, 24)) {
                const nm = f.displayName || f.username || 'Friend';
                list.appendChild(card({ ic: '🙂', name: nm, btn: 'Invite', onClick: async () => { const ok = await BX.inviteFriend(f._id || f.id); toast(ok ? 'Invited ' + nm + '!' : 'Could not invite ' + nm, ok ? '#7dff6b' : '#ff5a7a'); } }));
            }
        });
    } else note(body, 'Log in to Bloxity to invite your friends directly.');
}

// =====================================================================================
// Daily rewards
// =====================================================================================
export function openDailyOnJoin() {
    if (dailyStatus(S.daily, net.now()).can && !openDailyOnJoin.done) { openDailyOnJoin.done = true; setTimeout(openDaily, 1500); }
}
function openDaily() { renderDaily(); $('#daily').hidden = false; setMusicDuck(true); }
function renderDaily() {
    const st = dailyStatus(S.daily, net.now());
    const cards = $('#dailyCards');
    cards.innerHTML = '';
    DAILY.forEach((r, i) => {
        const done = i < st.day || (!st.can && i === st.day);
        const now = st.can && i === st.day;
        const d = el('div', 'dcard o1' + (done ? ' done' : '') + (now ? ' now' : ''));
        d.innerHTML = `<span class="d">Day ${i + 1}</span><span class="i">${r.trail ? '🌈' : r.boost ? '⏱️' : '🏆'}</span><span>${esc(rewardText(r))}</span>`;
        cards.appendChild(d);
    });
    $('#dailyClaim').disabled = !st.can;
    setText($('#dailyLeft'), st.can ? 'Your daily reward is ready!' : 'Come back tomorrow for Day ' + ((st.streak % 7) + 1) + '!');
}
$('#dailyClaim').addEventListener('click', () => { net.send('daily'); setTimeout(renderDaily, 300); });
$('#dailyClose').addEventListener('click', () => { $('#daily').hidden = true; setMusicDuck(false); });
export const refreshDaily = () => { if (!$('#daily').hidden) renderDaily(); };

// =====================================================================================
// The lucky block: a free spin every few minutes. The server picks the prize; the reel spins and
// slows down onto it.
// =====================================================================================
const luckyIc = (r) => (r.boost ? '⏱️' : r.wins >= 150 ? '💰' : r.wins >= 40 ? '🏆' : '🪙');
function openLucky() {
    const g = $('#luckyGrid');
    g.innerHTML = '';
    LUCKY.forEach((r) => {
        const d = el('div', 'lcard o1');
        d.innerHTML = `<span class="i">${luckyIc(r)}</span><span>${r.boost ? 'x2 Wins 15m' : '+' + fmt(r.wins)}</span><span class="p">${r.w}%</span>`;
        g.appendChild(d);
    });
    renderLuckyLeft();
    $('#lucky').hidden = false;
    setMusicDuck(true);
}
let spinning = false;
function renderLuckyLeft() {
    const left = CFG.luckyMinutes * 60000 - (net.now() - (S.luckyAt || 0));
    $('#luckySpin').disabled = left > 0 || spinning;
    setText($('#luckyLeft'), spinning ? 'Spinning…' : left > 0 ? 'Next free spin in ' + clock(left / 1000) : 'A free spin is ready!');
}
$('#luckySpin').addEventListener('click', () => { if (spinning) return; spinning = true; renderLuckyLeft(); net.send('lucky'); setTimeout(() => { if (spinning && !landed) { spinning = false; renderLuckyLeft(); } }, 4000); });
$('#luckyClose').addEventListener('click', () => { if (spinning) return; $('#lucky').hidden = true; setMusicDuck(false); });
let landed = false;
export function luckyResult(m) {
    if ($('#lucky').hidden) openLucky();
    const cards = [...$('#luckyGrid').children];
    landed = true;
    spinning = true;
    // a reel: around a few times, slowing down onto the prize
    const total = cards.length * 3 + m.k;
    let i = 0;
    const tick = () => {
        cards.forEach((c, j) => c.classList.toggle('hi', j === i % cards.length));
        sfx('spinTick');
        if (i >= total) {
            cards.forEach((c) => c.classList.remove('hi'));
            cards[m.k].classList.add('win');
            const r = LUCKY[m.k];
            sfx(r.wins >= 150 ? 'legendary' : 'bonus');
            toast('❓ Lucky Block: ' + (r.boost ? '15 min x2 Wins!' : '+' + fmt(m.n) + ' Wins!'), '#ffe24a');
            spinning = false; landed = false;
            renderLuckyLeft();
            return;
        }
        i++;
        setTimeout(tick, 45 + Math.pow(i / total, 3) * 380);
    };
    tick();
}

// =====================================================================================
// HUD buttons
// =====================================================================================
// A gear button: equip / unequip it if you own it, otherwise offer it
const gearBtn = (id) => () => (S.gear[id] ? actions.equip(id) : buy('pass', passForGear(id)));
$('#flingBtn').addEventListener('click', () => buy('product', 'FlingAll'));
$('#trailsBtn').addEventListener('click', () => openModal('trails'));
$('#coinPlus').addEventListener('click', () => openModal('store', 'boosts'));
$('#luckyBtn').addEventListener('click', openLucky);
$('#btnSkipEnd').addEventListener('click', () => buy('product', 'SkipEnd'));
$('#btnKillAll').addEventListener('click', () => buy('product', 'KillAll'));
$('#btnSkip').addEventListener('click', () => { if ((S.stage ?? -1) >= CHECKPOINTS.length - 1) { toast('This is the last maze: use Skip to End!', '#6fe0ff'); return; } buy('product', 'Skip'); });
$('#btnSpeed').addEventListener('click', gearBtn('speedCoil'));
$('#btnGravity').addEventListener('click', gearBtn('gravityCoil'));
$('#btnCarpet').addEventListener('click', gearBtn('carpet'));
$('#btnRay').addEventListener('click', gearBtn('rayGun'));
$('#x2Btn').addEventListener('click', () => (S.passes.DoubleWins ? toast('🏆 x2 Wins is on forever!', '#ffd028') : buy('pass', 'DoubleWins')));
$('#btnStore').addEventListener('click', () => openModal('store'));
$('#btnConfig').addEventListener('click', () => openModal('config'));
$('#btnInvite').addEventListener('click', () => openModal('invite'));
$('#btnGift').addEventListener('click', () => openModal('gifts'));
$('#btnTeleport').addEventListener('click', () => openModal('teleport'));
$('#btnDaily').addEventListener('click', openDaily);
actions.openStore = () => openModal('store');
actions.openTrails = () => openModal('trails');
actions.openTeleport = () => openModal('teleport');
actions.openInvite = () => openModal('invite');
actions.openLucky = openLucky;
actions.buy = buy;


// Closes the topmost popup (Escape / controller B); false when nothing was open
export function closeTop() {
    for (const id of ['#confirm', '#daily', '#lucky']) {
        if (!$(id).hidden) {
            if (id === '#confirm') closeConfirm(); else if (id === '#daily') $('#dailyClose').click(); else $('#luckyClose').click();
            return true;
        }
    }
    if (modalOpen()) { closeModal(); return true; }
    if (!$('#gearPop').hidden) { $('#gearPop').hidden = true; return true; }
    return false;
}
export const anyPopup = () => ['#confirm', '#daily', '#modal', '#lucky'].some((id) => !$(id).hidden);
