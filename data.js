'use strict';

// ============================================================
//  data.js — all gameplay tables: weapons, upgrades, supers, bosses, constants.
//  No game-state or DOM here — pure data + apply functions.
// ============================================================

const MAX_SLOTS = 3;
const BRUTE_UNLOCK_T = 60;
const ELITE_UNLOCK_T = 180;
const SPITTER_UNLOCK_T = 300;   // 5 min — rare ranged enemy
const EXPLODER_UNLOCK_T = 360;  // 6 min — rare suicide bomber
const LATE_GAME_T = 360;        // 6 min — HP/dmg scaling kicks in (player power outpaces sooner)
const VICTORY_TIME = 900;       // 15 min — Titan spawns
const BOSS_INTERVAL = 60;       // boss every minute
const EPIC_CHANCE = 0.10;       // 10% chance each upgrade card rolls as epic

const WEAPONS = {
  knife: {
    name: 'KNIFE', iconId: 'knife_dmg', tier: 0,
    upgradeIds: ['knife_dmg', 'knife_count', 'knife_rate', 'knife_pierce'],
  },
  aura: {
    name: 'DARK AURA', iconId: 'aura_unlock', tier: 1,
    upgradeIds: ['aura_dmg', 'area'],
  },
  holy: {
    name: 'HOLY WATER', iconId: 'holy_unlock', tier: 2,
    upgradeIds: ['holy_dmg', 'holy_count', 'holy_duration'],
  },
  ice: {
    name: 'ICE SHARD', iconId: 'ice_unlock', tier: 2,
    upgradeIds: ['ice_dmg', 'ice_slow', 'ice_rate'],
  },
  lightning: {
    name: 'LIGHTNING', iconId: 'lightning_unlock', tier: 2,
    upgradeIds: ['lightning_dmg', 'lightning_chain', 'lightning_rate'],
  },
  shards: {
    name: 'SHARDS', iconId: 'shards_unlock', tier: 2,
    upgradeIds: ['shards_dmg', 'shards_count', 'shards_rate'],
  },
  hole: {
    name: 'HOLE', iconId: 'hole_unlock', tier: 2,
    upgradeIds: ['hole_dmg', 'hole_radius', 'hole_rate'],
  },
};

const UPGRADES = [
  // KNIFE
  { id: 'knife_dmg',    weaponId: 'knife', name: 'SHARPER BLADE', desc: '+25% knife damage',
    max: 5, apply: p => p.weapons.knife.dmg *= 1.25 },
  { id: 'knife_count',  weaponId: 'knife', name: 'EXTRA KNIFE',  desc: '+1 knife per throw',
    max: 4, apply: p => p.weapons.knife.count += 1 },
  { id: 'knife_rate',   weaponId: 'knife', name: 'QUICK HANDS',  desc: '+20% knife fire rate',
    max: 5, apply: p => p.weapons.knife.rate *= 0.83 },
  { id: 'knife_pierce', weaponId: 'knife', name: 'PIERCING',     desc: '+1 knife pierce',
    max: 4, apply: p => p.weapons.knife.pierce += 1 },
  // AURA
  { id: 'aura_dmg', weaponId: 'aura', name: 'CURSED AURA', desc: '+40% aura damage',
    max: 4, apply: p => p.weapons.aura.dmg *= 1.4 },
  { id: 'area',     weaponId: 'aura', name: 'BIGGER AURA', desc: '+15% aura size',
    max: 4, apply: p => p.weapons.aura.radius *= 1.15 },
  // HOLY WATER
  { id: 'holy_dmg',      weaponId: 'holy', name: 'CONSECRATED',  desc: '+35% holy water damage',
    max: 5, apply: p => p.weapons.holy.dmg *= 1.35 },
  { id: 'holy_count',    weaponId: 'holy', name: 'EXTRA BOTTLE', desc: '+1 bottle per throw',
    max: 3, apply: p => p.weapons.holy.count += 1 },
  { id: 'holy_duration', weaponId: 'holy', name: 'LASTING FAITH', desc: '+1s puddle duration',
    max: 3, apply: p => p.weapons.holy.duration += 1 },
  // ICE
  { id: 'ice_dmg',  weaponId: 'ice', name: 'FROST EDGE', desc: '+30% ice damage',
    max: 5, apply: p => p.weapons.ice.dmg *= 1.3 },
  { id: 'ice_slow', weaponId: 'ice', name: 'DEEP FREEZE', desc: '+0.6s slow duration',
    max: 3, apply: p => p.weapons.ice.slow += 0.6 },
  { id: 'ice_rate', weaponId: 'ice', name: 'ICY VOLLEY', desc: '+25% ice fire rate',
    max: 4, apply: p => p.weapons.ice.rate *= 0.8 },
  // LIGHTNING
  { id: 'lightning_dmg',   weaponId: 'lightning', name: 'STORM POWER', desc: '+30% lightning damage',
    max: 5, apply: p => p.weapons.lightning.dmg *= 1.3 },
  { id: 'lightning_chain', weaponId: 'lightning', name: 'CHAIN STRIKE', desc: '+1 chain jump',
    max: 3, apply: p => p.weapons.lightning.chains += 1 },
  { id: 'lightning_rate',  weaponId: 'lightning', name: 'THUNDER SPEED', desc: '+25% strike rate',
    max: 4, apply: p => p.weapons.lightning.rate *= 0.8 },
  // SHARDS
  { id: 'shards_dmg',   weaponId: 'shards', name: 'KEEN GLASS',  desc: '+30% shard damage',
    max: 5, apply: p => { p.weapons.shards.dmg *= 1.3; p.weapons.shards.fragmentDmg *= 1.3; } },
  { id: 'shards_count', weaponId: 'shards', name: 'EXTRA SHARD', desc: '+1 orbiting shard',
    max: 1, apply: p => p.weapons.shards.count += 1 },
  { id: 'shards_rate',  weaponId: 'shards', name: 'SHATTER FAST', desc: '+25% re-summon rate',
    max: 4, apply: p => p.weapons.shards.rate *= 0.8 },
  // HOLE
  { id: 'hole_dmg',    weaponId: 'hole', name: 'EVENT HORIZON', desc: '+35% hole damage',
    max: 5, apply: p => p.weapons.hole.dmg *= 1.35 },
  { id: 'hole_radius', weaponId: 'hole', name: 'BIGGER HOLE',   desc: '+20% hole radius',
    max: 4, apply: p => p.weapons.hole.radius *= 1.2 },
  { id: 'hole_rate',   weaponId: 'hole', name: 'COLLAPSE FAST', desc: '+25% drop rate',
    max: 4, apply: p => p.weapons.hole.rate *= 0.8 },
  // PASSIVES
  { id: 'speed',  weaponId: null, name: 'SWIFT FEET', desc: '+10% move speed',
    max: 5, apply: p => p.mods.speedMult *= 1.1 },
  { id: 'hp',     weaponId: null, name: 'TOUGH SKIN', desc: '+25 max HP & heal',
    max: 5, apply: p => { p.hpMax += 25; p.hp = Math.min(p.hpMax, p.hp + 25); } },
  { id: 'lifesteal', weaponId: null, name: 'LIFESTEAL', desc: '+0.2% damage healed',
    max: 4, apply: p => p.mods.lifestealPct += 0.002 },
  { id: 'xp_boost', weaponId: null, name: 'QUICK LEARNER', desc: '+20% XP gain',
    max: 5, apply: p => p.mods.xpBoost += 0.20 },
  { id: 'magnet', weaponId: null, name: 'MAGNETISM', desc: '+30% pickup radius',
    max: 4, apply: p => p.mods.magnetMult *= 1.3 },
  { id: 'dmg',    weaponId: null, name: 'BERSERK', desc: '+15% all damage',
    max: 5, apply: p => p.mods.dmgMult *= 1.15 },
];

const SUPERS = [
  { id: 'super_blade', weaponId: 'knife', name: 'BLADE STORM',
    desc: '+3 knives, 2× speed, 2× damage, +2 pierce',
    iconKind: 'super_blade',
    requires: [{ id: 'knife_dmg', level: 3 }, { id: 'knife_count', level: 2 }, { id: 'speed', level: 2 }],
    apply: (p) => {
      p.weapons.knife.count += 3; p.weapons.knife.rate *= 0.5;
      p.weapons.knife.dmg *= 2; p.weapons.knife.pierce += 2;
    },
  },
  { id: 'super_aura', weaponId: 'aura', name: 'OBLIVION',
    desc: '60% bigger, 2.5× damage, faster ticks',
    iconKind: 'super_aura',
    requires: [{ id: 'aura_dmg', level: 2 }, { id: 'area', level: 1 }, { id: 'dmg', level: 2 }],
    apply: (p) => {
      p.weapons.aura.radius *= 1.6; p.weapons.aura.dmg *= 2.5; p.weapons.aura.rate *= 0.6;
    },
  },
  { id: 'super_holy', weaponId: 'holy', name: 'DELUGE',
    desc: '+2 bottles, bigger puddles, longer DoT, stronger heal',
    iconKind: 'super_holy',
    requires: [{ id: 'holy_dmg', level: 2 }, { id: 'holy_count', level: 1 }, { id: 'magnet', level: 1 }],
    apply: (p) => {
      p.weapons.holy.count += 2;
      p.weapons.holy.puddleRadius *= 1.5;
      p.weapons.holy.duration += 2;
      p.weapons.holy.dmg *= 1.5;
      p.weapons.holy.healPerTick *= 2;
    },
  },
  { id: 'super_ice', weaponId: 'ice', name: 'BLIZZARD',
    desc: 'Every 20s, freeze every enemy on screen — 50% slow for 3s',
    iconKind: 'super_ice',
    requires: [{ id: 'ice_dmg', level: 2 }, { id: 'ice_slow', level: 1 }, { id: 'magnet', level: 1 }],
    apply: (p) => {
      p.weapons.ice.blizzard = { cd: 20, interval: 20, slowMult: 0.5, duration: 3 };
    },
  },
  { id: 'super_lightning', weaponId: 'lightning', name: 'THUNDERSTORM',
    desc: '+3 chains, 2× damage, faster strikes',
    iconKind: 'super_lightning',
    requires: [{ id: 'lightning_dmg', level: 2 }, { id: 'lightning_chain', level: 1 }, { id: 'speed', level: 1 }],
    apply: (p) => {
      p.weapons.lightning.chains += 3;
      p.weapons.lightning.dmg *= 2;
      p.weapons.lightning.rate *= 0.6;
    },
  },
  { id: 'super_shards', weaponId: 'shards', name: 'PRISM STORM',
    desc: '+2 shards, double fragments, 2× damage',
    iconKind: 'super_shards',
    requires: [{ id: 'shards_dmg', level: 2 }, { id: 'shards_count', level: 1 }, { id: 'dmg', level: 1 }],
    apply: (p) => {
      p.weapons.shards.count += 2;
      p.weapons.shards.fragments *= 2;
      p.weapons.shards.dmg *= 2;
      p.weapons.shards.fragmentDmg *= 2;
    },
  },
  { id: 'super_hole', weaponId: 'hole', name: 'SINGULARITY',
    desc: '50% bigger, 2× damage, faster drop, stronger pull',
    iconKind: 'super_hole',
    requires: [{ id: 'hole_dmg', level: 2 }, { id: 'hole_radius', level: 1 }, { id: 'magnet', level: 1 }],
    apply: (p) => {
      p.weapons.hole.radius *= 1.5;
      p.weapons.hole.dmg *= 2;
      p.weapons.hole.rate *= 0.6;
      p.weapons.hole.pullForce *= 1.4;
    },
  },
];

// Regular bosses on the 1-minute interval. Gargantuar removed.
const BOSS_TYPES = [
  {
    id: 'reaper', name: 'THE REAPER',
    w: 28, h: 38, baseHp: 1000, baseDmg: 45, speed: 24,
    color: '#1a1a1a', accent: '#3a3a3a', eyes: '#aaffaa',
    ability: 'teleport', abilityCd: 6,
    desc: 'TELEPORTS BEHIND YOU AND STRIKES',
  },
  {
    id: 'necromancer', name: 'NECROMANCER',
    w: 26, h: 34, baseHp: 850, baseDmg: 32, speed: 16,
    color: '#5a2880', accent: '#2a1438', eyes: '#ff66cc',
    ability: 'summon', abilityCd: 5,
    desc: 'SUMMONS ZOMBIES IN WAVES',
  },
  {
    id: 'thorns', name: 'THORNED HORROR',
    w: 30, h: 34, baseHp: 1200, baseDmg: 38, speed: 16,
    color: '#660000', accent: '#220000', eyes: '#ffaa00',
    ability: 'thorns', abilityCd: 4,
    desc: 'SPROUTS THORN PATCHES THAT SLOW',
  },
  {
    id: 'juggernaut', name: 'JUGGERNAUT',
    w: 34, h: 40, baseHp: 1400, baseDmg: 50, speed: 14,
    color: '#cc6600', accent: '#552200', eyes: '#ffee66',
    ability: 'slam', abilityCd: 5,
    desc: 'CHARGES AND SLAMS A SHOCKWAVE',
  },
  {
    id: 'hivequeen', name: 'HIVE QUEEN',
    w: 34, h: 38, baseHp: 800, baseDmg: 30, speed: 16,
    color: '#aa44aa', accent: '#5a2050', eyes: '#ffff66',
    ability: 'swarm', abilityCd: 4,
    desc: 'RELEASES SWARMS OF FAST BUGS',
  },
  {
    id: 'plague', name: 'PLAGUE DOCTOR',
    w: 26, h: 36, baseHp: 950, baseDmg: 26, speed: 22,
    color: '#1a4a2a', accent: '#0a2a14', eyes: '#aaff66',
    ability: 'gas', abilityCd: 4,
    desc: 'LEAVES POISON GAS PUDDLES',
  },
];

// The 15-minute final boss — game ends only when he dies.
const TITAN_TYPE = {
  id: 'titan', name: 'THE TITAN',
  w: 56, h: 72, baseHp: 28000, baseDmg: 60, speed: 12,
  color: '#7a2a14', accent: '#3a1408', eyes: '#ffcc44',
  ability: 'titan', abilityCd: 4,
  desc: 'BEAMS, SLAMS, AND SUMMONS BETWEEN PHASES',
};
