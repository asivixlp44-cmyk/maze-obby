import { Client } from '@colyseus/sdk';
import {
    T, V3, $, canvas, scene, camera, sun, renderer, solids, triggers, prompts, tickers,
    billboard, buildRig, animRig, airPose, holdPose, floatText, updateEffects, lerpAngle, updateSky, setMood, SUN_DIRECTION,
} from './engine.js';
import { S, actions, net } from './state.js';
import { initAudio, resumeAudio, audioDebug, startMusic, sfx, step as surfStep, setVolume, audioSuspended, loopSound } from './audio.js';
import * as BX from './bloxity.js';
import { createAvatar, loadBase, packAvatar, unpackAvatar } from './avatar.js';
import { pad, pollGamepad, rumble, onGamepadConnection } from './gamepad.js';
import {
    render, updateFx, dust, sparkleColumn, ring, fireworks, setQuality, getQuality, autoQualityAllowed, makeTrail, splash,
    coinBurst, nukeFx, zapFx, poofFx, slashFx, confetti, updateAmbient, setSpeedLines, fxWarmGroup, fxShowAll,
} from './fx.js';
import {
    buildWorld, warmUp, SPAWN, SPAWN_YAW, renderBoards, updateWorld, cullZones, refreshGearPads, refreshMorphPads, lightCheckpoint, coinState,
    setDecorLow, themeOf, updateChest, chestState, luckyState,
} from './world.js';
import { heldModel, carpet as carpetModel, waveCarpet } from './gear.js';
import { buildMorph, morphStatue } from './morphs.js';
import {
    updateHud, toast, showStageTitle, showWin, showOof, flash, teleportFx, showOops, hideOops, showGearPop, renderHotbar, hotbarGear,
    renderProgress, animateCounters, bumpCoins, openDailyOnJoin, refreshModal, refreshDaily, openModal, notEnough, showStageClear,
    promptEl, promptTxtEl, codeResult, buy, closeTop, anyPopup, cheer, luckyResult,
} from './ui.js';
import { CFG, STAGES, KITS, SKINS, trailById, morphById, passForGear, fmt, clamp } from '../../shared/config.js';
import { CHECKPOINTS, COINS, FINISH, checkpointSpot, stageAt, nearestCell, MAZES, solve, CELL, WALL_H } from '../../shared/maze.js';

// =====================================================================================
// Local player
// =====================================================================================
const HW = 1, PH = 5, STEP = 1.25, PIVOT = 2.6;
const P = {
    pos: SPAWN.clone(), vel: new V3(), kv: new V3(), hv: new V3(), onGround: false, ground: null, facing: SPAWN_YAW, moving: false,
    animPhase: 0, airTime: 0, peakY: 0, stage: -1, lastStepN: 0, squash: 1, squashV: 0,
    flying: false, lastZap: -9, swing: 0, jumpPress: -9, coyote: 0, onIce: false,
};
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let shake = 0;
function addShake(a) { if (!reduceMotion) shake = Math.min(1.2, shake + a); }
let rig = null, headLabel, nameLabelText = '';

// The sparkly forcefield bubble you get for a moment after spawning
const shieldMat = new T.ShaderMaterial({
    transparent: true, depthWrite: false, blending: T.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uA: { value: 1 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); vP = position; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime; uniform float uA; varying vec3 vN; varying vec3 vV; varying vec3 vP;
        float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        void main(){
            float f = pow(1.0 - abs(dot(normalize(vN), vV)), 2.2);
            vec3 q = floor(vP * 5.0 + vec3(0.0, uTime * 2.0, 0.0));
            float sp = step(0.93, h(q)) * (0.5 + 0.5 * sin(uTime * 9.0 + h(q + 1.7) * 30.0));
            vec3 c = mix(vec3(0.55, 0.85, 1.0), vec3(0.75, 1.0, 0.85), 0.5 + 0.5 * sin(uTime * 2.0 + vP.y));
            gl_FragColor = vec4(c, (f * 0.7 + sp * 0.5 + 0.06) * uA);
        }`,
});
const shieldGeo = new T.SphereGeometry(3.6, 28, 18);
tickers.push((dt, t) => { shieldMat.uniforms.uTime.value = t; });
function setShield(g, secs) {
    const u = g.userData;
    if (!u.shield) { u.shield = new T.Mesh(shieldGeo, shieldMat); u.shield.position.y = 2.6; u.shield.renderOrder = 7; g.add(u.shield); }
    u.shieldT = secs;
    u.shield.visible = secs > 0;
}
function tickShield(g, dt) {
    const u = g.userData;
    if (!u.shield || u.shieldT <= 0) return;
    u.shieldT -= dt;
    u.shield.visible = u.shieldT > 0;
    u.shield.scale.setScalar(1 + Math.sin(performance.now() / 160) * 0.03);
}

// ----- a character: rig (feet, yaw) -> pivot (hips) -> body (blocky, Bloxity or a morph) + tool -----
function buildCharacter(kit, skin) {
    const g = new T.Group();
    const pivot = new T.Group(); pivot.position.y = PIVOT; g.add(pivot);
    const k = KITS[kit % KITS.length];
    const body = buildRig({ ...k, skin: SKINS[skin % SKINS.length] });
    body.position.y = -PIVOT;
    pivot.add(body);
    g.userData = { pivot, body, baseBody: body, morphId: '', morphs: {}, tool: '', held: null, carpet: null, trail: null, trailId: '' };
    return g;
}
// Free Morphs swap the whole body (the Bloxity avatar stays inside the base body, hidden with it)
function setMorph(g, id) {
    const u = g.userData;
    id = morphById[id] ? id : '';
    if (u.morphId === id) return;
    u.morphId = id;
    const next = id ? (u.morphs[id] || (u.morphs[id] = buildMorph(id))) : u.baseBody;
    if (!next || next === u.body) return;
    u.pivot.remove(u.body);
    next.position.y = -PIVOT;
    u.pivot.add(next);
    if (u.held) next.add(u.held);
    u.body = next;
}
// The tool in the right hand; the carpet under the feet
function setTool(g, id) {
    const u = g.userData;
    if (u.tool === (id || '')) return;
    u.tool = id || '';
    for (const k of ['held', 'carpet']) if (u[k]) { u[k].parent && u[k].parent.remove(u[k]); u[k] = null; }
    if (!id) return;
    if (id === 'carpet') { u.carpet = carpetModel(0.95); u.carpet.position.y = 0.25; u.carpet.visible = false; g.add(u.carpet); return; }
    const h = heldModel(id);
    if (h) { h.position.set(1.5, 2.2, 0.3); u.body.add(h); u.held = h; }
}
function setTrail(g, id) {
    const u = g.userData;
    const d = trailById[id] || trailById.starter;
    if (!u.trail) u.trail = makeTrail(d.color);
    if (u.trailId !== d.id) {
        u.trailId = d.id;
        u.trail.setColor(d.color, d.rainbow);
        u.trail.width = d.id === 'starter' ? 0.5 : 0.8;
    }
}

// ----- Bloxity avatars: replace the blocky body's meshes, keep the pivot, tools and labels -----
function dressRig(group, avatar) {
    const u = group.userData, body = u.baseBody;
    body.children.forEach((c) => { if (c !== u.held) c.visible = false; });
    body.add(avatar.root);
    u.blox = avatar;
}
let localAvatar = null, localAvatarReq = 0;
async function setupLocalAvatar() {
    const req = ++localAvatarReq;
    const a = await createAvatar(BX.currentAvatar(), BX.getSkinTextureUrl());
    if (!a) return;
    if (req !== localAvatarReq || !rig) { a.dispose(); return; }
    if (localAvatar) localAvatar.dispose();
    localAvatar = a;
    dressRig(rig, a);
}
function syncMyAvatar() {
    const av = BX.currentAvatar();
    if (localAvatar && av) { localAvatar.setProportions(av.proportions); localAvatar.setEquipped(av, BX.getSkinTextureUrl()); }
    net.send('avatar', { av: packAvatar(av) });
}
async function playEmoteOn(avatar, id) {
    if (!avatar) return;
    const cat = await BX.loadEmotes();
    const e = cat.get(id);
    if (e && e.clip) avatar.playEmote(e.clip);
}
function chatBubble(group, text) {
    if (!group) return;
    if (group.userData.bubble) { group.remove(group.userData.bubble); group.userData.bubble.material.map.dispose(); }
    const b = billboard([{ t: '💬 ' + text, c: '#ffffff', s: '#1a1a3a', px: 44 }], 9, 1024, new V3(0, 10, 0), group);
    group.userData.bubble = b;
    setTimeout(() => { if (group.userData.bubble === b) { group.remove(b); b.material.map.dispose(); group.userData.bubble = null; } }, 5000);
}
const nameLines = (name) => [{ t: name || ' ', c: '#ffffff', s: '#1a1a3a', px: 60 }];

function buildPlayer(kit, skin) {
    if (rig) { scene.remove(rig); if (rig.userData.trail) rig.userData.trail.dispose(); }
    rig = buildCharacter(kit, skin);
    scene.add(rig);
    nameLabelText = '';
    headLabel = billboard(nameLines(S.name), 6.5, 512, new V3(0, 7.8, 0), rig);
    // like Roblox, you don't see your own name tag (it would sit over every sign you look at)
    headLabel.visible = false;
    rig.position.copy(P.pos);
    localAvatar = null;
    setupLocalAvatar();
}

// =====================================================================================
// Collision: boxes, plus round shapes (the WIN pad) with their own surface tests
// =====================================================================================
let nearBoxes = [], nearRound = [], nearTriggers = triggers, nearPrompts = prompts, nearZoneKey = null;
// (called every frame: returns straight away unless the zone or the height band changed)
function refreshNear(stage, high) {
    const key = stage * 2 + (high ? 1 : 0);
    if (key === nearZoneKey) return;
    nearZoneKey = key;
    const zs = new Set([stage - 1, stage, stage + 1]);
    // the lobby only matters near the lobby
    const ok = (o) => o.zone === undefined || o.zone === -2 || (o.zone === -1 ? stage <= 0 : zs.has(o.zone));
    const list = solids.filter(ok);
    nearBoxes = list.filter((s) => !s.shape);
    nearRound = list.filter((s) => s.shape);
    nearTriggers = triggers.filter(ok);
    nearPrompts = prompts.filter(ok);
    cullZones(stage, high);
}
const overlaps = (c, x, y, z) => !c.off && c.max.x > x - HW && c.min.x < x + HW && c.max.y > y && c.min.y < y + PH && c.max.z > z - HW && c.min.z < z + HW;
function freeAt(x, y, z) {
    for (const c of nearBoxes) if (overlaps(c, x, y, z)) return false;
    return true;
}
function moveAxis(axis, d) {
    if (d === 0) return;
    const p = P.pos;
    p[axis] += d;
    for (const c of nearBoxes) {
        if (!overlaps(c, p.x, p.y, p.z)) continue;
        if (axis === 'y') {
            if (d < 0) { p.y = c.max.y; P.vel.y = Math.max(0, P.vel.y); P.onGround = true; P.ground = c; }
            else { p.y = c.min.y - PH - 1e-4; if (P.vel.y > 0) P.vel.y = 0; }
        } else {
            const rise = c.max.y - p.y;
            if (rise > 0 && rise <= STEP && (P.onGround || P.vel.y <= 0) && freeAt(p.x, c.max.y + 0.01, p.z)) { p.y = c.max.y + 0.001; continue; }
            if (d > 0) p[axis] = c.min[axis] - HW - 1e-4; else p[axis] = c.max[axis] + HW + 1e-4;
        }
    }
}
// Top of a round shape under (x, z); null if not over it
function surfaceY(s, x, z) {
    const d = Math.hypot(x - s.cx, z - s.cz);
    return d <= s.r + 0.55 ? s.max.y : null;
}
function resolveRound() {
    const p = P.pos;
    for (const s of nearRound) {
        if (s.off) continue;
        if (p.x + HW < s.min.x || p.x - HW > s.max.x || p.z + HW < s.min.z || p.z - HW > s.max.z) continue;
        if (p.y > s.max.y + 0.01 || p.y + PH < s.min.y) continue;
        const top = surfaceY(s, p.x, p.z);
        if (top === null || p.y >= top - 0.001) continue;
        if (top - p.y <= STEP || P.vel.y <= 0) { p.y = top; P.vel.y = Math.max(0, P.vel.y); P.onGround = true; P.ground = s; }
    }
}
// Snap down onto ground just below (walking off a step)
function groundProbe(maxDrop) {
    const p = P.pos;
    let best = -Infinity, bs = null;
    for (const c of nearBoxes) {
        if (c.off) continue;
        if (c.max.x <= p.x - HW || c.min.x >= p.x + HW || c.max.z <= p.z - HW || c.min.z >= p.z + HW) continue;
        if (c.max.y <= p.y + 0.01 && c.max.y >= p.y - maxDrop && c.max.y > best) { best = c.max.y; bs = c; }
    }
    for (const s of nearRound) {
        if (s.off) continue;
        const top = surfaceY(s, p.x, p.z);
        if (top !== null && top <= p.y + 0.01 && top >= p.y - maxDrop && top > best) { best = top; bs = s; }
    }
    if (bs) { p.y = best; P.onGround = true; P.ground = bs; P.vel.y = Math.max(0, P.vel.y); }
    return !!bs;
}
const overlapsBox = (t, p) => t.max.x > p.x - HW && t.min.x < p.x + HW && t.max.y > p.y && t.min.y < p.y + PH && t.max.z > p.z - HW && t.min.z < p.z + HW;

// ----- gear stats -----
const tool = () => S.tool || '';
function walkSpeed() {
    let w = CFG.walk;
    if (tool() === 'speedCoil') w *= CFG.speedCoil;
    if (tool() === 'superCoil') w *= CFG.superCoil.walk;
    return qaWalk || w;
}
const gravity = () => CFG.grav * (tool() === 'gravityCoil' ? CFG.gravityCoil : tool() === 'superCoil' ? CFG.superCoil.grav : 1);
const jumpV = () => CFG.jumpV;

function teleport(pos, yaw, fx) {
    P.pos.copy(pos); P.vel.set(0, 0, 0); P.kv.set(0, 0, 0); P.hv.set(0, 0, 0);
    P.facing = yaw || 0; cam.yaw = (yaw || 0) + Math.PI;
    P.peakY = pos.y; P.airTime = 0;
    if (rig && rig.userData.trail) rig.userData.trail.reset();
    P.stage = stageAt(pos.x, pos.y, pos.z);
    refreshNear(P.stage, pos.y > WALL_H + 2);
    for (const t of nearTriggers) t.inside = overlapsBox(t, pos);
    sendMove(true);
    if (fx) { teleportFx(); sfx('teleport'); }
}
function teleportLobby() {
    teleport(SPAWN, SPAWN_YAW, true);
    net.send('lobby');
    if (rig) { setShield(rig, CFG.spawnShield); sfx('shield'); }
}
// Your own checkpoint is free; the server answers 'tpTo', which moves you
actions.teleportLobby = () => { hideOops(); teleportLobby(); };
actions.teleportCheckpoint = () => {
    if (!checkpointSpot(S.stage)) { teleportLobby(); return; }
    net.send('tp', { i: S.stage });
};
actions.teleportTo = (i) => {
    if (!checkpointSpot(i) || (i !== S.stage && i >= (S.maxStage || 0))) return;
    net.send('tp', { i });
};
// Back to your own checkpoint (killed, fell, the portal's Respawn), or the spawn without one
function respawn(fx) {
    const spot = checkpointSpot(S.stage);
    if (spot) teleport(new V3(spot.x, 0.6, spot.z), spot.yaw, fx !== false);
    else { teleport(SPAWN, SPAWN_YAW, fx !== false); net.send('lobby'); }
    if (rig) setShield(rig, CFG.spawnShield);
}

// =====================================================================================
// Checkpoints, gems, the finish, gear pads, morphs, the chest
// =====================================================================================
actions.checkpoint = (i) => net.send('cp', { i });
let finishLock = 0;
actions.finish = () => {
    if (clockT - finishLock < 4) return;
    finishLock = clockT;
    net.send('win');
};
actions.chest = () => {
    if (chestState.ready) net.send('chest');
    else toast('💰 The chest refills in ' + chestState.left, '#ffd028');
};
actions.gearPad = (id, fromPrompt) => {
    if (S.gear[id]) { if (fromPrompt) actions.equip(id); else showGearPop(id); return; }
    if (fromPrompt) buy('pass', passForGear(id)); else showGearPop(id);
};
// Equip (or put away) a gear; buy it first if you don't own it
actions.equip = (id) => {
    if (!S.gear[id]) { buy('pass', passForGear(id)); return; }
    const next = S.tool === id ? '' : id;
    S.tool = next;
    net.send('tool', { id: next });
    sfx('equip');
    renderHotbar(); refreshGearPads();
    if (next === 'carpet') toast('🧞 Magic Carpet: Space to rise, Shift to sink', '#ffd028');
    else if (next === 'rayGun') toast('🔫 Ray Gun: click a player to zap them!', '#2ae8d8');
    else if (next === 'sword') toast('🗡️ Deadly Sword: click to swing at players nearby!', '#c87aff');
    else if (next === 'speedCoil') toast('🌀 Speed Coil: zoom!', '#ff6a7a');
    else if (next === 'gravityCoil') toast('🪐 Gravity Coil: floaty jumps!', '#6aa8ff');
    else if (next === 'superCoil') toast('💫 Super Coil: fast and floaty!', '#c45aff');
};
let morphT = -9;
actions.morph = (id) => {
    if ((S.morph || '') === (id || '') || clockT - morphT < 0.6) return;
    morphT = clockT;
    S.morph = id || '';
    net.send('morph', { id: S.morph });
    if (rig) setMorph(rig, S.morph);
    poofFx(P.pos); sfx('equip'); sfx('shield');
    refreshMorphPads();
    toast(id ? morphById[id].ic + ' You are now ' + morphById[id].name + '!' : '🙂 Back to your own avatar', '#ffffff');
};

// Kill bricks: touch one and you're back at your checkpoint (the start of this maze)
let killT = -9;
actions.killBrick = () => {
    if (P.flying || clockT - killT < 1) return;
    killT = clockT;
    flash('#ff2a3a', 500); sfx('oops'); addShake(0.7); rumble(0.7, 250);
    splash(P.pos, 0xff3a4a, 18, 1.3); ring(P.pos, 0xff3a4a, 6, 0.4);
    showOof();
    toast('💥 Kill brick! Back to your checkpoint', '#ff6a7a');
    respawn(true);
};

function checkCoins() {
    const p = P.pos;
    for (const c of COINS) {
        if (coinState.collected.has(c.i) || Math.abs(c.zone - P.stage) > 1) continue;
        const dx = c.x - p.x, dy = c.y - (p.y + 2.5), dz = c.z - p.z;
        if (dx * dx + dy * dy + dz * dz < 4.2 * 4.2) {
            coinState.collected.add(c.i);
            coinBurst(new V3(c.x, c.y, c.z));
            sfx('coin');
            net.send('coin', { i: c.i });
        }
    }
}

// =====================================================================================
// Friend Boost
// =====================================================================================
let friendNames = [], friendsT = 3, friendSyncT = 5;
async function refreshFriends() {
    if (!BX.bloxity.ready || !BX.identity().loggedIn) return;
    const list = await BX.getFriends();
    friendNames = list.map((f) => f.displayName || f.username).filter(Boolean);
    syncFriends();
}
function syncFriends() {
    const room = net.room;
    if (!room || !room.state || !room.state.players || !friendNames.length) return;
    const here = [];
    room.state.players.forEach((p, id) => { if (id !== room.sessionId && friendNames.includes(p.name)) here.push(p.name); });
    net.send('friends', { names: here });
}

// =====================================================================================
// Other players
// =====================================================================================
const remotes = new Map();
let joinSynced = false;
class Remote {
    constructor(p) {
        this.rig = buildCharacter(p.kit, p.skin);
        this.rig.position.set(p.x, p.y, p.z);
        this.rig.rotation.y = p.ry;
        scene.add(this.rig);
        this.label = billboard(nameLines(p.name), 6, 512, new V3(0, 7.8, 0), this.rig);
        this.labelKey = p.name;
        this.av = null; this.blox = null; this.dead = false; this.phase = 0; this.vel = 0;
        this.lastX = p.x; this.lastZ = p.z; this.stepN = 0; this.swing = 0;
        this.setAvatar(p.av);
        if (Math.hypot(p.x - SPAWN.x, p.z - SPAWN.z) < 14 && p.y < 4) setShield(this.rig, CFG.spawnShield);
    }
    setAvatar(av) {
        this.av = av;
        const data = av ? unpackAvatar(av) : null;
        if (this.blox) { this.blox.setProportions(data && data.proportions); this.blox.setEquipped(data || {}); return; }
        if (this.loading) return;
        this.loading = true;
        createAvatar(data).then((a) => {
            this.loading = false;
            if (!a) return;
            if (this.dead) { a.dispose(); return; }
            this.blox = a;
            dressRig(this.rig, a);
            if (this.av !== av) this.setAvatar(this.av);
        });
    }
    update(p, dt, t) {
        const r = this.rig, u = r.userData;
        const k = 1 - Math.exp(-dt * 12);
        const far = (r.position.x - p.x) ** 2 + (r.position.z - p.z) ** 2 + (r.position.y - p.y) ** 2 > 900;
        if (far) {
            r.position.set(p.x, p.y, p.z); if (u.trail) u.trail.reset();
            if (Math.hypot(p.x - SPAWN.x, p.z - SPAWN.z) < 14 && p.y < 4) setShield(r, CFG.spawnShield);
        } else { r.position.x += (p.x - r.position.x) * k; r.position.y += (p.y - r.position.y) * k; r.position.z += (p.z - r.position.z) * k; }
        r.rotation.y = lerpAngle(r.rotation.y, p.ry, k);
        if (p.av !== this.av) this.setAvatar(p.av);
        if ((p.morph || '') !== u.morphId) { setMorph(r, p.morph); poofFx(r.position); }
        const moved = Math.hypot(r.position.x - this.lastX, r.position.z - this.lastZ);
        this.vel += ((dt > 0 ? moved / dt : 0) - this.vel) * Math.min(1, dt * 6);
        this.lastX = r.position.x; this.lastZ = r.position.z;
        const air = p.anim === 2, fly = p.anim === 4;
        const moving = p.anim === 1 && this.vel > 1;
        this.phase += dt * (moving ? Math.min(18, 4 + this.vel * 0.3) : 0);
        if (air) airPose(u.body); else if (moving) animRig(u.body, this.phase, 0.85); else animRig(u.body, 0, 0);
        if (u.tool && u.held) holdPose(u.body);
        if (this.swing > 0) { this.swing -= dt; u.body.userData.arms[1].rotation.set(-1.6 - Math.sin((1 - this.swing / 0.3) * Math.PI) * 0.9, 0, 0); }
        if (this.blox) this.blox.update(dt, { moving, air: air || fly, speed: this.vel, t });
        // their footsteps make sounds too when close by
        const stepN = Math.floor(this.phase / Math.PI);
        if (moving && stepN !== this.stepN && camera.position.distanceToSquared(r.position) < 900) {
            const s = groundUnder(r.position);
            if (s) stepQuiet(s.mat);
        }
        this.stepN = stepN;
        u.pivot.position.y = PIVOT + (moving ? Math.abs(Math.sin(this.phase)) * 0.16 : 0);
        this.lean = (this.lean || 0) + ((moving ? 0.13 : fly ? 0.2 : 0) - (this.lean || 0)) * Math.min(1, dt * 8);
        u.pivot.rotation.set(this.lean, 0, 0);
        setTool(r, p.tool); setTrail(r, p.trail);
        if (u.carpet) { u.carpet.visible = fly; if (fly) waveCarpet(u.carpet, t, 1); }
        u.trail.update(trailAt(r), (moving || air || fly) && r.visible, dt, t);
        tickShield(r, dt);
        if (p.name !== this.labelKey) { this.labelKey = p.name; this.label.userData.set(nameLines(p.name)); }
    }
    dispose() {
        this.dead = true;
        if (this.blox) this.blox.dispose();
        if (this.rig.userData.trail) this.rig.userData.trail.dispose();
        scene.remove(this.rig);
    }
}
const trailTmp = new V3();
function trailAt(r) { return trailTmp.set(r.position.x - Math.sin(r.rotation.y) * 0.9, r.position.y + 2.4, r.position.z - Math.cos(r.rotation.y) * 0.9); }
// The solid right under a position (for other players' footstep sounds)
function groundUnder(pos) {
    for (const c of nearBoxes) if (!c.off && pos.x > c.min.x && pos.x < c.max.x && pos.z > c.min.z && pos.z < c.max.z && Math.abs(c.max.y - pos.y) < 0.6) return c;
    return null;
}
let quietT = 0;
function stepQuiet(m) { if (clockT - quietT < 0.06) return; quietT = clockT; surfStep(surfaceSound(m), false); }

const seenIds = new Set();
function syncRemotes(dt, t) {
    const room = net.room;
    if (!room || !room.state || !room.state.players) return;
    const seen = seenIds;
    seen.clear();
    room.state.players.forEach((p, id) => {
        if (id === room.sessionId) {
            S.name = p.name; S.friends = p.friends;
            if (!rig || rig.userData.kit !== p.kit) { buildPlayer(p.kit, p.skin); rig.userData.kit = p.kit; setShield(rig, CFG.spawnShield); }
            return;
        }
        seen.add(id);
        let r = remotes.get(id);
        if (!r) {
            r = new Remote(p); remotes.set(id, r);
            if (joinSynced) BX.playerJoined(p.name); else BX.playerInRoom(p.name);
        }
        r.update(p, dt, t);
    });
    for (const [id, r] of remotes) if (!seen.has(id)) { r.dispose(); remotes.delete(id); }
    joinSynced = true;
}

// =====================================================================================
// Networking
// =====================================================================================
const BLOXITY_GAME_ID = import.meta.env.VITE_BLOXITY_GAME_ID || '';
const ON_BLOXITY_HOST = /\.play\.bloxity\.io$/.test(location.hostname);
const DEV_CHANNEL = /\.dev\.play\.bloxity\.io$/.test(location.hostname);
const SERVER_URL = import.meta.env.VITE_SERVER_URL
    || (ON_BLOXITY_HOST ? `https://${location.hostname.replace(/\.play\.bloxity\.io$/, '.host.bloxity.io')}`
        : BLOXITY_GAME_ID ? `https://${BLOXITY_GAME_ID}.host.bloxity.io`
        : import.meta.env.DEV ? `${location.protocol}//${location.hostname}:2613` : location.origin);
async function serverEndpoint() {
    let url = SERVER_URL;
    if (BLOXITY_GAME_ID) {
        const r = await BX.resolveEndpoint(BLOXITY_GAME_ID, DEV_CHANNEL ? 'preview' : undefined);
        if (r && r.cold) $('#loading').textContent = 'Waking up a server…';
        url = (r && r.endpoint) || SERVER_URL;
    }
    if (!/^https?:/i.test(url)) return url;
    if (!(await serverUp(url))) {
        $('#loading').textContent = 'Waking up a server…';
        const until = Date.now() + 60000;
        while (Date.now() < until) {
            await new Promise((res) => setTimeout(res, 2000));
            if (await serverUp(url)) break;
        }
    }
    return url;
}
async function serverUp(url) {
    try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 4000);
        const r = await fetch(url.replace(/\/$/, '') + '/health', { signal: ctl.signal, cache: 'no-store' });
        clearTimeout(t);
        return r.ok;
    } catch (e) { return false; }
}
let lastMoveSent = 0, lastMoveKey = '';
function sendMove(force) {
    const now = performance.now();
    if (!force && now - lastMoveSent < 66) return;
    const a = P.flying ? 4 : !P.onGround ? 2 : P.moving ? 1 : 0;
    const m = { x: +P.pos.x.toFixed(2), y: +P.pos.y.toFixed(2), z: +P.pos.z.toFixed(2), ry: +P.facing.toFixed(3), a };
    const key = m.x + ',' + m.y + ',' + m.z + ',' + m.ry + ',' + a;
    if (!force && key === lastMoveKey && now - lastMoveSent < 500) return;
    lastMoveKey = key; lastMoveSent = now;
    net.send('move', m);
}

function storageGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function storageSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
function playerUid() {
    let uid = storageGet('mzo_uid');
    if (!uid) {
        uid = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
        storageSet('mzo_uid', uid);
    }
    return uid;
}

let lastCoins = null, lastStage = -2;
async function connect(name, endpoint) {
    const client = new Client(endpoint || await serverEndpoint());
    const id = BX.identity();
    const room = await client.joinOrCreate('maze', {
        uid: playerUid(), name: name || id.name, token: id.token, av: packAvatar(BX.currentAvatar()),
        save: storageGet('mzo_save') || '',
    });
    net.room = room;
    joinSynced = false;
    room.onMessage('hello', (m) => { net.offset = m.now - Date.now(); net.bloxity = !!m.bloxity; });
    room.onMessage('authed', () => { net.bloxity = true; });
    room.onMessage('emote', (m) => { const r = remotes.get(m.s); if (r) playEmoteOn(r.blox, m.id); });
    room.onMessage('chat', (m) => {
        toast(m.name + ': ' + m.text, '#ffffff');
        chatBubble(m.s === room.sessionId ? rig : remotes.get(m.s) && remotes.get(m.s).rig, m.text);
    });
    BX.updateRoom(room.roomId);
    BX.gameplayStart();
    room.onMessage('profile', (m) => {
        if (m.save) storageSet('mzo_save', m.save);
        delete m.save;
        const first = lastCoins === null;
        Object.assign(S, m);
        S.profileAt = Date.now();
        if (!first && S.wins > lastCoins) bumpCoins();
        lastCoins = S.wins;
        if (S.stage !== lastStage) {
            for (let i = 0; i < CHECKPOINTS.length; i++) lightCheckpoint(i, i <= S.stage);
            if (lastStage === -2 && S.stage >= 0) setTimeout(() => showOops('Continue from Stage ' + (S.stage + 2) + ' (free), or start again from Stage 1.', 'Welcome back!'), 2500);
            lastStage = S.stage;
        }
        if (rig) setMorph(rig, S.morph);
        refreshGearPads(); refreshMorphPads();
        renderHotbar();
        refreshModal(); refreshDaily();
        openDailyOnJoin();
    });
    room.onMessage('toast', (m) => toast(m.text, m.color));
    room.onMessage('announce', (m) => toast(m.text, m.color));
    room.onMessage('earn', (m) => {
        floatText('+' + fmt(m.n) + ' 🏆', '#ffd028', P.pos.clone().add(new V3(0, 6.5, 0)), 4.4);
        if (m.why === 'cp') {
            // Maze cleared: a celebration, a cheer, then the next maze's title
            showStageClear(m.i, m.n);
            cheer();
            sfx('checkpoint'); rumble(0.4, 180);
            sparkleColumn(P.pos, STAGES[m.i + 1] ? STAGES[m.i + 1].bar : 0xffd028);
            ring(P.pos, 0xffd028, 9, 0.7);
            confetti(P.pos);
            setTimeout(() => showStageTitle(Math.min(STAGES.length - 1, m.i + 1)), 1900);
        } else if (m.why === 'chest') {
            sfx('bonus'); sparkleColumn(P.pos, 0xffd028); coinBurst(P.pos.clone().add(new V3(0, 3, 0)));
            toast('💰 Treasure chest! +' + fmt(m.n) + ' Wins', '#ffd028');
        }
    });
    room.onMessage('broke', (m) => { notEnough(m); sfx('denied'); });
    room.onMessage('won', (m) => {
        showWin(m);
        sfx('win'); rumble(0.8, 600);
        fireworks(P.pos, 14, () => sfx('firework'));
        sparkleColumn(P.pos, 0xffd028);
        coinState.collected.clear();
        // rewards restart: back to the lobby for another run
        setTimeout(() => { if (P.pos.z > FINISH.z0 - 2) { teleportLobby(); toast('🔁 Rewards restart: run the mazes again!', '#7de8ff'); } }, 5200);
    });
    room.onMessage('lucky', (m) => luckyResult(m));
    room.onMessage('tpTo', (m) => {
        const spot = checkpointSpot(m.i);
        if (!spot) return;
        hideOops();
        teleport(new V3(spot.x, 0.6, spot.z), spot.yaw, true);
        if (rig) setShield(rig, CFG.spawnShield);
        showStageTitle(Math.min(STAGES.length - 1, m.i + 1));
    });
    room.onMessage('skipTo', (m) => {
        const spot = checkpointSpot(m.i);
        if (spot) { teleport(new V3(spot.x, 0.6, spot.z), spot.yaw, true); showStageTitle(Math.min(STAGES.length - 1, m.i + 1)); }
    });
    room.onMessage('skipEnd', () => {
        teleport(new V3(FINISH.x, 0.1, FINISH.z0 + 8), 0, true);
        toast('🚩 Straight to the finish! Step on the WIN pad', '#ffd028');
    });
    room.onMessage('codeResult', (m) => codeResult(m));
    room.onMessage('boards', renderBoards);
    room.onMessage('fx', (m) => {
        sparkleColumn(P.pos, m.kind === 'unlock' ? 0x46ff8a : 0xffd028);
        ring(P.pos, 0xffd028, 10, 0.8);
        confetti(P.pos);
        sfx('buy');
    });
    // Fling All: everyone else is thrown into the air
    room.onMessage('fling', (m) => {
        flash('#e8f4ff', 700); sfx('whoosh'); sfx('zapped'); addShake(0.9); rumble(0.9, 500);
        P.vel.y = 58; P.kv.set((Math.random() - 0.5) * 70, 0, (Math.random() - 0.5) * 70); P.onGround = false;
        toast('🌪️ ' + m.by + ' flung everyone!', '#7de8ff');
    });
    room.onMessage('flingSent', () => { flash('#e8f4ff', 500); sfx('whoosh'); addShake(0.5); });
    // Kill All / the Deadly Sword: back to your checkpoint
    room.onMessage('killed', (m) => {
        flash('#ff3a3a', 600); sfx('oops'); addShake(0.8); rumble(0.8, 300); showOof();
        nukeFx(P.pos);
        P.vel.y = 30; P.onGround = false;
        toast(m.all ? '💀 ' + m.by + ' used KILL ALL!' : '🗡️ ' + m.by + ' slashed you!', '#ff6a7a');
        setTimeout(() => respawn(true), 700);
    });
    room.onMessage('killSent', () => { flash('#ff8a8a', 400); sfx('nuke'); addShake(0.4); });
    // Zapped by a Ray Gun: flung up and away
    room.onMessage('zapped', (m) => {
        P.kv.set(m.dx * CFG.rayForce, 0, m.dz * CFG.rayForce);
        P.vel.y = 46; P.onGround = false;
        flash('#a8fff4', 350); sfx('zapped'); addShake(0.6); rumble(0.7, 250);
        toast('🔫 ' + m.by + ' zapped you!', '#2ae8d8');
    });
    room.onMessage('zapFx', (m) => {
        if (m.s === room.sessionId) return;
        const r = remotes.get(m.s); if (r) r.swing = 0.3;
        const tgt = m.t === room.sessionId ? rig : remotes.get(m.t) && remotes.get(m.t).rig;
        if (r && tgt) {
            zapFx(r.rig.localToWorld(new V3(1.5, 2.4, 2.4)), tgt.position.clone().add(new V3(0, 2.5, 0)));
            if (camera.position.distanceTo(r.rig.position) < 70) sfx('zap');
        }
    });
    room.onMessage('slashFx', (m) => {
        const r = remotes.get(m.s);
        if (!r) return;
        r.swing = 0.3;
        slashFx(r.rig.position, r.rig.rotation.y);
        if (camera.position.distanceTo(r.rig.position) < 60) sfx('whoosh');
    });
    room.onLeave((code, reason) => {
        console.warn('[net] left room', code, reason || '');
        net.room = null;
        if (code !== 1000) $('#offline').hidden = false;
    });
    return room;
}

// =====================================================================================
// Camera & input
// =====================================================================================
const cam = { yaw: SPAWN_YAW + Math.PI, pitch: 0.32, dist: 20, target: new V3() };
let camSens = 1;
const keys = {};
const touchMove = { x: 0, y: 0 };
let touchJump = false, touchDown = false, running = false;

function pressJump() { P.jumpPress = clockT; }
addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) { if (e.key === 'Enter') e.target.blur(); return; }
    if (e.code === 'Space' && !e.repeat && running) pressJump();
    keys[e.code] = true;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (e.code === 'KeyE' && running) { if (activePrompt) usePrompt(); else useTool(true); }
    if (running && /^Digit[1-9]$/.test(e.code)) { const g = hotbarGear()[+e.code.slice(5) - 1]; if (g) actions.equip(g.id); }
    if (e.code === 'Escape') {
        if (closeTop()) return;
        if (running && BX.isEmbedded()) BX.showPortalMenu();
    }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const drags = new Map();
canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); drags.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() }); canvas.focus(); });
canvas.addEventListener('pointermove', (e) => {
    const d = drags.get(e.pointerId);
    if (!d) return;
    const k = (e.pointerType === 'touch' ? 0.008 : 0.005) * camSens;
    cam.yaw -= (e.clientX - d.x) * k;
    cam.pitch = clamp(cam.pitch + (e.clientY - d.y) * k, -0.6, 1.35);
    d.x = e.clientX; d.y = e.clientY;
});
const endDrag = (e) => {
    const d = drags.get(e.pointerId);
    drags.delete(e.pointerId);
    // A tap / click without dragging uses the tool at that spot
    if (d && e.type === 'pointerup' && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 7 && performance.now() - d.t0 < 350 && running) useTool(false, e.clientX, e.clientY);
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', (e) => { cam.dist = clamp(cam.dist + Math.sign(e.deltaY) * 2.5, 6, 70); e.preventDefault(); }, { passive: false });

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');
(function joystick() {
    const stick = $('#stick'), knob = $('#knob');
    let id = null;
    const set = (e) => {
        const r = stick.getBoundingClientRect();
        let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        const max = r.width / 2, l = Math.hypot(dx, dy);
        if (l > max) { dx *= max / l; dy *= max / l; }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        touchMove.x = dx / max; touchMove.y = dy / max;
    };
    stick.addEventListener('pointerdown', (e) => { id = e.pointerId; stick.setPointerCapture(id); set(e); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e); });
    const end = (e) => { if (e.pointerId !== id) return; id = null; knob.style.transform = ''; touchMove.x = touchMove.y = 0; };
    stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
    const hold = (el, on, off) => {
        el.addEventListener('pointerdown', (e) => { e.preventDefault(); on(); });
        el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off);
    };
    hold($('#jumpBtn'), () => { touchJump = true; pressJump(); }, () => { touchJump = false; });
    hold($('#downBtn'), () => { touchDown = true; }, () => { touchDown = false; });
    $('#useBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); useTool(true); });
})();

// Ray against the boxes near the player (camera collision)
const AXES = ['x', 'y', 'z'];
function rayHit(o, d, maxT, opts) {
    let best = maxT;
    const test = (c) => {
        let t0 = 0, t1 = best;
        for (const a of AXES) {
            if (Math.abs(d[a]) < 1e-9) { if (o[a] < c.min[a] || o[a] > c.max[a]) return; continue; }
            let ta = (c.min[a] - o[a]) / d[a], tb = (c.max[a] - o[a]) / d[a];
            if (ta > tb) { const q = ta; ta = tb; tb = q; }
            t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
            if (t0 > t1) return;
        }
        if (t0 > 0 && t0 < best) best = t0;
    };
    for (const c of nearBoxes) {
        if (c.off || (c.mat === 'glass' && !(opts && opts.glass))) continue;
        test(c);
    }
    // every floor is at y = 0: never look from under it
    if (opts && opts.floor && d.y < -1e-6 && o.y > 0) { const t = (0.3 - o.y) / d.y; if (t > 0 && t < best) best = t; }
    return best;
}

// ----- the Ray Gun (click a player to zap them away) and the Deadly Sword (swing at players close by) -----
const ray = new T.Raycaster(), ndc = new T.Vector2();
function useTool(center, sx, sy) {
    const id = tool();
    if (!rig || (id !== 'rayGun' && id !== 'sword')) return;
    if (id === 'sword') {
        if (clockT - P.lastZap < CFG.swordCooldown) return;
        P.lastZap = clockT;
        P.swing = 0.3;
        sfx('whoosh');
        slashFx(P.pos, P.facing);
        // the closest player in front of you within reach
        let best = '', bd = Infinity;
        const fx = Math.sin(P.facing), fz = Math.cos(P.facing);
        for (const [rid, r] of remotes) {
            const dx = r.rig.position.x - P.pos.x, dz = r.rig.position.z - P.pos.z, dy = r.rig.position.y - P.pos.y, d = Math.hypot(dx, dz);
            if (d > CFG.swordRange || Math.abs(dy) > 6 || (d > 2 && (dx * fx + dz * fz) / d < 0.2)) continue;
            if (d < bd) { bd = d; best = rid; }
        }
        if (best) { popHit(remotes.get(best).rig.position); sfx('slap'); }
        net.send('slash', { t: best });
        return;
    }
    if (clockT - P.lastZap < CFG.rayCooldown) return;
    P.lastZap = clockT;
    const x = center || sx === undefined ? innerWidth / 2 : sx, y = center || sy === undefined ? innerHeight / 2 : sy;
    ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    let best = null, bd = Infinity;
    const c = new V3();
    for (const [rid, r] of remotes) {
        c.copy(r.rig.position).setY(r.rig.position.y + 2.5);
        if (c.clone().sub(ray.ray.origin).dot(ray.ray.direction) < 0) continue;
        const range = c.distanceTo(P.pos);
        if (range > CFG.rayRange) continue;
        const miss = ray.ray.distanceToPoint(c);
        if (miss < 2.8 + range * 0.035 && miss < bd) { bd = miss; best = rid; }
    }
    P.swing = 0.3;
    sfx('zap');
    const from = rig.localToWorld(new V3(1.5, 2.4, 2.4));
    if (best) {
        const tr = remotes.get(best).rig;
        zapFx(from, tr.position.clone().add(new V3(0, 2.5, 0)));
        net.send('ray', { t: best });
    } else zapFx(from, ray.ray.at(45, new V3()));
}
function popHit(pos) { ring(pos, 0xc87aff, 5, 0.4); sparkleColumn(pos, 0xc87aff); }

const camDir = new V3(), camGoal = new V3(), camPos = new V3();
let baseFov = camera.fov;
function updateCamera(dt) {
    const t = performance.now() / 1000;
    cam.target.lerp(camGoal.set(P.pos.x, P.pos.y + 5, P.pos.z), 1 - Math.exp(-dt * 16));
    const cp = Math.cos(cam.pitch);
    camDir.set(Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp);
    const dist = Math.max(2.5, rayHit(cam.target, camDir, cam.dist, { glass: true, floor: true }) - 0.8);
    camPos.copy(cam.target).addScaledVector(camDir, dist);
    camera.position.copy(camPos);
    camera.lookAt(cam.target);
    if (shake > 0.001) {
        const s = shake * shake * 0.9;
        camera.position.x += (Math.random() * 2 - 1) * s;
        camera.position.y += (Math.random() * 2 - 1) * s;
        shake = Math.max(0, shake - dt * 2.2);
    }
    const fovBase = innerWidth < innerHeight ? 85 : 70;
    const fast = tool() === 'speedCoil' || tool() === 'superCoil';
    const want = fovBase + (P.flying && P.moving ? 5 : 0) + (fast && P.moving ? 4 : 0);
    baseFov += (want - baseFov) * Math.min(1, dt * 5);
    if (Math.abs(camera.fov - baseFov) > 0.01) { camera.fov = baseFov; camera.updateProjectionMatrix(); }
    sun.position.copy(P.pos).addScaledVector(SUN_DIRECTION, 160);
    sun.target.position.copy(P.pos);
    // each maze has its own sky, light and floating particles; the lobby is a bright day
    const th = P.stage < 0 ? null : themeOf(P.stage);
    setMood(th ? th.mood : 'day');
    updateSky(camera.position, t, dt);
    updateAmbient(camera.position, t, th ? th.amb : LOBBY_AMB);
}
const LOBBY_AMB = { color: 0xffffff, dir: 0.5 };

// Proximity prompts
let activePrompt = null, promptX = -1, promptY = -1;
const projV = new V3();
function updatePrompt() {
    let best = null, bd = Infinity;
    for (const p of nearPrompts) {
        const d = p.pos.distanceTo(P.pos);
        if (d < p.r && d < bd) { bd = d; best = p; }
    }
    activePrompt = best;
    if (!best || anyPopup()) { promptEl.hidden = true; return; }
    projV.copy(best.pos).setY(best.pos.y + 2).project(camera);
    if (projV.z > 1) { promptEl.hidden = true; return; }
    promptEl.hidden = false;
    const px = Math.round((projV.x + 1) / 2 * innerWidth), py = Math.round((1 - projV.y) / 2 * innerHeight);
    if (px !== promptX || py !== promptY) { promptX = px; promptY = py; promptEl.style.transform = `translate(${px}px, ${py}px) translate(-50%, -110%)`; }
    const txt = best.label();
    if (promptTxtEl.textContent !== txt) promptTxtEl.textContent = txt;
}
function usePrompt() { if (activePrompt) activePrompt.act(); }
promptEl.addEventListener('click', usePrompt);

// Controller: popups first, then gameplay
let padJumpWas = false;
function padButtons() {
    if (pad.jump && !padJumpWas && running) pressJump();
    padJumpWas = pad.jump;
    const p = pad.pressed;
    if (!p.size) return;
    if (p.has('B') && closeTop()) return;
    if (!running) return;
    if (p.has('X')) { if (activePrompt) usePrompt(); else useTool(true); }
    if (p.has('Y')) openModal('store');
    if (p.has('LB') || p.has('RB')) {
        const list = hotbarGear();
        if (list.length) {
            const i = list.findIndex((g) => g.id === S.tool);
            const n = list[((i < 0 ? (p.has('RB') ? -1 : 0) : i) + (p.has('RB') ? 1 : -1) + list.length) % list.length];
            actions.equip(n.id);
        }
    }
    if (p.has('BACK')) openModal('teleport');
    if (p.has('START')) openModal('config');
    if (p.has('UP')) cam.dist = clamp(cam.dist - 4, 6, 70);
    if (p.has('DOWN')) cam.dist = clamp(cam.dist + 4, 6, 70);
}
onGamepadConnection((g, on) => { if (running) toast(on ? '🎮 Controller connected' : '🎮 Controller disconnected', on ? '#7dff6b' : '#ffb51c'); });

// =====================================================================================
// Main update
// =====================================================================================
const botInput = { f: 0, r: 0, jump: false, down: false };
let qaWalk = 0;
let clockT = 0, hudT = 0;
const tmpF = new V3(), tmpR = new V3(), mv = new V3();
// Footstep sounds per surface (solids carry a material tag; maze floors and walls their theme's)
function surfaceSound(m) {
    return { water: 'water', asphalt: 'asphalt', dirt: 'dirt', plastic: 'plastic', grass: 'grass', wood: 'wood', stud: 'stud', carpet: 'carpet', ice: 'ice', stone: 'stone', candy: 'candy', neon: 'neon', tile: 'tile', glass: 'tile' }[m] || 'tile';
}
const DUST = { dirt: 0xc87a58, grass: 0x8ae86a, carpet: 0xb8985a, wood: 0xc8a070, candy: 0xffb8d8, neon: 0xb88aff, stone: 0xff8a3a, ice: 0xe8f8ff };
function footStep(g) {
    surfStep(surfaceSound(g.mat), false);
    if (g.water && Math.random() < 0.7) splash(P.pos, 0x8ad8ff, 4, 0.6);
    else if (g.ice && Math.random() < 0.3) dust(P.pos, 2, 0.6, 0xe8f8ff);
}
function land(g, hard) {
    surfStep(surfaceSound(g.mat), true);
    if (g.water) splash(P.pos, 0x8ad8ff, hard ? 16 : 9, hard ? 1.2 : 0.8);
    else dust(P.pos, hard ? 10 : 5, hard ? 1.3 : 0.9, DUST[g.mat]);
    if (hard) ring(P.pos, 0xffffff, 4, 0.35);
    P.squashV -= hard ? 8 : 4;
}
let wallWarnT = -9, lastToolKey = '';

function update(dt) {
    clockT += dt;
    const t = clockT;
    let f = botInput.f, r = botInput.r;
    if (keys.KeyW || keys.ArrowUp) f += 1;
    if (keys.KeyS || keys.ArrowDown) f -= 1;
    if (keys.KeyD || keys.ArrowRight) r += 1;
    if (keys.KeyA || keys.ArrowLeft) r -= 1;
    f -= touchMove.y + pad.ly; r += touchMove.x + pad.lx;
    cam.yaw -= pad.rx * 2.8 * dt;
    cam.pitch = clamp(cam.pitch + pad.ry * 1.8 * dt, -0.6, 1.35);
    tmpF.set(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw));
    tmpR.set(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw));
    mv.set(0, 0, 0).addScaledVector(tmpF, f).addScaledVector(tmpR, r);
    if (mv.lengthSq() > 1) mv.normalize();
    if (anyPopup() && !isTouch) mv.set(0, 0, 0);
    P.moving = mv.lengthSq() > 0.01;
    const jumpHeld = keys.Space || touchJump || pad.jump || botInput.jump;
    const downHeld = keys.ShiftLeft || keys.ShiftRight || keys.KeyQ || keys.KeyC || touchDown || pad.sprint || botInput.down;

    updateWorld(dt, t, P.stage, P.pos);

    const id = tool();
    P.flying = id === 'carpet';
    const ws = P.flying ? CFG.carpetSpeed : walkSpeed();
    const g = gravity();

    // ----- vertical: jump or fly -----
    const pressed = t - P.jumpPress < 0.2;
    if (P.onGround) P.coyote = 0.1; else P.coyote -= dt;
    if (P.flying) {
        const vy = jumpHeld ? CFG.carpetSpeed * 0.75 : downHeld ? -CFG.carpetSpeed * 0.75 : 0;
        P.vel.y += (vy - P.vel.y) * Math.min(1, dt * 6);
    } else {
        if (pressed && (P.onGround || P.coyote > 0)) {
            P.vel.y = jumpV(); P.onGround = false; P.coyote = 0; P.jumpPress = -9; P.ground = null;
            sfx('jump'); P.squashV += 5;
        }
        P.vel.y -= g * dt;
    }
    loopSound('carpet', P.flying ? (P.moving || Math.abs(P.vel.y) > 1 ? 1 : 0.6) : 0);

    // ----- horizontal: instant, slippery on ice, knockback on top -----
    const tx = mv.x * ws, tz = mv.z * ws;
    const ice = P.ground && P.ground.ice;
    if (ice || (P.onIce && !P.onGround)) {
        const k = 1 - Math.exp(-dt * (P.onGround ? 3.2 : 2.4));
        P.hv.x += (tx - P.hv.x) * k; P.hv.z += (tz - P.hv.z) * k;
    } else P.hv.set(tx, 0, tz);
    if (P.onGround) P.onIce = !!ice;
    const vx = P.hv.x + P.kv.x, vz = P.hv.z + P.kv.z;
    P.kv.multiplyScalar(Math.exp(-dt * (P.onGround ? 9 : 1.6)));

    const dist = Math.max(Math.abs(vx), Math.abs(vz), Math.abs(P.vel.y)) * dt;
    const n = Math.max(1, Math.ceil(dist / 0.5));
    const sdt = dt / n;
    const wasOn = P.onGround;
    P.onGround = false; P.ground = null;
    let vy = P.flying ? P.vel.y : P.vel.y + 0.5 * g * dt;
    for (let i = 0; i < n; i++) {
        moveAxis('x', vx * sdt);
        moveAxis('z', vz * sdt);
        const before = P.vel.y;
        moveAxis('y', vy * sdt);
        if (P.vel.y !== before) vy = P.vel.y;
        resolveRound();
    }
    if (!P.onGround && wasOn && P.vel.y <= 0 && !P.flying) groundProbe(0.7);
    else if (!P.onGround && P.vel.y <= 0 && !P.flying) groundProbe(0.05);
    // the Magic Carpet flies only a little over the maze walls
    if (P.flying && P.pos.y > CFG.carpetCeil) { P.pos.y = CFG.carpetCeil; P.vel.y = Math.min(0, P.vel.y); }

    // ----- landing -----
    if (P.onGround) {
        const gr = P.ground;
        if (P.airTime > 0.25 && gr) land(gr, P.airTime > 0.8);
        P.airTime = 0; P.peakY = P.pos.y;
        // nobody walks along the tops of the maze walls: down into the nearest corridor
        if (gr && gr.wallTop && !P.flying && P.pos.y > gr.max.y - 0.2) {
            const c = nearestCell(P.pos.x, P.pos.z);
            if (c) {
                dust(P.pos, 8, 1, 0xffffff);
                teleport(new V3(c.x, 0.05, c.z), P.facing, false);
                sfx('teleport');
                if (t - wallWarnT > 4) { wallWarnT = t; toast('🚫 No walking on the maze walls!', '#ff8a8a'); }
            }
        }
    } else {
        P.airTime += dt;
        P.peakY = Math.max(P.peakY, P.pos.y);
        if (P.flying) { P.peakY = P.pos.y; P.airTime = 0; }
    }

    // facing
    if (P.moving && mv.lengthSq() > 0.01) P.facing = lerpAngle(P.facing, Math.atan2(mv.x, mv.z), 1 - Math.exp(-dt * 14));

    // ----- where you are -----
    const here = stageAt(P.pos.x, P.pos.y, P.pos.z), high = P.pos.y > WALL_H + 2;
    if (here !== P.stage) {
        // walking into a maze you haven't cleared yet: its title
        if (here > P.stage && here >= 0 && here > (S.stage ?? -1) && P.pos.z > MAZES[here].z0 - 1 && P.pos.z < MAZES[here].z0 + CELL) showStageTitle(here);
        P.stage = here;
    }
    refreshNear(here, high);
    // safety net: fell off the world: back to your checkpoint
    if (P.pos.y < -40 || Math.abs(P.pos.x) > 300 || P.pos.z < -200 || P.pos.z > FINISH.z1 + 200) {
        respawn(true); sfx('oops'); showOof();
    }
    // triggers (checkpoints, the finish, gear pads, morph pads, the chest)
    for (const tr of nearTriggers) {
        const inside = overlapsBox(tr, P.pos);
        if (inside && !tr.inside && tr.enter) tr.enter();
        tr.inside = inside;
    }
    checkCoins();
    const now = net.now();
    luckyState.ready = now - (S.luckyAt || 0) > CFG.luckyMinutes * 60000;

    if (S.name && headLabel && S.name !== nameLabelText) { nameLabelText = S.name; headLabel.userData.set(nameLines(S.name)); }
    updateEffects(dt);
    updateFx(dt);
    for (const fn of tickers) fn(dt, t);

    syncRemotes(dt, t);
    friendsT -= dt; friendSyncT -= dt;
    if (friendsT <= 0) { friendsT = 30; friendSyncT = 5; refreshFriends(); }
    else if (friendSyncT <= 0) { friendSyncT = 5; syncFriends(); }

    // ----- the local character -----
    if (rig) {
        const u = rig.userData;
        rig.position.copy(P.pos);
        rig.rotation.y = P.facing;
        const hs = P.moving ? ws : 0;
        P.animPhase += dt * (P.onGround ? Math.min(18, 4 + hs * 0.3) : 0);
        if (P.flying) { animRig(u.body, 0, 0); u.body.userData.legs[0].rotation.set(-0.9, 0, 0); u.body.userData.legs[1].rotation.set(-0.9, 0, 0); }
        else if (!P.onGround) airPose(u.body);
        else if (P.moving) animRig(u.body, P.animPhase, 0.85);
        else animRig(u.body, 0, 0);
        if (u.held) holdPose(u.body);
        if (P.swing > 0) { P.swing -= dt; u.body.userData.arms[1].rotation.set(-1.6 - Math.sin((1 - P.swing / 0.3) * Math.PI) * 0.9, 0, 0); }
        if (localAvatar) localAvatar.update(dt, { moving: P.moving && P.onGround, air: !P.onGround, speed: hs, t });
        setTool(rig, id); setTrail(rig, S.trail);
        if (u.carpet) { u.carpet.visible = P.flying; waveCarpet(u.carpet, t, P.moving ? 1.4 : 0.8); }
        u.trail.update(trailAt(rig), (P.moving || !P.onGround), dt, t);
        // footsteps: every half stride, the surface under you makes its sound
        const stepN = Math.floor(P.animPhase / Math.PI);
        if (P.onGround && P.moving && stepN !== P.lastStepN && P.ground) footStep(P.ground);
        P.lastStepN = stepN;
        const runBob = P.onGround && P.moving ? Math.abs(Math.sin(P.animPhase)) * 0.18 : 0;
        u.pivot.position.y = PIVOT + runBob;
        const leanTo = P.flying ? (P.moving ? 0.28 : 0) : P.onGround && P.moving ? Math.min(0.17, ws * 0.007) : !P.onGround ? -0.06 : 0;
        P.lean = (P.lean || 0) + (leanTo - (P.lean || 0)) * Math.min(1, dt * 9);
        let turn = P.facing - (P.prevFacing ?? P.facing);
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        P.prevFacing = P.facing;
        const rollTo = clamp(-turn / Math.max(dt, 1e-3) * 0.045, -0.22, 0.22) * (P.moving ? 1 : 0);
        P.roll = (P.roll || 0) + (rollTo - (P.roll || 0)) * Math.min(1, dt * 7);
        u.pivot.rotation.set(P.lean, 0, P.roll);
        P.squashV += (1 - P.squash) * 180 * dt;
        P.squashV *= Math.exp(-12 * dt);
        P.squash = clamp(P.squash + P.squashV * dt, 0.72, 1.28);
        rig.scale.set(1 / Math.sqrt(P.squash), P.squash, 1 / Math.sqrt(P.squash));
        tickShield(rig, dt);
    }
    const fastNow = Math.hypot(P.hv.x + P.kv.x, P.hv.z + P.kv.z);
    setSpeedLines(!reduceMotion && fastNow > 25 && P.moving ? Math.min(0.7, (fastNow - 25) * 0.05 + 0.25) : 0, dt);
    const toolKey = id + '|' + anyPopup();
    if (toolKey !== lastToolKey) {
        lastToolKey = toolKey;
        $('#crosshair').hidden = !(id === 'rayGun' && !isTouch && !anyPopup());
        $('#useBtn').hidden = !(isTouch && (id === 'rayGun' || id === 'sword'));
        $('#useBtn').textContent = id === 'sword' ? '🗡️' : '🔫';
        $('#downBtn').hidden = !(isTouch && id === 'carpet');
    }

    sendMove(false);
    updatePrompt();
    animateCounters(dt);
    hudT -= dt;
    if (hudT <= 0) {
        hudT = 0.1;
        updateHud(); renderHotbar(); setDecorLow(getQuality() === 'low');
        updateChest(now);
        renderProgress(S.stage);
    }
}

// =====================================================================================
// Boot
// =====================================================================================
let lastFrame = 0, loadingSignaled = false, fpsAcc = 0, fpsFrames = 0, showFps = false;
// Slow PC? After joining, if the game keeps running under ~40 FPS for 3 s (and the tab is visible),
// step the graphics down one level (never saved, never below Low). It stops once the player picks one.
const fpsWatch = { t: 0, low: 0 };
function watchFps(fps) {
    if (!running || document.hidden || !autoQualityAllowed()) return;
    fpsWatch.t += 0.5;
    if (fpsWatch.t < 2) return;
    fpsWatch.low = fps < 40 ? fpsWatch.low + 0.5 : 0;
    if (fpsWatch.low < 2.5) return;
    fpsWatch.low = 0;
    const next = { high: 'medium', medium: 'low' }[getQuality()];
    if (!next) return;
    setQuality(next, true);
    toast('⚙️ Graphics set to ' + (next === 'medium' ? 'Medium' : 'Low') + ' for smoother play', '#7de8ff');
}
function frame(now) {
    const dt = Math.min(0.05, (now - (lastFrame || now)) / 1000);
    fpsAcc += (now - (lastFrame || now)) / 1000; fpsFrames++;
    if (fpsAcc >= 0.5) { if (showFps) $('#fps').textContent = Math.round(fpsFrames / fpsAcc) + ' FPS'; watchFps(fpsFrames / fpsAcc); fpsAcc = 0; fpsFrames = 0; }
    lastFrame = now;
    if (!loadingSignaled) { loadingSignaled = true; BX.triggerAllSettings(); }
    pollGamepad();
    padButtons();
    // Nothing is drawn behind the loading screen: the page stays free to load and connect
    if (running) { update(dt); updateCamera(dt); render(); }
    requestAnimationFrame(frame);
}

// Straight into the game: no menu. Joins with the Bloxity name (or guest name) automatically.
// The server join starts right away and runs while the world is being built.
let joining = false, joinTask = null, worldReady = null;
async function joinServer() {
    // Ask the Bloxity matchmaker for a server straight away while a Bloxity login gets a short
    // moment to arrive; a login that comes later upgrades the session
    const endpointTask = serverEndpoint();
    endpointTask.catch(() => {});
    await waitForLogin(400);
    const saved = (storageGet('mzo_name') || '').slice(0, 20);
    for (let attempt = 0; ; attempt++) {
        try { return await connect(BX.identity().loggedIn ? '' : saved, attempt === 0 ? await endpointTask : null); } catch (e) {
            if (attempt >= 4) throw e;
            console.warn('[join] attempt', attempt + 1, 'failed:', e && e.message);
            $('#loading').textContent = 'Waking up a server…';
            await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
        }
    }
}
async function play() {
    if (joining || running) return;
    joining = true;
    const err = $('#connectErr'), retry = $('#playBtn');
    err.hidden = true; retry.hidden = true;
    $('#loading').hidden = false;
    if (!joinTask) joinTask = joinServer();
    initAudio();
    try {
        await worldReady;
        $('#loading').textContent = 'Joining…';
        BX.loadingStep('Joining a server…');
        const room = await joinTask;
        const me = room.state.players && room.state.players.get(room.sessionId);
        S.name = me ? me.name : S.name;
    } catch (e) {
        joinTask = null;
        console.error(e);
        joining = false;
        $('#loading').hidden = true;
        err.hidden = false;
        err.textContent = 'Could not reach the game server. Check your connection and try again.';
        retry.hidden = false;
        BX.loadingEnd();
        return;
    }
    joining = false;
    running = true;
    S.joinedAt = Date.now();
    startMusic();
    $('#start').hidden = true;
    $('#hud').hidden = false;
    $('#touch').hidden = !isTouch;
    if (!rig) buildPlayer(0, 0);
    teleport(SPAWN, SPAWN_YAW);
    setShield(rig, CFG.spawnShield);
    cam.target.set(P.pos.x, P.pos.y + 5, P.pos.z);
    showTips();
    toast('🏁 Find your way through 12 mazes! Follow the red arrows ⬆', '#ffffff');
    setTimeout(() => { if (audioSuspended()) toast('🔊 Click or tap anywhere for the music!', '#7de8ff'); }, 3500);
    canvas.focus();
    BX.loadingEnd();
}
function waitForLogin(ms) {
    if (!BX.bloxity.ready || BX.identity().loggedIn) return Promise.resolve();
    return new Promise((res) => {
        const t0 = performance.now();
        (function check() { if (BX.identity().loggedIn || performance.now() - t0 > ms) res(); else setTimeout(check, 100); })();
    });
}
function showTips() {
    const el = $('#tips');
    const k = (key, what) => `<span><kbd>${key}</kbd>${what}</span>`;
    el.innerHTML = isTouch
        ? '<span>Joystick to move · JUMP · drag to look · follow the light beam to the exit</span>'
        : pad.connected
            ? k('L', 'Move') + k('A', 'Jump') + k('X', 'Use') + k('LB/RB', 'Gear') + k('R', 'Camera')
            : k('WASD', 'Move') + k('Space', 'Jump') + k('1-6', 'Gear') + k('E', 'Use') + k('Drag', 'Camera') + '<span>✨ The light beam marks each exit</span>';
    el.hidden = false; el.style.opacity = 1;
    setTimeout(() => { el.style.opacity = 0; }, 10000);
    setTimeout(() => { el.hidden = true; }, 10900);
}
function unlockAudioOnGesture() {
    const unlock = () => {
        resumeAudio();
        if (!audioSuspended()) for (const ev of ['pointerdown', 'pointerup', 'keydown', 'touchstart', 'touchend', 'click']) removeEventListener(ev, unlock, true);
    };
    for (const ev of ['pointerdown', 'pointerup', 'keydown', 'touchstart', 'touchend', 'click']) addEventListener(ev, unlock, true);
}
function wirePortalSettings() {
    const embedded = (fn) => (v) => { if (BX.isEmbedded()) fn(v); };
    const pct = (v) => { const n = parseFloat(String(v)); if (!isFinite(n)) return undefined; return clamp(n > 1 ? n / 100 : n, 0, 1); };
    BX.listenSetting('master_volume', embedded((v) => { const p = pct(v); if (p !== undefined) setVolume('master', p); }));
    BX.listenSetting('music_volume', embedded((v) => { const p = pct(v); if (p !== undefined) setVolume('music', p); }));
    BX.listenSetting('graphics_quality', embedded((v) => setQuality(v === 'Low' ? 'low' : v === 'Medium' ? 'medium' : 'high', true)));
    BX.listenSetting('camera_sensitivity', embedded((v) => { camSens = clamp(parseFloat(v) || 1, 0.1, 5); }));
    BX.listenSetting('show_fps', (v) => { showFps = v === 'true'; $('#fps').hidden = !showFps; });
}
function wirePortalEvents() {
    BX.onPortalEvent((event, data) => {
        // the portal's Respawn: back to your checkpoint (free)
        if (event === 'respawn_request') { if (running) respawn(true); }
        else if (event === 'chat_message_sent' && data) net.send('chat', { text: String(data) });
        else if (event === 'play_emote' && data) { playEmoteOn(localAvatar, String(data)); net.send('emote', { id: String(data) }); }
    });
    BX.onAvatarChanged(() => syncMyAvatar());
    BX.onProportionsChanged(() => syncMyAvatar());
}

// ----- build the world and warm up the GPU while the loading screen is up -----
// On Windows every new shader is compiled the first time it's drawn and every texture uploaded the
// first time it's used: both freeze the game for a moment. Doing it all here, in parallel with
// joining the server, means nothing new has to be prepared once you spawn.
const pause = () => new Promise((r) => setTimeout(r, 0));
async function prepareWorld() {
    const step = (t) => { $('#loading').textContent = t; BX.loadingStep(t); };
    step('Loading fonts…');
    try { await Promise.race([Promise.all([document.fonts.load('700 40px Fredoka'), document.fonts.load('800 40px Montserrat')]), new Promise((r) => setTimeout(r, 2500))]); } catch (e) { /* fallback font */ }
    step('Building the mazes…');
    await buildWorld(pause);
    refreshNear(-1, false);
    step('Preparing graphics…');
    // From the spawn view, so the first frame needs nothing new
    camera.position.set(SPAWN.x, 12, SPAWN.z - 20); camera.lookAt(SPAWN.x, 4, SPAWN.z + 10); camera.updateMatrixWorld();
    // A stand-in player model (with its textured variants), a morph, the forcefield bubble, the gear
    // in hand, a carpet and one of each effect join the warm-up. They leave the scene after one
    // hidden frame but are never disposed, which keeps their shaders alive.
    const extras = [fxWarmGroup()];
    const bubble = new T.Mesh(shieldGeo, shieldMat); bubble.position.copy(SPAWN); extras.push(bubble);
    const cp = carpetModel(0.95); cp.position.copy(SPAWN); extras.push(cp);
    const blocky = buildRig({ ...KITS[0], skin: SKINS[0] }); blocky.position.copy(SPAWN); extras.push(blocky);
    const morph = morphStatue('robot'); morph.position.copy(SPAWN); extras.push(morph);
    for (const gid of ['speedCoil', 'superCoil', 'rayGun', 'sword']) { const h = heldModel(gid); if (h) { h.position.copy(SPAWN); extras.push(h); } }
    try {
        const base = await Promise.race([loadBase(), new Promise((r) => setTimeout(r, 4000))]);
        const a = base ? await createAvatar(null) : null;
        if (a) {
            a.root.position.copy(SPAWN);
            a.update(1 / 60, { t: 0 });
            extras.push(a.root, avatarVariants(a.root));
        }
    } catch (e) { /* the player model's shaders compile when it first shows instead */ }
    for (const o of extras) scene.add(o);
    fxShowAll(true);
    await warmUp(renderer, camera, pause);
    render();
    fxShowAll(false);
    for (const o of extras) scene.remove(o);
    console.info('[prewarm] ready,', renderer.info.programs.length, 'shaders');
}
// The textured versions of the player material: the skin arrives after the model shows, hats and
// back items are plain meshes with a texture
function avatarVariants(root) {
    const tex = new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    tex.needsUpdate = true;
    const g = new T.Group();
    g.position.copy(SPAWN);
    let sk = null;
    root.traverse((c) => { if (!sk && c.isSkinnedMesh) sk = c; });
    if (sk) {
        const s = new T.SkinnedMesh(sk.geometry, new T.MeshLambertMaterial({ map: tex }));
        s.bind(sk.skeleton, sk.bindMatrix);
        s.castShadow = true;
        g.add(s);
    }
    const m = new T.Mesh(new T.BoxGeometry(0.1, 0.1, 0.1), new T.MeshLambertMaterial({ map: tex }));
    m.castShadow = true;
    g.add(m);
    return g;
}
async function boot() {
    BX.initBloxity();
    // Join the server and load the player model while the world is being built
    joinTask = joinServer();
    joinTask.catch(() => {});
    loadBase().catch(() => {});
    worldReady = prepareWorld();
    wirePortalSettings();
    wirePortalEvents();
    BX.onIdentity((id) => {
        if (net.room && id.loggedIn && id.token && !net.bloxity) net.send('auth', { token: id.token });
        if (net.room) { setupLocalAvatar(); syncMyAvatar(); }
    });
    addEventListener('pagehide', () => { try { if (net.room) net.room.leave(true); } catch (e) { /* closing anyway */ } });
    $('#playBtn').addEventListener('click', play);
    $('#reconnectBtn').addEventListener('click', () => location.reload());
    unlockAudioOnGesture();
    requestAnimationFrame(frame);
    play();
}
boot();

// Dev-only hooks for automated QA runs (stripped from production builds)
if (import.meta.env.DEV || import.meta.env.VITE_QA) {
    window.__qa = {
        audio: () => audioDebug(), input: (o) => Object.assign(botInput, o), jump: () => pressJump(), solids, cam, P, S, scene, camera, net, renderer: () => renderer,
        teleport: (x, y, z, yaw) => teleport(new V3(x, y, z), yaw || 0),
        walk: (n) => { qaWalk = n; }, near: () => nearBoxes.length + nearRound.length, quality: (q) => setQuality(q),
        // Runs the game at 60 steps a second without rendering: hold forward f, press jump every N steps
        sim: (secs, f, jumpEvery) => { for (let i = 0; i < Math.round(secs * 60); i++) { if (jumpEvery && i % jumpEvery === 0) pressJump(); botInput.f = f || 0; update(1 / 60); } botInput.f = 0; return window.__qa.state(); },
        // Walks toward a point (x, z) for up to secs, steering by the camera yaw
        walkTo: (x, z, secs) => {
            for (let i = 0; i < Math.round((secs || 4) * 60); i++) {
                const dx = x - P.pos.x, dz = z - P.pos.z;
                if (Math.hypot(dx, dz) < 0.8) break;
                cam.yaw = Math.atan2(dx, dz) + Math.PI;
                botInput.f = 1; update(1 / 60);
            }
            botInput.f = 0;
            return window.__qa.state();
        },
        maze: (i) => ({ m: MAZES[i], path: solve(MAZES[i]) }),
        look: (yaw, pitch, dist) => { cam.yaw = yaw; cam.pitch = pitch; cam.dist = dist; },
        face: (yaw) => { cam.yaw = yaw + Math.PI; P.facing = yaw; },
        state: () => ({ x: +P.pos.x.toFixed(2), y: +P.pos.y.toFixed(2), z: +P.pos.z.toFixed(2), onGround: P.onGround, ground: P.ground && P.ground.mat, vy: +P.vel.y.toFixed(2), stage: P.stage, cp: S.stage, wins: S.wins, climbs: S.climbs, tool: S.tool, morph: S.morph }),
        tool: (id) => { S.gear[id] = true; actions.equip(id); },
        frame: () => { updateCamera(1 / 60); render(); },
    };
}
