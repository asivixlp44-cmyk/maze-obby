// Textures and materials, all drawn in code at load (no image files) and all matte (Lambert) or
// unlit (Basic): the twelve maze themes (sand over water, hedges, yellow bricks, rainbow plastic,
// grass, dark hedges on wood, Roblox studs, backrooms wallpaper and carpet, cracked ice, glowing
// lava, candy canes on chocolate, neon), the checkered lobby, glass fences, the checkpoint pads.
// Each is made once and shared. Glows are painted into emissive maps: no bloom, no reflections.
import { T, texFrom, matte, NEON_BOOST, studVCMaterial } from './engine.js';

const cache = new Map();
const once = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h || w; return c; };
function seeded(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
const wrap = (t) => { t.wrapS = t.wrapT = T.RepeatWrapping; return t; };
const pick = (rnd, a) => a[Math.floor(rnd() * a.length) % a.length];
// Draws fn at (x, y) and at its wrapped copies near the edges, so the texture tiles seamlessly
function wrapped(W, H, x, y, r, fn) {
    for (const ox of [-W, 0, W]) for (const oy of [-H, 0, H]) {
        const px = x + ox, py = y + oy;
        if (px + r < 0 || px - r > W || py + r < 0 || py - r > H) continue;
        fn(px, py);
    }
}
function fillNoise(x, W, H, rnd, n, colors, size, alpha) {
    for (let i = 0; i < n; i++) {
        const px = rnd() * W, py = rnd() * H, s = size * (0.5 + rnd());
        x.globalAlpha = alpha ?? 1;
        x.fillStyle = pick(rnd, colors);
        wrapped(W, H, px, py, s, (a, b) => x.fillRect(a, b, s, s));
    }
    x.globalAlpha = 1;
}
// Short strokes (straw, grass blades, carpet fibres)
function strokes(x, W, H, rnd, n, colors, len, width, angle, spread) {
    x.lineCap = 'round';
    for (let i = 0; i < n; i++) {
        const px = rnd() * W, py = rnd() * H, l = len * (0.5 + rnd()), a = angle + (rnd() - 0.5) * spread;
        x.strokeStyle = pick(rnd, colors); x.lineWidth = width * (0.6 + rnd() * 0.8);
        wrapped(W, H, px, py, l, (u, v) => { x.beginPath(); x.moveTo(u, v); x.lineTo(u + Math.cos(a) * l, v + Math.sin(a) * l); x.stroke(); });
    }
}
// Cell edges of a wrapped Voronoi pattern (water caustics, lava veins): 0 in the cells, 1 on the edges
function voronoiEdges(N, pts, width) {
    const out = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        let d1 = 1e9, d2 = 1e9;
        for (const [px, py] of pts) {
            let dx = Math.abs(x - px), dy = Math.abs(y - py);
            if (dx > N / 2) dx = N - dx;
            if (dy > N / 2) dy = N - dy;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
        }
        out[y * N + x] = Math.max(0, 1 - (d2 - d1) / width);
    }
    return out;
}
function imageFrom(N, fn) {
    const c = canvas(N), x = c.getContext('2d'), img = x.createImageData(N, N);
    for (let i = 0; i < N * N; i++) { const [r, g, b] = fn(i); img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255; }
    x.putImageData(img, 0, 0);
    return c;
}
const tex = (c) => wrap(texFrom(c));
const lerp = (a, b, k) => a + (b - a) * k;

// =====================================================================================
// The maze themes. Each texture tile covers 8 x 8 studs (walls are 16 high: two tiles).
// =====================================================================================
// 1. Sandy Shores: golden straw-like sand walls, clear blue water underfoot
const sandWallTex = () => once('sandwall', () => {
    const N = 256, c = canvas(N), x = c.getContext('2d'), rnd = seeded(3);
    x.fillStyle = '#c4952e'; x.fillRect(0, 0, N, N);
    fillNoise(x, N, N, rnd, 900, ['#a87a1c', '#d8aa40', '#b88a28'], 5, 0.6);
    strokes(x, N, N, rnd, 2600, ['#f0cc62', '#e0b44a', '#9a6a14', '#ffe08a', '#b8862a', '#d4a03a'], 7, 1.6, 0, Math.PI * 2);
    return tex(c);
});
// Two layers of soft caustic lines over a rippling blue, so the cells don't read as tiles
export const waterTex = () => once('water', () => {
    const N = 256, rnd = seeded(41);
    const a = voronoiEdges(N, Array.from({ length: 26 }, () => [rnd() * N, rnd() * N]), 6);
    const b = voronoiEdges(N, Array.from({ length: 11 }, () => [rnd() * N, rnd() * N]), 10);
    const TAU = Math.PI * 2;
    return tex(imageFrom(N, (i) => {
        const x = i % N, y = Math.floor(i / N);
        const w = 0.5 + 0.25 * Math.sin((x + y) / N * TAU * 2) + 0.25 * Math.sin((x - 2 * y) / N * TAU * 3);
        const k = Math.min(1, a[i] ** 2.2 * 0.75 + b[i] ** 2 * 0.45);
        return [lerp(22 + w * 18, 170, k), lerp(112 + w * 30, 232, k), lerp(206 + w * 20, 255, k)];
    }));
});
// 2. Hedge Garden: leafy hedges, dark asphalt path
function leaves(seed, base, cols, dark) {
    const N = 256, c = canvas(N), x = c.getContext('2d'), rnd = seeded(seed);
    x.fillStyle = base; x.fillRect(0, 0, N, N);
    fillNoise(x, N, N, rnd, 500, [dark], 6, 0.5);
    for (let i = 0; i < 2200; i++) {
        const px = rnd() * N, py = rnd() * N, rx = 2.5 + rnd() * 3.5, ry = 1.2 + rnd() * 1.8, a = rnd() * Math.PI;
        x.fillStyle = pick(rnd, cols);
        wrapped(N, N, px, py, rx, (u, v) => { x.beginPath(); x.ellipse(u, v, rx, ry, a, 0, Math.PI * 2); x.fill(); });
    }
    fillNoise(x, N, N, rnd, 260, [dark], 3, 0.55);
    return tex(c);
}
const hedgeWallTex = () => once('hedge', () => leaves(7, '#2f8a30', ['#3aa83a', '#2a7a2a', '#4ac848', '#22702a', '#5ad85a', '#368f34'], '#174a1a'));
const asphaltTex = () => once('asphalt', () => {
    const N = 256, c = canvas(N), x = c.getContext('2d'), rnd = seeded(13);
    x.fillStyle = '#4c5156'; x.fillRect(0, 0, N, N);
    fillNoise(x, N, N, rnd, 3200, ['#3e4247', '#5a5f65', '#464b50', '#686d73'], 2, 0.9);
    return tex(c);
});
// 3. Yellow Bricks on red dirt
function bricks(seed, base, mortar, light, dark, W, H, jitter) {
    const N = 256, c = canvas(N), x = c.getContext('2d'), rnd = seeded(seed);
    x.fillStyle = mortar; x.fillRect(0, 0, N, N);
    for (let row = 0; row < N / H; row++) {
        const off = row % 2 ? W / 2 : 0;
        for (let col = -1; col < N / W + 1; col++) {
            const bx = col * W + off + 2, by = row * H + 2, bw = W - 4, bh = H - 4;
            const v = (rnd() - 0.5) * jitter;
            x.fillStyle = base; x.globalAlpha = 1; x.fillRect(bx, by, bw, bh);
            x.fillStyle = v > 0 ? light : dark; x.globalAlpha = Math.abs(v); x.fillRect(bx, by, bw, bh);
            x.globalAlpha = 0.45; x.fillStyle = light; x.fillRect(bx, by, bw, 3);
            x.fillStyle = dark; x.fillRect(bx, by + bh - 3, bw, 3);
            x.globalAlpha = 1;
        }
    }
    fillNoise(x, N, N, rnd, 1400, [light, dark], 2, 0.25);
    return c;
}
const brickWallTex = () => once('brick', () => tex(bricks(5, '#f0d828', '#a89418', '#fff27a', '#b89c10', 64, 32, 0.5)));
const dirtTex = () => once('dirt', () => {
    const N = 256, c = canvas(N), x = c.getContext('2d'), rnd = seeded(17);
    x.fillStyle = '#a4523a'; x.fillRect(0, 0, N, N);
    fillNoise(x, N, N, rnd, 2600, ['#8a4030', '#c06a48', '#6a3020', '#b45a40', '#d07a58'], 3, 0.8);
    for (let i = 0; i < 70; i++) {
        const px = rnd() * N, py = rnd() * N, r = 2 + rnd() * 3;
        x.fillStyle = pick(rnd, ['#7a3a28', '#c8805a']);
        wrapped(N, N, px, py, r, (u, v) => { x.beginPath(); x.ellipse(u, v, r, r * 0.7, rnd() * 3, 0, Math.PI * 2); x.fill(); });
    }
    return tex(c);
});
// 4. Rainbow Blocks: smooth plastic in every colour (the colour is in the vertices), a purple floor
const plasticTex = () => once('plastic', () => {
    const N = 128, c = canvas(N), x = c.getContext('2d'), rnd = seeded(23);
    x.fillStyle = '#f4f4f4'; x.fillRect(0, 0, N, N);
    fillNoise(x, N, N, rnd, 900, ['#ffffff', '#e4e4e4'], 2, 0.5);
    return tex(c);
});
const purpleTex = () => once('purple', () => {
    const N = 256, c = canvas(N), x = c.getContext('2d'), rnd = seeded(29);
    x.fillStyle = '#8c3cb4'; x.fillRect(0, 0, N, N);
    fillNoise(x, N, N, rnd, 1400, ['#9a48c4', '#7e32a4'], 3, 0.5);
    x.fillStyle = 'rgba(255,255,255,0.08)'; x.fillRect(0, 0, N, 2); x.fillRect(0, 0, 2, N);
    return tex(c);
});
// 5. Grass Labyrinth: bright grass walls and floor
function grass(seed, base, cols, angle, spread) {
    const N = 256, c = canvas(N), x = c.getContext('2d'), rnd = seeded(seed);
    x.fillStyle = base; x.fillRect(0, 0, N, N);
    strokes(x, N, N, rnd, 3600, cols, 7, 1.7, angle, spread);
    return tex(c);
}
const grassWallTex = () => once('grasswall', () => grass(31, '#3ab82a', ['#5ae83a', '#2a9a20', '#7aff4a', '#48d030', '#228a1a', '#64f048'], -Math.PI / 2, 1.2));
const grassFloorTex = () => once('grassfloor', () => grass(37, '#6ad448', ['#88f064', '#58c03a', '#9aff74', '#4aae30', '#7ae458'], 0, Math.PI * 2));
// 6. Dark Hedges on old wooden boards
const darkHedgeTex = () => once('darkhedge', () => leaves(43, '#1f5a2a', ['#2a7038', '#1a4a24', '#348040', '#235f30', '#3e8a46'], '#0e3016'));
const woodTex = () => once('wood', () => {
    const N = 256, c = canvas(N), x = c.getContext('2d'), rnd = seeded(47);
    const PH = 32;
    for (let row = 0; row < N / PH; row++) {
        const y = row * PH, base = pick(rnd, ['#7a5434', '#8a6040', '#6c4a2c', '#82593a']);
        x.fillStyle = base; x.fillRect(0, y, N, PH);
        // grain
        for (let k = 0; k < 9; k++) {
            x.strokeStyle = pick(rnd, ['rgba(60,36,18,0.35)', 'rgba(160,120,80,0.25)']); x.lineWidth = 1 + rnd();
            x.beginPath(); const gy = y + 3 + rnd() * (PH - 6); x.moveTo(0, gy);
            for (let px = 0; px <= N; px += 32) x.lineTo(px, gy + Math.sin(px * 0.05 + k) * 1.5);
            x.stroke();
        }
        // plank joints and the gap between rows
        x.fillStyle = 'rgba(30,18,8,0.7)'; x.fillRect(0, y, N, 2);
        const j = rnd() * N; x.fillRect(j, y, 2, PH); x.fillRect((j + N / 2) % N, y, 2, PH);
        x.fillStyle = 'rgba(255,220,180,0.12)'; x.fillRect(0, y + 2, N, 2);
    }
    return tex(c);
});
// 8. The Backrooms: yellow damask wallpaper and a brown carpet
const wallpaperTex = () => once('wallpaper', () => {
    const N = 256, c = canvas(N), x = c.getContext('2d'), rnd = seeded(53);
    x.fillStyle = '#d6c264'; x.fillRect(0, 0, N, N);
    fillNoise(x, N, N, rnd, 1200, ['#c8b456', '#e0cc70'], 3, 0.5);
    // a damask motif twice per tile, offset rows
    const motif = (cx, cy) => {
        x.save(); x.translate(cx, cy);
        x.strokeStyle = 'rgba(150,120,40,0.55)'; x.fillStyle = 'rgba(240,222,140,0.55)'; x.lineWidth = 3;
        x.beginPath(); x.moveTo(0, -40); x.bezierCurveTo(26, -24, 26, 10, 0, 40); x.bezierCurveTo(-26, 10, -26, -24, 0, -40); x.fill(); x.stroke();
        x.beginPath(); x.ellipse(0, 0, 9, 16, 0, 0, Math.PI * 2); x.stroke();
        for (const s of [-1, 1]) { x.beginPath(); x.moveTo(0, 18); x.quadraticCurveTo(s * 34, 30, s * 30, 52); x.stroke(); x.beginPath(); x.moveTo(0, -18); x.quadraticCurveTo(s * 34, -30, s * 30, -52); x.stroke(); }
        x.restore();
    };
    for (const [cx, cy] of [[64, 64], [192, 64], [0, 192], [128, 192], [256, 192]]) motif(cx, cy);
    x.fillStyle = 'rgba(120,96,30,0.12)';
    for (let k = 0; k < N; k += 16) x.fillRect(k, 0, 2, N);
    return tex(c);
});
const carpetFloorTex = () => once('carpetfloor', () => {
    const N = 256, c = canvas(N), x = c.getContext('2d'), rnd = seeded(59);
    x.fillStyle = '#86683a'; x.fillRect(0, 0, N, N);
    strokes(x, N, N, rnd, 5200, ['#765a30', '#9a7a48', '#6a4e28', '#8e7040', '#a88850'], 3, 1.2, 0, Math.PI * 2);
    // a few damp spots, like the real thing
    for (let i = 0; i < 4; i++) {
        const px = rnd() * N, py = rnd() * N, r = 18 + rnd() * 26;
        wrapped(N, N, px, py, r, (u, v) => { const g = x.createRadialGradient(u, v, 0, u, v, r); g.addColorStop(0, 'rgba(70,50,20,0.35)'); g.addColorStop(1, 'rgba(70,50,20,0)'); x.fillStyle = g; x.fillRect(u - r, v - r, r * 2, r * 2); });
    }
    return tex(c);
});
// 9. Frozen Caves: white cracked ice walls, a slippery cyan floor
function cracks(x, N, rnd, n, color, width) {
    x.strokeStyle = color; x.lineWidth = width; x.lineJoin = 'round';
    for (let i = 0; i < n; i++) {
        let px = rnd() * N, py = rnd() * N, a = rnd() * Math.PI * 2;
        const pts = [[px, py]];
        for (let k = 0; k < 6 + rnd() * 8; k++) { a += (rnd() - 0.5) * 1.3; px += Math.cos(a) * 9; py += Math.sin(a) * 9; pts.push([px, py]); }
        for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) { x.beginPath(); pts.forEach(([u, v], j) => (j ? x.lineTo(u + ox, v + oy) : x.moveTo(u + ox, v + oy))); x.stroke(); }
    }
}
const iceWallTex = () => once('icewall', () => {
    const N = 256, c = canvas(N), x = c.getContext('2d'), rnd = seeded(61);
    const g = x.createLinearGradient(0, 0, N, N); g.addColorStop(0, '#f4faff'); g.addColorStop(0.5, '#dceefc'); g.addColorStop(1, '#f0f8ff');
    x.fillStyle = g; x.fillRect(0, 0, N, N);
    for (let i = 0; i < 18; i++) {
        const px = rnd() * N, py = rnd() * N, r = 20 + rnd() * 40;
        wrapped(N, N, px, py, r, (u, v) => { const gg = x.createRadialGradient(u, v, 0, u, v, r); gg.addColorStop(0, 'rgba(170,205,240,0.35)'); gg.addColorStop(1, 'rgba(170,205,240,0)'); x.fillStyle = gg; x.fillRect(u - r, v - r, r * 2, r * 2); });
    }
    cracks(x, N, rnd, 10, 'rgba(110,150,200,0.75)', 1.6);
    cracks(x, N, rnd, 6, 'rgba(255,255,255,0.9)', 1.2);
    return tex(c);
});
const iceFloorTex = () => once('icefloor', () => {
    const N = 256, c = canvas(N), x = c.getContext('2d'), rnd = seeded(67);
    x.fillStyle = '#62c4ee'; x.fillRect(0, 0, N, N);
    for (let i = 0; i < 26; i++) {
        const px = rnd() * N, py = rnd() * N, r = 16 + rnd() * 36;
        wrapped(N, N, px, py, r, (u, v) => { const gg = x.createRadialGradient(u, v, 0, u, v, r); gg.addColorStop(0, 'rgba(200,244,255,0.6)'); gg.addColorStop(1, 'rgba(200,244,255,0)'); x.fillStyle = gg; x.fillRect(u - r, v - r, r * 2, r * 2); });
    }
    cracks(x, N, rnd, 7, 'rgba(255,255,255,0.7)', 1.4);
    return tex(c);
});
// 10. Lava Castle: obsidian bricks with glowing mortar, basalt veined with lava
const lavaWallTex = () => once('lavawall', () => tex(bricks(71, '#2c2228', '#140c0c', '#463a42', '#1a1216', 64, 32, 0.6)));
const lavaWallGlow = () => once('lavawallglow', () => {
    const N = 256, c = canvas(N), x = c.getContext('2d'), rnd = seeded(73);
    x.fillStyle = '#000'; x.fillRect(0, 0, N, N);
    // the mortar glows
    x.fillStyle = '#ff5a10';
    for (let row = 0; row <= N / 32; row++) {
        x.globalAlpha = 0.85; x.fillRect(0, row * 32 - 2, N, 4);
        const off = row % 2 ? 32 : 0;
        for (let col = 0; col <= N / 64; col++) x.fillRect(col * 64 + off - 2, row * 32, 4, 32);
    }
    x.globalAlpha = 1;
    cracks(x, N, rnd, 8, '#ffb02a', 1.6);
    return tex(c);
});
const lavaFloorTex = () => once('lavafloor', () => {
    const N = 256, rnd = seeded(79), pts = Array.from({ length: 16 }, () => [rnd() * N, rnd() * N]);
    const e = voronoiEdges(N, pts, 7);
    return tex(imageFrom(N, (i) => { const k = e[i]; const n = ((i * 2654435761) >>> 0) % 7; return [lerp(52 + n, 255, k), lerp(38 + n, 120, k * k), lerp(38 + n, 20, k)]; }));
});
const lavaFloorGlow = () => once('lavafloorglow', () => {
    const N = 256, rnd = seeded(79), pts = Array.from({ length: 16 }, () => [rnd() * N, rnd() * N]);
    const e = voronoiEdges(N, pts, 7);
    return tex(imageFrom(N, (i) => { const k = e[i] ** 1.3; return [255 * k, 110 * k * k, 10 * k]; }));
});
// 11. Candy Land: candy-cane stripes, chocolate squares
const candyWallTex = () => once('candywall', () => {
    const N = 256, c = canvas(N), x = c.getContext('2d');
    x.fillStyle = '#fff6fa'; x.fillRect(0, 0, N, N);
    x.save(); x.translate(N / 2, N / 2); x.rotate(-Math.PI / 4);
    const S = N / Math.SQRT2 / 2;
    for (let k = -8; k < 8; k++) { x.fillStyle = k % 2 ? '#ff3f86' : '#ff9ac4'; x.fillRect(k * S, -N, S * 0.55, N * 2); }
    x.restore();
    // a glossy highlight painted along the top (there is no specular)
    const g = x.createLinearGradient(0, 0, 0, N); g.addColorStop(0, 'rgba(255,255,255,0.0)'); g.addColorStop(0.45, 'rgba(255,255,255,0.18)'); g.addColorStop(0.55, 'rgba(255,255,255,0.0)');
    x.fillStyle = g; x.fillRect(0, 0, N, N);
    return tex(c);
});
const chocolateTex = () => once('chocolate', () => {
    const N = 256, c = canvas(N), x = c.getContext('2d'), S = 64;
    x.fillStyle = '#3a1e12'; x.fillRect(0, 0, N, N);
    for (let r = 0; r < N / S; r++) for (let q = 0; q < N / S; q++) {
        const bx = q * S + 3, by = r * S + 3, s = S - 6;
        x.fillStyle = '#6a3a22'; x.fillRect(bx, by, s, s);
        x.fillStyle = '#86502e'; x.fillRect(bx, by, s, 5); x.fillRect(bx, by, 5, s);
        x.fillStyle = '#4a2616'; x.fillRect(bx, by + s - 5, s, 5); x.fillRect(bx + s - 5, by, 5, s);
        x.fillStyle = '#6e3e24'; x.fillRect(bx + 10, by + 10, s - 20, s - 20);
    }
    return tex(c);
});
// 12. Neon Galaxy: dark panels with glowing grid lines, a starry floor
function neonGrid(seed, glow, lineA, lineB, stars) {
    const N = 256, c = canvas(N), x = c.getContext('2d'), rnd = seeded(seed);
    x.fillStyle = glow ? '#000' : '#181438'; x.fillRect(0, 0, N, N);
    if (!glow) fillNoise(x, N, N, rnd, 600, ['#201a48', '#141030'], 4, 0.6);
    x.fillStyle = glow ? lineA : '#3a2a7a';
    x.fillRect(0, 0, N, 4); x.fillRect(0, 0, 4, N);
    x.fillStyle = glow ? lineB : '#2a2060';
    x.fillRect(0, N / 2 - 1, N, 2); x.fillRect(N / 2 - 1, 0, 2, N);
    if (stars) for (let i = 0; i < 60; i++) { x.fillStyle = glow ? pick(rnd, ['#ffffff', '#9ae8ff', '#ffb8ff']) : '#3a3470'; const s = 1 + rnd() * 2; x.fillRect(rnd() * N, rnd() * N, s, s); }
    return tex(c);
}

// The rock under every floating slab, and the lobby's checkered floor
const rockTex = () => once('rock', () => {
    const N = 256, c = canvas(N), x = c.getContext('2d'), rnd = seeded(83);
    x.fillStyle = '#7a6a5a'; x.fillRect(0, 0, N, N);
    fillNoise(x, N, N, rnd, 900, ['#6a5a4a', '#8a7a68', '#5a4c40', '#9a8a76'], 8, 0.7);
    x.fillStyle = '#5a9a3a'; x.fillRect(0, 0, N, 18);
    fillNoise(x, N, 22, rnd, 300, ['#4a8a2a', '#6ab04a'], 4, 0.9);
    return tex(c);
});
export const checkerTex = () => once('checker', () => {
    const N = 256, c = canvas(N), x = c.getContext('2d'), H = N / 2;
    for (const [i, j, col] of [[0, 0, '#f6f8fb'], [1, 1, '#f6f8fb'], [1, 0, '#cfd4dd'], [0, 1, '#cfd4dd']]) {
        x.fillStyle = col; x.fillRect(i * H, j * H, H, H);
        x.fillStyle = 'rgba(255,255,255,0.6)'; x.fillRect(i * H, j * H, H, 3); x.fillRect(i * H, j * H, 3, H);
        x.fillStyle = 'rgba(0,0,30,0.07)'; x.fillRect(i * H, j * H + H - 3, H, 3); x.fillRect(i * H + H - 3, j * H, 3, H);
    }
    return tex(c);
});
// Diamond-plate trim (the reference's cyan and magenta lobby areas)
export const diamondTex = (base, light, dark) => once('diamond|' + base, () => {
    const N = 128, c = canvas(N), x = c.getContext('2d');
    x.fillStyle = base; x.fillRect(0, 0, N, N);
    const d = (cx, cy, a) => { x.save(); x.translate(cx, cy); x.rotate(a); x.fillStyle = dark; x.fillRect(-11, -3.5, 22, 7); x.fillStyle = light; x.fillRect(-11, -3.5, 22, 3.5); x.restore(); };
    for (let r = 0; r < 4; r++) for (let q = 0; q < 4; q++) d(q * 32 + (r % 2) * 16 + 8, r * 32 + 16, (r + q) % 2 ? Math.PI / 4 : -Math.PI / 4);
    return tex(c);
});
// The plazas between the mazes: big white tiles
export const tileTex = () => once('tile', () => {
    const N = 128, c = canvas(N), x = c.getContext('2d');
    x.fillStyle = '#b8c0cc'; x.fillRect(0, 0, N, N);
    for (const [i, j] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        x.fillStyle = '#eef2f7'; x.fillRect(i * 64 + 2, j * 64 + 2, 60, 60);
        x.fillStyle = '#ffffff'; x.fillRect(i * 64 + 2, j * 64 + 2, 60, 4);
    }
    return tex(c);
});

const lambert = (o) => matte(o);
const glowLambert = (map, glow, color, k) => matte({ map, emissive: color || 0xffffff, emissiveMap: glow, emissiveIntensity: k ?? 1 });
// Every theme: wall and floor materials, an optional cap along the wall tops, the footstep sound,
// whether the floor is slippery, the ambient particles and the sky / light mood
export const THEMES = {
    sand: { wall: () => lambert({ map: sandWallTex() }), floor: () => lambert({ map: waterTex(), emissive: 0x0a3a6a, emissiveIntensity: 0.35 }), sound: 'water', water: true, amb: { color: 0xfff0b0, dir: 0.4 }, mood: 'day' },
    hedge: { wall: () => lambert({ map: hedgeWallTex() }), floor: () => lambert({ map: asphaltTex() }), sound: 'asphalt', amb: { color: 0xc8ff9a, dir: -0.3 }, mood: 'day' },
    brick: { wall: () => lambert({ map: brickWallTex() }), floor: () => lambert({ map: dirtTex() }), cap: 0xe8d8a8, sound: 'dirt', amb: { color: 0xfff0a0, dir: 0.4 }, mood: 'warm' },
    rainbow: { wall: () => lambert({ map: plasticTex(), vertexColors: true }), floor: () => lambert({ map: purpleTex() }), cap: 0xffffff, sound: 'plastic', rainbow: true, amb: { color: 0xffb8f0, dir: 0.6 }, mood: 'day' },
    grass: { wall: () => lambert({ map: grassWallTex() }), floor: () => lambert({ map: grassFloorTex() }), sound: 'grass', amb: { color: 0xd8ff9a, dir: 0.3 }, mood: 'day' },
    darkhedge: { wall: () => lambert({ map: darkHedgeTex() }), floor: () => lambert({ map: woodTex() }), sound: 'wood', amb: { color: 0xb8ffc8, dir: -0.2 }, mood: 'dusk' },
    studs: { wall: () => studVCMaterial(), floor: () => studVCMaterial(), wallColor: 0xa4a8b2, floorColor: 0x4ac64a, cap: 0xd8dce4, sound: 'stud', studs: true, amb: { color: 0xffffff, dir: 0.5 }, mood: 'day' },
    backrooms: { wall: () => lambert({ map: wallpaperTex() }), floor: () => lambert({ map: carpetFloorTex() }), cap: 0xf0ecd8, sound: 'carpet', amb: { color: 0xfff6c0, dir: 0.15 }, mood: 'backrooms' },
    ice: { wall: () => lambert({ map: iceWallTex(), emissive: 0x2a4a6a, emissiveIntensity: 0.25 }), floor: () => lambert({ map: iceFloorTex(), emissive: 0x1a5a8a, emissiveIntensity: 0.3 }), cap: 0xffffff, sound: 'ice', ice: true, amb: { color: 0xffffff, dir: -1, snow: true }, mood: 'cold' },
    lava: { wall: () => glowLambert(lavaWallTex(), lavaWallGlow(), 0xffffff, 1), floor: () => glowLambert(lavaFloorTex(), lavaFloorGlow(), 0xffffff, 1), capNeon: 0xff6a1a, sound: 'stone', amb: { color: 0xff8a2a, dir: 1.2 }, mood: 'lava' },
    candy: { wall: () => lambert({ map: candyWallTex(), emissive: 0x5a1030, emissiveIntensity: 0.15 }), floor: () => lambert({ map: chocolateTex() }), cap: 0xfff4f8, sound: 'candy', amb: { color: 0xff9ad8, dir: 0.5 }, mood: 'candy' },
    neon: { wall: () => glowLambert(neonGrid(89, false), neonGrid(89, true, '#2ae8ff', '#ff3ad8'), 0xffffff, 1), floor: () => glowLambert(neonGrid(97, false, 0, 0, true), neonGrid(97, true, '#9a5aff', '#4a2a9a', true), 0xffffff, 1), capNeon: 0x2ae8ff, sound: 'neon', amb: { color: 0xb88aff, dir: 0.4 }, mood: 'night' },
};
const themeMats = new Map();
export function themeMaterials(name) {
    if (!themeMats.has(name)) { const t = THEMES[name]; themeMats.set(name, { ...t, wallMat: t.wall(), floorMat: t.floor() }); }
    return themeMats.get(name);
}
export const rockMaterial = () => once('rockmat', () => matte({ map: rockTex() }));
export const checkerMaterial = () => once('checkermat', () => matte({ map: checkerTex() }));
export const diamondMaterial = (base, light, dark) => once('diamondmat|' + base, () => matte({ map: diamondTex(base, light, dark) }));
export const tileMaterial = () => once('tilemat', () => matte({ map: tileTex() }));

// The glass fence panels: a pale cyan diamond lattice you can see through
export const latticeTex = () => once('lattice', () => {
    const N = 128, c = canvas(N), x = c.getContext('2d');
    x.fillStyle = 'rgba(190,236,255,0.28)'; x.fillRect(0, 0, N, N);
    x.strokeStyle = 'rgba(255,255,255,0.95)'; x.lineWidth = 4;
    x.beginPath(); x.moveTo(0, 0); x.lineTo(N, N); x.moveTo(N, 0); x.lineTo(0, N); x.stroke();
    x.strokeStyle = 'rgba(120,210,255,0.9)'; x.lineWidth = 2;
    x.beginPath(); x.moveTo(0, 0); x.lineTo(N, N); x.moveTo(N, 0); x.lineTo(0, N); x.stroke();
    return tex(c);
});
export const latticeMaterial = () => once('latticemat', () => new T.MeshBasicMaterial({ map: latticeTex(), transparent: true, depthWrite: false, side: T.DoubleSide, toneMapped: false }));

// Floor decals: the big red arrows, the spawn star, the checkpoint pad
export const arrowTex = () => once('arrow', () => {
    const W = 256, H = 256, c = canvas(W, H), x = c.getContext('2d');
    const path = () => { x.beginPath(); x.moveTo(128, 10); x.lineTo(240, 128); x.lineTo(172, 128); x.lineTo(172, 246); x.lineTo(84, 246); x.lineTo(84, 128); x.lineTo(16, 128); x.closePath(); };
    path(); x.lineJoin = 'round'; x.lineWidth = 14; x.strokeStyle = '#3a0a0a'; x.stroke();
    const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#ff4a3a'); g.addColorStop(1, '#d8101a');
    path(); x.fillStyle = g; x.fill();
    x.fillStyle = 'rgba(255,255,255,0.25)'; x.beginPath(); x.moveTo(128, 30); x.lineTo(206, 114); x.lineTo(128, 96); x.lineTo(50, 114); x.closePath(); x.fill();
    return texFrom(c);
});
export const starPadTex = () => once('starpad', () => {
    const N = 512, c = canvas(N), x = c.getContext('2d');
    x.fillStyle = '#b8207e'; x.fillRect(0, 0, N, N);
    // diamond plate
    const d = (cx, cy, a) => { x.save(); x.translate(cx, cy); x.rotate(a); x.fillStyle = '#8a1660'; x.fillRect(-18, -5, 36, 10); x.fillStyle = '#d84aa0'; x.fillRect(-18, -5, 36, 5); x.restore(); };
    for (let r = 0; r < 12; r++) for (let q = 0; q < 12; q++) d(q * 44 + (r % 2) * 22 + 10, r * 44 + 20, (r + q) % 2 ? Math.PI / 4 : -Math.PI / 4);
    // the star outline
    x.save(); x.translate(N / 2, N / 2);
    x.beginPath();
    for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? 90 : 210; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    x.closePath(); x.lineJoin = 'round'; x.lineWidth = 26; x.strokeStyle = 'rgba(70,40,70,0.75)'; x.stroke();
    x.lineWidth = 10; x.strokeStyle = 'rgba(200,190,210,0.9)'; x.stroke();
    x.restore();
    const t = texFrom(c); return t;
});
export const cpPadTex = (on) => once('cp' + (on ? 1 : 0), () => {
    const N = 256, c = canvas(N), x = c.getContext('2d');
    x.fillStyle = on ? '#5aff6a' : '#ffe03a'; x.fillRect(0, 0, N, N);
    x.fillStyle = on ? '#28c83a' : '#f0b814'; x.fillRect(0, 0, N, 10); x.fillRect(0, N - 10, N, 10); x.fillRect(0, 0, 10, N); x.fillRect(N - 10, 0, 10, N);
    x.drawImage(arrowTex().image, 40, 30, 176, 196);
    return texFrom(c);
});
export const cpPadMaterial = (on) => once('cpmat' + (on ? 1 : 0), () => matte({ map: cpPadTex(on), emissive: on ? 0x1a6a2a : 0x8a6a00, emissiveIntensity: 0.25 }));
export const flagTex = (on) => once('flag' + (on ? 1 : 0), () => {
    const c = canvas(128, 80), x = c.getContext('2d');
    // a chequered racing flag, green once reached
    for (let r = 0; r < 5; r++) for (let q = 0; q < 8; q++) { x.fillStyle = (r + q) % 2 ? (on ? '#2ad84a' : '#ffffff') : (on ? '#0e6a22' : '#1a1a24'); x.fillRect(q * 16, r * 16, 16, 16); }
    return texFrom(c);
});
export const flagMaterial = (on) => once('flagmat' + (on ? 1 : 0), () => matte({ map: flagTex(on), side: T.DoubleSide, emissive: 0xffffff, emissiveMap: flagTex(on), emissiveIntensity: 0.2 }));

export const rainbowTex = () => once('rainbow', () => {
    const c = canvas(256, 16), x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 256, 0);
    ['#ff3c5a', '#ff9a2a', '#ffe83a', '#46ec50', '#28c8ff', '#6a5aff', '#d84aff', '#ff3c5a'].forEach((col, i, a) => g.addColorStop(i / (a.length - 1), col));
    x.fillStyle = g; x.fillRect(0, 0, 256, 16);
    return wrap(texFrom(c));
});
export const carpetTex = () => once('carpet', () => {
    const c = canvas(128, 256), x = c.getContext('2d');
    // the reference's magic carpet: rainbow stripes with a gold fringe
    const cols = ['#ff3c5a', '#ff9a2a', '#ffe83a', '#46ec50', '#28c8ff', '#8a5aff'];
    cols.forEach((col, i) => { x.fillStyle = col; x.fillRect(0, i * (256 / cols.length), 128, 256 / cols.length + 1); });
    x.strokeStyle = '#ffd028'; x.lineWidth = 8; x.strokeRect(5, 5, 118, 246);
    x.fillStyle = 'rgba(255,255,255,0.35)';
    for (let k = 0; k < 8; k++) { x.beginPath(); x.arc(64, 20 + k * 31, 6, 0, Math.PI * 2); x.fill(); }
    return texFrom(c);
});
// The lucky block's face: a yellow block with a big white question mark
export const luckyTex = () => once('lucky', () => {
    const N = 128, c = canvas(N), x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, N, N); g.addColorStop(0, '#ffe84a'); g.addColorStop(1, '#f0b414');
    x.fillStyle = g; x.fillRect(0, 0, N, N);
    x.fillStyle = '#c88a08'; x.fillRect(0, 0, N, 6); x.fillRect(0, N - 6, N, 6); x.fillRect(0, 0, 6, N); x.fillRect(N - 6, 0, 6, N);
    for (const [px, py] of [[16, 16], [N - 16, 16], [16, N - 16], [N - 16, N - 16]]) { x.fillStyle = '#a87000'; x.beginPath(); x.arc(px, py, 5, 0, Math.PI * 2); x.fill(); }
    x.font = '900 86px Fredoka, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = 10; x.strokeStyle = '#7a4a00'; x.strokeText('?', N / 2, N / 2 + 6);
    x.fillStyle = '#ffffff'; x.fillText('?', N / 2, N / 2 + 6);
    return texFrom(c);
});
export const luckyMaterial = () => once('luckymat', () => matte({ map: luckyTex(), emissive: 0x6a4a00, emissiveIntensity: 0.35 }));

// Kill bricks: glowing red with darker diagonal danger stripes (2 studs per tile)
export const killTex = () => once('kill', () => {
    const N = 64, c = canvas(N), x = c.getContext('2d');
    x.fillStyle = '#ff2a3a'; x.fillRect(0, 0, N, N);
    x.fillStyle = '#b8101e';
    for (let k = -2; k < 4; k++) { x.beginPath(); x.moveTo(k * 32, N); x.lineTo(k * 32 + 16, N); x.lineTo(k * 32 + 16 + N, 0); x.lineTo(k * 32 + N, 0); x.closePath(); x.fill(); }
    x.fillStyle = 'rgba(255,220,220,0.5)'; x.fillRect(0, 0, N, 3);
    return tex(c);
});

// Soft glow dot (pad glows, gems)
export const softTex = () => once('soft', () => {
    const c = canvas(64), x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return texFrom(c);
});
// Fluffy cloud puff for the sprites drifting around the mazes
export const cloudSpriteTex = () => once('cloudsprite', () => {
    const W = 256, H = 128, c = canvas(W, H), x = c.getContext('2d');
    const rnd = seeded(77);
    for (let i = 0; i < 16; i++) {
        const cx = 40 + rnd() * 176, cy = 54 + rnd() * 34, r = 22 + rnd() * 30;
        const g = x.createRadialGradient(cx, cy - r * 0.3, r * 0.1, cx, cy, r);
        g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.6, 'rgba(250,246,255,0.8)'); g.addColorStop(1, 'rgba(240,236,255,0)');
        x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
    }
    return texFrom(c);
});
// Win gems: faceted and glowing a little
export const gemMaterial = () => once('gemmat', () => matte({ color: 0x46ff8a, emissive: 0x16a84a, emissiveIntensity: 0.65, flatShading: true }));
export const goldMaterial = () => once('goldmat', () => matte({ color: 0xffc828, emissive: 0x8a5a00, emissiveIntensity: 0.45 }));

// Unlit glowing colour (neon trims, light panels), a little brighter than the colour itself
export const neon = (color, boost) => once('neon|' + color + '|' + (boost || 1.2), () => { const m = new T.MeshBasicMaterial({ color }); m.color.multiplyScalar(NEON_BOOST * (boost || 1.2) / 1.25); return m; });
