// Free Morphs: blocky costumes you can wear (the reference's row of characters in the lobby).
// Each morph is built like the default blocky body (a torso + head group, two arms and two legs that
// swing) out of boxes with the colour in the vertices, merged into one mesh per limb: five draw
// calls per player, one shared matte material (no new shaders). The lobby statues are merged into a
// single mesh each.
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { T, matte, mergeChildren } from './engine.js';

let vcMat = null;
const material = () => (vcMat || (vcMat = matte({ vertexColors: true })));
const tmpC = new T.Color();
function colored(g, color) {
    g = g.index ? g.toNonIndexed() : g;
    tmpC.set(color);
    const n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = tmpC.r; a[i * 3 + 1] = tmpC.g; a[i * 3 + 2] = tmpC.b; }
    g.setAttribute('color', new T.BufferAttribute(a, 3));
    return g;
}
// A list of coloured parts for one limb; mesh() merges them
function parts() {
    const list = [];
    return {
        box(sx, sy, sz, x, y, z, color, rx, ry, rz) {
            const g = new T.BoxGeometry(sx, sy, sz);
            if (rx || ry || rz) g.rotateX(rx || 0).rotateY(ry || 0).rotateZ(rz || 0);
            g.translate(x, y, z);
            list.push(colored(g, color));
        },
        cone(r, h, x, y, z, color, seg, rx, rz) {
            const g = new T.ConeGeometry(r, h, seg || 6);
            if (rx) g.rotateX(rx);
            if (rz) g.rotateZ(rz);
            g.translate(x, y, z);
            list.push(colored(g, color));
        },
        ball(r, x, y, z, color) { const g = new T.SphereGeometry(r, 10, 8); g.translate(x, y, z); list.push(colored(g, color)); },
        mesh() {
            const m = new T.Mesh(mergeGeometries(list), material());
            m.castShadow = true; m.receiveShadow = true;
            for (const g of list) g.dispose();
            return m;
        },
    };
}

// Faces on the front of a 1.2 head centred at y = 4.6 (front is +z)
const eyes = (p, white, pupil, y, gap, s) => {
    for (const sx of [-gap, gap]) {
        if (white) p.box(0.28 * (s || 1), 0.28 * (s || 1), 0.04, sx, y, 0.62, white);
        p.box(0.14 * (s || 1), 0.18 * (s || 1), 0.04, sx, y, 0.645, pupil);
    }
};
const smile = (p, color, y) => { p.box(0.42, 0.07, 0.04, 0, y, 0.63, color); p.box(0.08, 0.08, 0.04, -0.24, y + 0.06, 0.63, color); p.box(0.08, 0.08, 0.04, 0.24, y + 0.06, 0.63, color); };

// d: { torso, head, arm, hand, leg, shoe } colours plus extras(body, head) for hats and faces
function rig(d, extras) {
    const g = new T.Group();
    const body = parts(), head = parts();
    body.box(2, 2, 1, 0, 3, 0, d.torso);
    if (d.belt) body.box(2.04, 0.22, 1.04, 0, 2.2, 0, d.belt);
    head.box(d.headW || 1.2, d.headH || 1.2, d.headD || 1.2, 0, 4.6 + ((d.headH || 1.2) - 1.2) / 2, 0, d.head);
    if (extras) extras(body, head);
    const bodyMesh = body.mesh(); g.add(bodyMesh);
    const headGroup = new T.Group(); headGroup.add(head.mesh()); g.add(headGroup);
    const legs = [], arms = [];
    for (const side of [-0.5, 0.5]) {
        const p = new T.Group(); p.position.set(side, 2, 0); g.add(p);
        const l = parts();
        l.box(1, 2, 1, 0, -1, 0, d.leg);
        if (d.shoe) l.box(1.04, 0.4, 1.2, 0, -1.82, 0.08, d.shoe);
        if (d.legExtra) d.legExtra(l, side);
        p.add(l.mesh());
        legs.push(p);
    }
    for (const side of [-1.5, 1.5]) {
        const p = new T.Group(); p.position.set(side, 3.9, 0); g.add(p);
        const a = parts();
        a.box(1, 2, 1, 0, -0.9, 0, d.arm);
        if (d.hand) a.box(1.02, 0.5, 1.02, 0, -1.65, 0, d.hand);
        p.add(a.mesh());
        arms.push(p);
    }
    g.userData.legs = legs; g.userData.arms = arms; g.userData.head = headGroup;
    return g;
}

const BUILD = {
    // The classic: yellow head and arms, blue torso, green legs
    noob: () => rig({ torso: 0x0d69ac, head: 0xf5cd30, arm: 0xf5cd30, leg: 0xa4bd47 }, (b, h) => { eyes(h, 0, 0x1a1a1a, 4.75, 0.24); smile(h, 0x1a1a1a, 4.32); }),
    // A tall blue monster with big googly eyes
    blue: () => rig({ torso: 0x2a5aff, head: 0x2a5aff, arm: 0x2a5aff, leg: 0x2246d8, headH: 1.6, headW: 1.5, headD: 1.4 }, (b, h) => {
        for (const sx of [-0.34, 0.34]) { h.box(0.5, 0.5, 0.06, sx, 5.05, 0.72, 0xffffff); h.box(0.22, 0.26, 0.06, sx + 0.04, 5.0, 0.76, 0x101018); }
        h.box(0.8, 0.26, 0.06, 0, 4.5, 0.72, 0x1a0a20); h.box(0.6, 0.08, 0.07, 0, 4.58, 0.74, 0xffffff);
        h.cone(0.16, 0.5, 0, 5.98, 0, 0xffd028, 6);
    }),
    // A banana suit: a long yellow body with a brown tip, little arms and legs
    banana: () => rig({ torso: 0xffe03a, head: 0xffe03a, arm: 0xffd028, leg: 0xffd028, shoe: 0x6a4a1a, headH: 1.6 }, (b, h) => {
        h.box(0.5, 0.5, 0.5, 0, 5.75, -0.1, 0x6a4a1a, 0.3);
        b.box(2.1, 0.5, 1.1, 0, 2.15, 0, 0xf0c820);
        eyes(h, 0xffffff, 0x101010, 4.95, 0.26); smile(h, 0x5a3a10, 4.5);
    }),
    // A silver robot with a glowing visor and an antenna
    robot: () => rig({ torso: 0xb8c0cc, head: 0xc8d0da, arm: 0x9aa2ae, leg: 0x8a929e, hand: 0x5a626e, shoe: 0x4a525e }, (b, h) => {
        h.box(1.0, 0.42, 0.06, 0, 4.72, 0.62, 0x14202e);
        for (const sx of [-0.24, 0.24]) h.box(0.2, 0.12, 0.07, sx, 4.72, 0.65, 0x2ae8ff);
        h.box(0.08, 0.6, 0.08, 0, 5.5, 0, 0x5a626e); h.ball(0.16, 0, 5.85, 0, 0xff3a3a);
        b.box(1.0, 0.8, 0.06, 0, 3.2, 0.52, 0x3a4a5a); b.box(0.2, 0.2, 0.07, -0.25, 3.3, 0.55, 0x46ff5a); b.box(0.2, 0.2, 0.07, 0.25, 3.3, 0.55, 0xffd028);
    }),
    // A knight in shining armour with a red plume
    knight: () => rig({ torso: 0x9aa2ae, head: 0xa8b0bc, arm: 0x8a929e, leg: 0x7a828e, hand: 0x5a5e66, shoe: 0x4a4e56, belt: 0xd8a830 }, (b, h) => {
        h.box(1.3, 0.12, 1.3, 0, 4.0, 0, 0x8a929e);
        h.box(0.9, 0.1, 0.06, 0, 4.72, 0.62, 0x1a1a22); h.box(0.1, 0.5, 0.06, 0, 4.5, 0.62, 0x1a1a22);
        h.box(0.3, 0.5, 1.1, 0, 5.4, -0.05, 0xe8213f); h.box(0.26, 0.3, 0.6, 0, 5.1, -0.6, 0xe8213f);
        b.box(1.3, 1.3, 0.06, 0, 3.1, 0.52, 0xe8213f); b.box(0.3, 1.0, 0.07, 0, 3.1, 0.55, 0xffd028); b.box(1.0, 0.3, 0.07, 0, 3.3, 0.55, 0xffd028);
    }),
    // A ninja in black with a red belt and headband
    ninja: () => rig({ torso: 0x1a1a22, head: 0x1a1a22, arm: 0x1a1a22, leg: 0x22222c, hand: 0x14141a, shoe: 0x101014, belt: 0xd81e2e }, (b, h) => {
        h.box(1.0, 0.3, 0.06, 0, 4.72, 0.61, 0xf2c9a0);
        for (const sx of [-0.24, 0.24]) h.box(0.18, 0.1, 0.07, sx, 4.72, 0.64, 0x101010);
        h.box(1.24, 0.18, 1.24, 0, 5.0, 0, 0xd81e2e); h.box(0.12, 0.5, 0.06, 0.2, 4.7, -0.66, 0xd81e2e, 0, 0, 0.3); h.box(0.12, 0.5, 0.06, -0.1, 4.65, -0.66, 0xd81e2e, 0, 0, -0.2);
        b.box(0.24, 1.6, 0.08, 0.5, 3.2, -0.55, 0x5a5a66, 0, 0, 0.6);
    }),
    // A green zombie in a torn blue shirt
    zombie: () => rig({ torso: 0x3a5a8a, head: 0x6aa84a, arm: 0x6aa84a, hand: 0x5a9a3a, leg: 0x4a3a2a, shoe: 0x2a2018 }, (b, h) => {
        eyes(h, 0xe8e070, 0x2a1010, 4.75, 0.25); h.box(0.5, 0.12, 0.04, 0, 4.32, 0.63, 0x2a1010);
        h.box(0.5, 0.2, 0.06, -0.2, 5.12, 0.3, 0x4a7a32);
        b.box(0.6, 0.5, 0.06, 0.4, 2.4, 0.52, 0x6aa84a); b.box(0.4, 0.4, 0.06, -0.5, 3.4, 0.52, 0x6aa84a);
    }),
    // A princess: pink dress flaring over the legs, golden hair and crown
    princess: () => rig({ torso: 0xff7ab8, head: 0xf8d4b0, arm: 0xf8d4b0, leg: 0xf8d4b0, shoe: 0xff4a8a, legExtra: (l, side) => l.box(1.25, 1.3, 1.3, side * 0.15, -0.5, 0, 0xff8ac4) }, (b, h) => {
        eyes(h, 0xffffff, 0x3a6ad8, 4.75, 0.24); smile(h, 0xd84a6a, 4.34);
        h.box(1.3, 0.35, 1.3, 0, 5.3, -0.02, 0xffd86a); h.box(1.3, 1.2, 0.35, 0, 4.7, -0.55, 0xffd86a);
        for (let k = -2; k <= 2; k++) h.cone(0.12, 0.38, k * 0.24, 5.66, 0, 0xffc828, 4);
        h.box(1.22, 0.14, 1.22, 0, 5.47, 0, 0xffc828);
        b.box(2.04, 0.3, 1.04, 0, 3.85, 0, 0xffffff);
    }),
    // A dino hoodie: snout, teeth, back spikes and a tail
    dino: () => rig({ torso: 0x4ac84a, head: 0x4ac84a, arm: 0x3ab83a, leg: 0x3ab83a, hand: 0xf2c9a0, shoe: 0x2a8a2a }, (b, h) => {
        h.box(1.0, 0.6, 0.7, 0, 4.5, 0.9, 0x4ac84a);
        for (let k = -2; k <= 2; k++) h.cone(0.07, 0.18, k * 0.18, 4.17, 1.2, 0xffffff, 4, Math.PI);
        for (const sx of [-0.32, 0.32]) { h.box(0.26, 0.26, 0.06, sx, 4.95, 0.62, 0xffffff); h.box(0.12, 0.16, 0.07, sx, 4.95, 0.65, 0x101010); }
        for (let k = 0; k < 4; k++) b.cone(0.22, 0.5, 0, 5.4 - k * 0.75, -0.6 - (k > 0 ? 0 : 0) , 0xff9a2a, 4, -Math.PI / 2);
        b.box(0.8, 0.7, 1.6, 0, 2.3, -1.2, 0x4ac84a, -0.35);
        b.box(0.5, 0.45, 1.0, 0, 1.8, -2.2, 0x3ab83a, -0.5);
    }),
};
// A morph rig, ready to animate like the blocky body (userData.legs / arms / head)
export function buildMorph(id) {
    const f = BUILD[id];
    return f ? f() : null;
}
// A single-mesh copy for the lobby's display stands
export function morphStatue(id) {
    const g = buildMorph(id);
    if (!g) return new T.Group();
    g.userData.arms[0].rotation.x = -0.25; g.userData.arms[1].rotation.x = 0.2;
    mergeChildren(g);
    return g;
}
export const morphMaterial = material;
