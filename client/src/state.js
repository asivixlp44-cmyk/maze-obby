// Local mirror of this player's progress. The server owns the real values:
// public stats arrive through the room state, private ones in "profile" messages.
export const S = {
    wins: 0, totalWins: 0, climbs: 0, playtime: 0, stage: -1, maxStage: 0, best: 0,
    pets: {}, equippedPets: [], trails: { starter: true }, trail: 'starter', gear: {}, tool: '', passes: {},
    boostUntil: 0, daily: null, codes: {}, fx: '', bonusAt: 0,
    firstPlay: Date.now(), giftClaimed: {}, sessionSecs: 0, joinedAt: Date.now(), name: '', friends: 0,
    profileAt: Date.now(),
};

// Game actions that world objects (pads, doors, boards) trigger; filled in by main.js / ui.js
export const actions = {};

export const net = {
    room: null,
    offset: 0,
    send(type, msg) { if (this.room) this.room.send(type, msg || {}); },
    // Server clock in ms, so moving platforms and timers line up for everyone (QA runs can pin it)
    fixedNow: null,
    now() { return this.fixedNow ?? Date.now() + this.offset; },
};
