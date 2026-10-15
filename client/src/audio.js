// Procedural soundtrack and sound effects (Web Audio, no asset files).
//
// Music, "Maze Runner": an original, upbeat 118 BPM adventure-pop loop in G major. A sparkly
// electric piano plays G - D - Em - C (I-V-vi-IV) with a light shuffle, a bouncy round bass,
// kick and hand claps, shaker 8ths, and a marimba-bell hook in the chorus sections. 32 bars:
// intro, verse, chorus, breakdown, chorus again, looping.
//
// Footsteps: every maze floor has its own sound, all synthesized: splashy shallow water, soft
// asphalt, crunchy dirt, plastic clicks, rustling grass, hollow wooden boards, Roblox studs, a
// muffled carpet, crunchy ice, hard obsidian, crunchy candy, buzzing neon, clean tiles.

let ctx = null, master, comp, musicBus, musicOut, duckFilter, sfxBus, asmrBus, reverb, roomVerb, delay;
let noiseBuf = null, meter = null;
let musicOn = false, schedTimer = null, seqStep = 0, nextTime = 0, ducked = false;
const settings = { music: 0.5, sfx: 0.8, asmr: 0.9, master: 1, muted: false };
try { Object.assign(settings, JSON.parse(localStorage.getItem('mzo_audio') || '{}')); } catch (e) { /* defaults */ }

const BPM = 118, STEP = 60 / BPM / 4, SWING = 0.08;
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const CHORDS = [
    { root: 43, notes: [62, 67, 71, 74] },   // G (D G B D)
    { root: 38, notes: [62, 66, 69, 74] },   // D (D F# A D)
    { root: 40, notes: [64, 67, 71, 76] },   // Em (E G B E)
    { root: 36, notes: [60, 64, 67, 72] },   // C (C E G C)
];
// The bell hook, G major pentatonic: [step, midi, length], one phrase per bar
const MELODY = [
    [[0, 83, 2], [2, 86, 2], [4, 88, 2], [6, 86, 2], [8, 83, 4], [12, 81, 2], [14, 79, 2]],
    [[0, 81, 3], [3, 83, 1], [4, 81, 2], [6, 79, 2], [8, 74, 4], [12, 76, 2], [14, 79, 2]],
    [[0, 79, 2], [2, 83, 2], [4, 88, 4], [8, 86, 2], [10, 83, 2], [12, 81, 4]],
    [[0, 79, 3], [3, 81, 1], [4, 79, 2], [6, 76, 2], [8, 72, 4], [12, 74, 2], [14, 79, 2]],
];
const SECTION = (bar) => {
    const b = bar % 32;
    if (b < 4) return 'intro';
    if (b < 12) return 'groove';
    if (b < 20) return 'melody';
    if (b < 24) return 'break';
    return 'groove2';
};

export function initAudio() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.2;
    master = ctx.createGain(); master.gain.value = 1.0;
    comp.connect(master).connect(ctx.destination);
    meter = ctx.createAnalyser(); meter.fftSize = 2048; master.connect(meter);
    musicBus = ctx.createGain();
    duckFilter = ctx.createBiquadFilter(); duckFilter.type = 'lowpass'; duckFilter.frequency.value = 20000; duckFilter.Q.value = 0.5;
    // a gentle top-end roll-off so the bright mix never gets harsh
    const warm = ctx.createBiquadFilter(); warm.type = 'lowpass'; warm.frequency.value = 9000; warm.Q.value = 0.3;
    musicOut = ctx.createGain();
    musicBus.connect(warm).connect(duckFilter).connect(musicOut).connect(comp);
    sfxBus = ctx.createGain(); sfxBus.connect(comp);
    asmrBus = ctx.createGain(); asmrBus.connect(comp);
    applyVolumes();

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    const ir = (secs, decay) => {
        const len = ctx.sampleRate * secs, b = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) { const ch = b.getChannelData(c); for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
        return b;
    };
    reverb = ctx.createConvolver(); reverb.buffer = ir(2.8, 3);
    const revGain = ctx.createGain(); revGain.gain.value = 0.32;
    reverb.connect(revGain).connect(musicBus);
    // a small room for the ASMR sounds: close and intimate
    roomVerb = ctx.createConvolver(); roomVerb.buffer = ir(0.5, 4);
    const roomGain = ctx.createGain(); roomGain.gain.value = 0.22;
    roomVerb.connect(roomGain).connect(asmrBus);
    delay = ctx.createDelay(1);
    delay.delayTime.value = STEP * 3;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    const dlf = ctx.createBiquadFilter(); dlf.type = 'lowpass'; dlf.frequency.value = 2400;
    const dlGain = ctx.createGain(); dlGain.gain.value = 0.25;
    delay.connect(dlf).connect(fb).connect(delay);
    dlf.connect(dlGain).connect(musicBus);
    void startCrackle; void crackle;

    document.addEventListener('visibilitychange', () => {
        if (!ctx) return;
        if (document.hidden) ctx.suspend(); else ctx.resume();
    });
}

function applyVolumes() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const m = settings.master ?? 1;
    musicOut.gain.setTargetAtTime(settings.muted ? 0 : settings.music * 1.6 * m * (ducked ? 0.6 : 1), t, 0.08);
    sfxBus.gain.setTargetAtTime(settings.sfx * m, t, 0.05);
    asmrBus.gain.setTargetAtTime((settings.asmr ?? 1) * 1.1 * m, t, 0.05);
}
function save() { try { localStorage.setItem('mzo_audio', JSON.stringify(settings)); } catch (e) { /* ignore */ } }
export function getVolumes() { return { ...settings }; }
export function setVolume(kind, v) {
    settings[kind] = Math.max(0, Math.min(1, v));
    save();
    applyVolumes();
}
export function toggleMusic() { settings.muted = !settings.muted; save(); applyVolumes(); return !settings.muted; }
export const musicMuted = () => !!settings.muted;
// Browsers keep audio off until a click or key press: every gesture retries until it's running
export function resumeAudio() { initAudio(); if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {}); if (ctx && !musicOn && wantMusic) startMusic(); }
const level = () => { if (!meter) return 0; const a = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(a); let p = 0; for (const v of a) p = Math.max(p, Math.abs(v)); return +p.toFixed(3); };
export const audioDebug = () => ({ peak: level(), state: ctx && ctx.state, musicOn, settings: { ...settings } });
export const audioSuspended = () => !ctx || ctx.state !== 'running';
// Menus open: the music goes muffled and a little quieter
export function setMusicDuck(on) {
    if (!ctx || on === ducked) return;
    ducked = on;
    duckFilter.frequency.setTargetAtTime(on ? 900 : 20000, ctx.currentTime, 0.12);
    applyVolumes();
}

// ----- building blocks -----
function env(g, t, a, peak, d, sustain, r, end) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t + a + d);
    if (end) { g.gain.setValueAtTime(Math.max(0.0001, sustain), end); g.gain.exponentialRampToValueAtTime(0.0001, end + r); }
}
function noise(t, dur, type, freq, q, gain, out, freqEnd, attack) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q || 1;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    if (attack) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); } else g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out || musicBus);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
    return { f, g };
}
function tone(t, type, f0, f1, dur, gain, out, attack) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    if (attack) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); } else g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out || sfxBus); o.start(t); o.stop(t + dur + 0.05);
    return o;
}

// ----- the soundtrack -----
function startCrackle() {
    // Vinyl hiss bed
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 3200; f.Q.value = 0.6;
    const g = ctx.createGain(); g.gain.value = 0.006;
    src.connect(f).connect(g).connect(musicBus); src.start();
}
function crackle(t) {
    // A few random pops and ticks per beat
    for (let i = 0; i < 3; i++) if (Math.random() < 0.5) noise(t + Math.random() * STEP * 4, 0.004 + Math.random() * 0.006, 'highpass', 2500 + Math.random() * 3000, 0.7, 0.03 + Math.random() * 0.05, musicBus);
}
// Rhodes: a sine with a soft second partial and a glassy tine that fades fast, tremolo, warm filter
function rhodes(t, n, dur, gain) {
    const g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 2400; f.Q.value = 0.4;
    env(g, t, 0.006, gain, 1.4, gain * 0.35, 0.35, t + dur);
    const trem = ctx.createOscillator(), tg = ctx.createGain(), tremAmt = ctx.createGain();
    trem.frequency.value = 4.6; tg.gain.value = gain * 0.12;
    trem.connect(tg).connect(g.gain);
    f.connect(g); g.connect(musicBus); g.connect(reverb);
    const wob = ctx.createOscillator(), wg = ctx.createGain(); wob.frequency.value = 0.35; wg.gain.value = 7;
    wob.connect(wg);
    for (const [k, a] of [[1, 1], [2, 0.18], [3.01, 0.05]]) {
        const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'sine'; o.frequency.value = midi(n) * k; og.gain.value = a;
        wg.connect(o.detune);
        o.connect(og).connect(f); o.start(t); o.stop(t + dur + 0.4);
    }
    // tine
    const tine = ctx.createOscillator(), ti = ctx.createGain(); tine.type = 'sine'; tine.frequency.value = midi(n) * 7.1;
    ti.gain.setValueAtTime(gain * 0.12, t); ti.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    tine.connect(ti).connect(f); tine.start(t); tine.stop(t + 0.2);
    trem.start(t); trem.stop(t + dur + 0.4); wob.start(t); wob.stop(t + dur + 0.4);
    void tremAmt;
}
function chord(t, notes, dur, gain) { notes.forEach((n, i) => rhodes(t + i * 0.022, n, dur, gain)); }
function kalimba(t, n, gain) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    g.connect(musicBus); g.connect(reverb); g.connect(delay);
    for (const [k, a, type] of [[1, 1, 'triangle'], [2, 0.25, 'sine'], [5.4, 0.08, 'sine']]) {
        const o = ctx.createOscillator(), og = ctx.createGain(); o.type = type; o.frequency.value = midi(n) * k; og.gain.value = a;
        if (k > 2) { og.gain.setValueAtTime(a, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12); }
        o.connect(og).connect(g); o.start(t); o.stop(t + 1.25);
    }
}
function sub(t, n, dur, gain) {
    const g = ctx.createGain();
    env(g, t, 0.02, gain, dur * 0.5, gain * 0.6, 0.12, t + dur);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = midi(n);
    const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = midi(n); const g2 = ctx.createGain(); g2.gain.value = 0.18;
    o.connect(g); o2.connect(g2).connect(g); g.connect(musicBus);
    o.start(t); o.stop(t + dur + 0.2); o2.start(t); o2.stop(t + dur + 0.2);
}
function kick(t, gain) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g).connect(musicBus); o.start(t); o.stop(t + 0.35);
    noise(t, 0.015, 'lowpass', 1200, 0.7, gain * 0.25, musicBus);
}
// Brushed snare: soft noise with a long airy tail and a little body
function snare(t, gain) {
    noise(t, 0.22, 'bandpass', 1900, 0.7, gain, musicBus, 1100);
    noise(t, 0.35, 'highpass', 4000, 0.5, gain * 0.35, reverb);
    tone(t, 'triangle', 190, 150, 0.08, gain * 0.5, musicBus);
}
function hat(t, gain, open) { noise(t, open ? 0.16 : 0.035, 'highpass', 7500, 0.8, gain, musicBus); }
function shaker(t, gain) { noise(t, 0.06, 'bandpass', 5500, 1.2, gain, musicBus, 0, 0.02); }

// Hand clap: three quick noise bursts and a short room tail
function clap(t, gain) {
    for (let k = 0; k < 3; k++) noise(t + k * 0.011, 0.02, 'bandpass', 1400, 1.4, gain * (k === 2 ? 1 : 0.7), musicBus);
    noise(t + 0.03, 0.16, 'bandpass', 1300, 1, gain * 0.5, musicBus, 900);
    noise(t + 0.03, 0.25, 'highpass', 3000, 0.5, gain * 0.2, reverb);
}
function playStep(s, t) {
    const bar = Math.floor(s / 16), i = s % 16, sec = SECTION(bar), ch = CHORDS[bar % 4];
    // a light shuffle: every second 16th comes a little late
    if (i % 2 === 1) t += STEP * SWING;
    // Electric piano: the chord on 1, bouncy stabs on the off-beats
    if (i === 0) chord(t, ch.notes, STEP * 7, sec === 'intro' || sec === 'break' ? 0.045 : 0.034);
    if ((i === 6 || i === 10 || i === 14) && sec !== 'intro' && sec !== 'break') chord(t, ch.notes.slice(1), STEP * 1.6, 0.022);
    if (sec === 'intro') {
        if (i % 4 === 0 && bar % 2) kalimba(t, ch.notes[3] + 12, 0.04);
        if (i % 2 === 0 && bar >= 2) shaker(t, 0.015);
        return;
    }
    if (sec === 'break') {
        for (const [at, n] of MELODY[bar % 4]) if (at === i) kalimba(t, n - 12, 0.05);
        if (i === 0) sub(t, ch.root + 12, STEP * 14, 0.12);
        if (i % 4 === 2) shaker(t, 0.02);
        if (i === 12 && bar % 4 === 3) clap(t, 0.12);
        return;
    }
    // groove: four-on-the-floor-ish kick, claps on 2 and 4, shaker 8ths, a bouncing octave bass
    if (i === 0 || i === 8 || (i === 14 && bar % 2)) kick(t, 0.46);
    if (i === 4 || i === 12) clap(t, 0.16);
    if (i % 2 === 0) shaker(t, i % 4 === 0 ? 0.018 : 0.03);
    if (i % 4 === 2) hat(t, 0.028);
    const bn = [0, 12, 0, 12, 7, 12, 0, 10][i >> 1];
    if (i % 2 === 0) sub(t, ch.root + 12 + bn, STEP * 1.6, i % 4 === 0 ? 0.2 : 0.13);
    if (sec === 'melody' || sec === 'groove2') for (const [at, n] of MELODY[bar % 4]) if (at === i) kalimba(t, n, sec === 'groove2' ? 0.05 : 0.065);
}
function scheduler() {
    while (nextTime < ctx.currentTime + 0.2) {
        playStep(seqStep, nextTime);
        nextTime += STEP;
        seqStep++;
    }
}
let wantMusic = false;
export function startMusic() {
    wantMusic = true;
    if (!ctx || musicOn) return;
    musicOn = true;
    seqStep = 0; nextTime = ctx.currentTime + 0.1;
    schedTimer = setInterval(scheduler, 30);
}
export function stopMusic() { musicOn = false; clearInterval(schedTimer); }

// =====================================================================================
// ASMR surfaces
// =====================================================================================
const R = (a, b) => a + Math.random() * (b - a);
const ASMR = {
    // Mechanical keycap: sharp click, hollow plastic thock as it bottoms out, soft clack on return
    keys(t, k) {
        const p = R(0.85, 1.15);
        noise(t, 0.012, 'bandpass', 6200 * p, 1.6, 0.3 * k, asmrBus);
        noise(t + 0.006, 0.05, 'bandpass', 1500 * p, 2.4, 0.3 * k, asmrBus);
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'triangle'; o.frequency.setValueAtTime(380 * p, t + 0.008); o.frequency.exponentialRampToValueAtTime(150 * p, t + 0.07);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3 * k, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
        o.connect(g).connect(asmrBus); o.start(t); o.stop(t + 0.11);
        noise(t + 0.13, 0.02, 'bandpass', 3800 * p, 1.8, 0.1 * k, asmrBus);
    },
    // Wet slime: a squelch sweeping down, a low suck, then little bubbles popping
    slime(t, k) {
        const p = R(0.85, 1.2);
        const sq = noise(t, 0.16, 'bandpass', 2600 * p, 3.5, 0.36 * k, asmrBus, 420 * p, 0.006);
        sq.g.connect(roomVerb);
        tone(t, 'sine', 150 * p, 62 * p, 0.1, 0.22 * k, asmrBus, 0.004);
        noise(t + 0.05, 0.12, 'lowpass', 650, 1.5, 0.12 * k, asmrBus, 300);
        const n = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) {
            const at = t + R(0.04, 0.24), f = R(650, 1500);
            tone(at, 'sine', f, f * 1.5, 0.035, R(0.05, 0.1) * k, asmrBus, 0.003);
        }
    },
    // Gummy jelly: a wobbly "bloop" and a soft wet touch
    jelly(t, k) {
        const p = R(0.88, 1.15);
        const o = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
        o.type = 'sine'; o.frequency.setValueAtTime(520 * p, t); o.frequency.exponentialRampToValueAtTime(205 * p, t + 0.1);
        lfo.frequency.value = 24; lg.gain.value = 28 * p; lfo.connect(lg).connect(o.frequency);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.26 * k, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        o.connect(g).connect(asmrBus); g.connect(roomVerb);
        o.start(t); o.stop(t + 0.18); lfo.start(t); lfo.stop(t + 0.18);
        noise(t, 0.05, 'bandpass', 950 * p, 2, 0.1 * k, asmrBus);
    },
    // Squishy foam dome: rubbery creak, a puff of air, a soft body thump
    dome(t, k) {
        const p = R(0.9, 1.15);
        const o = ctx.createOscillator(), bp = ctx.createBiquadFilter(), g = ctx.createGain(), am = ctx.createOscillator(), ag = ctx.createGain();
        o.type = 'sawtooth'; o.frequency.value = 92 * p;
        bp.type = 'bandpass'; bp.Q.value = 6; bp.frequency.setValueAtTime(650 * p, t); bp.frequency.exponentialRampToValueAtTime(1500 * p, t + 0.2);
        am.frequency.value = 46; ag.gain.value = 0.05 * k; am.connect(ag).connect(g.gain);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.11 * k, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        o.connect(bp).connect(g).connect(asmrBus);
        o.start(t); o.stop(t + 0.24); am.start(t); am.stop(t + 0.24);
        noise(t, 0.14, 'lowpass', 420, 1, 0.26 * k, asmrBus, 0, 0.01);
        tone(t, 'sine', 210 * p, 110 * p, 0.12, 0.18 * k, asmrBus, 0.004);
    },
    // Soft waxy butter: a dull pat and the crinkle of the wrapper
    butter(t, k) {
        noise(t, 0.08, 'lowpass', R(420, 560), 1.2, 0.34 * k, asmrBus, 0, 0.003);
        tone(t, 'sine', R(150, 175), 100, 0.06, 0.14 * k, asmrBus);
        for (let i = 0; i < 6; i++) noise(t + R(0, 0.09), R(0.002, 0.005), 'highpass', R(4500, 7000), 0.8, R(0.03, 0.07) * k, asmrBus);
    },
    // Pop-it bubble popping in: a quick hollow "pok" and a click
    popit(t, k) {
        const p = R(0.85, 1.2);
        tone(t, 'sine', 920 * p, 380 * p, 0.04, 0.3 * k, asmrBus, 0.002);
        noise(t, 0.012, 'bandpass', 1700 * p, 1, 0.22 * k, asmrBus);
        tone(t, 'sine', 230 * p, 160, 0.05, 0.1 * k, asmrBus);
    },
    // Bubble wrap: a sharp crack with a tiny ringing tail (sometimes two)
    wrap(t, k) {
        const n = Math.random() < 0.35 ? 2 : 1;
        for (let i = 0; i < n; i++) {
            const at = t + i * R(0.04, 0.09);
            noise(at, 0.012, 'highpass', 1300, 0.7, 0.5 * k, asmrBus);
            noise(at, 0.035, 'bandpass', R(2800, 3600), 8, 0.14 * k, asmrBus);
        }
    },
    // Mochi spinner: a soft, floury squish
    mochi(t, k) {
        noise(t, 0.12, 'lowpass', 380, 1, 0.28 * k, asmrBus, 0, 0.012);
        tone(t, 'sine', R(170, 200), 95, 0.12, 0.16 * k, asmrBus, 0.006);
        noise(t + 0.02, 0.06, 'bandpass', 1300, 3, 0.05 * k, asmrBus);
    },
    // Lilac tiles: a clean little tap
    tile(t, k) {
        noise(t, 0.022, 'bandpass', R(2300, 2900), 1.2, 0.1 * k, asmrBus);
        noise(t, 0.04, 'lowpass', 700, 1, 0.1 * k, asmrBus);
    },
    // The green lobby floor: glossy and a little squishy
    floor(t, k) { ASMR.jelly(t, k * 0.55); },
    // Green blocks: a plastic thud
    block(t, k) {
        noise(t, 0.035, 'bandpass', R(820, 1000), 1.5, 0.2 * k, asmrBus);
        tone(t, 'sine', 180, 118, 0.05, 0.14 * k, asmrBus);
    },
    truss(t, k) {
        noise(t, 0.012, 'bandpass', R(2800, 3400), 2, 0.16 * k, asmrBus);
        tone(t, 'triangle', R(850, 1000), null, 0.02, 0.04 * k, asmrBus);
    },
    gold(t, k) {
        noise(t, 0.04, 'bandpass', 4000, 6, 0.12 * k, asmrBus);
        tone(t, 'sine', R(1700, 1900), null, 0.09, 0.04 * k, asmrBus);
    },
    // The giant rainbow squishy
    squishy(t, k) { ASMR.dome(t, k * 1.4); ASMR.slime(t + 0.03, k * 0.5); },
    bounce(t, k) { springTone(t, 210, 0.38, 0.2 * k); ASMR.dome(t, k * 0.7); },
    glass(t, k) { ASMR.tile(t, k); },
    wall(t, k) { ASMR.stud(t, k); },
    // Roblox studs: a crisp little plastic click with a hollow knock under it
    stud(t, k) {
        const p = R(0.9, 1.12);
        noise(t, 0.012, 'bandpass', 3600 * p, 1.6, 0.16 * k, asmrBus);
        noise(t + 0.004, 0.04, 'bandpass', 900 * p, 2, 0.16 * k, asmrBus);
        tone(t, 'triangle', 260 * p, 150 * p, 0.05, 0.12 * k, asmrBus, 0.003);
    },
    // A giant strawberry: a juicy squish with a little wet pop
    berry(t, k) {
        const p = R(0.9, 1.15);
        noise(t, 0.1, 'bandpass', 1800 * p, 3, 0.22 * k, asmrBus, 500 * p, 0.005);
        tone(t, 'sine', 240 * p, 120 * p, 0.08, 0.16 * k, asmrBus, 0.003);
        tone(t + R(0.03, 0.07), 'sine', R(700, 1100), R(1200, 1500), 0.03, 0.07 * k, asmrBus, 0.002);
    },
    // Sponge cake: a soft, dull, springy pat
    cake(t, k) {
        noise(t, 0.09, 'lowpass', R(500, 650), 1, 0.3 * k, asmrBus, 0, 0.006);
        tone(t, 'sine', R(150, 180), 95, 0.08, 0.14 * k, asmrBus, 0.004);
    },
    // Whipped cream: a puffy squish
    cream(t, k) { ASMR.dome(t, k * 0.9); },
    // Strawberry milk: a splash with a few bubbles
    milk(t, k) { ASMR.slime(t, k * 0.9); },
    // Glossy icing: a squeaky glide
    icing(t, k) {
        const p = R(0.9, 1.2);
        const o = ctx.createOscillator(), g = ctx.createGain(), bp = ctx.createBiquadFilter();
        o.type = 'sawtooth'; o.frequency.setValueAtTime(900 * p, t); o.frequency.exponentialRampToValueAtTime(1500 * p, t + 0.08);
        bp.type = 'bandpass'; bp.frequency.value = 2200 * p; bp.Q.value = 5;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05 * k, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
        o.connect(bp).connect(g).connect(asmrBus); o.start(t); o.stop(t + 0.12);
        ASMR.cake(t, k * 0.5);
    },
    // Grey sky plates: a hollow metallic knock
    plate(t, k) {
        noise(t, 0.03, 'bandpass', R(1500, 1900), 4, 0.16 * k, asmrBus);
        tone(t, 'sine', R(420, 480), null, 0.12, 0.06 * k, asmrBus, 0.002);
        tone(t, 'sine', R(1100, 1250), null, 0.07, 0.03 * k, asmrBus, 0.002);
    },
};
// ----- the maze floors -----
// Shallow water: a light splash and a couple of bubbles
ASMR.water = (t, k) => {
    const p = R(0.9, 1.2);
    noise(t, 0.12, 'bandpass', 2200 * p, 2.2, 0.2 * k, asmrBus, 700 * p, 0.004);
    noise(t + 0.02, 0.1, 'highpass', 3500, 0.7, 0.05 * k, asmrBus);
    for (let i = 0; i < 2; i++) { const f = R(800, 1500); tone(t + R(0.03, 0.12), 'sine', f, f * 1.6, 0.03, R(0.03, 0.06) * k, asmrBus, 0.003); }
};
// Asphalt: a soft, flat thud
ASMR.asphalt = (t, k) => { noise(t, 0.05, 'lowpass', R(800, 1000), 1, 0.22 * k, asmrBus); noise(t, 0.02, 'bandpass', 2600, 1.4, 0.05 * k, asmrBus); };
// Red dirt: a little gravelly crunch
ASMR.dirt = (t, k) => {
    for (let i = 0; i < 4; i++) noise(t + i * R(0.008, 0.018), 0.015, 'bandpass', R(1800, 3400), 2, R(0.06, 0.1) * k, asmrBus);
    noise(t, 0.06, 'lowpass', 600, 1, 0.12 * k, asmrBus);
};
// Smooth plastic: a crisp thud
ASMR.plastic = (t, k) => ASMR.block(t, k);
// Grass: a soft rustle over a padded step
ASMR.grass = (t, k) => { noise(t, 0.09, 'highpass', R(3000, 4200), 0.8, 0.07 * k, asmrBus, 0, 0.02); noise(t, 0.05, 'lowpass', 500, 1, 0.14 * k, asmrBus); };
// Wooden boards: a hollow knock
ASMR.wood = (t, k) => {
    const p = R(0.9, 1.1);
    tone(t, 'triangle', 230 * p, 150 * p, 0.07, 0.16 * k, asmrBus, 0.002);
    noise(t, 0.03, 'bandpass', 900 * p, 3, 0.16 * k, asmrBus);
    tone(t + 0.004, 'sine', 520 * p, null, 0.05, 0.04 * k, asmrBus, 0.002);
};
// Carpet: muffled
ASMR.carpet = (t, k) => { noise(t, 0.07, 'lowpass', R(380, 480), 1, 0.26 * k, asmrBus, 0, 0.008); };
// Ice: a crisp crunch with a tiny glassy ring
ASMR.ice = (t, k) => {
    for (let i = 0; i < 3; i++) noise(t + i * 0.012, 0.012, 'highpass', R(4000, 6000), 1, 0.07 * k, asmrBus);
    tone(t, 'sine', R(2300, 2700), null, 0.12, 0.025 * k, asmrBus, 0.002);
    noise(t, 0.04, 'lowpass', 700, 1, 0.1 * k, asmrBus);
};
// Obsidian: hard stone
ASMR.stone = (t, k) => { noise(t, 0.03, 'bandpass', R(1400, 1800), 1.6, 0.16 * k, asmrBus); tone(t, 'sine', 140, 90, 0.06, 0.14 * k, asmrBus); };
// Candy: a sugary crunch
ASMR.candy = (t, k) => {
    for (let i = 0; i < 3; i++) noise(t + i * R(0.01, 0.02), 0.02, 'bandpass', R(2600, 4200), 3, 0.08 * k, asmrBus);
    ASMR.cake(t, k * 0.4);
};
// Neon panels: a tile tap with a little electric buzz
ASMR.neon = (t, k) => { ASMR.tile(t, k); tone(t, 'square', R(110, 130), null, 0.06, 0.02 * k, asmrBus, 0.003); tone(t + 0.01, 'sine', R(1600, 1900), null, 0.05, 0.025 * k, asmrBus); };
export const ASMR_KINDS = Object.keys(ASMR);
// A footstep (or a landing, louder) on a surface
export function step(surface, landing) {
    if (!ctx || (settings.asmr ?? 1) <= 0) return;
    const f = ASMR[surface] || ASMR.block;
    f(ctx.currentTime + 0.004, landing ? 1.45 : 0.8);
}
// The "fwip" of a pop-it flipping back over
export function popitFlip() {
    if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    noise(t, 0.18, 'bandpass', 400, 2, 0.2, asmrBus, 3200, 0.02);
    for (let i = 0; i < 5; i++) tone(t + 0.03 + i * 0.025, 'sine', R(500, 800), 300, 0.03, 0.08, asmrBus);
}

// =====================================================================================
// Sound effects
// =====================================================================================
function springTone(t, f, dur, gain) {
    const o = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(f * 0.7, t); o.frequency.exponentialRampToValueAtTime(f * 1.9, t + dur * 0.35); o.frequency.exponentialRampToValueAtTime(f, t + dur);
    lfo.frequency.value = 28; lg.gain.value = f * 0.12; lfo.connect(lg).connect(o.frequency);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(sfxBus); o.start(t); o.stop(t + dur + 0.05); lfo.start(t); lfo.stop(t + dur + 0.05);
}
const SFX = {
    // UI: a soft bubbly pop
    click(t) { tone(t, 'sine', 720, 1250, 0.05, 0.13); noise(t, 0.01, 'bandpass', 2400, 1, 0.08, sfxBus); },
    clickBuy(t) { tone(t, 'sine', 620, 1100, 0.05, 0.13); tone(t + 0.05, 'sine', 1100, 1650, 0.06, 0.1); },
    jump(t) { tone(t, 'sine', 330, 620, 0.09, 0.08); },
    coin(t) { tone(t, 'square', midi(88), null, 0.07, 0.05); tone(t + 0.07, 'square', midi(93), null, 0.22, 0.05); tone(t, 'sine', midi(100), null, 0.25, 0.05); },
    checkpoint(t) {
        [76, 79, 84, 88].forEach((n, i) => tone(t + i * 0.07, 'triangle', midi(n), null, 0.32, 0.12));
        noise(t, 0.4, 'bandpass', 800, 1, 0.08, sfxBus, 6000, 0.05);
    },
    win(t) {
        [72, 76, 79, 84, 79, 84, 88].forEach((n, i) => tone(t + i * 0.1, 'square', midi(n), null, 0.28, 0.07));
        [60, 64, 67, 72].forEach((n) => tone(t + 0.7, 'triangle', midi(n), null, 1.4, 0.07));
        noise(t + 0.7, 1.2, 'highpass', 3000, 0.6, 0.08, sfxBus);
    },
    oops(t) { tone(t, 'sine', 1400, 300, 0.7, 0.12); tone(t + 0.72, 'sine', 140, 70, 0.2, 0.22); noise(t + 0.72, 0.18, 'lowpass', 700, 1, 0.25, sfxBus); },
    teleport(t) { for (let i = 0; i < 9; i++) tone(t + i * 0.028, 'sine', midi(74 + i * 3), null, 0.16, 0.06); noise(t, 0.35, 'bandpass', 600, 1.5, 0.08, sfxBus, 5000, 0.05); },
    buy(t) { [79, 84, 88, 91, 96].forEach((n, i) => tone(t + i * 0.05, 'sine', midi(n), null, 0.3, 0.14)); },
    denied(t) { tone(t, 'square', 220, 160, 0.14, 0.1); tone(t + 0.14, 'square', 180, 120, 0.18, 0.1); },
    gate(t) { [84, 88, 91, 96, 100].forEach((n, i) => tone(t + i * 0.035, 'sine', midi(n), null, 0.5, 0.08)); tone(t, 'triangle', 220, 880, 0.35, 0.1); },
    whoosh(t) { noise(t, 0.45, 'bandpass', 300, 2, 0.3, sfxBus, 3000, 0.18); },
    slap(t) {
        noise(t, 0.05, 'bandpass', 1400, 0.8, 0.6, sfxBus);
        noise(t, 0.12, 'lowpass', 500, 1, 0.4, sfxBus);
        tone(t, 'sine', 160, 70, 0.12, 0.3);
    },
    slapped(t) { SFX.slap(t); springTone(t + 0.05, 300, 0.4, 0.12); },
    nuke(t) {
        tone(t, 'sine', 90, 25, 2.2, 0.6);
        noise(t, 2.5, 'lowpass', 900, 0.8, 0.6, sfxBus, 80, 0.02);
        noise(t, 1.2, 'highpass', 2000, 0.6, 0.2, sfxBus);
    },
    grapple(t) { noise(t, 0.16, 'bandpass', 900, 3, 0.3, sfxBus, 4000, 0.01); tone(t, 'square', 1200, 400, 0.12, 0.05); },
    hook(t) { noise(t, 0.03, 'bandpass', 3000, 4, 0.3, sfxBus); tone(t, 'triangle', 1800, 900, 0.06, 0.08); },
    equip(t) { tone(t, 'triangle', midi(79), midi(84), 0.12, 0.1); noise(t, 0.04, 'bandpass', 3000, 2, 0.08, sfxBus); },
    spinTick(t) { tone(t, 'triangle', 1500, 1100, 0.025, 0.06); },
    hatchShake(t) { noise(t, 0.05, 'bandpass', 700, 2, 0.2, sfxBus); tone(t, 'sine', 300, 200, 0.06, 0.1); },
    common(t) { [79, 84].forEach((n, i) => tone(t + i * 0.08, 'triangle', midi(n), null, 0.3, 0.12)); },
    rare(t) { [79, 84, 88].forEach((n, i) => tone(t + i * 0.08, 'triangle', midi(n), null, 0.35, 0.12)); },
    epic(t) { [76, 79, 84, 88, 91].forEach((n, i) => tone(t + i * 0.07, 'square', midi(n), null, 0.35, 0.07)); },
    legendary(t) { SFX.win(t); },
    mythic(t) { SFX.win(t); SFX.nuke(t + 0.01); },
    quest(t) { [84, 91, 96].forEach((n, i) => tone(t + i * 0.09, 'triangle', midi(n), null, 0.35, 0.12)); },
    firework(t) { tone(t, 'sine', 900, 200, 0.35, 0.05); noise(t + 0.35, 0.4, 'lowpass', 2500, 0.8, 0.28, sfxBus); },
    gain(t) { tone(t, 'triangle', midi(88), null, 0.05, 0.05); },
    // Troll Gun: a sci-fi "pew" and an electric crackle
    zap(t) {
        tone(t, 'square', 2200, 300, 0.18, 0.06);
        tone(t, 'sawtooth', 1400, 200, 0.22, 0.04);
        noise(t, 0.2, 'bandpass', 3000, 2, 0.12, sfxBus, 800);
    },
    zapped(t) { SFX.zap(t); springTone(t + 0.05, 320, 0.5, 0.14); noise(t + 0.02, 0.3, 'highpass', 4000, 0.7, 0.1, sfxBus); },
    bonus(t) { [84, 88, 91, 96, 100, 103].forEach((n, i) => tone(t + i * 0.06, 'triangle', midi(n), null, 0.35, 0.1)); },
    shield(t) { for (let i = 0; i < 6; i++) tone(t + i * 0.04, 'sine', midi(86 + i * 2), null, 0.25, 0.04); },
    admin(t) { tone(t, 'sawtooth', 300, 1200, 0.25, 0.05); [84, 91].forEach((n, i) => tone(t + 0.1 + i * 0.08, 'triangle', midi(n), null, 0.3, 0.1)); },
};
export function sfx(name) {
    if (!ctx || !SFX[name] || settings.sfx <= 0) return;
    SFX[name](ctx.currentTime + 0.005);
}

// ----- continuous sounds: jetpack thrust, carpet shimmer, grapple reel -----
const loops = {};
function makeLoop(kind) {
    const g = ctx.createGain(); g.gain.value = 0; g.connect(sfxBus);
    if (kind === 'jet') {
        const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; f.Q.value = 0.8;
        src.connect(f).connect(g); src.start();
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 55; const og = ctx.createGain(); og.gain.value = 0.15;
        o.connect(og).connect(f); o.start();
    } else if (kind === 'carpet') {
        for (const n of [84, 88, 91]) {
            const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = midi(n);
            const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 0.4 + Math.random(); lg.gain.value = 6; l.connect(lg).connect(o.detune);
            const og = ctx.createGain(); og.gain.value = 0.3; o.connect(og).connect(g); g.connect(reverb); o.start(); l.start();
        }
        const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.8;
        const ng = ctx.createGain(); ng.gain.value = 0.6; src.connect(f).connect(ng).connect(g); src.start();
    } else if (kind === 'reel') {
        const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 60;
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 3;
        o.connect(f).connect(g); o.start();
    }
    return g;
}
export function loopSound(kind, level) {
    if (!ctx) return;
    if (!loops[kind]) { if (!level) return; loops[kind] = makeLoop(kind); }
    const vol = { jet: 0.22, carpet: 0.03, reel: 0.05 }[kind] || 0.1;
    loops[kind].gain.setTargetAtTime((level || 0) * vol, ctx.currentTime, 0.06);
}
