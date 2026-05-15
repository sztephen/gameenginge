'use strict';

// ============================================================
//  entities.js — player + enemy + boss lifecycle:
//  creation, spawning, damage, kill, particles, AI helpers.
//  Depends on globals from sprites.js, sfx.js, data.js, and the
//  `world` object (defined in game.js).
// ============================================================

function initWeapon(p, id) {
  switch (id) {
    case 'knife':     p.weapons.knife     = { cd: 0, rate: 0.6, dmg: 18, speed: 240, count: 1, pierce: 1 }; break;
    case 'aura':      p.weapons.aura      = { cd: 0, rate: 0.5, dmg: 14, radius: 31 }; break;
    case 'holy':      p.weapons.holy      = { cd: 0, rate: 1.6, dmg: 8, count: 1, duration: 3.0, puddleRadius: 29, healPerTick: 1 }; break;
    case 'ice':       p.weapons.ice       = { cd: 0, rate: 0.45, dmg: 10, speed: 280, slow: 1.4, count: 1 }; break;
    case 'lightning': p.weapons.lightning = { cd: 0, rate: 1.0, dmg: 22, chains: 2, range: 200 }; break;
    case 'shards':    p.weapons.shards    = { cd: 0, rate: 4.0, dmg: 14, count: 3, fragments: 4, life: 7.0, orbitRadius: 32, fragmentDmg: 7 }; break;
    case 'hole':      p.weapons.hole      = { cd: 0, rate: 6.0, dmg: 60, radius: 44, duration: 2.0, pullForce: 90 }; break;
    case 'flame':     p.weapons.flame     = {
      cd: 0, rate: 2.2, dmg: 8, range: 70, halfAngle: 0.42,
      duration: 0.55, dmgInterval: 0.12,
      fourWay: false,
    }; break;
    case 'banana':    p.weapons.banana    = {
      cd: 0, rate: 1.3, dmg: 22, count: 1,
      range: 130, speed: 320,
      splash: false, splashRadius: 28,
    }; break;
  }
}

function addWeapon(p, id) {
  if (!p || !WEAPONS[id]) return false;
  if (p.slots.includes(id)) return false;
  if (p.slots.length >= MAX_SLOTS) return false;
  p.slots.push(id);
  initWeapon(p, id);
  return true;
}

function removeWeapon(p, id) {
  if (!p) return;
  const idx = p.slots.indexOf(id);
  if (idx < 0) return;
  if (id === 'knife' && p.slots.length === 1) return; // never empty
  p.slots.splice(idx, 1);
  delete p.weapons[id];
  for (const upgId of WEAPONS[id].upgradeIds) {
    delete p.upgradeLevels[upgId];
  }
  const wepSuper = SUPERS.find(s => s.weaponId === id);
  if (wepSuper) delete p.superUnlocked[wepSuper.id];
}

function createPlayer(opts = {}) {
  const team = opts.team || 'blue'; // 'blue' = P1, 'red' = P2
  const skinIdx = clamp(opts.skin || 0, 0, PLAYER_SKINS.length - 1);
  const p = {
    id: opts.id || 1,
    name: opts.name || 'P1',
    team,
    controls: opts.controls || { up: 'w', down: 's', left: 'a', right: 'd' },
    sprites: playerSkinFrames[team][skinIdx],
    skinId: PLAYER_SKINS[skinIdx].id,
    skinName: PLAYER_SKINS[skinIdx].name,
    theme: opts.theme || (team === 'red' ? '#ff6666' : '#6abfff'),
    x: opts.x || 0, y: opts.y || 0, vx: 0, vy: 0,
    w: 14, h: 16,
    speed: 82,
    hp: 100, hpMax: 100,
    xp: 0, xpNext: 5, level: 1,
    pickupRadius: 44,
    invuln: 0,
    facing: 1,
    animT: 0,
    lifestealAcc: 0,
    slowedUntil: 0,
    weapons: {},
    slots: ['knife'],
    upgradeLevels: {},
    superUnlocked: {},
    levelUpQueue: 0,
    dead: false,
    mods: { dmgMult: 1, speedMult: 1, areaMult: 1, magnetMult: 1, lifestealPct: 0, xpBoost: 0 },
    stats: {
      kills: 0,
      dmgDealt: 0,
      healed: 0,
      xpGained: 0,
      gemsCollected: 0,
      damageByWeapon: {},
    },
  };
  initWeapon(p, 'knife');
  return p;
}

// Maps a weapon slot id to the super-power id that upgrades it. When that
// super is unlocked, the weapon's visuals switch to an orange "ignited" palette.
const SUPER_BY_WEAPON = {
  knife: 'super_blade', aura: 'super_aura', holy: 'super_holy',
  ice: 'super_ice', lightning: 'super_lightning', shards: 'super_shards',
  hole: 'super_hole', flame: 'super_flame', banana: 'super_banana',
};
function weaponIsSuper(p, weaponId) {
  if (!p || !p.superUnlocked || !weaponId) return false;
  const sid = SUPER_BY_WEAPON[weaponId];
  return sid ? !!p.superUnlocked[sid] : false;
}

// Compounding ice slow. Each consecutive ice hit while still slowed deepens
// the multiplier through three stages (0.45 → 0.30 → 0.15). Stacks reset once
// the slow expires.
function enemySlowFactor(e) {
  if (!e || e.slowedUntil <= world.time) return 1.0;
  const s = e.iceStacks || 1;
  return s >= 3 ? 0.15 : s >= 2 ? 0.30 : 0.45;
}

function alivePlayers() {
  return world.players.filter(p => p && !p.dead);
}
function nearestPlayer(x, y) {
  let best = null, bd = Infinity;
  for (const p of world.players) {
    if (!p || p.dead) continue;
    const dx = p.x - x, dy = p.y - y;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

// HP ramps hard so late-game enemies survive maxed-out weapons long enough to
// reach the player. Damage ramps slow so single hits stay survivable. Speed
// ramps modestly so the ones that *do* live close the distance instead of
// being kited forever.
//   At minute 10 (4 min past threshold): HP ×3.2, DMG ×1.4, Speed ×1.16
//   At minute 15 (9 min past threshold): HP ×5.9, DMG ×1.9, Speed ×1.36
function lateGameHpMult() {
  const t = world.time;
  if (t < LATE_GAME_T) return 1;
  const over = t - LATE_GAME_T;
  // First 3 min past the threshold (6→9 min) is the gentle 0.55/min ramp.
  // After 9 min, slope accelerates to 0.95/min so endgame enemies actually
  // soak hits from maxed weapons instead of evaporating.
  if (over <= 180) return 1 + (over / 60) * 0.55;
  return 1 + 3 * 0.55 + ((over - 180) / 60) * 0.95;
}
function lateGameDmgMult() {
  const t = world.time;
  if (t < LATE_GAME_T) return 1;
  return 1 + ((t - LATE_GAME_T) / 60) * 0.10;
}
function lateGameSpeedMult() {
  const t = world.time;
  if (t < LATE_GAME_T) return 1;
  return 1 + Math.min(0.40, ((t - LATE_GAME_T) / 60) * 0.04);
}
// Back-compat alias — call sites that still treat it as a single value get HP.
function lateGameMult() { return lateGameHpMult(); }

// ---------- ENEMY SPAWN ----------
// Per-tier base stats for normal zombies. Heavy (behemoth) is a separate type
// that rolls outside the normal pool with its own ramp curve.
const ZOMBIE_TIERS = [
  { hp: 24, dmg:  8, speedBase: 38, speedJitter: 14 }, // 0 — SHAMBLER
  { hp: 32, dmg: 11, speedBase: 38, speedJitter: 14 }, // 1 — ROTTER
  { hp: 44, dmg: 14, speedBase: 38, speedJitter: 14 }, // 2 — GHOUL
];

function spawnEnemy() {
  if (world.titanSpawned) return; // titan halts all spawns
  const alives = alivePlayers();
  const anchor = alives.length ? alives[irand(0, alives.length - 1)] : world.player;
  if (!anchor) return;
  const angle = Math.random() * TAU;
  const radius = 220 + Math.random() * 60;
  const x = anchor.x + Math.cos(angle) * radius;
  const y = anchor.y + Math.sin(angle) * radius;
  // In wave mode, time-gated unlocks/HP/dmg ramps off the wave's mapped game
  // time rather than the real clock, so wave 5 plays like minute ~2:15 etc.
  const t = world.waveSpawnTime != null ? world.waveSpawnTime : world.time;
  const mHp = world.waveSpawnTime != null
    ? (() => {
        const over = Math.max(0, world.waveSpawnTime - LATE_GAME_T);
        if (over <= 180) return 1 + (over / 60) * 0.55;
        return 1 + 3 * 0.55 + ((over - 180) / 60) * 0.95;
      })()
    : lateGameHpMult();
  const mDmg = world.waveSpawnTime != null
    ? (1 + Math.max(0, (world.waveSpawnTime - LATE_GAME_T) / 60) * 0.10)
    : lateGameDmgMult();
  const mSpd = world.waveSpawnTime != null
    ? (1 + Math.min(0.40, Math.max(0, (world.waveSpawnTime - LATE_GAME_T) / 60) * 0.04))
    : lateGameSpeedMult();
  const coopMult = world.players.length > 1 ? 1.35 : 1;
  // Speedrun discount: every enemy spawned in wave mode has 25% less HP to
  // keep clear-times reasonable across 30 waves.
  const speedrunHp = world.waveMode ? 0.75 : 1.0;
  // Past the late-game threshold, normal zombies gain a flat +25% HP on top
  // of the existing lateGameMult ramp, so endgame waves are noticeably tankier.
  const endgameHp = t >= LATE_GAME_T ? 1.25 : 1.0;

  // Heavy zombie ramp: noticeable from 4 min, dominant after 10 min. Pulled
  // earlier so the 6-min-onward easy stretch has a real threat in the pool.
  const heavyChance = t >= 600 ? 0.55 : t >= 360 ? 0.30 : t >= 240 ? 0.15 : 0;

  // Tier gating for the normal pool:
  //   < 5 min : tiers 0–2 mixed
  //   5–10 min: tier 0 (shambler) dropped — start at tier 1
  //   ≥ 10 min: only tier 2 (ghoul)
  const tierMin = t >= 600 ? 2 : t >= 300 ? 1 : 0;
  const tierMax = 2;

  const r = Math.random();
  const eliteChance    = t > ELITE_UNLOCK_T    ? 0.012 : 0;
  const exploderChance = t > EXPLODER_UNLOCK_T ? 0.030 : 0;
  const spitterChance  = t > SPITTER_UNLOCK_T  ? 0.040 : 0;
  const bruteChance    = t > BRUTE_UNLOCK_T    ? 0.140 : 0;

  const bloomChance = t > BLOOMLING_UNLOCK_T ? 0.08 : 0;
  const slingerChance = t > SLINGER_UNLOCK_T ? 0.07 : 0;

  let acc = 0;
  if (r < (acc += slingerChance)) {
    const hp = 220 * mHp * coopMult * speedrunHp;
    world.enemies.push({
      type: 'slinger', x, y, vx: 0, vy: 0, w: 16, h: 18,
      hp, hpMax: hp, speed: (38 + Math.random() * 6) * mSpd,
      dmg: 14 * mDmg * coopMult,
      sprites: slingerSprites, animT: Math.random() * 10,
      hit: 0, slowedUntil: 0,
      slingCd: 1.4 + Math.random() * 0.6,
    });
  } else if (r < (acc += bloomChance)) {
    const hp = 14 * mHp * coopMult * speedrunHp;
    world.enemies.push({
      type: 'bloomling', x, y, vx: 0, vy: 0, w: 14, h: 16,
      hp, hpMax: hp, speed: (78 + Math.random() * 16) * mSpd,
      dmg: 10 * mDmg * coopMult,
      sprites: bloomlingSprites, animT: Math.random() * 10,
      hit: 0, slowedUntil: 0,
    });
  } else if (r < (acc += eliteChance)) {
    const hp = 420 * mHp * coopMult * speedrunHp;
    world.enemies.push({
      type: 'elite', x, y, vx: 0, vy: 0, w: 24, h: 26,
      hp, hpMax: hp, speed: (30 + Math.random() * 6) * mSpd,
      dmg: 32 * mDmg * coopMult, sprites: bruteSprites, animT: Math.random() * 10,
      hit: 0, slowedUntil: 0, isElite: true,
    });
  } else if (r < (acc += exploderChance)) {
    const hp = 38 * mHp * coopMult * speedrunHp;
    world.enemies.push({
      type: 'exploder', x, y, vx: 0, vy: 0, w: 14, h: 16,
      hp, hpMax: hp, speed: (62 + Math.random() * 10) * mSpd,
      dmg: 50 * mDmg * coopMult,
      sprites: exploderSprites, animT: Math.random() * 10,
      hit: 0, slowedUntil: 0,
      fuseT: 0,
    });
  } else if (r < (acc += spitterChance)) {
    const hp = 56 * mHp * coopMult * speedrunHp;
    world.enemies.push({
      type: 'spitter', x, y, vx: 0, vy: 0, w: 14, h: 16,
      hp, hpMax: hp, speed: (26 + Math.random() * 6) * mSpd,
      dmg: 8 * mDmg * coopMult,
      sprites: spitterSprites, animT: Math.random() * 10,
      hit: 0, slowedUntil: 0,
      spitCd: 1.2,
      keepDist: 140,
    });
  } else if (r < (acc += bruteChance)) {
    const hp = 170 * mHp * coopMult * speedrunHp;
    world.enemies.push({
      type: 'brute', x, y, vx: 0, vy: 0, w: 22, h: 24,
      hp, hpMax: hp, speed: (26 + Math.random() * 6) * mSpd,
      dmg: 28 * mDmg * coopMult, sprites: bruteSprites, animT: Math.random() * 10,
      hit: 0, slowedUntil: 0,
    });
  } else if (r < (acc += heavyChance)) {
    // Behemoth: 2× the tier-2 HP and 1.5× the tier-2 damage. No +25% endgame
    // bonus — its scaling already comes from lateGameMult.
    const hp = 88 * mHp * coopMult * speedrunHp;
    world.enemies.push({
      type: 'behemoth', x, y, vx: 0, vy: 0, w: 18, h: 20,
      hp, hpMax: hp, speed: (28 + Math.random() * 6) * mSpd,
      dmg: 21 * mDmg * coopMult, sprites: behemothSprites, animT: Math.random() * 10,
      hit: 0, slowedUntil: 0,
    });
  } else {
    const tier = irand(tierMin, tierMax);
    const T = ZOMBIE_TIERS[tier];
    const hp = T.hp * mHp * coopMult * endgameHp * speedrunHp;
    world.enemies.push({
      type: 'zombie', x, y, vx: 0, vy: 0, w: 14, h: 16,
      hp, hpMax: hp,
      speed: (T.speedBase + Math.random() * T.speedJitter) * mSpd,
      dmg: T.dmg * mDmg * coopMult, sprites: zombieSets[tier], animT: Math.random() * 10,
      hit: 0, slowedUntil: 0,
      tier,
    });
  }
}

function spawnSwarmling(x, y) {
  world.enemies.push({
    type: 'swarmling',
    x: x + rand(-6, 6), y: y + rand(-6, 6),
    vx: 0, vy: 0, w: 8, h: 8,
    hp: 1, hpMax: 1,
    speed: 70 + Math.random() * 20,
    dmg: 1,
    animT: Math.random() * 10,
    hit: 0, slowedUntil: 0,
    summoned: true,
  });
}

function spawnBoss() {
  if (world.titanSpawned) return;
  // Avoid the same boss three times in a row: if the last two spawns were the
  // same type, exclude that type from the pool for this pick.
  const history = world.recentBosses;
  let pool = BOSS_TYPES;
  if (history.length >= 2 && history[history.length - 1] === history[history.length - 2]) {
    const banned = history[history.length - 1];
    pool = BOSS_TYPES.filter(t => t.id !== banned);
  }
  const type = pool[irand(0, pool.length - 1)];
  history.push(type.id);
  if (history.length > 4) history.shift();
  // In wave mode, the speedrun clock isn't a good proxy for difficulty — a
  // player can blast through 8 waves in 90s but the boss should still feel
  // like the corresponding mid-game boss. Map off the wave's natural time.
  const sourceT = world.waveSpawnTime != null ? world.waveSpawnTime : world.time;
  const minute = Math.max(1, Math.floor(sourceT / 60));
  const hpMult = 1 + (minute - 1) * 0.35;
  // Boss per-minute damage slope softened from 0.20 → 0.10 and the late-game
  // damage multiplier is now the gentle one — past minute 10 the stacked
  // multipliers were one-shotting maxed players.
  const dmgMult = 1 + (minute - 1) * 0.10;
  const coopMult = world.players.length > 1 ? 1.4 : 1;
  const lmHp = lateGameHpMult();
  const lmDmg = lateGameDmgMult();
  const anchor = alivePlayers()[0] || world.player;
  if (!anchor) return;
  const ang = Math.random() * TAU;
  const dist = 280 + Math.random() * 60;
  const hp = type.baseHp * hpMult * coopMult * lmHp;
  world.enemies.push({
    type: 'boss',
    bossType: type,
    bossName: type.name,
    minute,
    x: anchor.x + Math.cos(ang) * dist,
    y: anchor.y + Math.sin(ang) * dist,
    vx: 0, vy: 0,
    w: type.w, h: type.h,
    hp, hpMax: hp,
    speed: type.speed,
    dmg: type.baseDmg * dmgMult * coopMult * lmDmg,
    animT: Math.random() * 10,
    hit: 0, slowedUntil: 0,
    isBoss: true,
    abilityCd: type.abilityCd || 0,
    abilityCdMax: type.abilityCd || 0,
  });
  world.bossWarning = {
    t: 3.5, tMax: 3.5,
    name: type.name,
    subtitle: `MINUTE ${minute} BOSS — DROPS A CHEST`,
    desc: type.desc || '',
  };
  world.flash = 0.4;
  world.camera.shake = 10;
  SFX.bossSpawn();
}

function spawnTitan() {
  // Clear the field. Field-clearing matches the user's intent: "after the titan
  // spawns, no other zombies will spawn" — and we also wipe stragglers so the
  // arena feels cinematic.
  for (const e of world.enemies) e.dead = true;
  world.enemies = [];
  world.thorns = []; world.shockwaves = []; world.gasPuddles = []; world.spits = [];
  world.spores = []; world.glues = []; world.bossBombs = [];
  const anchor = alivePlayers()[0] || world.player;
  if (!anchor) return;
  const ang = Math.random() * TAU;
  const dist = 320;
  const lmHp = lateGameHpMult();
  const lmDmg = lateGameDmgMult();
  const coopMult = world.players.length > 1 ? 1.5 : 1;
  const speedrunHp = world.waveMode ? 0.75 : 1.0;
  const hp = TITAN_TYPE.baseHp * coopMult * lmHp * speedrunHp;
  world.enemies.push({
    type: 'boss',
    bossType: TITAN_TYPE,
    bossName: TITAN_TYPE.name,
    minute: 15,
    isTitan: true,
    x: anchor.x + Math.cos(ang) * dist,
    y: anchor.y + Math.sin(ang) * dist,
    vx: 0, vy: 0,
    w: TITAN_TYPE.w, h: TITAN_TYPE.h,
    hp, hpMax: hp,
    speed: TITAN_TYPE.speed,
    dmg: TITAN_TYPE.baseDmg * coopMult * lmDmg,
    animT: 0,
    hit: 0, slowedUntil: 0,
    isBoss: true,
    abilityCd: 3,
    abilityCdMax: TITAN_TYPE.abilityCd,
    phase: 0,
  });
  world.bossWarning = {
    t: 5.5, tMax: 5.5,
    name: TITAN_TYPE.name,
    subtitle: 'FINAL BATTLE — DEFEAT TO WIN',
    desc: TITAN_TYPE.desc || '',
  };
  world.flash = 1.0;
  world.camera.shake = 16;
  SFX.titanRoar();
}

// ---------- BOSS ABILITIES ----------
function tickBossAbility(e, dt) {
  const ab = e.bossType.ability;
  if (!ab) return;
  // Titan enrage at ≤20% HP — one-shot transition: faster, faster abilities, red.
  if (e.isTitan && !e.enraged && e.hp <= e.hpMax * 0.2) {
    e.enraged = true;
    e.speed *= 1.5;
    e.abilityCdMax = TITAN_TYPE.abilityCd / 1.5;
    if (e.abilityCd > e.abilityCdMax) e.abilityCd = e.abilityCdMax;
    world.flash = Math.max(world.flash, 0.6);
    world.camera.shake = Math.max(world.camera.shake, 14);
    SFX.titanRoar();
  }
  // Stephen quakes on its own timer, independent of the bomb-throw cycle.
  if (e.bossType.id === 'stephen') {
    e.quakeCd = (e.quakeCd == null ? 2.5 : e.quakeCd) - dt;
    if (e.quakeCd <= 0) {
      e.quakeCd = 3.2;
      triggerStephenQuake(e);
    }
  }
  e.abilityCd -= dt;
  if (e.abilityCd > 0) return;
  e.abilityCd = e.abilityCdMax;
  if (ab === 'teleport') {
    const tgt = nearestPlayer(e.x, e.y); if (!tgt) return;
    spawnParticles(e.x, e.y, 24, { colors: ['#aaffaa', '#003311', '#fff'], speed: 120, life: 0.4, gravity: 0 });
    const ang = Math.random() * TAU;
    e.x = tgt.x + Math.cos(ang) * 70;
    e.y = tgt.y + Math.sin(ang) * 70;
    spawnParticles(e.x, e.y, 24, { colors: ['#aaffaa', '#fff'], speed: 120, life: 0.4, gravity: 0 });
    SFX.bossTeleport();
  } else if (ab === 'summon') {
    SFX.bossSummon();
    const mHp = lateGameHpMult();
    const mDmg = lateGameDmgMult();
    const coopMult = world.players.length > 1 ? 1.35 : 1;
    const count = 3 + Math.floor(e.minute / 3);
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * TAU;
      const tier = irand(0, zombieSets.length - 1);
      const hp = 20 * mHp * coopMult;
      world.enemies.push({
        type: 'zombie',
        x: e.x + Math.cos(ang) * 24, y: e.y + Math.sin(ang) * 24,
        vx: 0, vy: 0, w: 14, h: 16,
        hp, hpMax: hp,
        speed: 50 + Math.random() * 18,
        dmg: 9 * mDmg * coopMult, sprites: zombieSets[tier], animT: Math.random() * 10,
        hit: 0, slowedUntil: 0, summoned: true,
      });
    }
    spawnParticles(e.x, e.y, 18, { colors: ['#ff66cc', '#5a2880', '#fff'], speed: 90, life: 0.4, gravity: 0 });
  } else if (ab === 'thorns') {
    SFX.bossThorns();
    const count = 10 + Math.floor(e.minute);
    const dmg = e.dmg * 0.35;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU + rand(-0.1, 0.1);
      world.thorns.push({
        x: e.x, y: e.y,
        vx: Math.cos(a) * 110, vy: Math.sin(a) * 110,
        life: 2.2, maxLife: 2.2, dmg, hit: new Set(),
      });
    }
  } else if (ab === 'slam') {
    SFX.bossSlam();
    world.camera.shake = 10;
    const dmg = e.dmg * 0.6;
    world.shockwaves.push({
      x: e.x, y: e.y, r: 0, rMax: 130 + e.minute * 8,
      life: 0.5, maxLife: 0.5, dmg, hit: new Set(),
    });
  } else if (ab === 'swarm') {
    SFX.swarm();
    const count = 18 + Math.floor(e.minute * 1.5);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const r = 8 + Math.random() * 22;
      spawnSwarmling(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r);
    }
    spawnParticles(e.x, e.y, 22, { colors: ['#ffff66', '#aa44aa', '#fff'], speed: 110, life: 0.5, gravity: 0 });
  } else if (ab === 'gas') {
    SFX.gas();
    const tgt = nearestPlayer(e.x, e.y); if (!tgt) return;
    const count = 4 + Math.floor(e.minute / 2);
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * TAU;
      const r = rand(20, 80);
      world.gasPuddles.push({
        x: tgt.x + Math.cos(ang) * r,
        y: tgt.y + Math.sin(ang) * r,
        r: 24, life: 8.0, maxLife: 8.0,
        dmg: e.dmg * 0.15, dmgInterval: 0.4, dmgTimer: 0,
      });
    }
  } else if (ab === 'stephen') {
    // Lobs 2–3 bombs toward each player. Each bomb arcs, lands, explodes for
    // area damage. Direct hit deals e.dmg.
    SFX.bomb();
    const targets = alivePlayers();
    if (targets.length === 0) return;
    const perTarget = 2 + Math.floor(e.minute / 4);
    for (const tgt of targets) {
      for (let i = 0; i < perTarget; i++) {
        const tx = tgt.x + rand(-30, 30);
        const ty = tgt.y + rand(-30, 30);
        world.bossBombs.push({
          x: e.x, y: e.y, sx: e.x, sy: e.y,
          tx, ty,
          t: 0, dur: 0.85,
          dmg: e.dmg * 0.7,
          explodeR: 40,
          owner: e,
        });
      }
    }
  } else if (ab === 'titan') {
    // Cycle through 4 attacks for varied pressure.
    e.phase = (e.phase + 1) % 4;
    const phase = e.phase;
    if (phase === 0) {
      SFX.bossSlam(); world.camera.shake = 14;
      world.shockwaves.push({
        x: e.x, y: e.y, r: 0, rMax: 240,
        life: 0.7, maxLife: 0.7, dmg: e.dmg * 0.7, hit: new Set(),
      });
    } else if (phase === 1) {
      SFX.bossSummon();
      const mHp = lateGameHpMult();
      const mDmg = lateGameDmgMult();
      const speedrunHp = world.waveMode ? 0.75 : 1.0;
      const tgt = nearestPlayer(e.x, e.y) || e;
      const zCount = e.enraged ? 30 : 20;
      for (let i = 0; i < zCount; i++) {
        const a = (i / zCount) * TAU;
        const hp = 36 * mHp * speedrunHp;
        const tier = irand(0, zombieSets.length - 1);
        world.enemies.push({
          type: 'zombie',
          x: tgt.x + Math.cos(a) * 120, y: tgt.y + Math.sin(a) * 120,
          vx: 0, vy: 0, w: 14, h: 16,
          hp, hpMax: hp,
          speed: 52 + Math.random() * 18,
          dmg: 12 * mDmg, sprites: zombieSets[tier], animT: Math.random() * 10,
          hit: 0, slowedUntil: 0, summoned: true,
        });
      }
    } else if (phase === 2) {
      SFX.titanBeam();
      const tgt = nearestPlayer(e.x, e.y); if (!tgt) return;
      const ang = Math.atan2(tgt.y - e.y, tgt.x - e.x);
      world.beams.push({
        x: e.x, y: e.y, angle: ang, length: 1000, width: 18,
        life: 0.6, maxLife: 0.6, dmg: e.dmg * 0.55, hit: new Set(),
      });
    } else {
      SFX.swarm();
      const sCount = e.enraged ? 72 : 48;
      for (let i = 0; i < sCount; i++) {
        const a = Math.random() * TAU;
        const r = 16 + Math.random() * 26;
        spawnSwarmling(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r);
      }
    }
  }
}

function triggerStephenQuake(e) {
  // Screen shake + apply slow to every alive player. No direct damage — it's a
  // movement-and-vision pressure ability that combos with the bomb throws.
  world.camera.shake = Math.max(world.camera.shake, 14);
  world.flash = Math.max(world.flash, 0.3);
  for (const pl of world.players) {
    if (!pl || pl.dead) continue;
    pl.slowedUntil = Math.max(pl.slowedUntil, world.time + 1.4);
  }
  SFX.bossSlam();
  // Visual: dust kicked up around the boss as the floor rumbles.
  for (let i = 0; i < 24; i++) {
    const a = Math.random() * TAU;
    const r = 18 + Math.random() * 26;
    world.particles.push({
      x: e.x + Math.cos(a) * r, y: e.y + Math.sin(a) * r,
      vx: Math.cos(a) * 30, vy: -20 - Math.random() * 30,
      life: 0.6, maxLife: 0.6, size: 2,
      color: ['#aa6633', '#ffaa44', '#5a3a18'][irand(0, 2)], gravity: 80,
    });
  }
}

// ---------- ENEMY AI OVERRIDES (called from update loop) ----------
function tickSpitterAI(e, dt, tgt) {
  const dx = tgt.x - e.x, dy = tgt.y - e.y;
  const d = Math.hypot(dx, dy) || 1;
  const slowFactor = enemySlowFactor(e);
  if (d > e.keepDist + 30) {
    e.vx = (dx / d) * e.speed * slowFactor;
    e.vy = (dy / d) * e.speed * slowFactor;
  } else if (d < e.keepDist - 20) {
    e.vx = -(dx / d) * e.speed * slowFactor;
    e.vy = -(dy / d) * e.speed * slowFactor;
  } else {
    e.vx = 0; e.vy = 0;
  }
  e.spitCd -= dt;
  if (e.spitCd <= 0 && d < 240) {
    e.spitCd = 1.5 + Math.random() * 0.4;
    world.spits.push({
      x: e.x, y: e.y, sx: e.x, sy: e.y,
      tx: tgt.x + rand(-10, 10), ty: tgt.y + rand(-10, 10),
      t: 0, dur: 0.55,
      dmg: e.dmg, owner: e,
    });
    SFX.spit();
  }
}

function tickSlingerAI(e, dt, tgt) {
  // Tanky and aggressive — always runs toward the player. Shoots a fast green
  // glue glob on a tight cooldown.
  const dx = tgt.x - e.x, dy = tgt.y - e.y;
  const d = Math.hypot(dx, dy) || 1;
  const slowFactor = enemySlowFactor(e);
  e.vx = (dx / d) * e.speed * slowFactor;
  e.vy = (dy / d) * e.speed * slowFactor;
  e.slingCd -= dt;
  if (e.slingCd <= 0 && d < 320) {
    e.slingCd = 1.4 + Math.random() * 0.4;
    const speed = 260;
    const ang = Math.atan2(dy, dx);
    world.glues.push({
      x: e.x, y: e.y,
      vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
      life: 1.6, dmg: e.dmg, owner: e,
    });
    SFX.spit();
  }
}

function bloomlingDeath(e) {
  // Three short-range spore hazards that linger and damage on contact.
  for (let i = 0; i < 3; i++) {
    const ang = (i / 3) * TAU + Math.random() * 0.5;
    const r = 14 + Math.random() * 8;
    world.spores.push({
      x: e.x + Math.cos(ang) * r,
      y: e.y + Math.sin(ang) * r,
      r: 9, life: 4.0, maxLife: 4.0,
      dmg: e.dmg * 0.6, dmgInterval: 0.5, dmgTimer: 0,
      bob: Math.random() * TAU,
    });
  }
  spawnParticles(e.x, e.y, 18, { colors: ['#ff66aa', '#aaff66', '#ffaadd'], speed: 90, life: 0.5, gravity: 0 });
}

function tickExploderAI(e, dt, tgt) {
  const dx = tgt.x - e.x, dy = tgt.y - e.y;
  const d = Math.hypot(dx, dy) || 1;
  const slowFactor = enemySlowFactor(e);
  e.vx = (dx / d) * e.speed * slowFactor;
  e.vy = (dy / d) * e.speed * slowFactor;
  if (d < 24 || e.fuseT > 0) {
    e.fuseT += dt;
    if (Math.random() < 0.3) SFX.exploderTick();
    if (e.fuseT >= 0.6) {
      exploderDetonate(e);
      e.dead = true;
      e.hp = 0;
      world.kills++;
    }
  }
}

// ---------- PARTICLES + DMG NUMBERS ----------
function spawnParticles(x, y, count, opts = {}) {
  const colors = opts.colors || ['#ff3344', '#aa0000', '#660000'];
  const spd = opts.speed || 60;
  const life = opts.life || 0.5;
  for (let i = 0; i < count; i++) {
    const a = Math.random() * TAU;
    const s = Math.random() * spd + 10;
    world.particles.push({
      x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - (opts.upward || 0),
      life, maxLife: life, size: opts.size || 2,
      color: colors[irand(0, colors.length - 1)],
      gravity: opts.gravity != null ? opts.gravity : 80,
    });
  }
}
function spawnDmgNumber(x, y, val, crit) {
  world.damageNumbers.push({
    x: x + rand(-3, 3), y, vy: -36, life: 0.8, val: Math.round(val), crit: !!crit,
  });
}

// ---------- DAMAGE / KILL ----------
function damageEnemy(e, dmg, source, weaponId) {
  if (e.dead) return;
  const crit = Math.random() < 0.12;
  const finalDmg = crit ? dmg * 2 : dmg;
  e.hp -= finalDmg;
  e.hit = 0.12;
  if (source) e.lastDamagedBy = source;
  spawnDmgNumber(e.x, e.y - e.h / 2, finalDmg, crit);
  SFX.enemyHit();
  const p = source || nearestPlayer(e.x, e.y);
  if (p && !p.dead) {
    p.stats.dmgDealt += finalDmg;
    if (weaponId) {
      p.stats.damageByWeapon[weaponId] = (p.stats.damageByWeapon[weaponId] || 0) + finalDmg;
    }
    if (p.mods.lifestealPct > 0) {
      p.lifestealAcc += finalDmg * p.mods.lifestealPct;
      if (p.lifestealAcc >= 1) {
        const amt = Math.floor(p.lifestealAcc);
        const restored = Math.min(p.hpMax - p.hp, amt);
        p.hp = Math.min(p.hpMax, p.hp + amt);
        p.stats.healed += restored;
        p.lifestealAcc -= amt;
      }
    }
  }
  if (e.hp <= 0) killEnemy(e);
}

function killEnemy(e) {
  if (e.dead) return;
  // Flag dead FIRST so chain reactions (exploder → exploder via exploderDetonate)
  // can't recurse back into the same enemy and blow the call stack.
  e.dead = true;
  spawnParticles(e.x, e.y, 14, { colors: ['#aa0000', '#ff3344', '#660000', '#cc1111'], speed: 90, life: 0.7, gravity: 220 });
  for (let i = 0; i < 3; i++) {
    world.particles.push({
      x: e.x + rand(-3, 3), y: e.y + rand(-3, 3),
      vx: rand(-40, 40), vy: rand(-60, -20),
      life: 0.7, maxLife: 0.7, size: 2, color: '#660000', gravity: 200,
    });
  }
  // Exploder detonates on death too.
  if (e.type === 'exploder') exploderDetonate(e);
  // Bloomling bursts into 3 spore puffs.
  if (e.type === 'bloomling') bloomlingDeath(e);

  let gemTier = 0;
  if (e.isBoss) gemTier = 2;
  else if (e.type === 'brute') gemTier = 2;
  else if (Math.random() < 0.12) gemTier = 1;
  const sprite = gemTier === 0 ? gemSmall : gemTier === 1 ? gemMed : gemLarge;
  const value = gemTier === 0 ? 1 : gemTier === 1 ? 5 : 20;
  if (!e.summoned) {
    world.pickups.push({ kind: 'gem', x: e.x, y: e.y, sprite, value, bob: Math.random() * TAU, t: 0 });
    if (Math.random() < 0.015) world.pickups.push({ kind: 'heal', x: e.x - 4, y: e.y, value: 30, bob: Math.random() * TAU, t: 0 });
    if (Math.random() < 0.008) world.pickups.push({ kind: 'magnet', x: e.x - 4, y: e.y + 4, bob: Math.random() * TAU, t: 0 });
    if (Math.random() < 0.006) world.pickups.push({ kind: 'bomb', x: e.x + 4, y: e.y + 4, bob: Math.random() * TAU, t: 0 });
  }
  if (e.isBoss) {
    if (e.isTitan) {
      world.titanDefeated = true;
      SFX.bossDeath();
      world.flash = 1.0;
      world.camera.shake = 20;
      for (let i = 0; i < 140; i++) {
        const a = Math.random() * TAU;
        const s = rand(80, 340);
        world.particles.push({
          x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
          life: rand(0.8, 1.8), maxLife: 1.8, size: 2,
          color: ['#ffcc44', '#ff66cc', '#fff', '#ffee88', '#ff3344'][irand(0, 4)], gravity: 80,
        });
      }
    } else {
      // Hive Queen: erupt into a swarm on death.
      if (e.bossType && e.bossType.id === 'hivequeen') {
        for (let i = 0; i < 50; i++) {
          const a = Math.random() * TAU;
          const r = rand(8, 40);
          spawnSwarmling(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r);
        }
        SFX.swarm();
      }
      const chestCount = Math.min(3, Math.max(1, e.minute));
      for (let i = 0; i < chestCount; i++) {
        const ang = (i / chestCount) * TAU + Math.random() * 0.4;
        const r = chestCount === 1 ? 0 : 16 + i * 2;
        world.pickups.push({
          kind: 'chest',
          x: e.x + Math.cos(ang) * r,
          y: e.y + Math.sin(ang) * r,
          bob: Math.random() * TAU, t: 0,
        });
      }
      world.pickups.push({ kind: 'gem', x: e.x + 8, y: e.y, sprite: gemLarge, value: 20, bob: Math.random() * TAU, t: 0 });
      world.pickups.push({ kind: 'heal', x: e.x - 8, y: e.y, value: 40, bob: Math.random() * TAU, t: 0 });
      SFX.bossDeath();
      world.flash = 0.7;
      world.camera.shake = 12;
      for (let i = 0; i < 60; i++) {
        const a = Math.random() * TAU;
        const s = rand(60, 200);
        world.particles.push({
          x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
          life: rand(0.5, 1.2), maxLife: 1.2, size: 2,
          color: ['#ffcc44', '#ff66cc', '#fff', '#ff3344'][irand(0, 3)], gravity: 80,
        });
      }
    }
  }
  world.kills++;
  if (e.lastDamagedBy && !e.lastDamagedBy.dead) e.lastDamagedBy.stats.kills++;
  SFX.enemyKill();
}

function exploderDetonate(e) {
  const R = 32;
  for (const f of world.enemies) {
    if (f.dead || f === e) continue;
    const dx = f.x - e.x, dy = f.y - e.y;
    if (dx * dx + dy * dy < R * R) {
      f.hp -= 40;
      f.hit = 0.12;
      if (f.hp <= 0) killEnemy(f);
    }
  }
  for (const pl of world.players) {
    if (!pl || pl.dead || pl.invuln > 0) continue;
    const dx = pl.x - e.x, dy = pl.y - e.y;
    if (dx * dx + dy * dy < R * R) {
      pl.hp -= e.dmg;
      pl.invuln = 0.6;
      world.camera.shake = 9;
      world.flash = 0.55;
      SFX.hurt();
      if (pl.hp <= 0) downPlayer(pl);
    }
  }
  for (let i = 0; i < 24; i++) {
    const a = Math.random() * TAU;
    const s = rand(80, 220);
    world.particles.push({
      x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: rand(0.4, 0.9), maxLife: 0.9, size: 2,
      color: ['#ffcc44', '#ff6600', '#ff3300', '#fff'][irand(0, 3)], gravity: 0,
    });
  }
  SFX.exploderBoom();
}

function downPlayer(p) {
  if (!p || p.dead) return;
  p.dead = true;
  p.hp = 0;
  SFX.playerDown();
  for (let i = 0; i < 30; i++) {
    const a = Math.random() * TAU;
    const s = rand(40, 160);
    world.particles.push({
      x: p.x, y: p.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: rand(0.5, 1.2), maxLife: 1.2, size: 2,
      color: ['#ff3344', '#aa0000', '#fff', '#ff66cc'][irand(0, 3)], gravity: 60,
    });
  }
  if (alivePlayers().length === 0) gameOver();
}

function revivePlayer(p) {
  if (!p || !p.dead) return;
  const ally = alivePlayers()[0];
  if (ally) { p.x = ally.x + rand(-14, 14); p.y = ally.y + rand(-14, 14); }
  p.dead = false;
  p.hp = Math.max(40, Math.floor(p.hpMax * 0.6));
  p.invuln = 2.0;
  SFX.revive();
  for (let i = 0; i < 50; i++) {
    const a = Math.random() * TAU;
    const s = rand(40, 180);
    world.particles.push({
      x: p.x, y: p.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: rand(0.5, 1.0), maxLife: 1.0, size: 2,
      color: ['#66ddff', '#aaffaa', '#fff', '#ffcc44'][irand(0, 3)], gravity: 0,
    });
  }
}

function gainXp(amount, p) {
  if (!p || p.dead) return;
  const gained = Math.ceil(amount * (1 + p.mods.xpBoost));
  p.xp += gained;
  p.stats.xpGained += gained;
  while (p.xp >= p.xpNext) {
    p.xp -= p.xpNext;
    p.level++;
    p.xpNext = Math.floor(p.xpNext * 1.35) + 2;
    p.hp = Math.min(p.hpMax, p.hp + 5);
    // Co-op revive on level-up.
    for (const ally of world.players) {
      if (ally && ally !== p && ally.dead) revivePlayer(ally);
    }
    p.levelUpQueue++;
  }
  if (!world.paused) showLevelUp();
}
