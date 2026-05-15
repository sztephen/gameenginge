'use strict';

// ============================================================
//  weapons.js — fire/tick functions for each weapon kind.
//  Pure logic — relies on entities.js helpers and world arrays.
// ============================================================

function fireKnife(p) {
  const w = p.weapons.knife;
  const isSuper = weaponIsSuper(p, 'knife');

  // Helper to spawn a knife — used by both the targeted and all-directions paths.
  const launchAt = (a) => {
    world.bullets.push({
      kind: 'knife',
      x: p.x, y: p.y,
      vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed,
      life: 0.9, dmg: w.dmg * p.mods.dmgMult,
      pierce: w.pierce, hits: new Set(), angle: a, owner: p,
      weaponId: 'knife', super: isSuper,
    });
  };

  if (w.allDirections) {
    // Blade Storm: fan `count` knives evenly around the full circle. They
    // ignore enemy presence so the player gets full-coverage every shot.
    for (let i = 0; i < w.count; i++) {
      const a = (i / w.count) * TAU + p.animT * 0.3; // tiny per-volley rotation
      launchAt(a);
    }
  } else {
    let nearest = null, nd = Infinity;
    for (const e of world.enemies) {
      if (e.dead) continue;
      const d = dist2(e.x, e.y, p.x, p.y);
      if (d < nd) { nd = d; nearest = e; }
    }
    if (!nearest) return;
    const baseAngle = Math.atan2(nearest.y - p.y, nearest.x - p.x);
    for (let i = 0; i < w.count; i++) {
      const spread = (i - (w.count - 1) / 2) * 0.18;
      launchAt(baseAngle + spread);
    }
  }
  spawnParticles(p.x, p.y, 3, {
    colors: isSuper ? ['#ffe088', '#ff8a1a'] : ['#ffffff', '#ffcc44'],
    speed: 50, life: 0.18, gravity: 0, size: 1,
  });
  SFX.knife();
}

function tickAura(p, dt) {
  const a = p.weapons.aura;
  if (!a) return;
  a.cd -= dt;
  if (a.cd <= 0) {
    a.cd = a.rate;
    const r = a.radius * p.mods.areaMult;
    const r2 = r * r;
    for (const e of world.enemies) {
      if (e.dead) continue;
      const dx = e.x - p.x, dy = e.y - p.y;
      const d2v = dx * dx + dy * dy;
      if (d2v < r2) {
        damageEnemy(e, a.dmg * p.mods.dmgMult, p, 'aura');
        const d = Math.sqrt(d2v) || 1;
        e.x += (dx / d) * 3; e.y += (dy / d) * 3;
      }
    }
    const segs = 40;
    const isSuper = weaponIsSuper(p, 'aura');
    for (let i = 0; i < segs; i++) {
      const ang = (i / segs) * TAU;
      world.particles.push({
        x: p.x + Math.cos(ang) * 4, y: p.y + Math.sin(ang) * 4,
        vx: Math.cos(ang) * (r * 2.6), vy: Math.sin(ang) * (r * 2.6),
        life: 0.45, maxLife: 0.45, size: 2,
        color: isSuper
          ? (i % 3 === 0 ? '#ffe088' : '#ff8a1a')
          : (i % 3 === 0 ? '#ffffff' : '#ff66cc'),
        gravity: 0,
      });
    }
    world.auraFlash = 1.0;
    SFX.aura();
  }
}

function fireHoly(p) {
  const w = p.weapons.holy;
  if (!w) return;
  const candidates = world.enemies.filter(e => !e.dead && dist2(e.x, e.y, p.x, p.y) < 220 * 220);
  for (let i = 0; i < w.count; i++) {
    let tx, ty;
    if (candidates.length > 0) {
      const t = candidates[irand(0, candidates.length - 1)];
      tx = t.x + rand(-12, 12); ty = t.y + rand(-12, 12);
    } else {
      const a = Math.random() * TAU;
      const r = 80 + Math.random() * 60;
      tx = p.x + Math.cos(a) * r; ty = p.y + Math.sin(a) * r;
    }
    // Stagger throws slightly so multiple bottles read as separate motions
    // instead of a single fan. Tiny per-bottle offset on launch position too.
    const launchOff = (i - (w.count - 1) / 2) * 4;
    const ang = Math.atan2(ty - p.y, tx - p.x);
    const launchX = p.x + Math.cos(ang + Math.PI / 2) * launchOff;
    const launchY = p.y - 6 + Math.cos(ang) * 0 + Math.sin(ang + Math.PI / 2) * launchOff;
    world.bullets.push({
      kind: 'holy', x: launchX, y: launchY, sx: launchX, sy: launchY, tx, ty,
      t: -i * 0.05, dur: 0.5, life: 1, dmg: w.dmg * p.mods.dmgMult,
      duration: w.duration,
      puddleRadius: w.puddleRadius * p.mods.areaMult,
      healPerTick: w.healPerTick || 0,
      owner: p,
      super: weaponIsSuper(p, 'holy'),
    });
  }
  // Throw splash at the player — a small burst of water droplets so the throw
  // reads as an action.
  for (let i = 0; i < 8; i++) {
    const a = -Math.PI / 2 + rand(-0.7, 0.7);
    const s = rand(40, 90);
    world.particles.push({
      x: p.x, y: p.y - 4,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s - 30,
      life: 0.35, maxLife: 0.35, size: 1,
      color: ['#aae0ff', '#fff', '#66bbff'][irand(0, 2)],
      gravity: 180,
    });
  }
  SFX.holy();
}

// DELUGE super effect — periodically drops a heal pickup ("potion") on or
// near the player. Counts as the normal heal pickup so the existing magnet,
// collection sfx, and HUD flash all just work.
function spawnHolyPotion(p) {
  const ang = Math.random() * TAU;
  const r = Math.random() < 0.35 ? 0 : 10 + Math.random() * 28;
  const x = p.x + Math.cos(ang) * r;
  const y = p.y + Math.sin(ang) * r;
  world.pickups.push({
    kind: 'heal', x, y, value: 35,
    bob: Math.random() * TAU, t: 0,
  });
  spawnParticles(x, y, 12, { colors: ['#ffe088', '#fff', '#ffaa66', '#ff8a1a'], speed: 70, life: 0.5, gravity: -30 });
  SFX.holy();
}

function fireIce(p) {
  const w = p.weapons.ice;
  if (!w) return;
  // Prefer the highest-HP enemy that isn't already slowed; if every enemy is
  // currently slowed, fall back to the highest-HP target so the weapon still fires.
  let target = null, bestHp = -Infinity;
  let fallback = null, fallbackHp = -Infinity;
  for (const e of world.enemies) {
    if (e.dead) continue;
    if (e.hp > fallbackHp) { fallbackHp = e.hp; fallback = e; }
    if (e.slowedUntil > world.time) continue;
    if (e.hp > bestHp) { bestHp = e.hp; target = e; }
  }
  if (!target) target = fallback;
  if (!target) return;
  const baseA = Math.atan2(target.y - p.y, target.x - p.x);
  const count = w.count || 1;
  for (let i = 0; i < count; i++) {
    const spread = (i - (count - 1) / 2) * 0.22;
    const a = baseA + spread;
    world.bullets.push({
      kind: 'ice', x: p.x, y: p.y,
      vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed,
      life: 1.2, dmg: w.dmg * p.mods.dmgMult,
      slow: w.slow, angle: a, hits: new Set(), owner: p,
      weaponId: 'ice', super: weaponIsSuper(p, 'ice'),
    });
  }
  SFX.ice();
}

function triggerBlizzard(p, b) {
  const until = world.time + b.duration;
  for (const e of world.enemies) {
    if (e.dead) continue;
    if (e.slowedUntil < until) e.slowedUntil = until;
  }
  // Screen-wide visual: pale ice burst around the player so it reads as a global effect.
  for (let i = 0; i < 60; i++) {
    const a = Math.random() * TAU;
    const r = 40 + Math.random() * 220;
    world.particles.push({
      x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r,
      vx: Math.cos(a) * 30, vy: Math.sin(a) * 30,
      life: 0.55, maxLife: 0.55, size: 1,
      color: ['#aaeeff', '#fff', '#66ccff'][irand(0, 2)], gravity: 0,
    });
  }
  world.flash = Math.max(world.flash, 0.35);
  SFX.ice();
}

function fireLightning(p) {
  const w = p.weapons.lightning;
  if (!w) return;
  const range2 = w.range * w.range;
  const candidates = world.enemies.filter(e => !e.dead && dist2(e.x, e.y, p.x, p.y) < range2);
  if (candidates.length === 0) return;
  let target = candidates[irand(0, candidates.length - 1)];
  let dmg = w.dmg * p.mods.dmgMult;
  const points = [{ x: p.x, y: p.y - 4 }];
  const hit = new Set();
  const totalHits = 1 + w.chains;
  for (let c = 0; c < totalHits; c++) {
    if (!target || hit.has(target)) break;
    hit.add(target);
    points.push({ x: target.x, y: target.y });
    damageEnemy(target, dmg, p, 'lightning');
    spawnParticles(target.x, target.y, 6, { colors: ['#ffee66', '#fff'], speed: 90, life: 0.3, gravity: 0 });
    dmg *= 0.75;
    let next = null, nd = Infinity;
    for (const e of world.enemies) {
      if (e.dead || hit.has(e)) continue;
      const d = dist2(e.x, e.y, target.x, target.y);
      if (d < nd && d < 90 * 90) { nd = d; next = e; }
    }
    target = next;
  }
  const segs = 6;
  const jitter = [];
  for (let i = 1; i < points.length; i++) {
    const row = [];
    for (let s = 1; s < segs; s++) row.push({ jx: (Math.random() - 0.5) * 6, jy: (Math.random() - 0.5) * 6 });
    jitter.push(row);
  }
  world.lightning.push({ points, jitter, segs, life: 0.22, maxLife: 0.22, super: weaponIsSuper(p, 'lightning') });
  SFX.lightning();
}

// ---------- SHARDS ----------
// Orbit the player on a timer. Each shard shatters into piercing fragments
// when it touches an enemy (or expires).
function fireShards(p) {
  const w = p.weapons.shards;
  if (!w) return;
  const baseAngle = Math.random() * TAU;
  for (let i = 0; i < w.count; i++) {
    const a0 = baseAngle + (i / w.count) * TAU;
    const r = w.orbitRadius * p.mods.areaMult;
    world.shards.push({
      owner: p, angle: a0, rotSpeed: 1.7,
      radius: r,
      x: p.x + Math.cos(a0) * r,
      y: p.y + Math.sin(a0) * r,
      life: w.life, maxLife: w.life,
      dmg: w.dmg * p.mods.dmgMult,
      fragments: w.fragments,
      fragmentDmg: w.fragmentDmg * p.mods.dmgMult,
      super: weaponIsSuper(p, 'shards'),
    });
  }
  SFX.shards();
}

function tickShards(dt) {
  for (const s of world.shards) {
    if (s.dead) continue;
    s.life -= dt;
    if (s.life <= 0 || !s.owner || s.owner.dead) {
      shatterShard(s);
      continue;
    }
    s.angle += s.rotSpeed * dt;
    s.x = s.owner.x + Math.cos(s.angle) * s.radius;
    s.y = s.owner.y + Math.sin(s.angle) * s.radius;
    for (const e of world.enemies) {
      if (e.dead) continue;
      const dx = e.x - s.x, dy = e.y - s.y;
      if (dx * dx + dy * dy < 8 * 8) {
        damageEnemy(e, s.dmg, s.owner, 'shards');
        shatterShard(s);
        break;
      }
    }
  }
  compact(world.shards, s => !s.dead);
}

function shatterShard(s) {
  if (s.dead) return;
  s.dead = true;
  const n = s.fragments;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + Math.random() * 0.08;
    world.bullets.push({
      kind: 'shardFrag',
      x: s.x, y: s.y,
      vx: Math.cos(a) * 230, vy: Math.sin(a) * 230,
      life: 0.45, dmg: s.fragmentDmg,
      pierce: 2, hits: new Set(), angle: a, owner: s.owner,
      weaponId: 'shards', super: !!s.super,
    });
  }
  spawnParticles(s.x, s.y, 8, { colors: ['#ffffff', '#aaeeff', '#88ccff'], speed: 130, life: 0.3, gravity: 0, size: 1 });
  SFX.shardBreak();
}

// ---------- HOLE ----------
// Drops a singularity at the nearest enemy. Pulls in for `duration`, then implodes.
function fireHole(p) {
  const w = p.weapons.hole;
  if (!w) return;
  let tx = p.x + (p.facing > 0 ? 50 : -50), ty = p.y;
  let nearest = null, nd = Infinity;
  for (const e of world.enemies) {
    if (e.dead) continue;
    const d = dist2(e.x, e.y, p.x, p.y);
    if (d < nd && d < 220 * 220) { nd = d; nearest = e; }
  }
  if (nearest) { tx = nearest.x; ty = nearest.y; }
  world.holes.push({
    x: tx, y: ty,
    r: w.radius * p.mods.areaMult,
    t: 0,
    duration: w.duration,
    pullForce: w.pullForce,
    dmg: w.dmg * p.mods.dmgMult,
    owner: p,
    super: weaponIsSuper(p, 'hole'),
  });
  SFX.hole();
}

// ---------- BANANA ----------
// Boomerang projectile — flies out in a straight line, decelerates, then
// returns to the player. Tracks owner position so it always returns even if
// the player moves. Pierces enemies (each one is only hit once per banana);
// super-tier bananas also splash for half base damage on each hit.
function fireBanana(p) {
  const w = p.weapons.banana;
  if (!w) return;
  // Aim toward the nearest enemy, or use the player's aim angle if no targets.
  let nearest = null, nd = Infinity;
  for (const e of world.enemies) {
    if (e.dead) continue;
    const d = dist2(e.x, e.y, p.x, p.y);
    if (d < nd) { nd = d; nearest = e; }
  }
  const baseAngle = nearest
    ? Math.atan2(nearest.y - p.y, nearest.x - p.x)
    : (p.aimAngle != null ? p.aimAngle : (p.facing < 0 ? Math.PI : 0));
  const count = w.count;
  const isSuper = weaponIsSuper(p, 'banana');
  for (let i = 0; i < count; i++) {
    const spread = count === 1 ? 0 : (i - (count - 1) / 2) * 0.35;
    const a = baseAngle + spread;
    // life is the time for a full out-and-back arc. distance peaks at
    // range when t=0.5 and returns to 0 at t=1.
    const life = (2 * w.range) / Math.max(1, w.speed) * (Math.PI / 2);
    world.bananas.push({
      owner: p,
      angle: a,
      range: w.range * p.mods.areaMult,
      life, maxLife: life,
      dmg: w.dmg * p.mods.dmgMult,
      splash: !!(w.splash || isSuper),
      splashRadius: w.splashRadius || 28,
      // enemy → { count, nextHit } — each banana hits each enemy up to twice
      // (typically once outbound, once on return), with a small debounce so a
      // single pass can't double-tap.
      hits: new Map(),
      x: p.x, y: p.y,
      spin: 0,
      super: isSuper,
    });
  }
  SFX.banana();
}

function tickBananas(dt) {
  for (const b of world.bananas) {
    if (b.dead) continue;
    b.life -= dt;
    b.spin += dt * 14;
    if (b.life <= 0 || !b.owner || b.owner.dead) { b.dead = true; continue; }
    const t = 1 - b.life / b.maxLife;
    const dist = b.range * Math.sin(t * Math.PI);
    b.x = b.owner.x + Math.cos(b.angle) * dist;
    b.y = b.owner.y + Math.sin(b.angle) * dist;
    // Collision — up to two hits per enemy per banana (out + return), with a
    // short per-enemy debounce so a single pass can't rack up multiple hits.
    for (const e of world.enemies) {
      if (e.dead) continue;
      const rec = b.hits.get(e);
      if (rec && (rec.count >= 2 || world.time < rec.nextHit)) continue;
      const dx = e.x - b.x, dy = e.y - b.y;
      const reach = (e.w + 6) * 0.5;
      if (dx * dx + dy * dy < reach * reach) {
        if (rec) { rec.count += 1; rec.nextHit = world.time + 0.25; }
        else { b.hits.set(e, { count: 1, nextHit: world.time + 0.25 }); }
        damageEnemy(e, b.dmg, b.owner, 'banana');
        // Super-only splash — half the banana's base damage to nearby enemies.
        if (b.splash) {
          const sr2 = b.splashRadius * b.splashRadius;
          const splashDmg = b.dmg * 0.5;
          for (const o of world.enemies) {
            if (o.dead || o === e) continue;
            const ox = o.x - e.x, oy = o.y - e.y;
            if (ox * ox + oy * oy < sr2) {
              damageEnemy(o, splashDmg, b.owner, 'banana');
            }
          }
          spawnParticles(e.x, e.y, 8, { colors: ['#ffe088', '#ffcc44', '#fff'], speed: 90, life: 0.3, gravity: 0 });
        } else {
          spawnParticles(b.x, b.y, 4, { colors: ['#ffe088', '#ffcc44'], speed: 60, life: 0.2, gravity: 0 });
        }
      }
    }
    // Light yellow trail.
    if (Math.random() < 0.5) {
      world.particles.push({
        x: b.x + rand(-1, 1), y: b.y + rand(-1, 1),
        vx: 0, vy: 0,
        life: 0.22, maxLife: 0.22, size: 1,
        color: b.super ? '#ff8a1a' : '#ffe088',
        gravity: 0,
      });
    }
  }
  compact(world.bananas, b => !b.dead);
}

// ---------- FLAMETHROWER ----------
// Spawns one (or four, with super) short-lived flame cones in the direction the
// player is currently facing. Each cone damages enemies inside on a tick
// interval and emits fire particles for the visual.
function fireFlame(p) {
  const w = p.weapons.flame;
  if (!w) return;

  // "Smart" aim: pick the cone direction that hits the most enemies. For each
  // candidate (one per in-range enemy), count how many enemies fall inside a
  // cone of width 2 * halfAngle pointed at that candidate's angle. Tiebreak by
  // total proximity so close clusters win over distant ones of equal count.
  const range = w.range * p.mods.areaMult;
  const halfAngle = Math.min(Math.PI, w.halfAngle);
  // Slight scan radius padding so enemies just past the tip still influence
  // the aim — feels less twitchy when a cluster is about to enter range.
  const scanR = range * 1.15;
  const scanR2 = scanR * scanR;
  const cosHalf = Math.cos(halfAngle);

  // Collect in-range candidates once: { angle, dist } per enemy.
  const cands = [];
  for (const e of world.enemies) {
    if (e.dead) continue;
    const dx = e.x - p.x, dy = e.y - p.y;
    const d2v = dx * dx + dy * dy;
    if (d2v > scanR2) continue;
    const d = Math.sqrt(d2v) || 1;
    cands.push({ ang: Math.atan2(dy, dx), invD: 1 / d });
  }
  if (cands.length === 0) {
    // Nothing nearby — short-cooldown so we re-check the moment one walks in.
    p.weapons.flame.cd = 0.15;
    return;
  }

  // Score each candidate angle by the count of enemies inside its cone,
  // weighted slightly by closeness so dense + nearby clusters win.
  let bestAng = cands[0].ang, bestScore = -1;
  for (const c of cands) {
    const cosA = Math.cos(c.ang), sinA = Math.sin(c.ang);
    let score = 0;
    for (const o of cands) {
      // dot(unit aim, unit toEnemy) = cos(angleDiff). >= cos(half) → inside.
      const od = Math.cos(c.ang - o.ang);
      if (od >= cosHalf) score += 1 + o.invD * 20;
    }
    if (score > bestScore) { bestScore = score; bestAng = c.ang; }
  }

  const baseAngle = bestAng;
  const angles = w.fourWay
    ? [baseAngle, baseAngle + Math.PI / 2, baseAngle + Math.PI, baseAngle + Math.PI * 1.5]
    : [baseAngle];
  for (const a of angles) {
    world.flames.push({
      owner: p, angle: a,
      range: w.range * p.mods.areaMult,
      halfAngle: Math.min(Math.PI, w.halfAngle),
      life: w.duration, maxLife: w.duration,
      dmg: w.dmg * p.mods.dmgMult,
      dmgInterval: w.dmgInterval, dmgTimer: 0,
      hit: new Set(),
      super: weaponIsSuper(p, 'flame'),
    });
  }
  SFX.flame();
}

function tickFlames(dt) {
  for (const fl of world.flames) {
    if (fl.dead) continue;
    fl.life -= dt;
    fl.dmgTimer -= dt;
    if (!fl.owner || fl.owner.dead) { fl.dead = true; continue; }
    // Pin the flame to the player so it travels with them — feels like a real jet.
    fl.x = fl.owner.x;
    fl.y = fl.owner.y;
    // Damage enemies whose center sits inside the cone.
    if (fl.dmgTimer <= 0) {
      fl.dmgTimer = fl.dmgInterval;
      const cosA = Math.cos(fl.angle), sinA = Math.sin(fl.angle);
      const r2 = fl.range * fl.range;
      for (const e of world.enemies) {
        if (e.dead) continue;
        const dx = e.x - fl.x, dy = e.y - fl.y;
        const d2v = dx * dx + dy * dy;
        if (d2v > r2 || d2v < 1) continue;
        // Inside the cone? Compute the unsigned angle between the cone axis
        // and the vector to the enemy.
        const along = dx * cosA + dy * sinA;
        if (along <= 0) continue; // behind the player
        const d = Math.sqrt(d2v);
        const dot = along / d; // = cos(angleDiff)
        if (dot < Math.cos(fl.halfAngle)) continue;
        damageEnemy(e, fl.dmg, fl.owner, 'flame');
        // Light the enemy on fire — a 2s residual burn ticking 10% of the
        // cone's per-tick damage. Refreshed every cone tick, so the burn only
        // really "bites" after the enemy walks out of the flame.
        e.burnUntil = world.time + 2.0;
        e.burnDmg = fl.dmg * 0.10;
        e.burnSource = fl.owner;
      }
    }
    // Particle plume — denser near the nozzle, scarcer at the tip.
    const plumes = fl.super ? 5 : 4;
    for (let i = 0; i < plumes; i++) {
      const t = Math.random();
      const spreadAng = (Math.random() - 0.5) * fl.halfAngle * 2 * (0.6 + t * 0.4);
      const a = fl.angle + spreadAng;
      const r = t * fl.range;
      const px = fl.x + Math.cos(a) * r;
      const py = fl.y + Math.sin(a) * r;
      const cols = t < 0.4
        ? ['#ffffff', '#ffe088', '#ffcc44']
        : t < 0.75
          ? ['#ffaa1a', '#ff8a1a', '#ff6600']
          : ['#aa3300', '#5a1800', '#1a0a0a'];
      world.particles.push({
        x: px, y: py,
        vx: Math.cos(a) * (40 + Math.random() * 80),
        vy: Math.sin(a) * (40 + Math.random() * 80) - 20,
        life: 0.25 + Math.random() * 0.25, maxLife: 0.5, size: 2,
        color: cols[irand(0, cols.length - 1)],
        gravity: -40,
      });
    }
  }
  compact(world.flames, fl => !fl.dead && fl.life > 0);
}

function tickHoles(dt) {
  for (const h of world.holes) {
    if (h.dead) continue;
    h.t += dt;
    const pullR = h.r;
    const pullR2 = pullR * pullR;
    for (const e of world.enemies) {
      if (e.dead || e.isBoss) continue; // bosses resist the pull
      const dx = h.x - e.x, dy = h.y - e.y;
      const d2v = dx * dx + dy * dy;
      if (d2v < pullR2 && d2v > 1) {
        const d = Math.sqrt(d2v);
        const force = h.pullForce * (1 - d / pullR);
        e.x += (dx / d) * force * dt;
        e.y += (dy / d) * force * dt;
      }
    }
    if (Math.random() < 0.7) {
      const a = Math.random() * TAU;
      const r = pullR * (0.6 + Math.random() * 0.4);
      const cols = ['#5a2880', '#fff', '#aa44dd'];
      world.particles.push({
        x: h.x + Math.cos(a) * r, y: h.y + Math.sin(a) * r,
        vx: -Math.cos(a) * 70, vy: -Math.sin(a) * 70,
        life: 0.4, maxLife: 0.4, size: 1,
        color: cols[irand(0, cols.length - 1)], gravity: 0,
      });
    }
    if (h.t >= h.duration) {
      h.dead = true;
      for (const e of world.enemies) {
        if (e.dead) continue;
        const dx = e.x - h.x, dy = e.y - h.y;
        if (dx * dx + dy * dy < pullR2) {
          damageEnemy(e, h.dmg, h.owner, 'hole');
        }
      }
      spawnParticles(h.x, h.y, 30, { colors: ['#5a2880', '#aa44dd', '#fff', '#ff66cc'], speed: 180, life: 0.6, gravity: 0 });
      world.camera.shake = Math.max(world.camera.shake, 6);
      SFX.holePop();
    }
  }
  compact(world.holes, h => !h.dead);
}
