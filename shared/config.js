// Game data shared by the client and the Colyseus server.
// Maze Obby: twelve themed mazes in a row, floating in the sky. Find the exit of each maze to reach
// the next checkpoint; every checkpoint pays Wins and escaping the last maze pays a big pile, then
// the run starts again from the lobby ("rewards restart once you finish"). There are no in-app
// purchases: gear (coils, the Magic Carpet, the Ray Gun, the Deadly Sword), Fling All, Kill All,
// skips and trails all cost Wins.

export const CFG = {
    // Roblox defaults: jump power 50, gravity 196.2 (a jump rises about 6.4 studs)
    grav: 196.2,
    jumpV: 50,
    walk: 18,
    maxPlayers: 24,
    // Wins: each new checkpoint of a run pays its stage's Wins (STAGES[i].wins), escaping the last
    // maze pays finishWins, every gem in a dead end +1 (all times the Wins multiplier)
    finishWins: 150,
    pickupWins: 1,
    // A run must take at least this long for the finish to pay (a Magic Carpet flight over every
    // maze takes about 70 s; walking takes several minutes)
    minRunSecs: 60,
    boostMinutes: 15,
    // The treasure chest in the lobby: free Wins every chestMinutes
    chestWins: 25,
    chestMinutes: 30,
    // The lucky block (the "?" next to the stage bar): a free spin every luckyMinutes
    luckyMinutes: 10,
    // Friend Boost: +10% Wins per Bloxity friend in the same server, up to 5
    friendBoost: 0.1,
    friendMax: 5,
    // Gear
    speedCoil: 1.5,           // walk speed x
    gravityCoil: 0.5,         // gravity x (floaty jumps, still lower than the maze walls)
    superCoil: { walk: 1.4, grav: 0.58 },
    carpetSpeed: 28,
    carpetCeil: 34,           // how high the Magic Carpet flies (a little over the maze walls)
    rayRange: 90,
    rayCooldown: 1.6,
    rayForce: 78,
    swordRange: 10,
    swordCooldown: 1.1,
    flingCooldown: 30,
    killCooldown: 60,
    spawnShield: 3,           // seconds of the sparkly forcefield bubble after spawning
};

// ----- the lobby and the mazes (see maze.js for the layout) -----
// The lobby is a floating checkered platform; the first maze starts at its north edge.
export const LOBBY = { half: 70, south: -62, north: 60, spawn: { x: 0, y: 0, z: -40 }, yaw: 0 };

// Twelve mazes, each bigger and longer than the one before. bar: the stage's colour (progress bar,
// arches, trims); theme: the look (materials.js); cols x rows: maze cells (12 studs each, cols odd
// so the entrance and exit sit in the middle); wins: what the checkpoint after it pays; gems: Wins
// gems hidden in its dead ends; kill: glowing kill bricks across the way through (jump them!);
// beam: a beam of light over the exit (the first mazes only).
export const DIFFS = {
    EASY: { label: 'EASY', color: '#46e85a' },
    MEDIUM: { label: 'MEDIUM', color: '#ffc828' },
    HARD: { label: 'HARD', color: '#ff8a2a' },
    EXTREME: { label: 'EXTREME', color: '#ff3a4a' },
    INSANE: { label: 'INSANE', color: '#c84aff' },
};
export const STAGES = [
    { name: 'Sandy Shores', sub: 'Golden sand walls over clear blue water', theme: 'sand', cols: 7, rows: 6, diff: 'EASY', wins: 3, gems: 2, kill: 0, beam: true, bar: 0xffc83a, ic: '🏖️' },
    { name: 'Hedge Garden', sub: 'Leafy green hedges', theme: 'hedge', cols: 7, rows: 7, diff: 'EASY', wins: 4, gems: 3, kill: 0, beam: true, bar: 0x46c84a, ic: '🌿' },
    { name: 'Yellow Bricks', sub: 'A brick maze on red dirt', theme: 'brick', cols: 9, rows: 7, diff: 'EASY', wins: 6, gems: 3, kill: 0, beam: true, bar: 0xffe03a, ic: '🧱' },
    { name: 'Rainbow Blocks', sub: 'Every wall a different colour', theme: 'rainbow', cols: 9, rows: 8, diff: 'MEDIUM', wins: 8, gems: 3, kill: 1, beam: true, bar: 0xff4ad8, ic: '🌈' },
    { name: 'Grass Labyrinth', sub: 'Bright green all around', theme: 'grass', cols: 9, rows: 9, diff: 'MEDIUM', wins: 10, gems: 4, kill: 2, beam: true, bar: 0x6aff3a, ic: '🍀' },
    { name: 'Dark Hedges', sub: 'Tall dark hedges on old wooden boards', theme: 'darkhedge', cols: 11, rows: 9, diff: 'MEDIUM', wins: 13, gems: 4, kill: 3, beam: true, bar: 0x2a9a5a, ic: '🌲' },
    { name: 'Stud City', sub: 'Classic studs, and red kill bricks to jump', theme: 'studs', cols: 11, rows: 10, diff: 'HARD', wins: 16, gems: 4, kill: 4, beam: false, bar: 0x9aa4b8, ic: '🟩' },
    { name: 'The Backrooms', sub: 'Yellow wallpaper forever...', theme: 'backrooms', cols: 11, rows: 11, diff: 'HARD', wins: 20, gems: 5, kill: 5, beam: false, bar: 0xd8c050, ic: '💡' },
    { name: 'Frozen Caves', sub: 'Slippery ice: jump the kill bricks carefully!', theme: 'ice', cols: 13, rows: 11, diff: 'HARD', wins: 25, gems: 5, kill: 5, beam: false, bar: 0x6ad8ff, ic: '❄️' },
    { name: 'Lava Castle', sub: 'Obsidian walls glowing with lava', theme: 'lava', cols: 13, rows: 12, diff: 'EXTREME', wins: 30, gems: 5, kill: 7, beam: false, bar: 0xff5a1a, ic: '🌋' },
    { name: 'Candy Land', sub: 'Candy cane walls on chocolate', theme: 'candy', cols: 15, rows: 12, diff: 'EXTREME', wins: 36, gems: 6, kill: 8, beam: false, bar: 0xff7ab0, ic: '🍭' },
    { name: 'Neon Galaxy', sub: 'The last and biggest maze, under the stars', theme: 'neon', cols: 15, rows: 13, diff: 'INSANE', wins: 0, gems: 6, kill: 9, beam: false, bar: 0x9a5aff, ic: '🌌' },
];

// ----- Free Morphs: stand on a pad in the lobby to become one (free, everyone sees it) -----
export const MORPHS = [
    { id: 'noob', name: 'Classic Noob', ic: '🙂' },
    { id: 'blue', name: 'Blue Buddy', ic: '💙' },
    { id: 'banana', name: 'Banana', ic: '🍌' },
    { id: 'robot', name: 'Robo', ic: '🤖' },
    { id: 'knight', name: 'Knight', ic: '🛡️' },
    { id: 'ninja', name: 'Ninja', ic: '🥷' },
    { id: 'zombie', name: 'Zombie', ic: '🧟' },
    { id: 'princess', name: 'Princess', ic: '👑' },
    { id: 'dino', name: 'Dino', ic: '🦖' },
];
export const morphById = Object.fromEntries(MORPHS.map((d) => [d.id, d]));

// ----- trails (Wins) -----
export const TRAILS = [
    { id: 'starter', name: 'Sparkle', price: 0, color: 0xf0f6ff },
    { id: 'aqua', name: 'Aqua', price: 40, color: 0x3ad8ff },
    { id: 'lime', name: 'Lime', price: 120, color: 0x7aff3a },
    { id: 'sun', name: 'Sunshine', price: 350, color: 0xffd028 },
    { id: 'rose', name: 'Rose', price: 900, color: 0xff4a8a },
    { id: 'flame', name: 'Flame', price: 2000, color: 0xff6a1a },
    { id: 'galaxy', name: 'Galaxy', price: 5000, color: 0x9a5aff },
    { id: 'rainbow', name: 'Rainbow', price: 12000, color: 0xff5ad8, rainbow: true },
];
export const trailById = Object.fromEntries(TRAILS.map((d) => [d.id, d]));

// ----- gear (bought with Wins on the GAMEPASS pads); tools sit in the hotbar -----
export const GEAR = [
    { id: 'speedCoil', name: 'Speed Coil', desc: 'Run 50% faster', ic: '🌀', color: 0xff3a4a },
    { id: 'gravityCoil', name: 'Gravity Coil', desc: 'Floaty jumps', ic: '🪐', color: 0x3a8aff },
    { id: 'superCoil', name: 'Super Coil', desc: 'Faster and floatier at once', ic: '💫', color: 0xc45aff },
    { id: 'carpet', name: 'Magic Carpet', desc: 'Fly over the mazes: Space up, Shift down', ic: '🧞', color: 0xffd028 },
    { id: 'rayGun', name: 'Ray Gun', desc: 'Zap players and fling them away', ic: '🔫', color: 0x2ae8d8 },
    { id: 'sword', name: 'Deadly Sword', desc: 'One hit sends a player back to their checkpoint', ic: '🗡️', color: 0x9a4aff },
];
export const gearById = Object.fromEntries(GEAR.map((d) => [d.id, d]));

// ----- the Wins shop -----
// Passes are owned forever; products can be bought again. Every price is in Wins.
export const PASSES = {
    SpeedCoil: { name: 'Speed Coil', price: 75, ic: '🌀', desc: 'Run 50% faster', gear: 'speedCoil' },
    GravityCoil: { name: 'Gravity Coil', price: 150, ic: '🪐', desc: 'Floaty jumps', gear: 'gravityCoil' },
    RayGun: { name: 'Ray Gun', price: 400, ic: '🔫', desc: 'Zap players and fling them away', gear: 'rayGun' },
    SuperCoil: { name: 'Super Coil', price: 800, ic: '💫', desc: 'Faster and floatier at once', gear: 'superCoil' },
    Sword: { name: 'Deadly Sword', price: 1500, ic: '🗡️', desc: 'One hit sends a player back to their checkpoint', gear: 'sword' },
    DoubleWins: { name: 'x2 Wins', price: 4000, ic: '🏆', desc: 'Double Wins forever' },
    MagicCarpet: { name: 'Magic Carpet', price: 8000, ic: '🧞', desc: 'Fly over the mazes: Space up, Shift down', gear: 'carpet' },
};
export const PRODUCTS = {
    Skip: { name: 'Skip Stage', price: 15, ic: '⏩', desc: 'Teleport to the next checkpoint' },
    SkipEnd: { name: 'Skip to End', price: 600, ic: '🚩', desc: 'Teleport straight to the finish' },
    FlingAll: { name: 'Fling All', price: 250, ic: '🌪️', desc: 'Fling everyone else into the air!' },
    KillAll: { name: 'Kill All', price: 350, ic: '💀', desc: 'Send everyone else back to their checkpoint!' },
    WinsBoost: { name: 'x2 Wins Boost', price: 150, ic: '⏱️', desc: 'Double Wins for 15 minutes' },
};
// Skipping costs more the further you are: five times what the next checkpoint pays
export const skipPrice = (stage) => Math.max(15, 5 * ((STAGES[Math.min(STAGES.length - 2, (stage ?? -1) + 1)] || {}).wins || 3));
// Skip to End is cheaper the closer you already are
export const skipEndPrice = (stage) => Math.max(120, Math.round(PRODUCTS.SkipEnd.price * (1 - Math.max(0, (stage ?? -1) + 1) / STAGES.length)));
// Teleports: your own checkpoint is free; back to another stage you've reached costs a little
export const tpPrice = (i, own) => (own ? 0 : Math.max(10, Math.round(((STAGES[i] || {}).wins || 3) * 4)));
export const priceOf = (kind, key, p) => (kind === 'product' && key === 'Skip' ? skipPrice(p ? p.stage : -1)
    : kind === 'product' && key === 'SkipEnd' ? skipEndPrice(p ? p.stage : -1)
    : ((kind === 'pass' ? PASSES : PRODUCTS)[key] || {}).price);
export const passForGear = (gearId) => Object.keys(PASSES).find((k) => PASSES[k].gear === gearId);

// ----- the lucky block: what a spin can give (weights add up to 100) -----
export const LUCKY = [
    { wins: 10, w: 30 }, { wins: 20, w: 24 }, { wins: 40, w: 17 }, { boost: true, w: 11 },
    { wins: 75, w: 10 }, { wins: 150, w: 6 }, { wins: 400, w: 2 },
];
export function luckyRoll(r) {
    let x = r * 100;
    for (let i = 0; i < LUCKY.length; i++) { x -= LUCKY[i].w; if (x < 0) return i; }
    return 0;
}

// ----- playtime gifts (minutes played this session) -----
export const GIFTS = [
    { min: 2, wins: 10 }, { min: 5, wins: 15 }, { min: 10, wins: 25 }, { min: 15, boost: true },
    { min: 20, wins: 50 }, { min: 30, wins: 75 }, { min: 45, wins: 120 }, { min: 60, wins: 200 },
];
// ----- daily rewards (7-day streak) -----
export const DAILY = [
    { wins: 15 }, { wins: 25 }, { wins: 40 }, { boost: true }, { wins: 75 }, { wins: 120 }, { wins: 300, trail: 'lime' },
];
export const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
export function dailyStatus(d, now) {
    const today = dayKey(now), yest = dayKey(now - 86400000);
    if (!d || !d.last) return { can: true, day: 0, streak: 0 };
    if (d.last === today) return { can: false, day: d.streak % 7, streak: d.streak };
    const streak = d.last === yest ? d.streak : 0;
    return { can: true, day: streak % 7, streak };
}
export const rewardText = (r) => [
    r.wins ? '+' + fmt(r.wins) + ' Wins' : '',
    r.boost ? '15 min x2 Wins' : '',
    r.trail ? 'the ' + trailById[r.trail].name + ' trail' : '',
].filter(Boolean).join(' + ');

export const CODES = {
    MAZE: { wins: 50 },
    OBBY: { wins: 75 },
    WINNER: { wins: 30 },
    LEGION: { wins: 100 },
    RELEASE: { boost: true },
};

// Wins multiplier: x2 Wins pass, x2 boost, Friend Boost
export function winsMult(p, now, friends) {
    let m = 1;
    if (p.passes && p.passes.DoubleWins) m *= 2;
    if ((p.boostUntil || 0) > now) m *= 2;
    m *= 1 + CFG.friendBoost * Math.min(CFG.friendMax, friends || 0);
    return m;
}

// Player outfits for the blocky fallback body (cycle by join order); the reference's default
// black hoodie first
export const KITS = [
    { shirt: 0x1c1c22, shorts: 0x24242c, socks: 0x1c1c22, hair: 0x8a4a1a },
    { shirt: 0x3ac8ff, shorts: 0x2a2a4a, socks: 0xffffff, hair: 0xffd028 },
    { shirt: 0xff7ab0, shorts: 0x3a3a5a, socks: 0xffffff, hair: 0x3a2618 },
    { shirt: 0x6aff5a, shorts: 0x2a3a2a, socks: 0xffffff, hair: 0x3a2618 },
    { shirt: 0xffd028, shorts: 0x3a2a1a, socks: 0xffffff, hair: 0xb8541c },
    { shirt: 0xc45aff, shorts: 0x2a1a3a, socks: 0xffffff, hair: 0xff8ad8 },
];
export const SKINS = [0xf2c9a0, 0xe1af87, 0xc88c5f, 0x8c5a3c, 0xf0c8a0];

// ----- formatting -----
export function fmt(v) {
    v = Math.floor(v || 0);
    if (v < 1000) return String(v);
    const u = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi'];
    let i = 0, x = v;
    while (x >= 1000 && i < u.length - 1) { x /= 1000; i++; }
    return (x >= 100 ? Math.floor(x) : Math.floor(x * 10) / 10) + u[i];
}
export const fmtComma = (v) => Math.floor(v || 0).toLocaleString('en-US');
export function clock(s) {
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(x).padStart(2, '0');
}
export function playtimeText(s) {
    s = Math.floor(s || 0);
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
    return Math.floor(s / 86400) + 'd ' + Math.floor((s % 86400) / 3600) + 'h';
}
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function rngFrom(seed) {
    let s = (seed >>> 0) || 1;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
