// The world: the floating checkered lobby (star spawn pad, big red arrows, Free Morphs, the treasure
// chest, the leaderboards and trophy, the GAMEPASS pads, the lucky block, trails), then the twelve
// themed mazes from shared/maze.js in a row, a checkpoint plaza between two mazes, and the finish
// platform with the WIN pad. Every collider and animation lives here too.
//
// Static geometry is merged per zone and material (a few draw calls per maze); everything matte
// (Lambert) or unlit; built in slices so the page never freezes while loading.
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
    T, V3, scene, mat, studVCMaterial, solids, triggers, prompts, tickers, solidBox,
    billboard, texFrom, sharedTex, textCanvas, mergeChildren, fitFont,
} from './engine.js';
import {
    themeMaterials, rockMaterial, checkerMaterial, diamondMaterial, tileMaterial, latticeMaterial, arrowTex, starPadTex,
    cpPadMaterial, flagMaterial, rainbowTex, softTex, cloudSpriteTex, gemMaterial, goldMaterial, luckyMaterial, neon, killTex,
} from './materials.js';
import { gearModel } from './gear.js';
import { morphStatue } from './morphs.js';
import { S, actions } from './state.js';
import { CFG, STAGES, LOBBY, GEAR, PASSES, MORPHS, passForGear, fmt, playtimeText, rngFrom, clock } from '../../shared/config.js';
import { MAZES, PLAZAS, CHECKPOINTS, COINS, FINISH, CELL, WALL_H, PLAZA, PLAZA_W, CHEST } from '../../shared/maze.js';

export const SPAWN = new V3(LOBBY.spawn.x, LOBBY.spawn.y + 0.4, LOBBY.spawn.z);
export const SPAWN_YAW = LOBBY.yaw;
const LX = LOBBY.half, LS = LOBBY.south, LN = LOBBY.north;
const BASE = 7;       // thickness of the rock under every floating floor

export const C = {
    white: 0xf6f8fb, grey: 0xcfd4dd, dark: 0x2a2e3a, cyan: 0x38d8f0, magenta: 0xc8288a, red: 0xe8213f, orange: 0xff8a2a,
    yellow: 0xffd028, green: 0x46d84a, gold: 0xffc828, pink: 0xff4aa8, blue: 0x2a7aff,
};
const RAINBOW = [0xff3a4a, 0xff8a2a, 0xffd83a, 0x46d84a, 0x2ac8ff, 0x3a6aff, 0xa84aff, 0xff4ad8];

// =====================================================================================
// Zones: the shell (-2, always drawn), the lobby (-1) and one per maze (with the plaza after it).
// Each zone's meshes live in their own group, so far mazes can be hidden, and the player only
// collides with nearby zones.
// =====================================================================================
const zoneGroups = new Map();
export function zoneGroup(z) {
    let g = zoneGroups.get(z);
    if (!g) { g = new T.Group(); g.name = 'zone' + z; scene.add(g); zoneGroups.set(z, g); }
    return g;
}
// Only the maze you're in and its neighbours are drawn: the tall walls hide everything further
// away. Flying over the walls (high) shows one more each way.
export function cullZones(stage, high) {
    const reach = high ? 2 : 1;
    for (const [z, g] of zoneGroups) {
        if (z === -2) continue;
        if (z === -1) { g.visible = stage <= (high ? 1 : 0); continue; }
        g.visible = stage < 0 ? z < reach : Math.abs(z - stage) <= reach;
    }
}
// Most of the world never moves: after building, its matrices are computed once and frozen, so the
// renderer doesn't recompute thousands of them every frame. Things that do move are marked anim().
const anim = (o) => { o.userData.anim = true; return o; };
function freezeStatic() {
    for (const g of zoneGroups.values()) {
        g.updateMatrixWorld(true);
        g.traverse((o) => { if (!o.userData.anim) o.matrixAutoUpdate = false; });
    }
}
// Signs over props hide while you stand right next to them, so they never cover your own name
const propLabels = [];
function propLabel(sp, x, z, r) { propLabels.push({ sp, x, z, r2: r * r }); return sp; }

// ----- static geometry, merged per zone and material at the end -----
const geoBatches = new Map();
function batchFor(zone, material, cast) {
    const k = zone + '|' + material.uuid + '|' + (cast ? 1 : 0);
    let b = geoBatches.get(k);
    if (!b) { b = { zone, material, cast, list: [], pos: [], nrm: [], uv: [], idx: [], col: [] }; geoBatches.set(k, b); }
    return b;
}
const white3 = new T.Color(0xffffff);
// Any geometry (already in world space). Materials with vertex colours get a colour attribute
// (white, or `color`), the others none, so every batch merges cleanly.
function addGeo(zone, geo, material, cast, color) {
    const b = batchFor(zone, material, cast);
    const vc = !!material.vertexColors;
    for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name) && !(vc && name === 'color')) geo.deleteAttribute(name);
    if (!geo.attributes.uv) geo.setAttribute('uv', new T.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    if (vc && (!geo.attributes.color || color !== undefined)) {
        const c = color !== undefined ? new T.Color(color) : white3, n = geo.attributes.position.count, a = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
        geo.setAttribute('color', new T.BufferAttribute(a, 3));
    }
    if (!geo.index) { const idx = []; for (let i = 0; i < geo.attributes.position.count; i++) idx.push(i); geo.setIndex(idx); }
    b.list.push(geo);
}
// Axis-aligned boxes are written straight into their batch's vertex arrays (the same faces, order
// and UVs as THREE.BoxGeometry), so building the world makes no geometry objects: thousands of
// boxes cost a few milliseconds. uvDiv: UVs in world units / uvDiv (studs), or 0 for 0..1 per face.
// skipBottom leaves out the face underneath (walls standing on a floor never show it).
const BOX_FACES = [[2, 1, 0, -1, -1, 1, 2, 1], [2, 1, 0, 1, -1, -1, 2, 1], [0, 2, 1, 1, 1, 1, 0, 2], [0, 2, 1, 1, -1, -1, 0, 2], [0, 1, 2, 1, -1, 1, 0, 1], [0, 1, 2, -1, -1, -1, 0, 1]];
const vcTmp = new T.Color();
function addBoxFast(zone, material, cast, sx, sy, sz, x, y, z, uvDiv, color, skipBottom) {
    const b = batchFor(zone, material, cast);
    const vc = !!material.vertexColors;
    if (vc) vcTmp.set(color ?? 0xffffff);
    const size = [sx, sy, sz], c = [x, y, z], v = [0, 0, 0], n = [0, 0, 0];
    for (let f = 0; f < 6; f++) {
        if (skipBottom && f === 3) continue;
        const [u, vv, w, ud, vd, ws, su, sv] = BOX_FACES[f];
        const base = b.pos.length / 3;
        const wu = size[u], hv = size[vv], dw = size[w] / 2 * ws;
        const us = uvDiv ? size[su] / uvDiv : 1, vs = uvDiv ? size[sv] / uvDiv : 1;
        for (let iy = 0; iy < 2; iy++) for (let ix = 0; ix < 2; ix++) {
            v[u] = (ix * wu - wu / 2) * ud; v[vv] = (iy * hv - hv / 2) * vd; v[w] = dw;
            b.pos.push(v[0] + c[0], v[1] + c[1], v[2] + c[2]);
            n[0] = n[1] = n[2] = 0; n[w] = ws;
            b.nrm.push(n[0], n[1], n[2]);
            // world-anchored UVs: offset by the box position so neighbouring boxes line up
            b.uv.push(ix * us + (uvDiv ? (c[su] - size[su] / 2) / uvDiv : 0), (1 - iy) * vs + (uvDiv ? (c[sv] - size[sv] / 2) / uvDiv : 0));
            if (vc) b.col.push(vcTmp.r, vcTmp.g, vcTmp.b);
        }
        b.idx.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
    }
}
function flushGeo() {
    for (const b of geoBatches.values()) {
        const parts = [...b.list];
        if (b.pos.length) {
            const g = new T.BufferGeometry();
            g.setAttribute('position', new T.Float32BufferAttribute(b.pos, 3));
            g.setAttribute('normal', new T.Float32BufferAttribute(b.nrm, 3));
            g.setAttribute('uv', new T.Float32BufferAttribute(b.uv, 2));
            if (b.col.length) g.setAttribute('color', new T.Float32BufferAttribute(b.col, 3));
            g.setIndex(b.idx);
            parts.push(g);
        }
        if (!parts.length) continue;
        const geo = parts.length === 1 ? parts[0] : mergeGeometries(parts);
        if (!geo) { console.warn('[world] could not merge a batch', b.zone); continue; }
        const mesh = new T.Mesh(geo, b.material);
        mesh.receiveShadow = true; mesh.castShadow = !!b.cast;
        mesh.matrixAutoUpdate = false;
        zoneGroup(b.zone).add(mesh);
        if (parts.length > 1) for (const g of parts) g.dispose();
    }
    geoBatches.clear();
}
function roundGeo(sx, sy, sz, r) {
    return new RoundedBoxGeometry(sx, sy, sz, 2, Math.min(r ?? 0.45, sx * 0.3, sy * 0.3, sz * 0.3));
}
function worldUV(g, tile) {
    const p = g.attributes.position, nn = g.attributes.normal, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
        const ax = Math.abs(nn.getX(i)), ay = Math.abs(nn.getY(i)), az = Math.abs(nn.getZ(i));
        if (ay >= ax && ay >= az) uv.setXY(i, p.getX(i) / tile, -p.getZ(i) / tile);
        else if (ax >= az) uv.setXY(i, -p.getZ(i) / tile, p.getY(i) / tile);
        else uv.setXY(i, p.getX(i) / tile, p.getY(i) / tile);
    }
    return g;
}
// A rounded studded plastic block (soft edges catch the light like moulded plastic)
function roundStud(zone, sx, sy, sz, x, y, z, color, o) {
    o = o || {};
    const g = roundGeo(sx, sy, sz, o.r);
    g.translate(x, y, z);
    addGeo(zone, worldUV(g, 8), studVCMaterial(), o.cast ?? true, color);
    if (o.solid !== false) return solidBox(x, y, z, sx, sy, sz, { zone, mat: o.mat || 'stud', ...(o.extra || {}) });
    return null;
}
function studBox(zone, sx, sy, sz, x, y, z, color, o) {
    o = o || {};
    addBoxFast(zone, studVCMaterial(), o.cast, sx, sy, sz, x, y, z, 8, color);
    if (o.solid !== false) return solidBox(x, y, z, sx, sy, sz, { zone, mat: o.mat || 'stud' });
    return null;
}
// A floating floor: the walkable top (in `material`, 0.6 thick) on a slab of rock
function floorSlab(zone, x0, x1, z0, z1, material, uvDiv, o) {
    o = o || {};
    const sx = x1 - x0, sz = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    addBoxFast(zone, material, false, sx, 0.6, sz, cx, -0.3, cz, uvDiv ?? 8, o.color, true);
    if (!o.noRock) addBoxFast(zone, rockMaterial(), false, sx, BASE, sz, cx, -0.6 - BASE / 2, cz, 8);
    solidBox(cx, -2, cz, sx, 4, sz, { zone, mat: o.mat || 'tile', ...(o.extra || {}) });
}
// Rocks hanging under a floating floor (a few cones, like the underside of an island)
function hangingRocks(zone, x0, x1, z0, z1, n, seed) {
    const rnd = rngFrom(seed);
    for (let k = 0; k < n; k++) {
        const r = Math.min(5 + rnd() * 9, (x1 - x0) / 2 - 1, (z1 - z0) / 2 - 1), h = 10 + rnd() * 22;
        const g = new T.ConeGeometry(r, h, 7);
        g.rotateX(Math.PI);
        g.translate(x0 + r + rnd() * (x1 - x0 - 2 * r), -0.6 - BASE - h / 2 + 1, z0 + r + rnd() * (z1 - z0 - 2 * r));
        addGeo(zone, worldUV(g, 8), rockMaterial(), false);
    }
}
const css = (h) => '#' + h.toString(16).padStart(6, '0');

// ----- signs -----
function bigTitle(zone, text, w, pos, look, colors, stroke) {
    const map = sharedTex('title|' + text + '|' + colors + '|' + stroke, () => {
        const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 220;
        const x = cv.getContext('2d');
        const px = fitFont(x, text, 1024 - 56, 150, 800, 'Montserrat, Fredoka, sans-serif', 0.16);
        x.textAlign = 'center'; x.textBaseline = 'middle';
        x.lineJoin = 'round'; x.lineWidth = px * 0.15; x.strokeStyle = stroke || '#1a1a3a'; x.strokeText(text, 512, 112);
        const g = x.createLinearGradient(0, 40, 0, 180);
        colors.forEach((c, i) => g.addColorStop(i / Math.max(1, colors.length - 1), c));
        x.fillStyle = g; x.fillText(text, 512, 112);
        return cv;
    });
    const m = new T.Mesh(new T.PlaneGeometry(w, w * 220 / 1024), new T.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false, side: T.DoubleSide }));
    m.position.copy(pos); m.lookAt(look);
    m.renderOrder = 2;
    zoneGroup(zone).add(m);
    return m;
}
// A painted board in a rounded frame, optionally on two posts (the "Complete the mazes" sign, the
// title over the first maze, the STAGE signs over the maze entrances)
function board(zone, draw, key, w, h, pos, look, o) {
    o = o || {};
    const map = sharedTex('board|' + key, () => { const cv = document.createElement('canvas'); cv.width = 1024; cv.height = Math.round(1024 * h / w); draw(cv.getContext('2d'), cv.width, cv.height); return cv; });
    const grp = new T.Group(); grp.position.copy(pos); grp.lookAt(look); zoneGroup(zone).add(grp);
    const frame = new T.Mesh(new RoundedBoxGeometry(w + 1, h + 1, 0.6, 2, 0.3), mat(o.frame ?? C.green)); grp.add(frame);
    const face = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map, toneMapped: false })); face.position.z = 0.32; grp.add(face);
    bakeMesh(zone, frame, true);
    return grp;
}
// Moves a static mesh into its zone's merged batches (one draw call per zone and material)
function bakeMesh(zone, mesh, cast) {
    mesh.updateWorldMatrix(true, false);
    addGeo(zone, mesh.geometry.clone().applyMatrix4(mesh.matrixWorld), mesh.material, cast);
    mesh.parent.remove(mesh);
}

// =====================================================================================
// The lobby: a floating checkered platform (x from -70 to 70, z from -62 to 60)
// =====================================================================================
const boardCanvases = {};
export const chestState = { lid: null, ready: true, label: null, labelKey: '', left: '' };
function buildLobby() {
    const Z = -1, B = 6;
    // The floor: checkered tiles in the middle, a cyan diamond-plate border (no overlapping layers)
    floorSlab(Z, -LX + B, LX - B, LS + B, LN, checkerMaterial(), 16, { noRock: true });
    const cyan = diamondMaterial('#38d4ee', '#8aeeff', '#20a8c8');
    for (const [x0, x1, z0, z1] of [[-LX, -LX + B, LS, LN], [LX - B, LX, LS, LN], [-LX + B, LX - B, LS, LS + B]]) floorSlab(Z, x0, x1, z0, z1, cyan, 8, { noRock: true });
    addBoxFast(Z, rockMaterial(), false, LX * 2, BASE, LN - LS, 0, -0.6 - BASE / 2, (LN + LS) / 2, 8);
    hangingRocks(Z, -LX, LX, LS, LN, 9, 5);
    // The spawn: a magenta diamond-plate pad with the star, framed in cyan
    const sx = SPAWN.x, sz = SPAWN.z;
    addBoxFast(Z, cyan, false, 30, 0.2, 30, sx, 0.1, sz, 8, undefined, true);
    addBoxFast(Z, new T.MeshLambertMaterial({ map: starPadTex() }), false, 26, 0.4, 26, sx, 0.2, sz, 0, undefined, true);
    solidBox(sx, 0.2, sz, 26, 0.4, 26, { zone: Z, mat: 'tile' });
    // Big red arrows on the floor pointing the way to the first maze, pulsing one after another
    const arrowMats = [];
    [-21, -1, 19, 39].forEach((z) => {
        const m = new T.MeshBasicMaterial({ map: arrowTex(), transparent: true, depthWrite: false, toneMapped: false });
        const a = new T.Mesh(new T.PlaneGeometry(11, 11), m); a.rotation.set(-Math.PI / 2, 0, Math.PI); a.position.set(0, 0.05, z);
        a.renderOrder = 1; zoneGroup(Z).add(a); arrowMats.push(m);
    });
    tickers.push((dt, t) => {
        if (!zoneGroup(Z).visible) return;
        arrowMats.forEach((m, i) => { const k = 0.5 + 0.5 * Math.sin(t * 4 - i * 0.9); m.color.setScalar(0.72 + k * 0.5); });
    });
    // The glass fence round the edge (open to the north, where the first maze starts)
    const fence = (x0, z0, x1, z1) => {
        const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0), len = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        const panel = new T.PlaneGeometry(len, 4);
        const pu = panel.attributes.uv; for (let i = 0; i < pu.count; i++) pu.setXY(i, pu.getX(i) * len / 4, pu.getY(i));
        if (!alongX) panel.rotateY(Math.PI / 2);
        panel.translate(cx, 2.4, cz);
        addGeo(Z, panel, latticeMaterial(), false);
        addBoxFast(Z, mat(0xffffff), false, alongX ? len : 0.5, 0.5, alongX ? 0.5 : len, cx, 4.6, cz, 0);
        addBoxFast(Z, mat(0x9adcf0), false, alongX ? len : 0.4, 0.4, alongX ? 0.4 : len, cx, 0.2, cz, 0);
        const posts = Math.max(1, Math.round(len / 10));
        for (let k = 0; k <= posts; k++) {
            const f = k / posts;
            addBoxFast(Z, mat(0xffffff), false, 0.6, 4.8, 0.6, x0 + (x1 - x0) * f, 2.4, z0 + (z1 - z0) * f, 0);
        }
        solidBox(cx, 4, cz, alongX ? len : 1, 8, alongX ? 1 : len, { zone: Z, mat: 'glass' });
    };
    const e = LX - 0.5, m0 = MAZES[0];
    fence(-e, LS + 0.5, e, LS + 0.5);
    fence(-e, LS + 0.5, -e, LN);
    fence(e, LS + 0.5, e, LN);
    fence(-e, LN - 0.5, m0.x0, LN - 0.5);
    fence(m0.x1, LN - 0.5, e, LN - 0.5);
    // The way in: the title board and the reference's green sign hang on the first maze's wall,
    // either side of the entrance (clear of the STAGE 1 sign over the arch and of the HUD)
    const wallFace = LN - 1 - 0.4;
    board(Z, (x, W, H) => {
        const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#3a8aff'); g.addColorStop(1, '#1a4ad8');
        x.fillStyle = g; x.fillRect(0, 0, W, H);
        x.fillStyle = 'rgba(255,255,255,0.12)'; for (let k = 0; k < 9; k++) { x.beginPath(); x.arc(W * (0.06 + k * 0.11), H * (0.12 + (k % 3) * 0.2), H * 0.13, 0, Math.PI * 2); x.fill(); }
        x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
        let px = fitFont(x, 'MAZE OBBY', W * 0.88, Math.round(H * 0.5), 800, 'Montserrat, Fredoka, sans-serif', 0.17);
        x.lineWidth = px * 0.16; x.strokeStyle = '#0a1a4a'; x.strokeText('MAZE OBBY', W / 2, H * 0.42);
        const tg = x.createLinearGradient(0, H * 0.2, 0, H * 0.62); tg.addColorStop(0, '#fff6a0'); tg.addColorStop(1, '#ffb81c');
        x.fillStyle = tg; x.fillText('MAZE OBBY', W / 2, H * 0.42);
        px = fitFont(x, '12 mazes · find every exit!', W * 0.84, Math.round(H * 0.15), 700, 'Fredoka, sans-serif', 0.24);
        x.lineWidth = px * 0.22; x.strokeText('12 mazes · find every exit!', W / 2, H * 0.8); x.fillStyle = '#ffffff'; x.fillText('12 mazes · find every exit!', W / 2, H * 0.8);
    }, 'mazeobby2', 17, 6.2, new V3(17.3, 9, wallFace), new V3(17.3, 9, LN - 40), { frame: C.yellow });
    board(Z, (x, W, H) => {
        x.fillStyle = '#3ad84a'; x.fillRect(0, 0, W, H);
        x.fillStyle = '#2ab83a'; for (let k = 0; k < W; k += W / 18) x.fillRect(k, 0, W / 42, H);
        x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round'; x.strokeStyle = '#3a2a00';
        // both lines the same size, the longer one fitted (with room for the slight tilt)
        const L1 = 'COMPLETE THE MAZES', L2 = 'TO BE A WINNER!';
        const px = fitFont(x, L1, W * 0.86, Math.round(H * 0.13), 800, 'Fredoka, sans-serif', 0.2);
        x.lineWidth = px * 0.2;
        x.save(); x.translate(W / 2, H * 0.15); x.rotate(-0.04);
        x.strokeText(L1, 0, 0); x.fillStyle = '#ffe24a'; x.fillText(L1, 0, 0);
        x.strokeText(L2, 0, px * 1.12); x.fillText(L2, 0, px * 1.12);
        x.restore();
        // a little maze doorway with a player walking in, and a yellow arrow pointing at it
        const bx = W * 0.46, by = H * 0.43, bw = W * 0.36, bh = H * 0.5;
        x.fillStyle = '#5a5e6a'; x.fillRect(bx, by, bw, bh);
        x.fillStyle = '#7a7e8a'; for (let r = 0; r < 7; r++) for (let c = 0; c < 3; c++) x.fillRect(bx + (c + (r % 2) * 0.5) * bw / 3 + 4, by + r * bh / 7 + 4, bw / 3 - 12, bh / 7 - 8);
        x.fillStyle = '#2a2e3a'; x.fillRect(bx + bw * 0.36, by + bh * 0.18, bw * 0.3, bh * 0.82);
        x.fillStyle = '#ffd028'; x.fillRect(bx + bw * 0.44, by + bh * 0.24, bw * 0.14, bh * 0.14);
        x.fillStyle = '#46e84a'; x.fillRect(bx + bw * 0.41, by + bh * 0.38, bw * 0.2, bh * 0.26);
        x.fillStyle = '#2a5ad8'; x.fillRect(bx + bw * 0.41, by + bh * 0.64, bw * 0.2, bh * 0.22);
        x.fillStyle = '#ffe03a'; x.strokeStyle = '#3a2a00'; x.lineWidth = W * 0.012;
        const ax = W * 0.06, ay = H * 0.6;
        x.beginPath(); x.moveTo(ax, ay); x.lineTo(ax + W * 0.26, ay + H * 0.06); x.lineTo(ax + W * 0.24, ay); x.lineTo(ax + W * 0.38, ay + H * 0.13); x.lineTo(ax + W * 0.21, ay + H * 0.24); x.lineTo(ax + W * 0.22, ay + H * 0.15); x.lineTo(ax - W * 0.01, ay + H * 0.09); x.closePath(); x.fill(); x.stroke();
    }, 'complete2', 15, 10, new V3(-17.3, 8.2, wallFace), new V3(-17.3, 8.2, LN - 40), { frame: C.green });
    buildMorphs();
    buildChest();
    buildBoards();
    buildGamepass();
    buildTrailKiosk();
    buildLucky();
    buildInvite();
}

// ----- Free Morphs: statues on a striped stand along the west side -----
const morphPads = [];
function buildMorphs() {
    const Z = -1, x = -56, z0 = -30, gap = 7.4;
    const n = MORPHS.length;
    // the stand: coloured stripes like the reference
    const stripes = [C.blue, C.yellow, C.red];
    for (let k = 0; k <= n; k++) roundStud(Z, 6, 1, gap - 0.2, x, 0.5, z0 + k * gap, stripes[k % stripes.length], { r: 0.25, cast: false, mat: 'plastic' });
    MORPHS.forEach((d, i) => {
        const z = z0 + i * gap;
        const st = anim(morphStatue(d.id)); st.position.set(x, 1, z); st.rotation.y = Math.PI / 2; zoneGroup(Z).add(st);
        st.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        const label = propLabel(billboard([{ t: d.ic + ' ' + d.name, c: '#ffffff', s: '#1a1a3a', px: 46 }], 5, 512, new V3(x, 8.4, z), zoneGroup(Z)), x + 3, z, 3.2);
        solidBox(x, 3.5, z, 2.6, 5, 2.6, { zone: Z, mat: 'plastic' });
        const pad = { def: d, st, label, z, key: -1 };
        morphPads.push(pad);
        triggers.push({ min: new V3(x + 1.2, 0, z - 2.4), max: new V3(x + 4.8, 5, z + 2.4), zone: Z, enter: () => actions.morph(d.id) });
        prompts.push({ pos: new V3(x + 3, 1, z), r: 4.2, zone: Z, label: () => (S.morph === d.id ? '✔ Wearing ' + d.name : 'Become ' + d.name), act: () => actions.morph(d.id) });
        tickers.push((dt, t) => { if (!st.parent.visible) return; st.position.y = 1 + Math.abs(Math.sin(t * 2.2 + i)) * 0.25; st.rotation.y = Math.PI / 2 + Math.sin(t * 0.8 + i) * 0.3; });
    });
    // REMOVE MORPH: a red pad at the end of the row
    const rz = z0 + n * gap;
    const rm = new T.Mesh(new T.CylinderGeometry(2.6, 2.6, 0.4, 32), mat(C.red, { emissive: 0xff2a3a, ei: 0.3 })); rm.position.set(x + 1, 1.2, rz); zoneGroup(Z).add(rm); bakeMesh(Z, rm, false);
    billboard([{ t: 'REMOVE', c: '#ff5a6a', s: '#3a0010', px: 54 }, { t: 'MORPH', c: '#ff5a6a', s: '#3a0010', px: 54 }], 5, 256, new V3(x + 1, 5.4, rz), zoneGroup(Z), true);
    triggers.push({ min: new V3(x - 1.6, 0, rz - 2.6), max: new V3(x + 3.6, 5, rz + 2.6), zone: Z, enter: () => actions.morph('') });
    prompts.push({ pos: new V3(x + 3, 1, rz), r: 4.2, zone: Z, label: () => 'Remove morph', act: () => actions.morph('') });
    bigTitle(Z, 'Free Morphs', 30, new V3(x - 2, 15, z0 + n * gap / 2), new V3(0, 15, z0 + n * gap / 2), ['#fff6a0', '#ffc828', '#ff9a1a'], '#5a2a00');
}
export function refreshMorphPads() {
    for (const p of morphPads) {
        const on = S.morph === p.def.id, key = on ? 1 : 0;
        if (p.key === key) continue;
        p.key = key;
        p.label.userData.set([{ t: (on ? '✔ ' : p.def.ic + ' ') + p.def.name, c: on ? '#9aff7a' : '#ffffff', s: '#1a1a3a', px: 46 }]);
    }
}

// ----- the treasure chest (free Wins every few minutes) -----
function buildChest() {
    const Z = -1, x = CHEST.x, z = CHEST.z;
    roundStud(Z, 12, 0.8, 10, x, 0.4, z, C.pink, { r: 0.3, cast: false });
    roundStud(Z, 10, 0.6, 8, x, 1.1, z, C.green, { r: 0.25, cast: false });
    const g = new T.Group(); g.position.set(x, 1.4, z); g.rotation.y = 0.5; zoneGroup(Z).add(g);
    const wood = mat(0x8a4a1e), band = mat(0xffc828), dark = mat(0x4a240c);
    const body = new T.Mesh(new T.BoxGeometry(6, 3.2, 4), wood); body.position.y = 1.6; body.castShadow = true; g.add(body);
    for (const sx of [-2.2, 2.2]) { const b = new T.Mesh(new T.BoxGeometry(0.5, 3.3, 4.1), band); b.position.set(sx, 1.6, 0); g.add(b); }
    const rim = new T.Mesh(new T.BoxGeometry(6.1, 0.4, 4.1), band); rim.position.y = 3.1; g.add(rim);
    const lid = new T.Group(); lid.position.set(0, 3.2, -2); g.add(lid);
    const lidBox = new T.Mesh(new T.CylinderGeometry(2, 2, 6, 16, 1, false, 0, Math.PI), wood); lidBox.rotation.z = Math.PI / 2; lidBox.position.set(0, 0, 2); lidBox.castShadow = true; lid.add(lidBox);
    for (const sx of [-2.2, 2.2]) { const b = new T.Mesh(new T.CylinderGeometry(2.05, 2.05, 0.5, 16, 1, false, 0, Math.PI), band); b.rotation.z = Math.PI / 2; b.position.set(sx, 0, 2); lid.add(b); }
    const lock = new T.Mesh(new T.BoxGeometry(1, 1.2, 0.4), band); lock.position.set(0, 2.6, 2.1); g.add(lock);
    const hole = new T.Mesh(new T.BoxGeometry(0.25, 0.5, 0.1), dark); hole.position.set(0, 2.5, 2.33); g.add(hole);
    // gold inside, seen when the lid lifts
    const gold = new T.Mesh(new T.CylinderGeometry(2.6, 2.8, 0.6, 16), goldMaterial()); gold.scale.z = 0.7; gold.position.y = 3.0; g.add(gold);
    const glow = new T.Sprite(new T.SpriteMaterial({ map: softTex(), color: 0xffd028, transparent: true, opacity: 0.55, depthWrite: false, blending: T.AdditiveBlending }));
    glow.scale.set(9, 9, 1); glow.position.y = 4; g.add(glow);
    lid.traverse((o) => { if (o.isMesh) { o.userData.keep = true; o.receiveShadow = true; } });
    mergeChildren(g);
    chestState.lid = anim(lid); anim(g);
    chestState.label = propLabel(billboard(chestLines(true), 10, 512, new V3(x, 10, z), zoneGroup(Z)), x, z, 7);
    solidBox(x, 2.5, z, 6.5, 5, 5, { zone: Z, mat: 'wood' });
    triggers.push({ min: new V3(x - 5, 0, z - 4.5), max: new V3(x + 5, 6, z + 4.5), zone: Z, enter: () => actions.chest() });
    prompts.push({ pos: new V3(x + 2, 1, z - 3), r: 6.5, zone: Z, label: () => (chestState.ready ? '💰 Open the chest' : 'Chest refills in ' + chestState.left), act: () => actions.chest() });
    tickers.push((dt, t) => {
        if (!g.parent.visible) return;
        const open = chestState.ready ? 0.35 + Math.sin(t * 2.4) * 0.12 : 0;
        lid.rotation.x += (-open - lid.rotation.x) * Math.min(1, dt * 6);
        glow.material.opacity = chestState.ready ? 0.45 + Math.sin(t * 3) * 0.15 : 0;
        g.scale.setScalar(1 + (chestState.ready ? Math.sin(t * 4) * 0.015 : 0));
    });
}
const chestLines = (ready, left) => [
    { t: '💰 TREASURE CHEST', g: ['#fff6a0', '#ffc828'], s: '#5a2a00', px: 52 },
    ready ? { t: 'FREE ' + CFG.chestWins + ' Wins! Step on it!', c: '#9aff7a', s: '#0a3a0a', px: 36 } : { t: 'Refills in ' + left, c: '#ffffff', s: '#1a1a3a', px: 36 },
];
export function updateChest(now) {
    const leftMs = CFG.chestMinutes * 60000 - (now - (S.bonusAt || 0));
    chestState.ready = leftMs <= 0;
    chestState.left = clock(leftMs / 1000);
    // the label shows minutes only, so it's redrawn once a minute at most
    const key = chestState.ready ? 'ready' : Math.ceil(leftMs / 60000) + ' min';
    if (chestState.label && key !== chestState.labelKey) { chestState.labelKey = key; chestState.label.userData.set(chestLines(chestState.ready, key)); }
}

// ----- Leaderboards and the big gold trophy (north-east, facing the spawn) -----
const BOARDS = [['wins', 'Wins Leaderboard', 34], ['climbs', 'Most Escapes', 54]];
function buildBoards() {
    const Z = -1, z = 46;
    studBox(Z, 34, 0.3, 22, 46, 0.15, 40, C.orange, { mat: 'stud' });
    for (const [key, title, x] of BOARDS) {
        const frame = new T.Mesh(new RoundedBoxGeometry(17, 22, 1.4, 3, 0.8), mat(0xff9a2a)); frame.position.set(x, 13, z);
        zoneGroup(Z).add(frame); bakeMesh(Z, frame, true);
        for (const sx of [-6, 6]) addBoxFast(Z, mat(0xe87a1a), false, 1.2, 2.2, 1.2, x + sx, 1.1, z, 0);
        const cv = document.createElement('canvas'); cv.width = 512; cv.height = 640;
        const tex = texFrom(cv);
        const sc = new T.Mesh(new T.PlaneGeometry(15.4, 19.25), new T.MeshBasicMaterial({ map: tex, toneMapped: false }));
        sc.position.set(x, 13, z - 0.75); sc.rotation.y = Math.PI;
        zoneGroup(Z).add(sc);
        solidBox(x, 12, z, 17, 24, 1.4, { zone: Z, mat: 'stud' });
        boardCanvases[key] = { cv, tex, title };
        drawBoard(key, []);
    }
    // the trophy on a yellow pedestal, slowly turning
    roundStud(Z, 6, 3, 6, 44, 1.5, 32, C.yellow, { r: 0.4 });
    const tr = anim(trophy()); tr.position.set(44, 3, 32); zoneGroup(Z).add(tr);
    const glow = new T.Sprite(new T.SpriteMaterial({ map: softTex(), color: 0xffe07a, transparent: true, opacity: 0.4, depthWrite: false, blending: T.AdditiveBlending }));
    glow.scale.set(10, 10, 1); glow.position.y = 4; tr.add(glow);
    tickers.push((dt, t) => { if (tr.parent.visible) { tr.rotation.y = t * 0.6; tr.position.y = 3 + Math.sin(t * 1.5) * 0.25; } });
}
function trophy() {
    const tr = new T.Group();
    const gm = goldMaterial();
    const cup = new T.Mesh(new T.CylinderGeometry(2.2, 1.0, 3.2, 24, 1, true), gm); cup.position.y = 4.4; tr.add(cup);
    const inner = new T.Mesh(new T.CylinderGeometry(2.1, 0.95, 3.1, 24, 1, true), mat(0xd89a10, { side: true })); inner.position.y = 4.42; tr.add(inner);
    const stem = new T.Mesh(new T.CylinderGeometry(0.35, 0.5, 1.6, 12), gm); stem.position.y = 2.0; tr.add(stem);
    const foot = new T.Mesh(new T.CylinderGeometry(1.4, 1.6, 0.6, 20), gm); foot.position.y = 1.0; tr.add(foot);
    for (const sx of [-1, 1]) { const h = new T.Mesh(new T.TorusGeometry(0.9, 0.22, 8, 16, Math.PI), gm); h.position.set(sx * 2.1, 4.6, 0); h.rotation.z = sx > 0 ? -Math.PI / 2 : Math.PI / 2; tr.add(h); }
    tr.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    mergeChildren(tr);
    return tr;
}
function drawBoard(key, rows) {
    const b = boardCanvases[key];
    if (!b) return;
    const x = b.cv.getContext('2d'), W = 512, Hh = 640;
    x.fillStyle = '#ffe9c8'; x.fillRect(0, 0, W, Hh);
    const g = x.createLinearGradient(0, 0, 0, 80); g.addColorStop(0, '#ffb44a'); g.addColorStop(1, '#ff8a1a');
    x.fillStyle = g; x.fillRect(0, 0, W, 80);
    x.fillStyle = '#ffffff'; x.textAlign = 'center'; x.textBaseline = 'middle';
    const tpx = fitFont(x, b.title, W - 48, 44, 700, 'Fredoka, sans-serif', 0.18);
    x.lineWidth = tpx * 0.16; x.strokeStyle = '#8a3a00'; x.lineJoin = 'round'; x.strokeText(b.title, W / 2, 42); x.fillText(b.title, W / 2, 42);
    x.font = '700 22px Fredoka, sans-serif'; x.fillStyle = '#8a5a2a'; x.textAlign = 'left'; x.fillText('#', 28, 102); x.fillText('Username', 96, 102); x.textAlign = 'right'; x.fillText(key === 'climbs' ? 'Escapes' : 'Wins', W - 30, 102);
    for (let i = 0; i < 10; i++) {
        const y = 140 + i * 49, r = rows[i];
        x.fillStyle = i % 2 ? '#fff4e2' : '#ffe2c0'; x.fillRect(16, y - 22, W - 32, 44);
        x.textAlign = 'left'; x.font = '700 28px Fredoka, sans-serif';
        x.fillStyle = i === 0 ? '#e8a400' : i === 1 ? '#8a94a8' : i === 2 ? '#c8703a' : '#5a3a1a';
        x.fillText(String(i + 1), 28, y);
        if (!r) continue;
        x.fillStyle = '#3a2410'; x.font = '600 26px Fredoka, sans-serif';
        let n = r.n; while (x.measureText(n).width > 250 && n.length > 3) n = n.slice(0, -1);
        x.fillText(n, 96, y);
        x.textAlign = 'right'; x.fillStyle = '#c85a00';
        x.fillText(key === 'playtime' ? playtimeText(r.v) : fmt(r.v), W - 30, y);
    }
    b.tex.needsUpdate = true;
}
// Boards arrive every 10 s: only redraw (and re-upload) the ones whose rows changed
const boardKeys = {};
export function renderBoards(m) {
    for (const [key] of BOARDS) {
        const rows = (m && m[key]) || [], k = JSON.stringify(rows);
        if (boardKeys[key] === k) continue;
        boardKeys[key] = k;
        drawBoard(key, rows);
    }
}

// ----- GAMEPASS: the gear on coloured pads along a dark runway (east side) -----
const gearPads = [];
function gearPad(id, x, y, z, zone, scale, padColor) {
    const def = GEAR.find((g) => g.id === id);
    const pc = padColor ?? def.color;
    const grp = new T.Group(); grp.position.set(x, y, z); zoneGroup(zone).add(grp);
    const ped = new T.Mesh(new T.CylinderGeometry(3.2, 3.2, 0.3, 40), mat(pc, { emissive: pc, ei: 0.25 }));
    ped.position.y = 0.15; grp.add(ped); bakeMesh(zone, ped, false);
    const glow = new T.Sprite(new T.SpriteMaterial({ map: softTex(), color: def.color, transparent: true, opacity: 0.4, depthWrite: false, blending: T.AdditiveBlending }));
    glow.scale.set(8, 8, 1); glow.position.y = 3.6; grp.add(glow);
    const model = anim(gearModel(id)); model.position.y = 3.8; model.scale.multiplyScalar(scale || 1); grp.add(model);
    model.traverse((o) => { o.castShadow = false; });
    const pass = passForGear(id);
    const label = propLabel(billboard([{ t: def.name, c: '#ffffff', s: '#1a1a3a', px: 56 }, { t: '🏆 ' + fmt(PASSES[pass].price), c: '#9aff7a', s: '#1a3a1a', px: 46 }], 6.5, 512, new V3(0, 8.2, 0), grp), x, z, 6);
    const pad = { id, grp, model, label, owned: null, zone, x, y, z };
    gearPads.push(pad);
    triggers.push({ min: new V3(x - 2.6, y, z - 2.6), max: new V3(x + 2.6, y + 5, z + 2.6), zone, enter: () => actions.gearPad(id) });
    prompts.push({ pos: new V3(x, y, z), r: 5, zone, label: () => (S.gear[id] ? (S.tool === id ? 'Unequip ' : 'Equip ') + def.name : 'Buy ' + def.name), act: () => actions.gearPad(id, true) });
    tickers.push((dt, t) => {
        if (!grp.parent.visible) return;
        model.rotation.y = t * 1.2 + x;
        model.position.y = 3.8 + Math.sin(t * 2 + z) * 0.35;
    });
}
// Owned gear says so on its pad
export function refreshGearPads() {
    for (const p of gearPads) {
        const owned = !!S.gear[p.id];
        const key = owned + '|' + (S.tool === p.id);
        if (p.owned === key) continue;
        p.owned = key;
        const def = GEAR.find((g) => g.id === p.id);
        p.label.userData.set([{ t: def.name, c: '#ffffff', s: '#1a1a3a', px: 56 }, owned ? { t: S.tool === p.id ? '✔ EQUIPPED' : '✔ OWNED', c: '#9aff7a', s: '#1a3a1a', px: 46 } : { t: '🏆 ' + fmt(PASSES[passForGear(p.id)].price), c: '#9aff7a', s: '#1a3a1a', px: 46 }]);
    }
}
function buildGamepass() {
    const Z = -1, x = 54;
    addBoxFast(Z, mat(0x3a3e4a), false, 12, 0.3, 64, x, 0.15, -8, 0);
    addBoxFast(Z, mat(0xffd028), false, 0.6, 0.32, 64, x - 6, 0.16, -8, 0);
    addBoxFast(Z, mat(0xffd028), false, 0.6, 0.32, 64, x + 6, 0.16, -8, 0);
    solidBox(x, 0.15, -8, 12, 0.3, 64, { zone: Z, mat: 'stud' });
    const pads = [0xff3a4a, 0x2a6aff, 0xb44aff, 0xffe03a, 0x2ae8d8, 0x9a4aff];
    GEAR.forEach((g, i) => gearPad(g.id, x, 0.3, -34 + i * 10.4, Z, 1, pads[i]));
    bigTitle(Z, 'GAMEPASS', 26, new V3(x + 4, 17, -8), new V3(0, 17, -8), ['#ff5ad8', '#7a5aff', '#2ac8ff'], '#1a0a3a');
    prompts.push({ pos: new V3(x - 8, 1, -8), r: 6, zone: Z, label: () => '🛒 Open the Shop', act: () => actions.openStore() });
}

// ----- TRAILS kiosk, south-east -----
function buildTrailKiosk() {
    const Z = -1, x = 34, z = -48;
    roundStud(Z, 12, 0.8, 9, x, 0.4, z, C.white, { r: 0.35, cast: false });
    const rack = new T.Group(); rack.position.set(x, 0.8, z); zoneGroup(Z).add(rack);
    const bar = new T.Mesh(new T.CylinderGeometry(0.15, 0.15, 10, 8), mat(0xd8d8e8)); bar.rotation.z = Math.PI / 2; bar.position.y = 6; rack.add(bar); bakeMesh(Z, bar, false);
    for (const sx of [-5, 5]) { const p = new T.Mesh(new T.CylinderGeometry(0.18, 0.18, 6, 8), mat(0xd8d8e8)); p.position.set(sx, 3, 0); rack.add(p); bakeMesh(Z, p, false); }
    const ribbons = RAINBOW.slice(0, 6).map((c, i) => {
        const r = new T.Mesh(new T.PlaneGeometry(0.9, 4.2, 1, 8), neon(c, 1.1));
        r.material = r.material.clone(); r.material.side = T.DoubleSide;
        r.position.set(-3.8 + i * 1.5, 3.8, 0); rack.add(anim(r));
        return r;
    });
    tickers.push((dt, t) => { if (!rack.parent.visible) return; ribbons.forEach((r, i) => { r.rotation.y = Math.sin(t * 1.5 + i) * 0.5; }); });
    propLabel(billboard([{ t: '🌈 TRAILS', g: ['#ffffff', '#e0f0ff'], s: '#1a2a6a', px: 64 }], 8, 512, new V3(x, 10.5, z), zoneGroup(Z), true), x, z, 7);
    prompts.push({ pos: new V3(x, 1, z + 3), r: 6.5, zone: Z, label: () => '🌈 Trails', act: () => actions.openTrails() });
}

// ----- The giant lucky block, south-west (the reference's "?" block) -----
export const luckyState = { ready: true, mesh: null };
function buildLucky() {
    const Z = -1, x = -34, z = -48;
    roundStud(Z, 10, 0.8, 10, x, 0.4, z, C.yellow, { r: 0.35, cast: false });
    const box = new T.Mesh(new RoundedBoxGeometry(5, 5, 5, 2, 0.4), luckyMaterial()); box.castShadow = true; box.receiveShadow = true;
    box.position.set(x, 5, z); zoneGroup(Z).add(anim(box));
    const glow = new T.Sprite(new T.SpriteMaterial({ map: softTex(), color: 0xffe04a, transparent: true, opacity: 0.5, depthWrite: false, blending: T.AdditiveBlending }));
    glow.scale.set(13, 13, 1); glow.position.set(x, 5, z); zoneGroup(Z).add(glow);
    luckyState.mesh = box;
    propLabel(billboard([{ t: '❓ LUCKY BLOCK', g: ['#fff6a0', '#ffc828'], s: '#5a3a00', px: 56 }, { t: 'a free spin every ' + CFG.luckyMinutes + ' min!', c: '#ffffff', s: '#1a1a3a', px: 34 }], 10, 512, new V3(x, 11.5, z), zoneGroup(Z), true), x, z, 7.5);
    solidBox(x, 4, z, 5, 8, 5, { zone: Z, mat: 'plastic' });
    prompts.push({ pos: new V3(x, 1, z + 4), r: 7, zone: Z, label: () => (luckyState.ready ? '❓ Open the Lucky Block' : '❓ Lucky Block'), act: () => actions.openLucky() });
    tickers.push((dt, t) => { if (!box.parent.visible) return; box.rotation.y = t * 0.8; box.rotation.x = Math.sin(t * 0.7) * 0.15; box.position.y = 5 + Math.sin(t * 1.8) * 0.5; glow.material.opacity = luckyState.ready ? 0.45 + Math.sin(t * 4) * 0.15 : 0.12; });
}
// ----- INVITE FRIENDS: a rainbow pad -----
function buildInvite() {
    const Z = -1, x = -34, z = -22;
    const tex = rainbowTex().clone(); tex.needsUpdate = true;
    const pad = new T.Mesh(new T.CylinderGeometry(4, 4, 0.3, 40), new T.MeshBasicMaterial({ map: tex, toneMapped: false })); pad.position.set(x, 0.15, z); zoneGroup(Z).add(pad);
    propLabel(billboard([{ t: 'INVITE', g: ['#ff5ad8', '#7a5aff'], s: '#ffffff', px: 64 }, { t: 'FRIENDS', g: ['#2ac8ff', '#46e84a'], s: '#ffffff', px: 64 }], 7, 512, new V3(x, 5.2, z), zoneGroup(Z), true), x, z, 5);
    prompts.push({ pos: new V3(x, 0.5, z), r: 5, zone: Z, label: () => '👥 Invite friends (+10% Wins each)', act: () => actions.openInvite() });
    tickers.push((dt, t) => { if (pad.parent.visible) tex.offset.x = (t * 0.2) % 1; });
}

// =====================================================================================
// The mazes
// =====================================================================================
export const cpPads = [];
let gemMesh = null;
export const coinState = { collected: new Set() };
const beamMats = [];
let waterT = null;
const beamVert = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }';
const beamFrag = `uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
    void main(){ float a = (1.0 - vUv.y) * 0.5 * (0.75 + 0.25 * sin(vUv.y * 24.0 - uTime * 5.0)); gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.35) * 1.2, a); }`;
// Kill bricks glow and pulse (one unlit material per colour, shared by every brick of that colour)
const killMats = [];
function killMaterial(color) {
    let k = killMats.find((o) => o.color === color);
    if (!k) { k = { color, base: new T.Color(0xffffff), m: new T.MeshBasicMaterial({ color: 0xffffff, map: killTex() }) }; killMats.push(k); }
    return k.m;
}
function buildMaze(m) {
    const s = STAGES[m.i], th = themeMaterials(s.theme), Z = m.i;
    // the floor and the rock under it
    floorSlab(Z, m.x0, m.x1, m.z0, m.z1, th.floorMat, 8, { color: th.floorColor, mat: th.sound, extra: th.ice ? { ice: true } : th.water ? { water: true } : {} });
    hangingRocks(Z, m.x0, m.x1, m.z0, m.z1, 5 + Math.floor(m.i / 3), 100 + m.i);
    if (th.water) waterT = th.floorMat.map;
    // the walls: merged runs, each a box with a collider you can't stand on
    for (const w of m.walls) {
        const sx = w.x1 - w.x0, sz = w.z1 - w.z0, cx = (w.x0 + w.x1) / 2, cz = (w.z0 + w.z1) / 2;
        const color = th.rainbow ? RAINBOW[(w.k * 5 + m.i) % RAINBOW.length] : th.wallColor;
        addBoxFast(Z, th.wallMat, true, sx, WALL_H, sz, cx, WALL_H / 2, cz, 8, color, true);
        solidBox(cx, WALL_H / 2, cz, sx, WALL_H, sz, { zone: Z, mat: th.sound, wallTop: true });
        // a trim along the top: snow on the ice, icing on the candy, glowing lines on lava and neon
        if (th.cap) addBoxFast(Z, mat(th.cap), false, sx + 0.3, 0.45, sz + 0.3, cx, WALL_H + 0.22, cz, 0, undefined, true);
        if (th.capNeon) addBoxFast(Z, neon(th.capNeon, 1.3), false, sx + 0.1, 0.3, sz + 0.1, cx, WALL_H + 0.15, cz, 0, undefined, true);
    }
    // the entrance and exit arches in the stage's colour
    arch(Z, m.z0, s, m.i, 'in');
    arch(Z, m.z1, s, m.i, 'out');
    // kill bricks across the way through (jump them!), glowing and pulsing in the maze's danger colour
    if (m.kills.length) {
        const km = killMaterial(th.kill ?? 0xff2a2a);
        for (const k of m.kills) {
            addBoxFast(Z, mat(0x1a0608), false, k.sx + 0.8, 0.2, k.sz + 0.8, k.x, 0.1, k.z, 0, undefined, true);
            addBoxFast(Z, km, false, k.sx, 0.45, k.sz, k.x, 0.225, k.z, 2, undefined, true);
            // touching it (feet on the floor) sends you back; jumping over is fine
            triggers.push({ min: new V3(k.x - k.sx / 2 + 0.2, -1, k.z - k.sz / 2 + 0.2), max: new V3(k.x + k.sx / 2 - 0.2, 0.55, k.z + k.sz / 2 - 0.2), zone: Z, enter: () => actions.killBrick() });
        }
    }
    if (!s.beam) return;
    // a beam of light over the exit, seen over the walls from anywhere in the maze (the first mazes)
    const bm = new T.ShaderMaterial({
        transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
        uniforms: { uTime: { value: 0 }, uColor: { value: new T.Color(s.bar) } }, vertexShader: beamVert, fragmentShader: beamFrag,
    });
    beamMats.push(bm);
    const beam = new T.Mesh(new T.CylinderGeometry(3.2, 4.4, 70, 24, 1, true), bm);
    beam.position.set(0, 35, m.z1 - CELL / 2); beam.renderOrder = 3;
    zoneGroup(Z).add(beam);
}
// Two pillars and a beam over the opening, a STAGE sign facing the way in, EXIT over the way out
function arch(Z, z, s, i, kind) {
    const half = CELL / 2 + 0.2, H = WALL_H + 5, color = s.bar;
    for (const sx of [-half, half]) {
        roundStud(Z, 2.4, H, 2.4, sx, H / 2, z, color, { r: 0.4 });
        addBoxFast(Z, neon(color, 1.3), false, 2.6, 0.35, 2.6, sx, H - 0.6, z, 0);
    }
    roundStud(Z, half * 2 + 2.4, 2.6, 2.4, 0, H + 1.3, z, color, { r: 0.5, solid: false });
    addBoxFast(Z, neon(0xffffff, 1.2), false, half * 2 - 2.4, 0.3, 2.5, 0, H, z, 0);
    const n = i + 1;
    if (kind === 'in') {
        board(Z, (x, W, Hh) => {
            const g = x.createLinearGradient(0, 0, 0, Hh); g.addColorStop(0, css(color)); g.addColorStop(1, '#1a1a3a');
            x.fillStyle = g; x.fillRect(0, 0, W, Hh);
            x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
            let px = fitFont(x, 'STAGE ' + n, W * 0.84, Math.round(Hh * 0.4), 800, 'Montserrat, Fredoka, sans-serif', 0.2);
            x.lineWidth = px * 0.18; x.strokeStyle = '#0a0a1a';
            x.strokeText('STAGE ' + n, W / 2, Hh * 0.36); x.fillStyle = '#ffffff'; x.fillText('STAGE ' + n, W / 2, Hh * 0.36);
            px = fitFont(x, s.ic + ' ' + s.name, W * 0.88, Math.round(Hh * 0.2), 700, 'Fredoka, sans-serif', 0.22); x.lineWidth = px * 0.2; x.strokeText(s.ic + ' ' + s.name, W / 2, Hh * 0.74); x.fillStyle = '#fff6a0'; x.fillText(s.ic + ' ' + s.name, W / 2, Hh * 0.74);
        }, 'stage2-' + n, 15, 6, new V3(0, H + 7, z - 0.2), new V3(0, H + 7, z - 30), { frame: color });
    } else {
        billboard([{ t: n === STAGES.length ? '🏆 FINISH' : 'EXIT ⬆', g: ['#ffffff', '#c8ffd0'], s: '#0a3a14', px: 80 }], 6, 256, new V3(0, H + 4.8, z), zoneGroup(Z), true);
    }
}

// ----- the checkpoint plazas between the mazes -----
const flagGeoBase = (() => { const g = new T.PlaneGeometry(3.4, 2.2, 10, 4); g.translate(1.7, 0, 0); return g; })();
const PLAZA_GEAR = { 0: ['speedCoil', 'gravityCoil'], 3: ['rayGun', 'superCoil'], 6: ['sword', 'carpet'], 9: ['speedCoil', 'carpet'] };
function buildPlaza(p) {
    const Z = p.i, half = PLAZA_W / 2;
    floorSlab(Z, p.x0, p.x1, p.z0, p.z1, tileMaterial(), 8, { mat: 'tile' });
    hangingRocks(Z, p.x0, p.x1, p.z0, p.z1, 2, 300 + p.i);
    // glass rails down both sides (you can't fall off), lamp posts glowing in the next stage's colour
    for (const sx of [-1, 1]) {
        const x = sx * (half - 0.3), len = p.z1 - p.z0, cz = (p.z0 + p.z1) / 2;
        const panel = new T.PlaneGeometry(len, 3.4);
        const pu = panel.attributes.uv; for (let i = 0; i < pu.count; i++) pu.setXY(i, pu.getX(i) * len / 4, pu.getY(i));
        panel.rotateY(Math.PI / 2); panel.translate(x, 2.1, cz);
        addGeo(Z, panel, latticeMaterial(), false);
        addBoxFast(Z, mat(0xffffff), false, 0.5, 0.5, len, x, 4, cz, 0);
        for (let k = 0; k <= 3; k++) addBoxFast(Z, mat(0xffffff), false, 0.6, 4.2, 0.6, x, 2.1, p.z0 + len * k / 3, 0);
        solidBox(x, 4, cz, 1, 8, len, { zone: Z, mat: 'glass' });
        for (const z of [p.z0 + 3, p.z1 - 3]) {
            addBoxFast(Z, mat(0x3a3e4a), true, 0.5, 8, 0.5, sx * (half - 2.5), 4, z, 0);
            const bulb = new T.SphereGeometry(0.75, 12, 8); bulb.translate(sx * (half - 2.5), 8.4, z);
            addGeo(Z, bulb, neon(STAGES[p.i + 1].bar, 1.25), false);
        }
    }
    const cp = CHECKPOINTS[p.i];
    buildCheckpoint(cp);
    const gear = PLAZA_GEAR[p.i];
    if (gear) gear.forEach((id, k) => gearPad(id, (k ? 1 : -1) * 13.5, 0, cp.z, Z, 0.85));
}
function buildCheckpoint(e) {
    const Z = e.i;
    const pad = new T.Mesh(new RoundedBoxGeometry(10, 0.5, 10, 2, 0.2), cpPadMaterial(false));
    pad.position.set(e.x, 0.25, e.z); pad.rotation.y = Math.PI; pad.receiveShadow = true;
    zoneGroup(Z).add(pad);
    solidBox(e.x, 0.25, e.z, 10, 0.5, 10, { zone: Z, mat: 'tile' });
    const ringMat = new T.MeshBasicMaterial({ color: 0xffd028, toneMapped: false });
    const ring = new T.Mesh(new T.TorusGeometry(7, 0.18, 8, 64), ringMat);
    ring.rotation.x = Math.PI / 2; ring.position.set(e.x, 0.55, e.z); anim(ring);
    zoneGroup(Z).add(ring);
    const flagGeo = flagGeoBase.clone();
    const flag = new T.Mesh(flagGeo, flagMaterial(false));
    flag.castShadow = true;
    const fx = e.x - 6.5, fz = e.z + 4;
    const pole = new T.Mesh(new T.CylinderGeometry(0.14, 0.16, 9, 8), mat(0xf4f6fa));
    pole.position.set(fx, 4.5, fz); zoneGroup(Z).add(pole); bakeMesh(Z, pole, true);
    const knob = new T.Mesh(new T.SphereGeometry(0.35, 12, 8), goldMaterial()); knob.position.set(fx, 9.1, fz); zoneGroup(Z).add(knob); bakeMesh(Z, knob, false);
    flag.position.set(fx, 7.8, fz);
    zoneGroup(Z).add(flag);
    const base = Float32Array.from(flagGeo.attributes.position.array);
    cpPads[e.i] = { pad, lit: false, ring, flag };
    let acc = 0;
    tickers.push((dt, t) => {
        if (!flag.parent.visible) return;
        acc += dt;
        if (acc > 1 / 30) {
            // the flag waves at 30 fps: plenty for cloth, half the work
            acc = 0;
            const p = flagGeo.attributes.position;
            for (let i = 0; i < p.count; i++) {
                const x = base[i * 3], k = x / 3.4;
                p.array[i * 3 + 2] = Math.sin(x * 1.9 - t * 5 + e.i) * 0.32 * k + Math.sin(base[i * 3 + 1] * 2 + t * 3) * 0.06 * k;
            }
            p.needsUpdate = true;
            flagGeo.computeVertexNormals();
        }
        const pulse = 1.1 + Math.sin(t * 3 + e.i) * 0.25;
        ringMat.color.set(cpPads[e.i].lit ? 0x46ff5a : 0xffd028).multiplyScalar(pulse);
        ring.scale.setScalar(1 + Math.sin(t * 3 + e.i) * 0.03);
    });
    // the whole plaza counts: nobody walks past their checkpoint
    triggers.push({ min: new V3(-PLAZA_W / 2, 0, e.z - PLAZA / 2 + 1), max: new V3(PLAZA_W / 2, 8, e.z + PLAZA / 2 - 1), zone: Z, enter: () => actions.checkpoint(e.i) });
}
export function lightCheckpoint(i, on) {
    const c = cpPads[i];
    if (!c || c.lit === on) return;
    c.lit = on;
    c.pad.material = cpPadMaterial(on);
    c.flag.material = flagMaterial(on);
}

// ----- the finish: a big platform with the rainbow WIN pad, a podium and a giant trophy -----
function buildFinish() {
    const Z = STAGES.length - 1, F = FINISH;
    floorSlab(Z, F.x0, F.x1, F.z0, F.z1, checkerMaterial(), 16, { mat: 'tile' });
    hangingRocks(Z, F.x0, F.x1, F.z0, F.z1, 6, 777);
    const e = 0.5;
    const rail = (x0, z0, x1, z1) => {
        const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0), len = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        const panel = new T.PlaneGeometry(len, 4);
        const pu = panel.attributes.uv; for (let i = 0; i < pu.count; i++) pu.setXY(i, pu.getX(i) * len / 4, pu.getY(i));
        if (!alongX) panel.rotateY(Math.PI / 2);
        panel.translate(cx, 2.4, cz);
        addGeo(Z, panel, latticeMaterial(), false);
        addBoxFast(Z, mat(0xffd028), false, alongX ? len : 0.5, 0.5, alongX ? 0.5 : len, cx, 4.6, cz, 0);
        solidBox(cx, 4, cz, alongX ? len : 1, 8, alongX ? 1 : len, { zone: Z, mat: 'glass' });
    };
    rail(F.x0 + e, F.z1 - e, F.x1 - e, F.z1 - e);
    rail(F.x0 + e, F.z0, F.x0 + e, F.z1);
    rail(F.x1 - e, F.z0, F.x1 - e, F.z1);
    // the WIN pad
    const g = new T.Group(); g.position.set(F.x, 0, F.z); zoneGroup(Z).add(g);
    const padTex = rainbowTex().clone(); padTex.needsUpdate = true;
    const pad = new T.Mesh(new T.CylinderGeometry(F.pad, F.pad, 0.4, 48), new T.MeshBasicMaterial({ map: padTex, toneMapped: false }));
    pad.position.y = 0.2; g.add(pad);
    solids.push({ shape: 'cyl', cx: F.x, cz: F.z, r: F.pad, min: new V3(F.x - F.pad, 0, F.z - F.pad), max: new V3(F.x + F.pad, 0.4, F.z + F.pad), zone: Z, mat: 'tile' });
    const beam = new T.Mesh(new T.CylinderGeometry(F.pad, F.pad, 40, 32, 1, true), new T.ShaderMaterial({
        transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
        uniforms: { uTime: { value: 0 } },
        vertexShader: beamVert,
        fragmentShader: `uniform float uTime; varying vec2 vUv;
            vec3 hue(float h){ return clamp(abs(mod(h*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0,0.0,1.0); }
            void main(){ float a = (1.0 - vUv.y) * 0.5 * (0.7 + 0.3 * sin(vUv.y * 20.0 - uTime * 4.0)); gl_FragColor = vec4(hue(vUv.x + uTime * 0.1) * 1.2, a); }`,
    }));
    beam.position.y = 20; g.add(beam);
    const win = anim(billboard([{ t: '🏆 WIN! 🏆', g: ['#fff6b0', '#ffc828'], s: '#7a3a00', px: 90 }, { t: 'You escaped all 12 mazes!', c: '#ffffff', s: '#1a1a3a', px: 40 }], 13, 512, new V3(0, 9, 0), g));
    triggers.push({ min: new V3(F.x - F.pad + 0.6, 0, F.z - F.pad + 0.6), max: new V3(F.x + F.pad - 0.6, 6, F.z + F.pad - 0.6), zone: Z, enter: () => actions.finish() });
    // the podium behind it, and a giant trophy on top
    const pz = F.z + 18;
    roundStud(Z, 10, 6, 8, 0, 3, pz, C.gold, { r: 0.5 });
    roundStud(Z, 10, 4, 8, -10, 2, pz, 0xc8d0dc, { r: 0.5 });
    roundStud(Z, 10, 2.6, 8, 10, 1.3, pz, 0xd8884a, { r: 0.5 });
    for (const [x, y, n] of [[0, 6, '1'], [-10, 4, '2'], [10, 2.6, '3']]) billboard([{ t: n, c: '#ffffff', s: '#1a1a3a', px: 110 }], 3, 128, new V3(x, y - 1.5, pz - 4.3), zoneGroup(Z), true);
    const tr = anim(trophy()); tr.position.set(0, 6, pz); tr.scale.setScalar(2.2); zoneGroup(Z).add(tr);
    bigTitle(Z, 'YOU ESCAPED!', 44, new V3(0, 30, pz + 6), new V3(0, 30, F.z0 - 40), ['#fff6a0', '#ffc828', '#ff8a1a'], '#5a2a00');
    // balloons tied along the rails (one instanced mesh, placed once)
    const rnd = rngFrom(42), NB = 14;
    const bm = new T.InstancedMesh(new T.SphereGeometry(1.5, 14, 10), new T.MeshLambertMaterial({ color: 0xffffff }), NB);
    for (let k = 0; k < NB; k++) {
        const side = k % 2 ? 1 : -1, z = F.z0 + 6 + (k >> 1) * 8.5;
        bm.setColorAt(k, new T.Color(RAINBOW[k % RAINBOW.length]));
        bm.setMatrixAt(k, m4.compose(v0.set(side * (F.x1 - 1.5), 9 + rnd() * 3, z), q0.identity(), s0.set(1, 1.2, 1)));
    }
    zoneGroup(Z).add(bm);
    tickers.push((dt, t) => {
        if (!g.parent.visible) return;
        padTex.offset.x = (t * 0.25) % 1;
        beam.material.uniforms.uTime.value = t;
        win.position.y = 9 + Math.sin(t * 1.5) * 0.5;
        tr.rotation.y = t * 0.5;
    });
}

// ----- Win gems in the dead ends: one instanced mesh for all of them. They spin and bob in the
// vertex shader (the instance buffer is only rewritten when a gem is picked up). -----
const gemTime = { value: 0 };
let gemKey = -1;
function buildGems() {
    const geo = new T.OctahedronGeometry(1.1, 0); geo.scale(1, 1.4, 1);
    const gm = gemMaterial();
    gm.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = gemTime;
        sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
            float gid = float(gl_InstanceID), ga = uTime * 2.2 + gid, gc = cos(ga), gs = sin(ga);
            transformed = vec3(gc * transformed.x + gs * transformed.z, transformed.y + sin(uTime * 2.0 + gid) * 0.35, gc * transformed.z - gs * transformed.x);`);
    };
    gm.customProgramCacheKey = () => 'gem-spin';
    gemMesh = new T.InstancedMesh(geo, gm, COINS.length);
    gemMesh.frustumCulled = false;
    scene.add(gemMesh);
    placeGems();
}
function placeGems() {
    COINS.forEach((c, i) => gemMesh.setMatrixAt(i, m4.compose(v0.set(c.x, c.y, c.z), q0.identity(), s0.setScalar(coinState.collected.has(c.i) ? 0.0001 : 1))));
    gemMesh.instanceMatrix.needsUpdate = true;
    gemKey = coinState.collected.size;
}

// =====================================================================================
// Decor: clouds drifting along the mazes (all of them one draw call: camera-facing quads moved by
// the shader), lucky blocks floating around the lobby (one instanced mesh)
// =====================================================================================
let lowDecor = false, cloudMat = null;
const luckies = [];
export function setDecorLow(on) {
    if (lowDecor === !!on) return;
    lowDecor = !!on;
    if (cloudMat) cloudMat.uniforms.uLow.value = lowDecor ? 1 : 0;
    luckies.forEach((f, k) => { f.o.visible = !(lowDecor && k % 2); });
}
function buildDecor() {
    const rnd = rngFrom(5), N = 40;
    const pos = [], uv = [], center = [], info = [], low = [], idx = [];
    for (let k = 0; k < N; k++) {
        const side = rnd() < 0.5 ? -1 : 1, x = side * (130 + rnd() * 260), z = -120 + rnd() * (FINISH.z1 + 240), y = k < 22 ? -50 - rnd() * 120 : 20 + rnd() * 120;
        const sz = 90 + rnd() * 120, spd = 1.5 + rnd() * 3, b = k * 4;
        for (const [cx, cy] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
            pos.push(cx, cy, 0); uv.push(cx + 0.5, cy + 0.5); center.push(x, y, z); info.push(sz, sz / 2, spd); low.push(k % 2);
        }
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setAttribute('aCenter', new T.Float32BufferAttribute(center, 3));
    g.setAttribute('aInfo', new T.Float32BufferAttribute(info, 3));
    g.setAttribute('aLow', new T.Float32BufferAttribute(low, 1));
    g.setIndex(idx);
    cloudMat = new T.ShaderMaterial({
        transparent: true, depthWrite: false,
        uniforms: { uMap: { value: cloudSpriteTex() }, uTime: { value: 0 }, uZ0: { value: -140 }, uLen: { value: FINISH.z1 + 280 }, uLow: { value: 0 } },
        vertexShader: `attribute vec3 aCenter; attribute vec3 aInfo; attribute float aLow; uniform float uTime; uniform float uZ0; uniform float uLen; uniform float uLow; varying vec2 vUv;
            void main() {
                vUv = uv;
                vec3 c = aCenter; c.z = uZ0 + mod(c.z - uZ0 + uTime * aInfo.z, uLen);
                vec4 mv = viewMatrix * vec4(c, 1.0); mv.xy += position.xy * aInfo.xy;
                gl_Position = projectionMatrix * mv;
                if (uLow > 0.5 && aLow > 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            }`,
        fragmentShader: `uniform sampler2D uMap; varying vec2 vUv;
            void main() { vec4 c = texture2D(uMap, vUv); if (c.a < 0.01) discard; gl_FragColor = vec4(c.rgb, c.a * 0.92);
                #include <colorspace_fragment>
            }`,
    });
    const clouds = new T.Mesh(g, cloudMat);
    clouds.frustumCulled = false; clouds.renderOrder = -5;
    scene.add(clouds);
    // floating lucky blocks around the lobby
    for (let k = 0; k < 8; k++) {
        const a = k / 8 * Math.PI * 2 + 0.3, r = 95 + rnd() * 25;
        luckies.push({ x: Math.cos(a) * r, y: 12 + rnd() * 30, z: Math.sin(a) * r * 0.8 - 10, s: 5 + rnd() * 4, ph: rnd() * 6, rot: 0.3 + rnd() * 0.4 });
    }
    const lg = new RoundedBoxGeometry(1, 1, 1, 2, 0.08);
    for (const f of luckies) { f.o = anim(new T.Mesh(lg, luckyMaterial())); f.o.receiveShadow = true; f.o.scale.setScalar(f.s); f.o.position.set(f.x, f.y, f.z); zoneGroup(-1).add(f.o); }
}
function updateDecor(dt, t) {
    if (cloudMat) cloudMat.uniforms.uTime.value = t;
    if (luckies.length && luckies[0].o.parent.visible) {
        for (const f of luckies) { f.o.position.y = f.y + Math.sin(t * 0.6 + f.ph) * 2.5; f.o.rotation.set(t * f.rot * 0.5, t * f.rot, 0); }
    }
}

// =====================================================================================
// Per-frame world animation (before the player moves)
// =====================================================================================
const m4 = new T.Matrix4(), q0 = new T.Quaternion(), v0 = new V3(), s0 = new V3();
export function updateWorld(dt, t, stage, me) {
    gemTime.value = t;
    if (gemMesh && coinState.collected.size !== gemKey) placeGems();
    for (const bm of beamMats) bm.uniforms.uTime.value = t;
    const pulse = 0.75 + 0.5 * (0.5 + 0.5 * Math.sin(t * 7));
    for (const k of killMats) k.m.color.copy(k.base).multiplyScalar(pulse);
    if (me) for (const l of propLabels) l.sp.visible = (l.x - me.x) ** 2 + (l.z - me.z) ** 2 > l.r2;
    // the water in the first maze ripples along
    if (waterT) waterT.offset.set((t * 0.02) % 1, (t * 0.035) % 1);
    updateDecor(dt, t);
}

// =====================================================================================
// Built in slices with a pause between them (pause() returns a promise), so the page stays
// responsive and the server connection that runs alongside keeps moving.
// =====================================================================================
export async function buildWorld(pause) {
    pause = pause || (() => Promise.resolve());
    buildLobby();
    await pause();
    for (const m of MAZES) {
        buildMaze(m);
        if (PLAZAS[m.i]) buildPlaza(PLAZAS[m.i]);
        if (m.i % 3 === 2) await pause();
    }
    buildFinish();
    buildGems();
    await pause();
    buildDecor();
    flushGeo();
    freezeStatic();
    cullZones(-1);
}
// The theme of the maze a zone belongs to (footsteps, the mood, the ambient particles)
export const themeOf = (stage) => themeMaterials(STAGES[Math.max(0, Math.min(STAGES.length - 1, stage))].theme);

// Gets every shader and texture onto the GPU while the loading screen shows, without freezing the
// page: the shaders compile in the background (compileAsync), the depth shaders the sun's shadow
// pass draws with included, then the textures upload and a GPU fence says when they're done. The
// stand-ins made here are kept, so their shaders stay alive.
const SHADOW_SIDE = { [T.FrontSide]: T.BackSide, [T.BackSide]: T.FrontSide, [T.DoubleSide]: T.DoubleSide };
const warmKeep = [];
export async function warmUp(renderer, camera, pause) {
    const vis = [];
    scene.traverse((o) => { if (o !== scene && !o.visible) { vis.push(o); o.visible = true; } });
    try { await renderer.compileAsync(scene, camera); } catch (e) { renderer.compile(scene, camera); }
    if (renderer.shadowMap.enabled) {
        // The shadow pass draws each caster with three's depth material (its side flipped, its
        // colour map kept) into a render target: one stand-in per kind of caster, compiled the
        // same way (and without fog: three draws the shadow pass with an empty scene)
        const kinds = new Map();
        scene.traverse((o) => {
            if (!o.isMesh || !o.castShadow) return;
            for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
                const side = m.shadowSide ?? SHADOW_SIDE[m.side];
                const key = [o.isSkinnedMesh, o.isInstancedMesh, !!(o.isInstancedMesh && o.instanceColor), !!m.map, side, m.alphaTest > 0].join();
                if (kinds.has(key)) continue;
                const d = new T.MeshDepthMaterial({ side, map: m.map, alphaMap: m.alphaMap, alphaTest: m.alphaTest });
                let p;
                if (o.isSkinnedMesh) { p = new T.SkinnedMesh(o.geometry, d); p.bind(o.skeleton, o.bindMatrix); }
                else if (o.isInstancedMesh) { p = new T.InstancedMesh(o.geometry, d, 1); if (o.instanceColor) p.setColorAt(0, new T.Color(1, 1, 1)); }
                else p = new T.Mesh(o.geometry, d);
                kinds.set(key, p);
            }
        });
        const stand = new T.Group();
        for (const p of kinds.values()) stand.add(p);
        const rt = new T.WebGLRenderTarget(1, 1);
        const prev = renderer.getRenderTarget(), fog = scene.fog;
        let ready = null;
        renderer.setRenderTarget(rt);
        scene.fog = null;
        try { ready = renderer.compileAsync(stand, camera, scene); } catch (e) { /* compiles on first use */ }
        scene.fog = fog;
        renderer.setRenderTarget(prev);
        if (ready) { try { await ready; } catch (e) { /* compiles on first use */ } }
        rt.dispose();
        warmKeep.push(stand);
        // put the lights back the way the next frame draws them
        try { renderer.compile(new T.Group(), camera, scene); } catch (e) { /* next frame */ }
    }
    for (const o of vis) o.visible = false;
    const texs = new Set();
    scene.traverse((o) => {
        const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        for (const m of ms) {
            for (const k of ['map', 'normalMap', 'emissiveMap', 'alphaMap']) if (m[k]) texs.add(m[k]);
            if (m.uniforms) for (const k in m.uniforms) { const v = m.uniforms[k] && m.uniforms[k].value; if (v && v.isTexture) texs.add(v); }
        }
    });
    let n = 0;
    for (const t of texs) {
        renderer.initTexture(t);
        if (++n % 16 === 0) await pause();
    }
    // Wait until the GPU has the uploads done, polling between tasks instead of blocking
    const gl = renderer.getContext();
    if (gl.fenceSync) {
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        const t0 = performance.now();
        while (gl.clientWaitSync(sync, 0, 0) === gl.TIMEOUT_EXPIRED && performance.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 15));
        gl.deleteSync(sync);
    }
    cullZones(-1);
}
export { textCanvas };
