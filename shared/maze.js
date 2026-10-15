// The Maze Obby layout as plain data, shared by the client (which builds meshes and colliders from
// it) and the server (which checks checkpoints, gems and the finish against it).
//
// The lobby sits around the origin; the twelve mazes follow it northward (+z) in a straight line,
// each centred on x = 0, with a checkpoint plaza between two mazes and the finish platform after the
// last one. A maze is a grid of 12-stud cells carved by a seeded depth-first search (the same maze
// for everyone, every time), with a few extra openings so there is more than one way through.
// The entrance is in the middle of its south wall, the exit in the middle of its north wall.
//
// Coordinates are studs; every floor is at y = 0.
import { STAGES, LOBBY, rngFrom } from './config.js';

export const CELL = 12, WALL = 2, WALL_H = 16;
export const PLAZA = 30, PLAZA_W = 44;        // the checkpoint plaza between two mazes
export const FINISH_D = 64, FINISH_W = 76;    // the finish platform after the last maze

export const MAZES = [];        // { i, cols, rows, W, D, x0, x1, z0, z1, mid, h, v, walls, deadEnds, gems }
export const PLAZAS = [];       // { i, x0, x1, z0, z1 }: the plaza after maze i
export const CHECKPOINTS = [];  // { i, x, y, z, yaw }: the pad on plaza i (reaching it clears maze i)
export const COINS = [];        // gems in dead ends, +1 Win each: { i, x, y, z, zone }

function carve(m, rnd, loops) {
    const { cols, rows } = m;
    // h[r][c]: a wall on the south edge of cell (c, r); row `rows` is the north boundary
    // v[r][c]: a wall on the west edge of cell (c, r); column `cols` is the east boundary
    const h = Array.from({ length: rows + 1 }, () => new Array(cols).fill(true));
    const v = Array.from({ length: rows }, () => new Array(cols + 1).fill(true));
    const seen = new Uint8Array(cols * rows);
    const stack = [[m.mid, 0]];
    seen[m.mid] = 1;
    while (stack.length) {
        const [c, r] = stack[stack.length - 1];
        const nb = [];
        if (r > 0 && !seen[(r - 1) * cols + c]) nb.push([c, r - 1, 0]);
        if (r < rows - 1 && !seen[(r + 1) * cols + c]) nb.push([c, r + 1, 1]);
        if (c > 0 && !seen[r * cols + c - 1]) nb.push([c - 1, r, 2]);
        if (c < cols - 1 && !seen[r * cols + c + 1]) nb.push([c + 1, r, 3]);
        if (!nb.length) { stack.pop(); continue; }
        const [nc, nr, d] = nb[Math.floor(rnd() * nb.length)];
        if (d === 0) h[r][c] = false; else if (d === 1) h[r + 1][c] = false; else if (d === 2) v[r][c] = false; else v[r][c + 1] = false;
        seen[nr * cols + nc] = 1;
        stack.push([nc, nr]);
    }
    // a few extra openings: loops, so a wrong turn isn't always a long walk back
    for (let k = 0, tries = 0; k < loops && tries < 400; tries++) {
        if (rnd() < 0.5) {
            const r = 1 + Math.floor(rnd() * (rows - 1)), c = Math.floor(rnd() * cols);
            if (h[r][c]) { h[r][c] = false; k++; }
        } else {
            const r = Math.floor(rnd() * rows), c = 1 + Math.floor(rnd() * (cols - 1));
            if (v[r][c]) { v[r][c] = false; k++; }
        }
    }
    h[0][m.mid] = false;          // the entrance
    h[rows][m.mid] = false;       // the exit
    m.h = h; m.v = v;
}

// Wall boxes: straight runs of wall merged into one box each (far fewer colliders and faces).
// Horizontal runs reach half a wall past their ends to cover the corner posts; vertical runs stop
// at a horizontal wall, or reach past the corner when nothing else covers it.
function wallRuns(m) {
    const { cols, rows, h, v, x0, z0 } = m, hw = WALL / 2;
    const out = [];
    for (let r = 0; r <= rows; r++) {
        for (let c = 0; c < cols;) {
            if (!h[r][c]) { c++; continue; }
            let e = c;
            while (e + 1 < cols && h[r][e + 1]) e++;
            const z = z0 + r * CELL;
            out.push({ x0: x0 + c * CELL - hw, x1: x0 + (e + 1) * CELL + hw, z0: z - hw, z1: z + hw, outer: r === 0 || r === rows, k: out.length });
            c = e + 1;
        }
    }
    const touched = (c, r) => (r >= 0 && r <= rows) && ((c > 0 && h[r][c - 1]) || (c < cols && h[r][c]));
    for (let c = 0; c <= cols; c++) {
        for (let r = 0; r < rows;) {
            if (!v[r][c]) { r++; continue; }
            let e = r;
            while (e + 1 < rows && v[e + 1][c]) e++;
            const x = x0 + c * CELL;
            const za = z0 + r * CELL + (touched(c, r) ? hw : -hw), zb = z0 + (e + 1) * CELL - (touched(c, e + 1) ? hw : -hw);
            out.push({ x0: x - hw, x1: x + hw, z0: za, z1: zb, outer: c === 0 || c === cols, k: out.length });
            r = e + 1;
        }
    }
    return out;
}

// Cells with three walls (not the entrance or exit cell): where the gems hide
function deadEnds(m) {
    const out = [];
    for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) {
        if (c === m.mid && (r === 0 || r === m.rows - 1)) continue;
        const n = (m.h[r][c] ? 1 : 0) + (m.h[r + 1][c] ? 1 : 0) + (m.v[r][c] ? 1 : 0) + (m.v[r][c + 1] ? 1 : 0);
        if (n === 3) out.push([c, r]);
    }
    return out;
}
export const cellCenter = (m, c, r) => ({ x: m.x0 + (c + 0.5) * CELL, z: m.z0 + (r + 0.5) * CELL });

// The way through a maze, cell by cell from the entrance to the exit (breadth-first)
export function solve(m) {
    const { cols, rows } = m, prev = new Int32Array(cols * rows).fill(-1);
    const start = m.mid, goal = (rows - 1) * cols + m.mid;
    const q = [start];
    prev[start] = start;
    while (q.length) {
        const k = q.shift();
        if (k === goal) break;
        const c = k % cols, r = (k - c) / cols;
        const go = (nc, nr, open) => { const n = nr * cols + nc; if (open && prev[n] < 0) { prev[n] = k; q.push(n); } };
        if (r > 0) go(c, r - 1, !m.h[r][c]);
        if (r < rows - 1) go(c, r + 1, !m.h[r + 1][c]);
        if (c > 0) go(c - 1, r, !m.v[r][c]);
        if (c < cols - 1) go(c + 1, r, !m.v[r][c + 1]);
    }
    const path = [];
    for (let k = goal; ; k = prev[k]) { path.unshift([k % cols, Math.floor(k / cols)]); if (k === start || prev[k] < 0) break; }
    return path;
}

// Kill bricks: glowing strips across the corridor on straight stretches of the way through, spread
// out evenly. A strip is KILL_LEN long along the way (a running jump clears it easily: a jump
// covers about 9 studs) and touching it sends you back to your checkpoint.
export const KILL_LEN = 3.2;
export const KILLS = [];          // { i, zone, x, z, sx, sz, c, r }
function killBricks(m, n) {
    if (!n) return [];
    const path = solve(m), out = [];
    const straight = (k) => {
        const [a, b, c] = [path[k - 1], path[k], path[k + 1]];
        return (a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1]);
    };
    const gap = Math.max(4, Math.floor((path.length - 6) / n));
    let last = -99;
    for (let k = 3; k < path.length - 3 && out.length < n; k++) {
        if (k - last < gap || !straight(k)) continue;
        const [c, r] = path[k], along = path[k - 1][0] === c ? 'z' : 'x';
        const p = cellCenter(m, c, r), across = CELL - WALL - 0.4;
        const kb = { i: KILLS.length, zone: m.i, x: p.x, z: p.z, sx: along === 'z' ? across : KILL_LEN, sz: along === 'z' ? KILL_LEN : across, c, r };
        KILLS.push(kb); out.push(kb);
        last = k;
    }
    return out;
}

let z = LOBBY.north;
STAGES.forEach((s, i) => {
    const W = s.cols * CELL, D = s.rows * CELL;
    const m = { i, cols: s.cols, rows: s.rows, W, D, x0: -W / 2, x1: W / 2, z0: z, z1: z + D, mid: (s.cols - 1) / 2 };
    // Every maze is longer to walk than the one before: out of many seeds, take the one whose way
    // through is closest to this stage's target length (in cells). Only the first mazes get extra
    // openings (loops); later a wrong turn means a long walk back.
    const target = 12 + i * 6.5, loops = i < 3 ? 2 : i < 6 ? 1 : 0;
    let best = 0, bestErr = Infinity;
    for (let k = 0; k < 96; k++) {
        carve(m, rngFrom(9100 + i * 7919 + k * 104729), loops);
        const err = Math.abs(solve(m).length - target);
        if (err < bestErr) { bestErr = err; best = k; }
    }
    const rnd = rngFrom(9100 + i * 7919 + best * 104729);
    carve(m, rnd, loops);
    m.walls = wallRuns(m);
    m.deadEnds = deadEnds(m);
    m.kills = killBricks(m, s.kill);
    // gems in some of the dead ends (a seeded shuffle, the farthest from the entrance first)
    const de = m.deadEnds.map(([c, r]) => ({ c, r, k: rnd() + r / m.rows }));
    de.sort((a, b) => b.k - a.k);
    m.gems = de.slice(0, s.gems).map(({ c, r }) => {
        const p = cellCenter(m, c, r);
        const g = { i: COINS.length, x: p.x, y: 3, z: p.z, zone: i };
        COINS.push(g);
        return g;
    });
    MAZES.push(m);
    z += D;
    if (i < STAGES.length - 1) {
        PLAZAS.push({ i, x0: -PLAZA_W / 2, x1: PLAZA_W / 2, z0: z, z1: z + PLAZA });
        CHECKPOINTS.push({ i, x: 0, y: 0, z: z + PLAZA / 2, yaw: 0 });
        z += PLAZA;
    }
});
// The finish: escape the last maze onto this platform and step on the WIN pad
export const FINISH = { x0: -FINISH_W / 2, x1: FINISH_W / 2, z0: z, z1: z + FINISH_D, x: 0, y: 0, z: z + FINISH_D * 0.5, pad: 6 };
export const WORLD_END = FINISH.z1;

// Which zone a position is in: -1 the lobby, i the maze i (with the plaza after it); the finish
// belongs to the last maze
export function stageAt(x, y, z) {
    if (z < MAZES[0].z0) return -1;
    for (let i = 1; i < MAZES.length; i++) if (z < MAZES[i].z0) return i - 1;
    return MAZES.length - 1;
}
export function mazeAt(x, z) {
    for (const m of MAZES) if (z >= m.z0 && z <= m.z1 && x >= m.x0 && x <= m.x1) return m;
    return null;
}
// The middle of the nearest maze cell (somewhere to stand that isn't on top of a wall)
export function nearestCell(x, z) {
    const m = mazeAt(x, z);
    if (!m) return null;
    const c = Math.max(0, Math.min(m.cols - 1, Math.floor((x - m.x0) / CELL)));
    const r = Math.max(0, Math.min(m.rows - 1, Math.floor((z - m.z0) / CELL)));
    return cellCenter(m, c, r);
}
export function checkpointSpot(i) { return i >= 0 ? CHECKPOINTS[i] || null : null; }
// Where the run clock starts: stepping into the first maze
export const RUN_START_Z = MAZES[0].z0 + 2;
// The lobby's treasure chest (free Wins every few minutes)
export const CHEST = { x: -46, y: 0, z: 36 };
