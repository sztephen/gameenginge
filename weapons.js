'use strict';

// ============================================================
//  weapons.js — fire/tick functions for each weapon kind.
//  Pure logic — relies on entities.js helpers and world arrays.
// ============================================================

function fireKnife(p) {
  const w = p.weapons.knife;
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
    const a = baseAngle + spread;
    world.bullets.push({
      kind: 'knife',
      x: p.x, y: p.y,
      vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed,
      life: 0.9, dmg: w.dmg * p.mods.dmgMult,
      pierce: w.pierce, hits: new Set(), angle: a, owner: p,
      weaponId: 'knife',
    });
  }
  spawnParticles(p.x, p.y, 3, { colors: ['#ffffff', '#ffcc44'], speed: 50, life: 0.18, gravity: 0, size: 1 });
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
    for (let i = 0; i < segs; i++) {
      const ang = (i / segs) * TAU;
      world.particles.push({
        x: p.x + Math.cos(ang) * 4, y: p.y + Math.sin(ang) * 4,
        vx: Math.cos(ang) * (r * 2.6), vy: Math.sin(ang) * (r * 2.6),
        life: 0.45, maxLife: 0.45, size: 2,
        color: i % 3 === 0 ? '#ffffff' : '#ff66cc', gravity: 0,
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
    world.bullets.push({
      kind: 'holy', x: p.x, y: p.y, sx: p.x, sy: p.y, tx, ty,
      t: 0, dur: 0.5, life: 1, dmg: w.dmg * p.mods.dmgMult,
      duration: w.duration,
      puddleRadius: w.puddleRadius * p.mods.areaMult,
      healPerTick: w.healPerTick || 0,
      owner: p,
    });
  }
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
      weaponId: 'ice',
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
  world.lightning.push({ points, jitter, segs, life: 0.22, maxLife: 0.22 });
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
      weaponId: 'shards',
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
  });
  SFX.hole();
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
