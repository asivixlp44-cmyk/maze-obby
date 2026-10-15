import { Room } from 'colyseus';
import { GameState, PlayerState } from './schema.js';
import {
    getProfile, hasProfile, markDirty, saveProfiles, adoptGuestProgress, loadProfile, releaseProfile,
    topProfiles, recordSession, USE_DB,
} from './profiles.js';
import { sealProfile, openSave } from './saves.js';
import { verifyBloxityToken } from './bloxity.js';
import {
    CFG, LOBBY, STAGES, trailById, morphById, PASSES, PRODUCTS, priceOf, tpPrice, GIFTS, DAILY, CODES, KITS, SKINS, LUCKY,
    luckyRoll, dailyStatus, dayKey, rewardText, winsMult, clamp,
} from '../../shared/config.js';
import { CHECKPOINTS, COINS, FINISH, RUN_START_Z, CHEST, PLAZA, PLAZA_W } from '../../shared/maze.js';

const GREEN = '#7dff6b', GOLD = '#ffd028', BLUE = '#6fe0ff';

// Empty string when the player left the name box blank
function cleanName(name) {
    return String(name || '').replace(/[^\w .\-]/g, '').trim().slice(0, 20);
}
const randomName = () => 'Player' + Math.floor(1000 + Math.random() * 9000);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
// Guest ids come from the browser; they can never claim a Bloxity identity
const guestUid = (uid, fallback) => String(uid || fallback).replace(/^legion_/, 'guest_').slice(0, 64);
const cleanAvatar = (av) => (typeof av === 'string' && av.length <= 2000 ? av : '');
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
const newRun = () => ({ cps: new Set(), coins: new Set(), start: 0, fromLobby: true });

export const liveRooms = new Set();

// One shared maze world. Movement is client-side; everything that changes progress (Wins,
// checkpoints, gems, the finish, gear, trails, morphs) is decided here. There are no real-money
// purchases: every price is in Wins, checked and taken by the server.
export class MazeRoom extends Room {
    maxClients = CFG.maxPlayers;

    onCreate() {
        liveRooms.add(this);
        this.setState(new GameState());
        this.setPatchRate(50);
        this.sessions = new Map();
        this.joinCount = 0;

        const on = (type, fn) => this.onMessage(type, (client, m) => { try { fn.call(this, client, m || {}); } catch (e) { console.warn('[msg]', type, e.message); } });
        on('move', this.onMove);
        on('cp', this.onCheckpoint);
        on('coin', this.onCoin);
        on('win', this.onWin);
        on('chest', this.onChest);
        on('lucky', this.onLucky);
        on('lobby', this.onLobby);
        on('tp', this.onTeleport);
        on('buy', this.onBuy);
        on('tool', this.onTool);
        on('ray', this.onRay);
        on('slash', this.onSlash);
        on('morph', this.onMorph);
        on('trail', this.onTrail);
        on('daily', this.onDaily);
        on('gift', this.onGift);
        on('code', this.onCode);
        on('auth', this.onBloxityLogin);
        on('avatar', this.onAvatar);
        on('emote', this.onEmote);
        on('chat', this.onChat);
        on('friends', this.onFriends);

        this.setSimulationInterval(() => this.tick(), 1000);
        this.clock.setInterval(() => this.broadcastBoards(), 10000);
    }

    // A Bloxity token is verified with the Bloxity API; anyone else joins as a guest
    async onAuth(client, options) {
        const legion = options && options.token ? await verifyBloxityToken(options.token) : null;
        return legion ? { legion } : { guest: true };
    }

    async onJoin(client, options, auth) {
        options = options || {};
        const guest = guestUid(options.uid, client.sessionId);
        let uid = guest, name = cleanName(options.name);
        if (auth && auth.legion) {
            uid = 'legion_' + auth.legion.id;
            name = cleanName(auth.legion.name) || name;
            await adoptGuestProgress(uid, guest, name);
        }
        await loadProfile(uid);
        // A fresh server on a temporary disk restores the browser's signed backup.
        // With a database the profile is never lost, so backups are not accepted at all.
        const restore = !USE_DB && !hasProfile(uid) && openSave(options.save, [uid, guest]);
        const profile = getProfile(uid, name, randomName());
        if (restore) { Object.assign(profile, restore); markDirty(); }
        this.fixProfile(profile);
        const player = new PlayerState();
        player.name = profile.name;
        player.av = cleanAvatar(options.av);
        player.x = LOBBY.spawn.x; player.y = LOBBY.spawn.y; player.z = LOBBY.spawn.z; player.ry = 0;
        player.kit = this.joinCount % KITS.length;
        player.skin = (this.joinCount * 3) % SKINS.length;
        this.joinCount++;
        this.state.players.set(client.sessionId, player);
        const s = {
            client, profile, player,
            pos: { x: LOBBY.spawn.x, y: LOBBY.spawn.y, z: LOBBY.spawn.z },
            run: newRun(),
            joinedAt: Date.now(), lastWin: 0, giftClaimed: {}, friends: 0, guest, lastChat: 0, lastZap: 0, lastSlash: 0, lastFling: 0, lastKill: 0, playSecs: 0,
            stats: { fresh: Date.now() - (profile.firstPlay || 0) < 60000, maxStage: -1, climbs: 0, falls: 0, wins0: profile.totalWins, buys: 0 },
        };
        this.sessions.set(client.sessionId, s);
        this.syncPublic(client.sessionId);
        client.send('hello', { now: Date.now(), bloxity: uid.startsWith('legion_') });
        this.sendProfile(client.sessionId);
        this.broadcastBoards(client);
    }

    // Older saves / hand-edited data: keep every field the right shape
    fixProfile(p) {
        for (const k of ['wins', 'totalWins', 'climbs', 'bonusAt', 'boostUntil', 'luckyAt']) if (!finite(p[k])) p[k] = 0;
        if (!p.trails || typeof p.trails !== 'object') p.trails = { starter: true };
        if (!trailById[p.trail] || !p.trails[p.trail]) p.trail = 'starter';
        if (!p.gear || typeof p.gear !== 'object') p.gear = {};
        if (!p.passes || typeof p.passes !== 'object') p.passes = {};
        if (p.tool && !p.gear[p.tool]) p.tool = '';
        if (typeof p.morph !== 'string' || (p.morph && !morphById[p.morph])) p.morph = '';
        p.stage = clamp(Math.floor(finite(p.stage) ? p.stage : -1), -1, CHECKPOINTS.length - 1);
        p.maxStage = clamp(Math.floor(finite(p.maxStage) ? p.maxStage : 0), 0, CHECKPOINTS.length);
    }

    // A dropped connection keeps the player in the world for 30 s so the client can reconnect
    onDrop(client) {
        this.allowReconnection(client, 30);
    }
    onReconnect(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        s.client = client;
        client.send('hello', { now: Date.now(), bloxity: s.profile.uid.startsWith('legion_') });
        this.sendProfile(client.sessionId);
        this.broadcastBoards(client);
    }

    onLeave(client) {
        const s = this.sessions.get(client.sessionId);
        this.state.players.delete(client.sessionId);
        this.sessions.delete(client.sessionId);
        markDirty();
        if (!s) return;
        const st = s.stats;
        recordSession({
            at: new Date(), secs: Math.round((Date.now() - s.joinedAt) / 1000), fresh: st.fresh, maxStage: st.maxStage,
            endStage: s.profile.stage, climbs: st.climbs, falls: st.falls, wins: (s.profile.totalWins || 0) - (st.wins0 || 0), buys: st.buys,
        }).catch((e) => console.warn('[stats]', e.message));
        if (!isOnline(s.profile.uid)) releaseProfile(s.profile.uid, isOnline);
    }

    // Colyseus awaits this on SIGTERM, which is how Legion stops a pod on every deploy
    onDispose() { liveRooms.delete(this); markDirty(); return saveProfiles(); }

    // ----- helpers -----
    syncPublic(id) {
        const s = this.sessions.get(id);
        if (!s) return;
        const p = s.profile, pl = s.player;
        pl.wins = p.wins;
        pl.stage = p.stage;
        pl.tool = p.tool || '';
        pl.trail = p.trail || 'starter';
        pl.morph = p.morph || '';
        pl.name = p.name;
    }
    sendProfile(id) {
        const s = this.sessions.get(id);
        if (!s) return;
        const p = s.profile;
        s.client.send('profile', {
            wins: p.wins, totalWins: p.totalWins, climbs: p.climbs, playtime: p.playtime,
            stage: p.stage, maxStage: p.maxStage, best: p.best,
            trails: p.trails, trail: p.trail, gear: p.gear, tool: p.tool, passes: p.passes, morph: p.morph, bonusAt: p.bonusAt, luckyAt: p.luckyAt,
            boostUntil: p.boostUntil, daily: p.daily, codes: p.codes, firstPlay: p.firstPlay, giftClaimed: s.giftClaimed, sessionSecs: s.playSecs,
            save: sealProfile(p),
        });
    }
    changed(id) { this.syncPublic(id); this.sendProfile(id); markDirty(); }
    toast(s, text, color) { s.client.send('toast', { text, color: color || '#ffffff' }); }
    mult(s) { return winsMult(s.profile, Date.now(), s.friends); }
    addWins(s, base, why, extra) {
        const n = Math.max(1, Math.round(base * this.mult(s)));
        s.profile.wins = (s.profile.wins || 0) + n;
        s.profile.totalWins = (s.profile.totalWins || 0) + n;
        s.client.send('earn', { n, why, ...(extra || {}) });
        return n;
    }

    // Every second: playtime
    tick() {
        for (const s of this.sessions.values()) {
            s.profile.playtime = (s.profile.playtime || 0) + 1;
            s.playSecs++;
        }
        markDirty();
    }

    // ----- movement & the run -----
    onMove(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !finite(m.x) || !finite(m.y) || !finite(m.z)) return;
        const pl = s.player;
        pl.x = clamp(m.x, -300, 300); pl.y = clamp(m.y, -80, 260); pl.z = clamp(m.z, -200, FINISH.z1 + 200);
        pl.ry = finite(m.ry) ? m.ry : 0;
        pl.anim = clamp(m.a | 0, 0, 4);
        s.pos = { x: pl.x, y: pl.y, z: pl.z };
        // Stepped into the first maze: the run clock starts
        if (!s.run.start && pl.z > RUN_START_Z) s.run.start = Date.now();
    }
    near(s, x, y, z, r, dy) { return dist2(s.pos, { x, z }) <= r * r && Math.abs(s.pos.y - y) <= dy; }

    onCheckpoint(client, m) {
        const s = this.sessions.get(client.sessionId);
        const cp = CHECKPOINTS[m.i | 0];
        // anywhere on its plaza (the pad's trigger covers the whole plaza)
        if (!s || !cp || Math.abs(s.pos.x - cp.x) > PLAZA_W / 2 + 3 || Math.abs(s.pos.z - cp.z) > PLAZA / 2 + 3 || Math.abs(s.pos.y - cp.y) > 10) return;
        const p = s.profile;
        if (!s.run.start) s.run.start = Date.now();
        if (cp.i > p.stage) { p.stage = cp.i; s.player.stage = cp.i; }
        p.maxStage = Math.max(p.maxStage || 0, cp.i + 1);
        s.stats.maxStage = Math.max(s.stats.maxStage, cp.i);
        if (!s.run.cps.has(cp.i)) {
            s.run.cps.add(cp.i);
            this.addWins(s, STAGES[cp.i].wins, 'cp', { i: cp.i });
        }
        this.changed(client.sessionId);
    }
    onCoin(client, m) {
        const s = this.sessions.get(client.sessionId);
        const c = COINS[m.i | 0];
        if (!s || !c || s.run.coins.has(c.i) || !this.near(s, c.x, c.y, c.z, 7, 8)) return;
        s.run.coins.add(c.i);
        this.addWins(s, CFG.pickupWins, 'coin', { i: c.i });
        this.changed(client.sessionId);
    }
    // The WIN pad on the finish platform after the last maze
    onWin(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !this.near(s, FINISH.x, FINISH.y, FINISH.z, FINISH.pad + 3, 6)) return;
        const now = Date.now();
        const secs = s.run.start ? (now - s.run.start) / 1000 : 0;
        const short = !s.run.fromLobby;
        // every checkpoint of the run reached (or skipped past), and a run that took a while
        if (s.run.cps.size < CHECKPOINTS.length || secs < (short ? 6 : CFG.minRunSecs) || now - s.lastWin < 30000) {
            this.toast(s, 'Escape all the mazes to win!', BLUE);
            return;
        }
        const p = s.profile;
        s.lastWin = now;
        p.climbs = (p.climbs || 0) + 1;
        s.stats.climbs++;
        if (!short && (!p.best || secs < p.best)) p.best = Math.round(secs);
        // a run that skipped ahead pays a quarter
        const n = this.addWins(s, CFG.finishWins * (short ? 0.25 : 1), 'win');
        client.send('won', { climbs: p.climbs, secs: Math.round(secs), wins: n, best: p.best, short });
        this.broadcast('announce', { text: '🏆 ' + p.name + ' escaped all 12 mazes! (' + Math.round(secs) + 's)', color: GOLD }, { except: client });
        // Rewards restart: a fresh run from the lobby, checkpoints and gems pay again
        p.stage = -1;
        s.run = newRun();
        this.changed(client.sessionId);
    }
    // The lobby's treasure chest: free Wins every few minutes
    onChest(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !this.near(s, CHEST.x, CHEST.y, CHEST.z, 9, 6)) return;
        const p = s.profile, now = Date.now();
        if (now - (p.bonusAt || 0) < CFG.chestMinutes * 60000) return this.toast(s, 'The chest refills in ' + Math.ceil((CFG.chestMinutes * 60000 - (now - p.bonusAt)) / 60000) + ' min', BLUE);
        p.bonusAt = now;
        this.addWins(s, CFG.chestWins, 'chest');
        this.changed(client.sessionId);
    }
    // The lucky block: a free spin every few minutes; the client plays the spin and lands on k
    onLucky(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const p = s.profile, now = Date.now();
        if (now - (p.luckyAt || 0) < CFG.luckyMinutes * 60000) return this.toast(s, 'The lucky block is recharging!', BLUE);
        p.luckyAt = now;
        const k = luckyRoll(Math.random()), r = LUCKY[k];
        const n = r.wins ? Math.max(1, Math.round(r.wins * this.mult(s))) : 0;
        if (n) { p.wins += n; p.totalWins += n; }
        if (r.boost) p.boostUntil = Math.max(now, p.boostUntil || 0) + CFG.boostMinutes * 60000;
        client.send('lucky', { k, n });
        this.changed(client.sessionId);
    }
    // Walked back into the lobby: the run clock restarts from the bottom, checkpoint kept
    onLobby(client) {
        const s = this.sessions.get(client.sessionId);
        if (s) { s.run.start = 0; s.run.fromLobby = true; }
    }
    // Teleports: your own checkpoint is free; another stage you have reached costs Wins (and makes
    // the run a shortcut). The client only moves once the server says so ('tpTo').
    onTeleport(client, m) {
        const s = this.sessions.get(client.sessionId);
        const i = m.i | 0, cp = CHECKPOINTS[i];
        if (!s || !cp) return;
        const p = s.profile, own = i === p.stage;
        if (!own && i >= (p.maxStage || 0)) return;
        const price = tpPrice(i, own);
        if ((p.wins || 0) < price) return client.send('broke', { need: price - (p.wins || 0), price, name: 'Teleport to Stage ' + (i + 2) });
        p.wins -= price;
        if (!own) {
            p.stage = i;
            s.run.fromLobby = false;
            s.run.cps.add(i);
        }
        if (!s.run.start) s.run.start = Date.now();
        s.pos = { x: cp.x, y: cp.y, z: cp.z };
        client.send('tpTo', { i });
        this.changed(client.sessionId);
    }

    // ----- the Wins shop: the server checks the price, takes the Wins, then grants -----
    onBuy(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m || (m.kind !== 'pass' && m.kind !== 'product')) return;
        const p = s.profile, key = String(m.key || '');
        const item = (m.kind === 'pass' ? PASSES : PRODUCTS)[key];
        if (!item) return;
        if (m.kind === 'pass' && p.passes[key]) return this.toast(s, item.name + ' already owned!', BLUE);
        if (key === 'Skip' && p.stage >= CHECKPOINTS.length - 1) return this.toast(s, 'This is the last maze: use Skip to End!', BLUE);
        const wait = (last, secs) => Math.ceil((secs * 1000 - (Date.now() - last)) / 1000);
        if (key === 'FlingAll' && wait(s.lastFling, CFG.flingCooldown) > 0) return this.toast(s, '🌪️ Fling All is recharging! Try again in ' + wait(s.lastFling, CFG.flingCooldown) + 's', BLUE);
        if (key === 'KillAll' && wait(s.lastKill, CFG.killCooldown) > 0) return this.toast(s, '💀 Kill All is recharging! Try again in ' + wait(s.lastKill, CFG.killCooldown) + 's', BLUE);
        if ((key === 'FlingAll' || key === 'KillAll') && this.sessions.size < 2) return this.toast(s, 'Nobody else is here yet!', BLUE);
        const price = priceOf(m.kind, key, p);
        if ((p.wins || 0) < price) return client.send('broke', { need: price - (p.wins || 0), price, name: item.name });
        p.wins -= price;
        this.grant(s, client.sessionId, m.kind, key);
    }
    grant(s, id, kind, key) {
        const client = s.client;
        const p = s.profile;
        s.stats.buys++;
        if (kind === 'pass') {
            const pass = PASSES[key];
            p.passes[key] = true;
            if (pass.gear) { p.gear[pass.gear] = true; p.tool = pass.gear; }
            this.toast(s, pass.ic + ' ' + pass.name + ' unlocked!', GREEN);
            client.send('fx', { kind: 'unlock', key });
        } else {
            if (key === 'Skip') {
                p.stage = p.stage + 1;
                p.maxStage = Math.max(p.maxStage || 0, p.stage + 1);
                s.run.cps.add(p.stage);
                s.run.fromLobby = false;
                if (!s.run.start) s.run.start = Date.now();
                client.send('skipTo', { i: p.stage });
            } else if (key === 'SkipEnd') {
                p.stage = CHECKPOINTS.length - 1;
                p.maxStage = CHECKPOINTS.length;
                for (let i = 0; i < CHECKPOINTS.length; i++) s.run.cps.add(i);
                s.run.fromLobby = false;
                s.run.start = Date.now();
                client.send('skipEnd', {});
            } else if (key === 'FlingAll') {
                s.lastFling = Date.now();
                this.broadcast('fling', { by: p.name, s: id }, { except: client });
                this.toast(s, '🌪️ You flung everyone!', GOLD);
                client.send('flingSent', {});
            } else if (key === 'KillAll') {
                s.lastKill = Date.now();
                this.broadcast('killed', { by: p.name, all: true }, { except: client });
                this.toast(s, '💀 Everyone else is back at their checkpoint!', GOLD);
                client.send('killSent', {});
            } else if (key === 'WinsBoost') {
                p.boostUntil = Math.max(Date.now(), p.boostUntil || 0) + CFG.boostMinutes * 60000;
                this.toast(s, '⏱️ x2 Wins for ' + CFG.boostMinutes + ' minutes!', GOLD);
            }
            client.send('fx', { kind: 'confetti', key });
        }
        this.changed(id);
    }

    // ----- gear: the Ray Gun flings, the Deadly Sword sends players back to their checkpoint -----
    onTool(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const id = String(m.id || '');
        if (id && !s.profile.gear[id]) return;
        s.profile.tool = id;
        this.changed(client.sessionId);
    }
    onRay(client, m) {
        const s = this.sessions.get(client.sessionId);
        const t = this.sessions.get(String(m.t || ''));
        const now = Date.now();
        if (!s || !t || t === s || s.profile.tool !== 'rayGun' || now - s.lastZap < CFG.rayCooldown * 1000 * 0.8) return;
        const d = Math.hypot(t.pos.x - s.pos.x, t.pos.y - s.pos.y, t.pos.z - s.pos.z);
        if (d > CFG.rayRange + 12) return;
        s.lastZap = now;
        const dx = t.pos.x - s.pos.x, dz = t.pos.z - s.pos.z, l = Math.hypot(dx, dz) || 1;
        t.client.send('zapped', { dx: dx / l, dz: dz / l, by: s.profile.name });
        this.broadcast('zapFx', { s: client.sessionId, t: String(m.t) });
    }
    onSlash(client, m) {
        const s = this.sessions.get(client.sessionId);
        const now = Date.now();
        if (!s || s.profile.tool !== 'sword' || now - s.lastSlash < CFG.swordCooldown * 1000 * 0.8) return;
        s.lastSlash = now;
        this.broadcast('slashFx', { s: client.sessionId }, { except: client });
        const t = this.sessions.get(String(m.t || ''));
        if (!t || t === s) return;
        const d = Math.hypot(t.pos.x - s.pos.x, t.pos.y - s.pos.y, t.pos.z - s.pos.z);
        if (d > CFG.swordRange + 5) return;
        t.client.send('killed', { by: s.profile.name });
        this.toast(s, '🗡️ You sent ' + t.profile.name + ' back to their checkpoint!', GOLD);
    }

    // ----- Free Morphs (cosmetic, free) -----
    onMorph(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const id = String(m.id || '');
        if (id && !morphById[id]) return;
        s.profile.morph = id;
        this.changed(client.sessionId);
    }

    // ----- trails -----
    onTrail(client, m) {
        const s = this.sessions.get(client.sessionId);
        const d = trailById[m.id];
        if (!s || !d) return;
        const p = s.profile;
        if (!p.trails[d.id]) {
            if (p.wins < d.price) return client.send('broke', { need: d.price - p.wins, price: d.price, name: d.name });
            p.wins -= d.price;
            p.trails[d.id] = true;
            this.toast(s, d.name + ' trail unlocked!', GREEN);
        }
        p.trail = d.id;
        this.changed(client.sessionId);
    }

    // ----- rewards -----
    giveReward(s, r) {
        const p = s.profile;
        if (r.wins) { p.wins += r.wins; p.totalWins += r.wins; }
        if (r.boost) p.boostUntil = Math.max(Date.now(), p.boostUntil || 0) + CFG.boostMinutes * 60000;
        if (r.trail && trailById[r.trail]) {
            if (!p.trails[r.trail]) p.trails[r.trail] = true;
            else { p.wins += 100; p.totalWins += 100; }
        }
    }
    onDaily(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const p = s.profile, now = Date.now();
        const st = dailyStatus(p.daily, now);
        if (!st.can) return this.toast(s, 'Come back tomorrow for more!', BLUE);
        const r = DAILY[st.day];
        p.daily = { last: dayKey(now), streak: st.streak + 1 };
        this.giveReward(s, r);
        this.toast(s, 'Day ' + p.daily.streak + ' reward: ' + rewardText(r) + '!', GREEN);
        client.send('fx', { kind: 'confetti' });
        this.changed(client.sessionId);
    }
    onGift(client, m) {
        const s = this.sessions.get(client.sessionId);
        const k = m.k | 0, g = GIFTS[k];
        if (!s || !g || s.giftClaimed[k]) return;
        if (s.playSecs < g.min * 60 - 2) return this.toast(s, 'Keep playing to unlock this gift!', BLUE);
        s.giftClaimed[k] = true;
        this.giveReward(s, g);
        this.toast(s, '🎁 ' + rewardText(g) + '!', GREEN);
        client.send('fx', { kind: 'confetti' });
        this.changed(client.sessionId);
    }
    onCode(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const code = String(m.code || '').trim().toUpperCase().slice(0, 24);
        const r = CODES[code];
        const p = s.profile;
        p.codes = p.codes || {};
        if (!r) return client.send('codeResult', { ok: false, text: 'Invalid code' });
        if (p.codes[code]) return client.send('codeResult', { ok: false, text: 'Code already used' });
        p.codes[code] = true;
        this.giveReward(s, r);
        client.send('codeResult', { ok: true, text: rewardText(r) + '!' });
        this.changed(client.sessionId);
    }

    broadcastBoards(client) {
        const row = (key) => topProfiles(key).filter((p) => (p[key] || 0) > 0).map((p) => ({ n: p.name, v: Math.floor(p[key] || 0) }));
        const m = { wins: row('totalWins'), playtime: row('playtime'), climbs: row('climbs') };
        if (client) client.send('boards', m); else this.broadcast('boards', m);
    }

    // ----- Bloxity -----
    // Logged in to Bloxity after joining: move this session onto the Bloxity profile
    async onBloxityLogin(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m || s.authing) return;
        s.authing = true;
        const legion = await verifyBloxityToken(m.token);
        s.authing = false;
        if (!legion || !this.sessions.has(client.sessionId)) return;
        const uid = 'legion_' + legion.id;
        if (s.profile.uid === uid) return;
        const name = cleanName(legion.name) || s.profile.name;
        const guestProfile = s.profile;
        await adoptGuestProgress(uid, guestProfile.uid, name);
        await loadProfile(uid);
        if (!this.sessions.has(client.sessionId)) return;
        s.profile = getProfile(uid, name, randomName());
        this.fixProfile(s.profile);
        if (!isOnline(guestProfile.uid)) releaseProfile(guestProfile.uid, isOnline);
        s.player.name = s.profile.name;
        this.changed(client.sessionId);
        client.send('authed', { name: s.profile.name });
        this.toast(s, 'Logged in as ' + s.profile.name, GREEN);
        this.broadcastBoards();
    }
    onAvatar(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (s && m) s.player.av = cleanAvatar(m.av);
    }
    // Emote ids are opaque catalogue ids; other players play the same clip
    onEmote(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m || typeof m.id !== 'string' || m.id.length > 40) return;
        this.broadcast('emote', { s: client.sessionId, id: m.id }, { except: client });
    }
    onChat(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m || typeof m.text !== 'string') return;
        const now = Date.now();
        if (now - s.lastChat < 800) return;
        s.lastChat = now;
        const text = m.text.replace(/\s+/g, ' ').trim().slice(0, 120);
        if (text) this.broadcast('chat', { s: client.sessionId, name: s.profile.name, text });
    }
    // Friend Boost: the client counts its Bloxity friends among the names in this room.
    // Only names actually present here are counted, and the bonus is capped.
    onFriends(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m || !Array.isArray(m.names)) return;
        const here = new Set([...this.sessions.values()].filter((o) => o !== s).map((o) => o.profile.name));
        const n = new Set(m.names.slice(0, 50).map(String).filter((x) => here.has(x))).size;
        const friends = Math.min(CFG.friendMax, n);
        if (friends === s.friends) return;
        s.friends = friends;
        s.player.friends = friends;
    }
}

function isOnline(uid) {
    for (const room of liveRooms) for (const s of room.sessions.values()) if (s.profile.uid === uid) return true;
    return false;
}

