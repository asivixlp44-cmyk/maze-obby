// Gear models: the coils (springs, like the reference's pads), the Magic Carpet, the Ray Gun and the
// Deadly Sword. The same models sit spinning on the lobby GAMEPASS pads, ride in your hand, or lie
// under your feet (the carpet). Matte plastic with a little glow, merged into a few meshes each.
import { T, matte, mergeChildren } from './engine.js';
import { carpetTex } from './materials.js';

const mats = new Map();
const gm = (key, make) => { if (!mats.has(key)) mats.set(key, make()); return mats.get(key); };
const plastic = (color, glow) => gm('p' + color + '|' + (glow || 0), () => matte({ color, emissive: color, emissiveIntensity: glow ?? 0.25 }));

class Helix extends T.Curve {
    constructor(r, h, turns) { super(); this.r = r; this.h = h; this.turns = turns; }
    getPoint(t, out) { const a = t * Math.PI * 2 * this.turns; return (out || new T.Vector3()).set(Math.cos(a) * this.r, t * this.h - this.h / 2, Math.sin(a) * this.r); }
}
const helixGeo = new T.TubeGeometry(new Helix(0.95, 2.8, 5.5), 88, 0.18, 6, false);

function coil(color, rainbow) {
    const g = new T.Group();
    let m = plastic(color, 0.35);
    if (rainbow) {
        const geo = helixGeo.clone(), p = geo.attributes.position, col = new Float32Array(p.count * 3), c = new T.Color();
        for (let i = 0; i < p.count; i++) { c.setHSL(((p.getY(i) + 1.4) / 2.8) * 0.85, 0.9, 0.6); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
        geo.setAttribute('color', new T.BufferAttribute(col, 3));
        m = gm('rainbowcoil', () => matte({ vertexColors: true, emissive: 0x332233, emissiveIntensity: 0.4 }));
        const spring = new T.Mesh(geo, m); spring.castShadow = true; spring.userData.keep = true; g.add(spring);
    } else {
        const spring = new T.Mesh(helixGeo, m); spring.castShadow = true; g.add(spring);
    }
    const cap = new T.Mesh(new T.CylinderGeometry(1.1, 1.1, 0.24, 24), plastic(0xf4f4ff, 0.1));
    cap.position.y = -1.48; g.add(cap);
    const cap2 = cap.clone(); cap2.position.y = 1.48; g.add(cap2);
    return g;
}
// The reference's ray gun: a dark body with teal bands and a glowing tip
function rayGun() {
    const g = new T.Group();
    const teal = plastic(0x2ae8d8, 0.45), dark = plastic(0x2a2a3a, 0.05), white = plastic(0xffffff, 0.2);
    const body = new T.Mesh(new T.CapsuleGeometry(0.55, 1.9, 6, 14), dark); body.rotation.x = Math.PI / 2; body.castShadow = true; g.add(body);
    for (const z of [-0.6, 0.1, 0.8]) { const band = new T.Mesh(new T.TorusGeometry(0.58, 0.12, 6, 20), teal); band.position.z = z; g.add(band); }
    const barrel = new T.Mesh(new T.CylinderGeometry(0.28, 0.36, 1.3, 14), white); barrel.rotation.x = Math.PI / 2; barrel.position.z = 1.75; g.add(barrel);
    const tip = new T.Mesh(new T.SphereGeometry(0.34, 14, 10), teal); tip.position.z = 2.45; g.add(tip);
    const fin = new T.Mesh(new T.BoxGeometry(0.12, 0.7, 1.1), teal); fin.position.set(0, 0.7, -0.2); g.add(fin);
    const grip = new T.Mesh(new T.BoxGeometry(0.5, 1.3, 0.6), dark); grip.position.set(0, -0.9, -0.55); grip.rotation.x = 0.3; g.add(grip);
    const trig = new T.Mesh(new T.TorusGeometry(0.28, 0.07, 6, 12, Math.PI), white); trig.position.set(0, -0.6, -0.05); trig.rotation.z = Math.PI; g.add(trig);
    return g;
}
export function carpet(scale) {
    const g = new T.Group();
    const geo = new T.PlaneGeometry(4.2, 6, 10, 14);
    geo.rotateX(-Math.PI / 2);
    const m = gm('carpet', () => matte({ map: carpetTex(), side: T.DoubleSide, emissive: 0xffffff, emissiveMap: carpetTex(), emissiveIntensity: 0.25 }));
    const cloth = new T.Mesh(geo, m); cloth.castShadow = true; g.add(cloth);
    g.userData.cloth = cloth;
    g.userData.base = Float32Array.from(geo.attributes.position.array);
    const tassel = plastic(0xffd028, 0.3);
    for (const [x, z] of [[-2.1, -3], [2.1, -3], [-2.1, 3], [2.1, 3]]) {
        const t = new T.Mesh(new T.ConeGeometry(0.22, 0.7, 8), tassel); t.position.set(x * 1.03, 0, z * 1.03); t.rotation.x = z > 0 ? Math.PI / 2 : -Math.PI / 2; g.add(t);
    }
    g.scale.setScalar(scale || 1);
    g.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
    return g;
}
// Ripple the carpet cloth like it's floating on the wind
export function waveCarpet(g, t, amt) {
    const cloth = g.userData.cloth, base = g.userData.base;
    if (!cloth) return;
    const p = cloth.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
        const x = base[i * 3], z = base[i * 3 + 2];
        p.array[i * 3 + 1] = Math.sin(z * 1.3 + t * 6) * 0.14 * amt + Math.sin(x * 1.8 + t * 4) * 0.06 * amt;
    }
    p.needsUpdate = true;
    cloth.geometry.computeVertexNormals();
}

// The reference's one-hit sword: a glowing purple blade with a gold guard
function sword() {
    const g = new T.Group();
    const blade = plastic(0xb46aff, 0.75), edge = plastic(0xffffff, 0.6), gold = plastic(0xffc828, 0.3), dark = plastic(0x2a1a3a, 0.05);
    const b = new T.Mesh(new T.BoxGeometry(0.34, 3.4, 0.12), blade); b.position.y = 2.1; b.castShadow = true; g.add(b);
    const tip = new T.Mesh(new T.ConeGeometry(0.24, 0.6, 4), blade); tip.position.y = 4.1; tip.rotation.y = Math.PI / 4; tip.scale.z = 0.35; g.add(tip);
    const e = new T.Mesh(new T.BoxGeometry(0.06, 3.3, 0.14), edge); e.position.set(0.12, 2.1, 0); g.add(e);
    const guard = new T.Mesh(new T.BoxGeometry(1.3, 0.24, 0.34), gold); guard.position.y = 0.32; g.add(guard);
    const grip = new T.Mesh(new T.CylinderGeometry(0.13, 0.13, 0.9, 8), dark); grip.position.y = -0.25; g.add(grip);
    const pommel = new T.Mesh(new T.SphereGeometry(0.2, 10, 8), gold); pommel.position.y = -0.75; g.add(pommel);
    g.position.y = -1.4;
    const holder = new T.Group(); holder.add(g);
    return holder;
}

const BUILD = {
    speedCoil: () => coil(0xff3a4a),
    gravityCoil: () => coil(0x3a8aff),
    superCoil: () => coil(0xc45aff, true),
    rayGun: () => rayGun(),
    sword: () => sword(),
    carpet: () => carpet(0.75),
};
// A gear model, about 3 studs tall, centred on its own origin
export function gearModel(id) {
    const f = BUILD[id];
    const g = f ? f() : new T.Group();
    if (id !== 'carpet') mergeChildren(g);
    g.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
    return g;
}
// A smaller copy to hold in the right hand
export function heldModel(id) {
    if (id === 'carpet') return null;
    const g = gearModel(id);
    if (id.endsWith('Coil')) { g.scale.setScalar(0.42); g.position.set(0, -0.2, 0.7); }
    else if (id === 'rayGun') { g.scale.setScalar(0.6); g.position.set(0, -0.15, 0.95); }
    else if (id === 'sword') { g.scale.setScalar(0.62); g.rotation.x = Math.PI / 2; g.position.set(0, -0.1, 0.6); }
    const holder = new T.Group(); holder.add(g);
    return holder;
}
