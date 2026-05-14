'use strict';

// ============================================================
//  game.js — world state, input, main loop, update + render.
//  Loads last; depends on sprites / sfx / data / entities / weapons / ui.
// ============================================================

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

// In-place compaction — avoids allocating a new array each frame the way
// `arr = arr.filter(...)` does. Hot tick loops process thousands of items
// per second; the cumulative GC pressure was visible as frame hitches.
function compact(arr, keep) {
  let w = 0;
  for (let i = 0; i < arr.length; i++) {
    if (keep(arr[i])) {
      if (w !== i) arr[w] = arr[i];
      w++;
    }
  }
  arr.length = w;
}

// Cached radial glow sprites. createRadialGradient is genuinely expensive —
// it tessellates a gradient texture each call. Pickups draw ~one per frame
// each, so caching by (color, radius) wipes a real chunk of frame time.
const _glowCache = new Map();
function getGlowSprite(color, radius) {
  const key = color + '@' + radius;
  let s = _glowCache.get(key);
  if (s) return s;
  s = document.createElement('canvas');
  const d = radius * 2;
  s.width = d; s.height = d;
  const gx = s.getContext('2d');
  const grad = gx.createRadialGradient(radius, radius, 1, radius, radius, radius);
  grad.addColorStop(0, color);
  grad.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
  gx.fillStyle = grad;
  gx.fillRect(0, 0, d, d);
  _glowCache.set(key, s);
  return s;
}

// Reusable z-sort buffer — avoids allocating an array of closure objects every
// frame. Entities push themselves in; we sort by `y` and dispatch by checking
// a property that's unique to each kind (player.controls, pickup.kind).
const _drawables = [];
const _drawableCmp = (a, b) => a.y - b.y;

const PIXEL_SCALE = 3;
let W = 0, H = 0;
function fitCanvas() {
  W = Math.max(320, Math.floor(window.innerWidth / PIXEL_SCALE));
  H = Math.max(180, Math.floor(window.innerHeight / PIXEL_SCALE));
  canvas.width = W;
  canvas.height = H;
  ctx.imageSmoothingEnabled = false;
}
window.addEventListener('resize', fitCanvas);
fitCanvas();

// ---------- INPUT ----------
const keys = {};
let moveTarget = null;
let mouseScreen = { x: 0, y: 0 };
let mouseHeld = false;

addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  keys[k] = true;
  if (k.startsWith('arrow')) e.preventDefault();
  if (k === 'm' && !e.repeat) {
    SFX.muted = !SFX.muted;
  }
  // Lore intro: any key (or specifically space/click) skips it.
  if (world.lore && !e.repeat) {
    if (k === ' ' || e.code === 'Space' || k === 'enter' || k === 'escape') {
      e.preventDefault();
      skipLore();
      return;
    }
  }
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
    moveTarget = null;
  }
  if ((k === ' ' || e.code === 'Space') && !e.repeat && world.player && !world.gameOver && !world.paused) {
    e.preventDefault();
    world.userPaused = !world.userPaused;
    SFX.pause();
  }
});
addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

function screenToWorld(sx, sy) {
  const rect = canvas.getBoundingClientRect();
  const lx = (sx - rect.left) / rect.width * W;
  const ly = (sy - rect.top) / rect.height * H;
  return { x: lx + world.camera.x, y: ly + world.camera.y };
}

canvas.addEventListener('mousemove', e => {
  mouseScreen.x = e.clientX; mouseScreen.y = e.clientY;
});
canvas.addEventListener('mousedown', e => {
  // Skip the lore intro if it's playing — gameplay click doesn't apply.
  if (world.lore) { skipLore(); return; }
  if (!world.player || world.paused || world.gameOver || world.userPaused) return;
  const wp = screenToWorld(e.clientX, e.clientY);
  moveTarget = wp;
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * TAU;
    world.particles.push({
      x: wp.x + Math.cos(ang) * 2, y: wp.y + Math.sin(ang) * 2,
      vx: Math.cos(ang) * 60, vy: Math.sin(ang) * 60,
      life: 0.3, maxLife: 0.3, size: 2,
      color: '#66ddff', gravity: 0,
    });
  }
  world.clickMarker = { x: wp.x, y: wp.y, t: 0.6 };
  mouseHeld = true;
});
addEventListener('mouseup', () => mouseHeld = false);

// ---------- WORLD ----------
const world = {
  players: [],
  get player() { return this.players[0]; },
  activeLevelUpPlayer: null,
  enemies: [],
  bullets: [],
  pickups: [],
  particles: [],
  damageNumbers: [],
  puddles: [],
  lightning: [],
  shards: [],
  holes: [],
  thorns: [],
  shockwaves: [],
  gasPuddles: [],
  spits: [],
  beams: [],
  camera: { x: -W / 2, y: -H / 2, shake: 0 },
  time: 0,
  kills: 0,
  spawnTimer: 0,
  nextBossAt: BOSS_INTERVAL,
  paused: false,
  userPaused: false,
  gameOver: false,
  clickMarker: null,
  flash: 0,
  auraFlash: 0,
  tier2Unlocked: false,
  bossWarning: null,
  titanSpawned: false,
  titanDefeated: false,
  recentBosses: [], // last few boss IDs spawned — used to prevent 3-in-a-row

  // Speedrun / wave mode. When waveMode is true the normal time-based spawner
  // is replaced by a queued-per-wave spawner and bosses are skipped (Titan is
  // wave 30). world.time still increments — it doubles as the speedrun timer.
  waveMode: false,
  wave: 0,
  waveQueued: 0,
  waveSpawnRate: 0.6,
  waveBurst: 1,
  waveSpawnCd: 0,
  waveSpawnTime: null,
  waveIntermissionT: 0,
  waveBanner: null,

  // Lore intro — see startLoreIntro / tickLore / renderLore.
  lore: null,
};

// ---------- MAIN LOOP ----------
let lastTime = 0;
function loop(t) {
  // Clamp non-negative: rAF's `t` can occasionally be slightly *behind* the
  // performance.now() value we sampled when (re)starting the game, which
  // produces a tiny negative dt. That cascades into negative animation indices.
  const dt = Math.max(0, Math.min(0.05, (t - lastTime) / 1000));
  lastTime = t;
  // Lore plays in front of the game and pauses gameplay. Tick first so the
  // text reveals advance even while world.paused is true.
  if (world.lore) tickLore(dt);
  if (!world.paused && !world.userPaused && !world.gameOver && world.players.length > 0) {
    update(dt);
  }
  render();
  requestAnimationFrame(loop);
}

function update(dt) {
  world.time += dt;

  // ----- player input + movement + per-slot weapon firing -----
  for (const p of world.players) {
    if (!p || p.dead) continue;
    let ix = 0, iy = 0;
    const c = p.controls;
    if (keys[c.up])    iy -= 1;
    if (keys[c.down])  iy += 1;
    if (keys[c.left])  ix -= 1;
    if (keys[c.right]) ix += 1;
    const hasKey = ix !== 0 || iy !== 0;
    if (p === world.player) {
      if (hasKey) { moveTarget = null; }
      else if (mouseHeld) { moveTarget = screenToWorld(mouseScreen.x, mouseScreen.y); }
      if (!hasKey && moveTarget) {
        const dx = moveTarget.x - p.x, dy = moveTarget.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d < 3) moveTarget = null;
        else { ix = dx / d; iy = dy / d; }
      }
    }
    const m = Math.hypot(ix, iy) || 1;
    ix /= m; iy /= m;
    const slow = (p.slowedUntil > world.time) ? 0.6 : 1.0;
    const spd = p.speed * p.mods.speedMult * slow;
    p.vx = ix * spd; p.vy = iy * spd;
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (Math.abs(p.vx) + Math.abs(p.vy) > 1) p.animT += dt * 8;
    if (p.vx !== 0) p.facing = p.vx > 0 ? 1 : -1;
    if (p.invuln > 0) p.invuln -= dt;

    for (const id of p.slots) {
      const w = p.weapons[id];
      if (!w) continue;
      if (id === 'knife') {
        w.cd -= dt; if (w.cd <= 0) { w.cd = w.rate; fireKnife(p); }
      } else if (id === 'aura') {
        tickAura(p, dt);
      } else if (id === 'holy') {
        w.cd -= dt; if (w.cd <= 0) { w.cd = w.rate; fireHoly(p); }
      } else if (id === 'ice') {
        w.cd -= dt; if (w.cd <= 0) { w.cd = w.rate; fireIce(p); }
        if (w.blizzard) {
          w.blizzard.cd -= dt;
          if (w.blizzard.cd <= 0) { w.blizzard.cd = w.blizzard.interval; triggerBlizzard(p, w.blizzard); }
        }
      } else if (id === 'lightning') {
        w.cd -= dt; if (w.cd <= 0) { w.cd = w.rate; fireLightning(p); }
      } else if (id === 'shards') {
        w.cd -= dt; if (w.cd <= 0) { w.cd = w.rate; fireShards(p); }
      } else if (id === 'hole') {
        w.cd -= dt; if (w.cd <= 0) { w.cd = w.rate; fireHole(p); }
      }
    }
  }

  // ----- spawning -----
  if (world.waveMode) {
    updateWaveSpawner(dt);
  } else {
    // Titan replaces all spawns at the 15-minute mark.
    if (!world.titanSpawned && world.time >= VICTORY_TIME) {
      world.titanSpawned = true;
      spawnTitan();
    }
    if (!world.titanSpawned) {
      world.spawnTimer -= dt;
      if (world.spawnTimer <= 0) {
        const t = world.time;
        const rate = Math.max(0.18, 0.85 - Math.sqrt(t) * 0.04);
        world.spawnTimer = rate;
        const burst = 1 + Math.floor(Math.sqrt(t / 12));
        for (let i = 0; i < burst; i++) spawnEnemy();
      }
      if (world.time >= world.nextBossAt) {
        spawnBoss();
        world.nextBossAt += BOSS_INTERVAL;
      }
    }
  }

  // Titan defeated → victory.
  if (world.titanDefeated && !world.gameOver) {
    showVictory();
    return;
  }

  // ----- enemy AI + movement -----
  const enemies = world.enemies;
  for (const e of enemies) {
    if (e.isBoss) tickBossAbility(e, dt);
    const tgt = nearestPlayer(e.x, e.y) || world.player;
    if (!tgt) continue;
    if (e.type === 'spitter') {
      tickSpitterAI(e, dt, tgt);
    } else if (e.type === 'exploder') {
      tickExploderAI(e, dt, tgt);
    } else {
      const dx = tgt.x - e.x, dy = tgt.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      const slowFactor = (e.slowedUntil > world.time) ? 0.45 : 1.0;
      e.vx = (dx / d) * e.speed * slowFactor;
      e.vy = (dy / d) * e.speed * slowFactor;
    }
    e.animT += dt * 4;
    if (e.hit > 0) e.hit -= dt;
  }
  // Spatial-hash enemy-enemy collisions.
  const CELL = 24;
  const grid = new Map();
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    const cx = Math.floor(e.x / CELL), cy = Math.floor(e.y / CELL);
    const key = cx * 73856093 ^ cy * 19349663;
    let bucket = grid.get(key);
    if (!bucket) { bucket = []; grid.set(key, bucket); }
    bucket.push(i);
  }
  for (let i = 0; i < enemies.length; i++) {
    const a = enemies[i];
    const cx = Math.floor(a.x / CELL), cy = Math.floor(a.y / CELL);
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const key = (cx + ox) * 73856093 ^ (cy + oy) * 19349663;
        const bucket = grid.get(key);
        if (!bucket) continue;
        for (const j of bucket) {
          if (j <= i) continue;
          const b = enemies[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const md = (a.w + b.w) * 0.45;
          const d2v = dx * dx + dy * dy;
          if (d2v < md * md && d2v > 0.01) {
            const d = Math.sqrt(d2v);
            const push = (md - d) / md * 40;
            const nx = dx / d, ny = dy / d;
            a.vx -= nx * push; a.vy -= ny * push;
            b.vx += nx * push; b.vy += ny * push;
          }
        }
      }
    }
  }
  for (const e of enemies) {
    e.x += e.vx * dt; e.y += e.vy * dt;
    for (const pl of world.players) {
      if (!pl || pl.dead) continue;
      const ddx = e.x - pl.x, ddy = e.y - pl.y;
      const minD = (e.w + pl.w) * 0.4;
      if (ddx * ddx + ddy * ddy < minD * minD && pl.invuln <= 0) {
        pl.hp -= e.dmg;
        pl.invuln = 0.6;
        world.camera.shake = 7;
        world.flash = 0.4;
        spawnParticles(pl.x, pl.y, 10, { colors: ['#ff0000', '#ff66cc'], speed: 110, life: 0.4 });
        SFX.hurt();
        if (pl.hp <= 0) downPlayer(pl);
      }
    }
  }

  // ----- bullets -----
  for (const b of world.bullets) {
    if (b.kind === 'holy') {
      b.t += dt;
      const t = b.t / b.dur;
      if (t >= 1) {
        world.puddles.push({
          x: b.tx, y: b.ty, r: b.puddleRadius,
          dmg: b.dmg, dmgInterval: 0.4, dmgTimer: 0,
          life: b.duration, maxLife: b.duration,
          healPerTick: b.healPerTick || 0,
          owner: b.owner,
        });
        spawnParticles(b.tx, b.ty, 14, { colors: ['#88ccff', '#fff', '#aaeeff'], speed: 70, life: 0.4, gravity: 60 });
        SFX.holySplash();
        b.life = -1;
        continue;
      }
      b.x = b.sx + (b.tx - b.sx) * t;
      b.y = b.sy + (b.ty - b.sy) * t - Math.sin(t * Math.PI) * 30;
      continue;
    }
    b.x += b.vx * dt; b.y += b.vy * dt;
    b.life -= dt;
    for (const e of enemies) {
      if (e.dead) continue;
      const dd = (e.w + 4) * 0.5;
      if (Math.abs(b.x - e.x) < dd && Math.abs(b.y - e.y) < dd) {
        if (b.kind === 'knife' || b.kind === 'shardFrag') {
          if (b.hits.has(e)) continue;
          b.hits.add(e);
          damageEnemy(e, b.dmg, b.owner, b.weaponId);
          const cols = b.kind === 'shardFrag'
            ? ['#fff', '#aaeeff', '#88ccff']
            : ['#ff3344', '#fff', '#ffcc44'];
          spawnParticles(b.x, b.y, 5, { colors: cols, speed: 80, life: 0.25, gravity: 0 });
          if (b.hits.size >= b.pierce) b.life = 0;
        } else if (b.kind === 'ice') {
          if (b.hits.has(e)) continue;
          b.hits.add(e);
          damageEnemy(e, b.dmg, b.owner, 'ice');
          e.slowedUntil = Math.max(e.slowedUntil, world.time + b.slow);
          spawnParticles(b.x, b.y, 8, { colors: ['#aaddff', '#fff', '#66bbff'], speed: 70, life: 0.35, gravity: 0 });
          b.life = 0;
        }
      }
    }
  }
  compact(world.bullets, b => b.life > 0);

  // Despawn enemies far from ALL alive players (in-place compaction).
  compact(world.enemies, e => {
    if (e.dead) return false;
    for (const pl of world.players) {
      if (!pl || pl.dead) continue;
      if (dist2(e.x, e.y, pl.x, pl.y) < 700 * 700) return true;
    }
    return false;
  });

  // ----- holy puddles (damage enemies, heal owner inside) -----
  for (const pd of world.puddles) {
    pd.life -= dt;
    pd.dmgTimer -= dt;
    if (pd.dmgTimer <= 0) {
      pd.dmgTimer = pd.dmgInterval;
      const r2 = pd.r * pd.r;
      for (const e of world.enemies) {
        if (e.dead) continue;
        const dx = e.x - pd.x, dy = e.y - pd.y;
        if (dx * dx + dy * dy < r2) {
          damageEnemy(e, pd.dmg, pd.owner || nearestPlayer(e.x, e.y), 'holy');
        }
      }
      // Heal: any alive player standing in the puddle gets a small tick.
      if (pd.healPerTick > 0) {
        for (const pl of world.players) {
          if (!pl || pl.dead) continue;
          const dx = pl.x - pd.x, dy = pl.y - pd.y;
          if (dx * dx + dy * dy < r2 && pl.hp < pl.hpMax) {
            const heal = Math.min(pd.healPerTick, pl.hpMax - pl.hp);
            pl.hp += heal;
            pl.stats.healed += heal;
            world.particles.push({
              x: pl.x + rand(-4, 4), y: pl.y - 6,
              vx: 0, vy: -28,
              life: 0.5, maxLife: 0.5, size: 1,
              color: '#aaffaa', gravity: -30,
            });
          }
        }
      }
    }
    if (Math.random() < 0.3) {
      world.particles.push({
        x: pd.x + rand(-pd.r, pd.r) * 0.7, y: pd.y + rand(-pd.r, pd.r) * 0.4,
        vx: 0, vy: -10, life: 0.4, maxLife: 0.4, size: 1,
        color: '#aae0ff', gravity: 0,
      });
    }
  }
  compact(world.puddles, pd => pd.life > 0);

  // ----- shards / holes -----
  tickShards(dt);
  tickHoles(dt);

  // ----- lightning visuals fade -----
  for (const l of world.lightning) l.life -= dt;
  compact(world.lightning, l => l.life > 0);

  // ----- boss warning banner -----
  if (world.bossWarning) {
    world.bossWarning.t -= dt;
    if (world.bossWarning.t <= 0) world.bossWarning = null;
  }
  if (world.waveBanner) {
    world.waveBanner.t -= dt;
    if (world.waveBanner.t <= 0) world.waveBanner = null;
  }

  // ----- thorns (boss) -----
  for (const tn of world.thorns) {
    tn.life -= dt;
    tn.x += tn.vx * dt; tn.y += tn.vy * dt;
    if (Math.random() < 0.4) {
      world.particles.push({
        x: tn.x, y: tn.y, vx: 0, vy: 0, life: 0.2, maxLife: 0.2, size: 1,
        color: '#ff6633', gravity: 0,
      });
    }
    for (const pl of world.players) {
      if (!pl || pl.dead || pl.invuln > 0 || tn.hit.has(pl)) continue;
      const dx = pl.x - tn.x, dy = pl.y - tn.y;
      if (dx * dx + dy * dy < 7 * 7) {
        tn.hit.add(pl);
        pl.hp -= tn.dmg;
        pl.invuln = 0.5;
        world.camera.shake = 5;
        world.flash = 0.35;
        SFX.hurt();
        if (pl.hp <= 0) downPlayer(pl);
        tn.life = 0;
        break;
      }
    }
  }
  compact(world.thorns, tn => tn.life > 0);

  // ----- shockwaves (boss slam / titan) -----
  for (const sw of world.shockwaves) {
    sw.life -= dt;
    const t = 1 - sw.life / sw.maxLife;
    sw.r = sw.rMax * t;
    const inner = Math.max(0, sw.rMax * Math.max(0, t - 0.15));
    for (const pl of world.players) {
      if (!pl || pl.dead || pl.invuln > 0 || sw.hit.has(pl)) continue;
      const dx = pl.x - sw.x, dy = pl.y - sw.y;
      const d = Math.hypot(dx, dy);
      if (d < sw.r && d > inner) {
        sw.hit.add(pl);
        pl.hp -= sw.dmg;
        pl.invuln = 0.6;
        world.camera.shake = 9;
        world.flash = 0.5;
        SFX.hurt();
        if (pl.hp <= 0) downPlayer(pl);
      }
    }
  }
  compact(world.shockwaves, sw => sw.life > 0);

  // ----- spitter projectiles (lobs landing into a slow-pool) -----
  for (const sp of world.spits) {
    sp.t += dt;
    const k = sp.t / sp.dur;
    if (k >= 1) {
      // Land — create a small slow pool.
      world.gasPuddles.push({
        x: sp.tx, y: sp.ty, r: 18, life: 3.5, maxLife: 3.5,
        dmg: sp.dmg * 0.25, dmgInterval: 0.4, dmgTimer: 0,
        slowsPlayer: true, color: '#88cc44',
      });
      // Direct hit damage.
      for (const pl of world.players) {
        if (!pl || pl.dead || pl.invuln > 0) continue;
        const dx = pl.x - sp.tx, dy = pl.y - sp.ty;
        if (dx * dx + dy * dy < 10 * 10) {
          pl.hp -= sp.dmg;
          pl.invuln = 0.4;
          SFX.hurt();
          if (pl.hp <= 0) downPlayer(pl);
        }
      }
      spawnParticles(sp.tx, sp.ty, 8, { colors: ['#88cc44', '#cce066', '#446622'], speed: 80, life: 0.4, gravity: 40 });
      sp.dead = true;
      continue;
    }
    sp.x = sp.sx + (sp.tx - sp.sx) * k;
    sp.y = sp.sy + (sp.ty - sp.sy) * k - Math.sin(k * Math.PI) * 24;
  }
  compact(world.spits, sp => !sp.dead);

  // ----- gas puddles (player-hazard, possibly slowing) -----
  for (const gp of world.gasPuddles) {
    gp.life -= dt;
    gp.dmgTimer -= dt;
    const r2 = gp.r * gp.r;
    // Continuous slow check.
    if (gp.slowsPlayer) {
      for (const pl of world.players) {
        if (!pl || pl.dead) continue;
        const dx = pl.x - gp.x, dy = pl.y - gp.y;
        if (dx * dx + dy * dy < r2) {
          pl.slowedUntil = Math.max(pl.slowedUntil, world.time + 0.2);
        }
      }
    }
    if (gp.dmgTimer <= 0) {
      gp.dmgTimer = gp.dmgInterval;
      for (const pl of world.players) {
        if (!pl || pl.dead || pl.invuln > 0) continue;
        const dx = pl.x - gp.x, dy = pl.y - gp.y;
        if (dx * dx + dy * dy < r2) {
          pl.hp -= gp.dmg;
          pl.invuln = 0.25;
          SFX.hurt();
          if (pl.hp <= 0) downPlayer(pl);
        }
      }
    }
    if (Math.random() < 0.25) {
      world.particles.push({
        x: gp.x + rand(-gp.r, gp.r) * 0.7,
        y: gp.y + rand(-gp.r * 0.4, gp.r * 0.4),
        vx: 0, vy: -14,
        life: 0.5, maxLife: 0.5, size: 1,
        color: gp.color || '#aaff66', gravity: -20,
      });
    }
  }
  compact(world.gasPuddles, gp => gp.life > 0);

  // ----- titan beams -----
  for (const bm of world.beams) {
    bm.life -= dt;
    // Damage players along the line during life.
    for (const pl of world.players) {
      if (!pl || pl.dead || pl.invuln > 0 || bm.hit.has(pl)) continue;
      // Distance from player to beam line segment.
      const dx = pl.x - bm.x, dy = pl.y - bm.y;
      const cosA = Math.cos(bm.angle), sinA = Math.sin(bm.angle);
      const along = dx * cosA + dy * sinA;
      const perp = Math.abs(-dx * sinA + dy * cosA);
      if (along > 0 && along < bm.length && perp < bm.width) {
        bm.hit.add(pl);
        pl.hp -= bm.dmg;
        pl.invuln = 0.6;
        SFX.hurt();
        world.camera.shake = 8;
        world.flash = 0.5;
        if (pl.hp <= 0) downPlayer(pl);
      }
    }
  }
  compact(world.beams, bm => bm.life > 0);

  // ----- pickups -----
  for (const pk of world.pickups) {
    pk.bob += dt * 4;
    pk.t += dt;

    // Magnet-tagged homing: accelerate toward the tagged player, ignoring
    // the normal pickup radius. Falls back to standard behavior if the
    // target is dead so the gem doesn't float forever.
    if (pk._homing) {
      const tgt = pk._homing;
      if (tgt.dead) {
        pk._homing = null;
      } else {
        pk._homingT += dt;
        if (pk._homingT > 0) {
          const dx = tgt.x - pk.x, dy = tgt.y - pk.y;
          const d2v = dx * dx + dy * dy;
          if (d2v < 9 * 9) {
            collectPickup(pk, tgt);
            pk.dead = true;
            continue;
          }
          // Quick easing curve: starts ~320 px/s, ramps past 1000 in under a
          // second so distant gems still arrive snappily.
          const speed = 320 + pk._homingT * pk._homingT * 1400;
          const d = Math.sqrt(d2v) || 1;
          pk.x += (dx / d) * speed * dt;
          pk.y += (dy / d) * speed * dt;
          // Light sparkle trail so the cascade reads visually too.
          if (Math.random() < 0.35) {
            world.particles.push({
              x: pk.x, y: pk.y, vx: 0, vy: 0,
              life: 0.22, maxLife: 0.22, size: 1,
              color: '#aaeeff', gravity: 0,
            });
          }
        }
        // Still homing (or waiting in the startup delay) — skip normal magnet.
        continue;
      }
    }

    let bestPull = null, bestPullD = Infinity, bestPullPr = 0;
    for (const pl of world.players) {
      if (!pl || pl.dead) continue;
      const pr = pl.pickupRadius * pl.mods.magnetMult;
      const dx = pl.x - pk.x, dy = pl.y - pk.y;
      const d2v = dx * dx + dy * dy;
      if (d2v < 9 * 9) {
        collectPickup(pk, pl);
        pk.dead = true;
        break;
      }
      if (d2v < pr * pr && d2v < bestPullD) {
        bestPullD = d2v; bestPull = pl; bestPullPr = pr;
      }
    }
    if (!pk.dead && bestPull) {
      const dx = bestPull.x - pk.x, dy = bestPull.y - pk.y;
      const d = Math.sqrt(bestPullD) || 1;
      const mag = 220 + (1 - d / bestPullPr) * 240;
      pk.x += (dx / d) * mag * dt;
      pk.y += (dy / d) * mag * dt;
    }
  }
  compact(world.pickups, pk => !pk.dead);

  // ----- particles + damage numbers -----
  {
    const arr = world.particles;
    for (let i = arr.length - 1; i >= 0; i--) {
      const pp = arr[i];
      pp.life -= dt;
      pp.vy += pp.gravity * dt;
      pp.x += pp.vx * dt; pp.y += pp.vy * dt;
      if (pp.life <= 0) {
        const last = arr.length - 1;
        if (i !== last) arr[i] = arr[last];
        arr.pop();
      }
    }
  }
  for (const dn of world.damageNumbers) {
    dn.life -= dt;
    dn.y += dn.vy * dt;
    dn.vy += 40 * dt;
  }
  compact(world.damageNumbers, d => d.life > 0);

  if (world.clickMarker) {
    world.clickMarker.t -= dt;
    if (world.clickMarker.t <= 0) world.clickMarker = null;
  }
  if (world.flash > 0) world.flash = Math.max(0, world.flash - dt * 2);
  if (world.auraFlash > 0) world.auraFlash = Math.max(0, world.auraFlash - dt * 3);

  // ----- camera follow midpoint of alive players -----
  // Tight critically-damped lerp — bumped factor + no per-frame allocation.
  let camFx = 0, camFy = 0, camN = 0;
  for (const pl of world.players) {
    if (!pl || pl.dead) continue;
    camFx += pl.x; camFy += pl.y; camN++;
  }
  if (camN === 0 && world.player) { camFx = world.player.x; camFy = world.player.y; camN = 1; }
  if (camN > 0) {
    const fx = camFx / camN, fy = camFy / camN;
    const cx = fx - W / 2;
    const cy = fy - H / 2;
    // Higher factor = camera sticks closer to the focal point each frame.
    const k = Math.min(1, dt * 16);
    world.camera.x += (cx - world.camera.x) * k;
    world.camera.y += (cy - world.camera.y) * k;
  }
  if (world.camera.shake > 0) {
    world.camera.shake *= Math.pow(0.82, dt * 60);
    if (world.camera.shake < 0.05) world.camera.shake = 0;
  }

  updateHUD();
}

function collectPickup(pk, collector) {
  const p = collector || nearestPlayer(pk.x, pk.y) || world.player;
  if (!p) return;
  if (pk.kind === 'gem') {
    gainXp(pk.value, p);
    p.stats.gemsCollected++;
    spawnParticles(pk.x, pk.y, 5, { colors: ['#66ddff', '#fff'], speed: 50, life: 0.3, gravity: 0 });
    SFX.gem();
  } else if (pk.kind === 'heal') {
    const restored = Math.min(pk.value, p.hpMax - p.hp);
    p.hp = Math.min(p.hpMax, p.hp + pk.value);
    p.stats.healed += restored;
    spawnParticles(pk.x, pk.y, 12, { colors: ['#66ff66', '#fff', '#aaffaa'], speed: 60, life: 0.5, gravity: -40 });
    SFX.heal();
  } else if (pk.kind === 'magnet') {
    // Tag every gem to home toward the collector — they accelerate toward the
    // player and trigger the normal gem-collect sound as each one arrives,
    // which gives the satisfying chime cascade instead of an instant gulp.
    for (const pp of world.pickups) {
      if (pp.dead || pp === pk) continue;
      if (pp.kind === 'gem') {
        pp._homing = p;
        // Negative startup time delays the launch — gives the cascade a
        // rolling feel instead of a single chord when many gems are nearby.
        pp._homingT = -Math.random() * 0.35;
      }
    }
    world.flash = 0.25;
    spawnParticles(pk.x, pk.y, 20, { colors: ['#ff6666', '#fff', '#ffaaaa'], speed: 120, life: 0.55, gravity: 0 });
    SFX.magnet();
  } else if (pk.kind === 'chest') {
    for (const pl of world.players) {
      if (!pl || pl.dead) continue;
      const needed = pl.xpNext - pl.xp;
      gainXp(Math.max(1, needed), pl);
    }
    world.flash = 0.5;
    spawnParticles(pk.x, pk.y, 30, { colors: ['#ffcc44', '#fff', '#ffee88', '#ff66cc'], speed: 140, life: 0.7, gravity: 0 });
    SFX.chest();
  } else if (pk.kind === 'bomb') {
    world.flash = 0.7;
    world.camera.shake = 12;
    SFX.bomb();
    for (const e of world.enemies) {
      if (e.dead) continue;
      damageEnemy(e, 80, p);
    }
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * TAU;
      const s = rand(80, 220);
      world.particles.push({
        x: p.x, y: p.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(0.5, 1.0), maxLife: 1.0, size: 2,
        color: ['#ffcc44', '#ff6600', '#ff3300', '#fff'][irand(0, 3)], gravity: 0,
      });
    }
  }
}

// ============================================================
//  RENDER
// ============================================================
function render() {
  // Lore overlay paints its own scene; skip the gameplay render entirely.
  if (world.lore) { renderLore(); return; }
  ctx.fillStyle = '#0a0612';
  ctx.fillRect(0, 0, W, H);
  if (world.players.length === 0) return;

  const shakeX = (Math.random() - 0.5) * world.camera.shake;
  const shakeY = (Math.random() - 0.5) * world.camera.shake;
  const camX = Math.floor(world.camera.x + shakeX);
  const camY = Math.floor(world.camera.y + shakeY);

  // Tiles
  const TS = 32;
  const startX = Math.floor(camX / TS) - 1;
  const startY = Math.floor(camY / TS) - 1;
  const endX = startX + Math.ceil(W / TS) + 2;
  const endY = startY + Math.ceil(H / TS) + 2;
  for (let ty = startY; ty < endY; ty++) {
    for (let tx = startX; tx < endX; tx++) {
      const h = ((tx * 928371) ^ (ty * 213213)) & 15;
      const t = h === 0 ? tile3 : h < 4 ? tile2 : tile;
      ctx.drawImage(t, tx * TS - camX, ty * TS - camY);
    }
  }

  // Click marker
  if (world.clickMarker) {
    const m = world.clickMarker;
    const a = clamp(m.t / 0.6, 0, 1);
    ctx.globalAlpha = a;
    ctx.strokeStyle = '#66ddff';
    ctx.lineWidth = 1;
    const sz = 6 + (1 - a) * 4;
    ctx.beginPath();
    ctx.moveTo(m.x - camX - sz, m.y - camY - sz);
    ctx.lineTo(m.x - camX + sz, m.y - camY + sz);
    ctx.moveTo(m.x - camX + sz, m.y - camY - sz);
    ctx.lineTo(m.x - camX - sz, m.y - camY + sz);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Holy puddles
  for (const pd of world.puddles) {
    const a = clamp(pd.life / pd.maxLife, 0, 1);
    ctx.globalAlpha = 0.5 * a;
    const grad = ctx.createRadialGradient(pd.x - camX, pd.y - camY, 1, pd.x - camX, pd.y - camY, pd.r);
    grad.addColorStop(0, 'rgba(170, 220, 255, 0.7)');
    grad.addColorStop(0.7, 'rgba(100, 180, 255, 0.4)');
    grad.addColorStop(1, 'rgba(100, 180, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(pd.x - camX - pd.r, pd.y - camY - pd.r * 0.6, pd.r * 2, pd.r * 1.2);
    ctx.globalAlpha = 1;
  }

  // Gas / spit puddles
  for (const gp of world.gasPuddles) {
    const a = clamp(gp.life / gp.maxLife, 0, 1);
    ctx.globalAlpha = 0.55 * a;
    const col = gp.color || '#aaff66';
    const grad = ctx.createRadialGradient(gp.x - camX, gp.y - camY, 1, gp.x - camX, gp.y - camY, gp.r);
    grad.addColorStop(0, col);
    grad.addColorStop(1, 'rgba(40, 80, 40, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(gp.x - camX - gp.r, gp.y - camY - gp.r * 0.6, gp.r * 2, gp.r * 1.2);
    ctx.globalAlpha = 1;
  }

  // Holes (under entities)
  for (const h of world.holes) drawHole(h, camX, camY);

  // Aura rings
  const pulse = 0.5 + 0.5 * Math.sin(world.time * 5);
  for (const pl of world.players) {
    if (!pl || pl.dead || !pl.weapons.aura) continue;
    const r = pl.weapons.aura.radius * pl.mods.areaMult;
    const af = world.auraFlash;
    const grad = ctx.createRadialGradient(pl.x - camX, pl.y - camY, 4, pl.x - camX, pl.y - camY, r);
    grad.addColorStop(0, `rgba(255, 102, 204, ${0.25 + af * 0.35})`);
    grad.addColorStop(0.7, `rgba(180, 60, 200, ${0.12 + af * 0.2})`);
    grad.addColorStop(1, 'rgba(180, 60, 200, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(pl.x - camX - r, pl.y - camY - r, r * 2, r * 2);
    ctx.strokeStyle = `rgba(255, 102, 204, ${0.55 + pulse * 0.25 + af * 0.4})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pl.x - camX, pl.y - camY, r, 0, TAU);
    ctx.stroke();
  }

  // Titan beams (under entities)
  for (const bm of world.beams) drawBeam(bm, camX, camY);

  // Z-sorted entities — reuse the buffer and dispatch by property tag.
  _drawables.length = 0;
  // Cull entities outside the visible window (+margin for sprite extents).
  const cullL = camX - 32, cullR = camX + W + 32;
  const cullT = camY - 48, cullB = camY + H + 64;
  for (const pk of world.pickups) {
    if (pk.x < cullL || pk.x > cullR || pk.y < cullT || pk.y > cullB) continue;
    _drawables.push(pk);
  }
  for (const e of world.enemies) {
    if (e.x < cullL || e.x > cullR || e.y < cullT || e.y > cullB) continue;
    _drawables.push(e);
  }
  for (const pl of world.players) {
    if (!pl) continue;
    _drawables.push(pl);
  }
  _drawables.sort(_drawableCmp);
  for (let i = 0; i < _drawables.length; i++) {
    const d = _drawables[i];
    // Players have `controls`; pickups have `kind`; enemies have neither.
    if (d.controls) drawPlayer(d, camX, camY);
    else if (d.kind) drawPickup(d, camX, camY);
    else drawEnemy(d, camX, camY);
  }

  // Shards (over entities)
  for (const s of world.shards) drawShard(s, camX, camY);

  // Bullets
  for (const b of world.bullets) drawBullet(b, camX, camY);

  // Lightning chains
  for (const l of world.lightning) {
    const a = clamp(l.life / l.maxLife, 0, 1);
    ctx.globalAlpha = a;
    ctx.lineWidth = 2;
    const segs = l.segs || 6;
    for (let i = 1; i < l.points.length; i++) {
      const p0 = l.points[i - 1], p1 = l.points[i];
      const row = l.jitter ? l.jitter[i - 1] : null;
      ctx.strokeStyle = '#ffee66';
      ctx.beginPath();
      ctx.moveTo(p0.x - camX, p0.y - camY);
      for (let s = 1; s < segs; s++) {
        const t = s / segs;
        const jx = row ? row[s - 1].jx : 0;
        const jy = row ? row[s - 1].jy : 0;
        ctx.lineTo(p0.x + (p1.x - p0.x) * t - camX + jx, p0.y + (p1.y - p0.y) * t - camY + jy);
      }
      ctx.lineTo(p1.x - camX, p1.y - camY);
      ctx.stroke();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.lineWidth = 2;
    }
    ctx.globalAlpha = 1;
  }

  // Boss shockwave rings
  for (const sw of world.shockwaves) {
    const a = clamp(sw.life / sw.maxLife, 0, 1);
    ctx.globalAlpha = a * 0.9;
    ctx.strokeStyle = '#ffaa44';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(sw.x - camX, sw.y - camY, sw.r, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(sw.x - camX, sw.y - camY, sw.r, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Thorn projectiles
  for (const tn of world.thorns) {
    const a = clamp(tn.life / tn.maxLife, 0, 1);
    ctx.globalAlpha = a;
    ctx.fillStyle = '#ff3300';
    ctx.fillRect(Math.floor(tn.x - camX - 2), Math.floor(tn.y - camY - 2), 4, 4);
    ctx.fillStyle = '#ffaa00';
    ctx.fillRect(Math.floor(tn.x - camX - 1), Math.floor(tn.y - camY - 1), 2, 2);
    ctx.globalAlpha = 1;
  }

  // Spit projectiles
  for (const sp of world.spits) {
    ctx.save();
    ctx.translate(Math.floor(sp.x - camX), Math.floor(sp.y - camY));
    ctx.fillStyle = '#88cc44';
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#cce066';
    ctx.beginPath();
    ctx.arc(-1, -1, 1, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // Particles
  for (const pp of world.particles) {
    const alpha = Math.max(0, pp.life / pp.maxLife);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = pp.color;
    ctx.fillRect(Math.floor(pp.x - camX), Math.floor(pp.y - camY), pp.size, pp.size);
  }
  ctx.globalAlpha = 1;

  // Damage numbers
  ctx.font = 'bold 11px Courier New';
  ctx.textAlign = 'center';
  for (const d of world.damageNumbers) {
    const a = Math.max(0, d.life / 0.8);
    ctx.globalAlpha = a;
    ctx.fillStyle = '#000';
    ctx.fillText(d.val, Math.floor(d.x - camX + 1), Math.floor(d.y - camY + 1));
    ctx.fillStyle = d.crit ? '#ffcc44' : '#ffffff';
    ctx.fillText(d.val, Math.floor(d.x - camX), Math.floor(d.y - camY));
  }
  ctx.globalAlpha = 1;

  if (world.flash > 0) {
    ctx.fillStyle = `rgba(255, 64, 64, ${world.flash * 0.45})`;
    ctx.fillRect(0, 0, W, H);
  }

  const grad = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.8);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  if (world.bossWarning) {
    const bw = world.bossWarning;
    const a = clamp(bw.t / (bw.tMax || 3.0), 0, 1);
    const pulse2 = 0.6 + 0.4 * Math.sin(world.time * 8);
    const hasDesc = !!bw.desc;
    const bannerH = hasDesc ? 48 : 36;
    const bannerY = H / 2 - 28;
    ctx.globalAlpha = a;
    ctx.fillStyle = `rgba(120, 8, 24, ${0.45 + pulse2 * 0.2})`;
    ctx.fillRect(0, bannerY, W, bannerH);
    ctx.font = 'bold 16px Courier New';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#000';
    ctx.fillText('⚠  ' + bw.name + '  ⚠', W / 2 + 2, H / 2 - 6 + 2);
    ctx.fillStyle = '#ffcc44';
    ctx.fillText('⚠  ' + bw.name + '  ⚠', W / 2, H / 2 - 6);
    ctx.font = 'bold 9px Courier New';
    ctx.fillStyle = '#fff';
    ctx.fillText(bw.subtitle || '', W / 2, H / 2 + 6);
    if (hasDesc) {
      ctx.font = 'bold 8px Courier New';
      ctx.fillStyle = '#ffaaaa';
      ctx.fillText(bw.desc, W / 2, H / 2 + 16);
    }
    ctx.globalAlpha = 1;
  }

  // Wave banner (speedrun mode): sits up near the top so it never overlaps
  // the center-screen boss warning.
  if (world.waveBanner) {
    const wb = world.waveBanner;
    const a = clamp(wb.t / (wb.tMax || 2.0), 0, 1);
    const cy = 50;
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(20, 8, 30, 0.85)';
    ctx.fillRect(0, cy - 14, W, 30);
    ctx.font = 'bold 14px Courier New';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffcc44';
    ctx.fillText(wb.line1, W / 2, cy + 2);
    ctx.font = 'bold 9px Courier New';
    ctx.fillStyle = '#aaeeff';
    ctx.fillText(wb.line2 || '', W / 2, cy + 14);
    ctx.globalAlpha = 1;
  }

  if (world.userPaused) {
    ctx.fillStyle = 'rgba(8, 4, 18, 0.7)';
    ctx.fillRect(0, 0, W, H);
    ctx.font = 'bold 32px Courier New';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#000';
    ctx.fillText('PAUSED', W / 2 + 2, H / 2 + 2);
    ctx.fillStyle = '#ff66cc';
    ctx.fillText('PAUSED', W / 2, H / 2);
    ctx.font = 'bold 10px Courier New';
    ctx.fillStyle = '#aaa';
    ctx.fillText('SPACE to resume  •  M to mute', W / 2, H / 2 + 20);
  }
}

// ---------- DRAW HELPERS ----------
function drawPlayer(p, camX, camY) {
  if (p.dead) {
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#000';
    ctx.fillRect(Math.floor(p.x - camX - 5), Math.floor(p.y - camY - 6), 10, 10);
    ctx.fillStyle = '#555';
    ctx.fillRect(Math.floor(p.x - camX - 4), Math.floor(p.y - camY - 5), 8, 8);
    ctx.fillStyle = '#222';
    ctx.font = 'bold 7px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('R.I.P', Math.floor(p.x - camX), Math.floor(p.y - camY + 1));
    ctx.globalAlpha = 1;
    ctx.font = 'bold 8px Courier New';
    ctx.fillStyle = '#000';
    ctx.fillText(`${p.name} DOWN`, Math.floor(p.x - camX + 1), Math.floor(p.y - camY - 9));
    ctx.fillStyle = '#ff6666';
    ctx.fillText(`${p.name} DOWN`, Math.floor(p.x - camX), Math.floor(p.y - camY - 10));
    return;
  }
  const frame = Math.floor(p.animT) % 2;
  const sprite = (p.sprites || playerSprites)[frame];
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.ellipse(p.x - camX, p.y - camY + 7, 6, 2, 0, 0, TAU);
  ctx.fill();
  if (p.invuln > 0 && Math.floor(p.invuln * 30) % 2 === 0) ctx.globalAlpha = 0.5;
  if (p.facing === -1) {
    ctx.save();
    ctx.translate(Math.floor(p.x - camX), Math.floor(p.y - camY - 8));
    ctx.scale(-1, 1);
    ctx.drawImage(sprite, -7, 0);
    ctx.restore();
  } else {
    ctx.drawImage(sprite, Math.floor(p.x - camX - 7), Math.floor(p.y - camY - 8));
  }
  if (world.players.length > 1) {
    ctx.font = 'bold 7px Courier New';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#000';
    ctx.fillText(p.name, Math.floor(p.x - camX + 1), Math.floor(p.y - camY - 18 + 1));
    ctx.fillStyle = p.theme || '#fff';
    ctx.fillText(p.name, Math.floor(p.x - camX), Math.floor(p.y - camY - 18));
  }
  ctx.globalAlpha = 1;

  const bw = 22, bh = 4;
  const bx = Math.floor(p.x - camX - bw / 2);
  const by = Math.floor(p.y - camY - 16);
  ctx.fillStyle = '#000';
  ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
  ctx.fillStyle = '#3a0a1a';
  ctx.fillRect(bx, by, bw, bh);
  const pct = clamp(p.hp / p.hpMax, 0, 1);
  const fillW = Math.ceil(bw * pct);
  const g = Math.floor(80 + pct * 100);
  const b = Math.floor(80 + pct * 40);
  ctx.fillStyle = `rgb(255,${g},${b})`;
  ctx.fillRect(bx, by, fillW, bh);
  ctx.fillStyle = `rgba(255,255,255,0.35)`;
  ctx.fillRect(bx, by, fillW, 1);
  ctx.font = 'bold 7px Courier New';
  ctx.textAlign = 'center';
  const txt = `${Math.max(0, Math.ceil(p.hp))}/${p.hpMax}`;
  ctx.fillStyle = '#000';
  ctx.fillText(txt, bx + bw / 2 + 1, by - 2 + 1);
  ctx.fillStyle = '#fff';
  ctx.fillText(txt, bx + bw / 2, by - 2);
}

function drawEnemy(e, camX, camY) {
  if (e.isBoss) { drawBoss(e, camX, camY); return; }
  if (e.type === 'swarmling') { drawSwarmling(e, camX, camY); return; }
  const frame = Math.floor(e.animT) % 2;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.ellipse(e.x - camX, e.y - camY + (e.h / 2 - 1), e.w / 2 - 2, 2, 0, 0, TAU);
  ctx.fill();
  const tgt = nearestPlayer(e.x, e.y) || world.player;
  const facing = tgt && tgt.x > e.x ? 1 : -1;
  const sprite = e.sprites[frame];
  const slowed = e.slowedUntil > world.time;
  ctx.save();
  ctx.translate(Math.floor(e.x - camX), Math.floor(e.y - camY - e.h / 2));
  if (facing === -1) ctx.scale(-1, 1);
  // Exploder fuse flash (white blink as fuse climbs).
  const fuseFlash = e.type === 'exploder' && e.fuseT > 0 && Math.floor(e.fuseT * 16) % 2 === 0;
  if (e.hit > 0 || fuseFlash) {
    ctx.drawImage(sprite, -sprite.width / 2, 0);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = fuseFlash ? 'rgba(255,180,80,0.85)' : 'rgba(255,255,255,0.85)';
    ctx.fillRect(-sprite.width / 2, 0, sprite.width, sprite.height);
    ctx.globalCompositeOperation = 'source-over';
  } else {
    ctx.drawImage(sprite, -sprite.width / 2, 0);
    if (slowed) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = 'rgba(102, 187, 255, 0.4)';
      ctx.fillRect(-sprite.width / 2, 0, sprite.width, sprite.height);
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  ctx.restore();
  if (e.isElite) {
    const pulse = 0.4 + 0.3 * Math.sin(world.time * 4 + e.animT);
    ctx.fillStyle = `rgba(255, 204, 68, ${pulse * 0.5})`;
    ctx.beginPath();
    ctx.arc(e.x - camX, e.y - camY, e.w * 0.9, 0, TAU);
    ctx.fill();
  }
  if (e.type === 'exploder') {
    const pulse = 0.5 + 0.5 * Math.sin(world.time * 10);
    ctx.fillStyle = `rgba(255, 102, 0, ${pulse * 0.35})`;
    ctx.beginPath();
    ctx.arc(e.x - camX, e.y - camY, e.w * 0.85, 0, TAU);
    ctx.fill();
  }
  if ((e.type === 'brute' || e.isElite) && e.hp < e.hpMax) {
    const w = e.w;
    ctx.fillStyle = '#000';
    ctx.fillRect(Math.floor(e.x - camX - w / 2), Math.floor(e.y - camY - e.h / 2 - 5), w, 4);
    ctx.fillStyle = '#ff3344';
    ctx.fillRect(Math.floor(e.x - camX - w / 2) + 1, Math.floor(e.y - camY - e.h / 2 - 5) + 1, (w - 2) * (e.hp / e.hpMax), 2);
  }
}

function drawSwarmling(e, camX, camY) {
  const x = Math.floor(e.x - camX);
  const y = Math.floor(e.y - camY);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(x - 3, y + 2, 6, 1);
  const blink = Math.floor(world.time * 8 + e.animT) % 2;
  ctx.fillStyle = blink ? '#cc4488' : '#aa3377';
  ctx.fillRect(x - 3, y - 3, 6, 6);
  ctx.fillStyle = '#ff66cc';
  ctx.fillRect(x - 3, y - 3, 6, 1);
  ctx.fillStyle = '#fff';
  ctx.fillRect(x - 2, y - 2, 1, 1);
  ctx.fillRect(x + 1, y - 2, 1, 1);
}

function drawBoss(e, camX, camY) {
  const x = Math.floor(e.x - camX);
  const y = Math.floor(e.y - camY);
  const tp = e.bossType;
  const t = world.time * 6 + e.animT;
  const bob = Math.sin(t) * 1.5;
  const hit = e.hit > 0;

  // Shadow (every boss).
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.beginPath();
  ctx.ellipse(x, y + e.h / 2 - 1, e.w / 2, 3, 0, 0, TAU);
  ctx.fill();

  // Aura pulse — tinted to match the boss's eye color so each feels distinct.
  const pulse = 0.4 + 0.3 * Math.sin(world.time * 3);
  ctx.fillStyle = hexToRgba(tp.eyes, pulse * 0.30);
  ctx.beginPath();
  ctx.arc(x, y, e.w * 0.85, 0, TAU);
  ctx.fill();

  // Dispatch by boss id — each one is hand-drawn so they read as creatures
  // instead of colored boxes.
  const id = tp.id;
  if      (id === 'reaper')      drawReaper(e, x, y, bob, hit);
  else if (id === 'necromancer') drawNecromancer(e, x, y, bob, hit);
  else if (id === 'thorns')      drawThornedHorror(e, x, y, bob, hit);
  else if (id === 'juggernaut')  drawJuggernaut(e, x, y, bob, hit);
  else if (id === 'hivequeen')   drawHiveQueen(e, x, y, bob, hit);
  else if (id === 'plague')      drawPlagueDoctor(e, x, y, bob, hit);
  else if (id === 'titan')       drawTitan(e, x, y, bob, hit);
  else                            drawGenericBoss(e, x, y, bob, hit);

  if (e.slowedUntil > world.time) {
    ctx.fillStyle = 'rgba(102, 187, 255, 0.25)';
    ctx.fillRect(x - e.w / 2 - 2, y - e.h / 2 + bob - 2, e.w + 4, e.h + 4);
  }

  drawBossOverlay(e, x, y, bob);
}

function hexToRgba(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function drawBossOverlay(e, x, y, bob) {
  const tp = e.bossType;
  const bw = e.w + 8;
  ctx.fillStyle = '#000';
  ctx.fillRect(x - bw / 2 - 1, y - e.h / 2 - 9 + bob, bw + 2, 6);
  ctx.fillStyle = '#3a0a1a';
  ctx.fillRect(x - bw / 2, y - e.h / 2 - 8 + bob, bw, 4);
  ctx.fillStyle = '#ff3344';
  ctx.fillRect(x - bw / 2, y - e.h / 2 - 8 + bob, bw * (e.hp / e.hpMax), 4);
  ctx.font = 'bold 8px Courier New';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#000';
  const label = e.isTitan ? e.bossName : `${e.bossName} (${e.minute}m)`;
  ctx.fillText(label, x + 1, y - e.h / 2 - 12 + bob + 1);
  ctx.fillStyle = tp.eyes;
  ctx.fillText(label, x, y - e.h / 2 - 12 + bob);
  if (tp.ability && e.abilityCd < 1.0) {
    const w = 1 - e.abilityCd;
    ctx.strokeStyle = `rgba(255, 204, 68, ${w * 0.8})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, e.w * 0.7 + (1 - w) * 8, 0, TAU);
    ctx.stroke();
  }
}

// ---------- per-boss silhouettes ----------
function drawGenericBoss(e, x, y, bob, hit) {
  const tp = e.bossType;
  const col = hit ? '#fff' : tp.color;
  ctx.fillStyle = col;
  ctx.fillRect(x - e.w / 2, y - e.h / 2 + bob, e.w, e.h);
  ctx.fillStyle = hit ? '#fff' : tp.accent;
  ctx.fillRect(x - e.w / 2, y - e.h / 2 + bob, e.w, 4);
  ctx.fillRect(x - e.w / 2, y + e.h / 2 - 4 + bob, e.w, 4);
  ctx.fillStyle = tp.eyes;
  ctx.fillRect(x - e.w / 2 + 6, y - e.h / 2 + 8 + bob, 4, 4);
  ctx.fillRect(x + e.w / 2 - 10, y - e.h / 2 + 8 + bob, 4, 4);
}

function drawReaper(e, x, y, bob, hit) {
  // Tall hooded skeleton with a scythe. Robe widens at the bottom.
  const robe = hit ? '#fff' : '#0a0a14';
  const robeShade = hit ? '#fff' : '#1a1a26';
  const top = y - e.h / 2 + bob;
  // Scythe pole (drawn behind).
  ctx.fillStyle = hit ? '#fff' : '#5a3a18';
  ctx.fillRect(x + e.w / 2 + 1, top - 4, 2, e.h + 4);
  ctx.fillStyle = hit ? '#fff' : '#9a7a4a';
  ctx.fillRect(x + e.w / 2 + 1, top - 4, 2, 1);
  // Scythe blade curve.
  ctx.fillStyle = hit ? '#fff' : '#ddd';
  ctx.fillRect(x + e.w / 2 - 1, top - 4, 10, 2);
  ctx.fillRect(x + e.w / 2 + 6, top - 2, 3, 4);
  ctx.fillRect(x + e.w / 2 + 4, top - 6, 4, 2);
  ctx.fillStyle = hit ? '#fff' : '#999';
  ctx.fillRect(x + e.w / 2 + 7, top - 1, 1, 2);
  // Robe — trapezoid built from horizontal bands.
  for (let i = 0; i < e.h; i++) {
    const t = i / e.h;
    const halfW = Math.floor(5 + t * (e.w / 2 - 4));
    ctx.fillStyle = robe;
    ctx.fillRect(x - halfW, top + i, halfW * 2, 1);
    if (i > 4 && i % 6 === 0) {
      ctx.fillStyle = robeShade;
      ctx.fillRect(x - halfW + 1, top + i, 1, 1);
      ctx.fillRect(x + halfW - 2, top + i, 1, 1);
    }
  }
  // Bone trim along the bottom.
  ctx.fillStyle = hit ? '#fff' : '#dddddd';
  for (let i = -e.w / 2 + 2; i < e.w / 2 - 2; i += 4) {
    ctx.fillRect(x + i, y + e.h / 2 + bob - 2, 2, 2);
  }
  // Hood opening — pitch black.
  ctx.fillStyle = '#000';
  ctx.fillRect(x - 6, top + 4, 12, 12);
  ctx.fillRect(x - 5, top + 2, 10, 2);
  ctx.fillRect(x - 4, top, 8, 2);
  // Glowing green eyes deep in the hood.
  ctx.fillStyle = hit ? '#fff' : '#aaffaa';
  ctx.fillRect(x - 5, top + 8, 3, 2);
  ctx.fillRect(x + 2, top + 8, 3, 2);
  ctx.fillStyle = '#fff';
  ctx.fillRect(x - 4, top + 8, 1, 1);
  ctx.fillRect(x + 3, top + 8, 1, 1);
  // Skeletal hand on the scythe pole.
  ctx.fillStyle = hit ? '#fff' : '#ddd';
  ctx.fillRect(x + e.w / 2 - 1, y + bob, 3, 4);
}

function drawNecromancer(e, x, y, bob, hit) {
  // Hooded purple sorcerer holding a staff with an orb and a floating skull.
  const robe = hit ? '#fff' : '#3a1058';
  const robeHi = hit ? '#fff' : '#5a2880';
  const top = y - e.h / 2 + bob;
  // Staff to the left.
  ctx.fillStyle = hit ? '#fff' : '#3a2010';
  ctx.fillRect(x - e.w / 2 - 3, top - 4, 2, e.h + 4);
  // Orb at top of staff.
  ctx.fillStyle = hit ? '#fff' : '#ff66cc';
  ctx.beginPath(); ctx.arc(x - e.w / 2 - 2, top - 4, 3, 0, TAU); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillRect(x - e.w / 2 - 3, top - 5, 1, 1);
  // Robe — slight trapezoid.
  for (let i = 0; i < e.h; i++) {
    const t = i / e.h;
    const halfW = Math.floor(5 + t * (e.w / 2 - 4));
    ctx.fillStyle = robe;
    ctx.fillRect(x - halfW, top + i, halfW * 2, 1);
  }
  // Robe trim with mystic glyphs.
  ctx.fillStyle = robeHi;
  ctx.fillRect(x - e.w / 2 + 3, y + bob - 4, e.w - 6, 2);
  ctx.fillStyle = hit ? '#fff' : '#ff66cc';
  for (let i = -e.w / 2 + 5; i < e.w / 2 - 5; i += 4) {
    ctx.fillRect(x + i, y + bob - 3, 1, 1);
  }
  // Hood peak.
  ctx.fillStyle = robe;
  ctx.fillRect(x - 4, top - 2, 8, 4);
  ctx.fillRect(x - 6, top + 2, 12, 4);
  // Hood opening (dark).
  ctx.fillStyle = '#100018';
  ctx.fillRect(x - 5, top + 4, 10, 8);
  // Glowing pink eyes.
  ctx.fillStyle = hit ? '#fff' : '#ff66cc';
  ctx.fillRect(x - 4, top + 7, 2, 2);
  ctx.fillRect(x + 2, top + 7, 2, 2);
  ctx.fillStyle = '#fff';
  ctx.fillRect(x - 4, top + 7, 1, 1);
  ctx.fillRect(x + 2, top + 7, 1, 1);
  // Floating skull in front of chest.
  const skullY = y + bob + Math.sin(world.time * 4) * 1;
  ctx.fillStyle = hit ? '#fff' : '#e8e8d0';
  ctx.fillRect(x - 3, skullY, 6, 5);
  ctx.fillStyle = '#000';
  ctx.fillRect(x - 2, skullY + 1, 1, 1);
  ctx.fillRect(x + 1, skullY + 1, 1, 1);
  ctx.fillStyle = '#000';
  ctx.fillRect(x - 1, skullY + 4, 3, 1);
  ctx.fillRect(x - 2, skullY + 5, 5, 1);
  ctx.fillStyle = hit ? '#fff' : '#e8e8d0';
  ctx.fillRect(x - 1, skullY + 5, 1, 1);
  ctx.fillRect(x + 1, skullY + 5, 1, 1);
}

function drawThornedHorror(e, x, y, bob, hit) {
  // Dark red bulbous body with thorns radiating outward.
  const body = hit ? '#fff' : '#660014';
  const bodyHi = hit ? '#fff' : '#aa1a2a';
  const thorn = hit ? '#fff' : '#220000';
  // Thorns first (behind body).
  ctx.fillStyle = thorn;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU + world.time * 0.4;
    const r = e.w * 0.55;
    const tx = x + Math.cos(a) * r;
    const ty = y + bob + Math.sin(a) * r * 0.85;
    const len = 5;
    const ex = x + Math.cos(a) * (r + len);
    const ey = y + bob + Math.sin(a) * (r + len) * 0.85;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(ex, ey);
    ctx.lineWidth = 2;
    ctx.strokeStyle = thorn;
    ctx.stroke();
    ctx.fillStyle = hit ? '#fff' : '#ffaa00';
    ctx.fillRect(Math.floor(ex - 1), Math.floor(ey - 1), 2, 2);
  }
  // Round body.
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(x, y + bob, e.w / 2, e.h / 2 - 2, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = bodyHi;
  ctx.beginPath();
  ctx.ellipse(x - 3, y + bob - 4, e.w / 3, e.h / 4, 0, 0, TAU);
  ctx.fill();
  // Single big angry eye.
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(x, y + bob - 2, 6, 0, TAU);
  ctx.fill();
  ctx.fillStyle = hit ? '#000' : '#ffaa00';
  ctx.beginPath();
  ctx.arc(x + 1, y + bob - 1, 3, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(x + 1, y + bob - 1, 1.4, 0, TAU);
  ctx.fill();
  // Gnarly mouth.
  ctx.fillStyle = '#000';
  ctx.fillRect(x - 5, y + bob + 4, 10, 2);
  ctx.fillStyle = hit ? '#fff' : '#ffaa00';
  for (let i = 0; i < 5; i++) ctx.fillRect(x - 5 + i * 2, y + bob + 4, 1, 2);
}

function drawJuggernaut(e, x, y, bob, hit) {
  // Massive orange armored brute with shoulder spikes and a glowing visor.
  const body = hit ? '#fff' : '#cc6600';
  const armor = hit ? '#fff' : '#883a00';
  const plate = hit ? '#fff' : '#e88a30';
  const top = y - e.h / 2 + bob;
  // Lower legs.
  ctx.fillStyle = armor;
  ctx.fillRect(x - e.w / 2 + 4, y + e.h / 2 + bob - 8, 6, 8);
  ctx.fillRect(x + e.w / 2 - 10, y + e.h / 2 + bob - 8, 6, 8);
  // Belt.
  ctx.fillStyle = armor;
  ctx.fillRect(x - e.w / 2 + 2, y + bob + 4, e.w - 4, 3);
  // Main torso.
  ctx.fillStyle = body;
  ctx.fillRect(x - e.w / 2 + 2, top + 8, e.w - 4, e.h - 16);
  // Chest plate.
  ctx.fillStyle = plate;
  ctx.fillRect(x - e.w / 2 + 4, top + 10, e.w - 8, 8);
  ctx.fillStyle = armor;
  ctx.fillRect(x - 1, top + 10, 2, 8);
  // Shoulder pads with spikes.
  ctx.fillStyle = armor;
  ctx.fillRect(x - e.w / 2, top + 6, 8, 8);
  ctx.fillRect(x + e.w / 2 - 8, top + 6, 8, 8);
  // Shoulder spikes
  ctx.fillStyle = hit ? '#fff' : '#ffcc44';
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(x - e.w / 2 + i * 3, top + 4, 2, 3);
    ctx.fillRect(x + e.w / 2 - 8 + i * 3, top + 4, 2, 3);
  }
  // Head (helmet).
  ctx.fillStyle = armor;
  ctx.fillRect(x - 6, top, 12, 9);
  ctx.fillStyle = body;
  ctx.fillRect(x - 5, top + 1, 10, 6);
  // Horns.
  ctx.fillStyle = hit ? '#fff' : '#ffcc44';
  ctx.fillRect(x - 7, top - 2, 2, 4);
  ctx.fillRect(x + 5, top - 2, 2, 4);
  // Glowing yellow visor.
  ctx.fillStyle = hit ? '#fff' : '#ffee66';
  ctx.fillRect(x - 4, top + 4, 8, 2);
  ctx.fillStyle = '#fff';
  ctx.fillRect(x - 3, top + 4, 1, 1);
  ctx.fillRect(x + 2, top + 4, 1, 1);
  // Cracks in armor that glow.
  ctx.fillStyle = hit ? '#fff' : '#ffee66';
  ctx.fillRect(x - 5, top + 14, 2, 1);
  ctx.fillRect(x + 3, top + 18, 2, 1);
}

function drawHiveQueen(e, x, y, bob, hit) {
  // Insectoid: big bulbous abdomen, smaller head with antennae and mandibles.
  const body = hit ? '#fff' : '#9a3aa0';
  const bodyHi = hit ? '#fff' : '#cc66c8';
  const chitin = hit ? '#fff' : '#5a2050';
  const top = y - e.h / 2 + bob;
  // Wings — translucent, behind body.
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = hit ? '#fff' : '#ffaaff';
  ctx.beginPath();
  ctx.ellipse(x - e.w / 2, y + bob - 2, 9, 6, -0.4, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x + e.w / 2, y + bob - 2, 9, 6, 0.4, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
  // Big abdomen oval (lower body).
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(x, y + bob + 4, e.w / 2, e.h / 2 - 4, 0, 0, TAU);
  ctx.fill();
  // Abdomen stripes.
  ctx.fillStyle = chitin;
  for (let i = -2; i <= 2; i++) {
    ctx.fillRect(x - e.w / 2 + 3, y + bob + 4 + i * 4, e.w - 6, 1);
  }
  ctx.fillStyle = bodyHi;
  ctx.beginPath();
  ctx.ellipse(x - 4, y + bob, 6, 4, 0, 0, TAU);
  ctx.fill();
  // Thorax.
  ctx.fillStyle = chitin;
  ctx.fillRect(x - 6, top + 8, 12, 6);
  // Head.
  ctx.fillStyle = body;
  ctx.fillRect(x - 5, top + 2, 10, 8);
  ctx.fillStyle = bodyHi;
  ctx.fillRect(x - 5, top + 2, 10, 2);
  // Antennae.
  ctx.fillStyle = chitin;
  ctx.fillRect(x - 5, top - 4, 1, 6);
  ctx.fillRect(x + 4, top - 4, 1, 6);
  ctx.fillStyle = hit ? '#fff' : '#ffff66';
  ctx.fillRect(x - 6, top - 5, 2, 2);
  ctx.fillRect(x + 4, top - 5, 2, 2);
  // Compound eyes.
  ctx.fillStyle = hit ? '#fff' : '#ffff66';
  ctx.fillRect(x - 4, top + 4, 3, 3);
  ctx.fillRect(x + 1, top + 4, 3, 3);
  ctx.fillStyle = '#000';
  ctx.fillRect(x - 4, top + 5, 1, 1);
  ctx.fillRect(x + 3, top + 5, 1, 1);
  // Mandibles.
  ctx.fillStyle = chitin;
  ctx.fillRect(x - 4, top + 9, 2, 3);
  ctx.fillRect(x + 2, top + 9, 2, 3);
}

function drawPlagueDoctor(e, x, y, bob, hit) {
  // Thin tall figure with iconic plague-mask beak and top hat.
  const robe = hit ? '#fff' : '#1a4a2a';
  const robeHi = hit ? '#fff' : '#3a6a3a';
  const mask = hit ? '#fff' : '#d8d0aa';
  const top = y - e.h / 2 + bob;
  // Robe — narrow trapezoid.
  for (let i = 14; i < e.h; i++) {
    const t = (i - 14) / (e.h - 14);
    const halfW = Math.floor(4 + t * (e.w / 2 - 3));
    ctx.fillStyle = robe;
    ctx.fillRect(x - halfW, top + i, halfW * 2, 1);
  }
  // Robe collar.
  ctx.fillStyle = robeHi;
  ctx.fillRect(x - 6, top + 14, 12, 3);
  // Belt.
  ctx.fillStyle = hit ? '#fff' : '#3a2010';
  ctx.fillRect(x - e.w / 2 + 3, y + bob + 6, e.w - 6, 2);
  // Buckle.
  ctx.fillStyle = hit ? '#fff' : '#ffcc44';
  ctx.fillRect(x - 1, y + bob + 6, 3, 2);
  // Mask head.
  ctx.fillStyle = mask;
  ctx.fillRect(x - 5, top + 4, 10, 10);
  ctx.fillStyle = hit ? '#fff' : '#aaa080';
  ctx.fillRect(x - 5, top + 12, 10, 2);
  // Mask beak — long pointed nose.
  ctx.fillStyle = mask;
  ctx.fillRect(x + 4, top + 8, 4, 2);
  ctx.fillRect(x + 6, top + 9, 4, 2);
  ctx.fillRect(x + 8, top + 10, 3, 2);
  ctx.fillStyle = hit ? '#fff' : '#aaa080';
  ctx.fillRect(x + 4, top + 9, 4, 1);
  ctx.fillRect(x + 6, top + 10, 4, 1);
  // Glowing green goggle eyes.
  ctx.fillStyle = '#000';
  ctx.fillRect(x - 4, top + 7, 3, 3);
  ctx.fillRect(x, top + 7, 3, 3);
  ctx.fillStyle = hit ? '#fff' : '#aaff66';
  ctx.fillRect(x - 4, top + 7, 1, 1);
  ctx.fillRect(x + 1, top + 7, 1, 1);
  ctx.fillStyle = '#fff';
  ctx.fillRect(x - 3, top + 8, 1, 1);
  ctx.fillRect(x + 2, top + 8, 1, 1);
  // Top hat.
  ctx.fillStyle = hit ? '#fff' : '#0a0a14';
  ctx.fillRect(x - 7, top + 3, 14, 1);
  ctx.fillRect(x - 4, top - 3, 8, 7);
  ctx.fillStyle = hit ? '#fff' : '#3a3a3a';
  ctx.fillRect(x - 4, top - 3, 8, 1);
  // Hat band.
  ctx.fillStyle = hit ? '#fff' : '#aa3030';
  ctx.fillRect(x - 4, top + 1, 8, 1);
}

function drawTitan(e, x, y, bob, hit) {
  // Massive armored colossus — meant to feel like the final boss.
  const body = hit ? '#fff' : '#7a2a14';
  const armor = hit ? '#fff' : '#4a1a08';
  const plate = hit ? '#fff' : '#aa4020';
  const glow = hit ? '#fff' : '#ffcc44';
  const top = y - e.h / 2 + bob;
  // Background heat haze halo.
  ctx.fillStyle = `rgba(255, 150, 60, ${0.25 + 0.15 * Math.sin(world.time * 4)})`;
  ctx.beginPath();
  ctx.arc(x, y, e.w * 0.65, 0, TAU);
  ctx.fill();
  // Legs.
  ctx.fillStyle = armor;
  ctx.fillRect(x - e.w / 2 + 8, y + e.h / 2 + bob - 18, 14, 18);
  ctx.fillRect(x + e.w / 2 - 22, y + e.h / 2 + bob - 18, 14, 18);
  // Hip rune.
  ctx.fillStyle = glow;
  ctx.fillRect(x - 2, y + e.h / 2 + bob - 10, 4, 2);
  // Torso.
  ctx.fillStyle = body;
  ctx.fillRect(x - e.w / 2 + 6, top + 18, e.w - 12, e.h - 36);
  // Chest armor.
  ctx.fillStyle = armor;
  ctx.fillRect(x - e.w / 2 + 8, top + 20, e.w - 16, 22);
  ctx.fillStyle = plate;
  ctx.fillRect(x - e.w / 2 + 10, top + 22, e.w - 20, 18);
  // Glowing chest rune.
  ctx.fillStyle = glow;
  ctx.fillRect(x - 4, top + 28, 8, 2);
  ctx.fillRect(x - 2, top + 26, 4, 6);
  ctx.fillStyle = '#fff';
  ctx.fillRect(x - 1, top + 27, 2, 2);
  // Shoulders — massive.
  ctx.fillStyle = armor;
  ctx.fillRect(x - e.w / 2, top + 14, 16, 12);
  ctx.fillRect(x + e.w / 2 - 16, top + 14, 16, 12);
  ctx.fillStyle = plate;
  ctx.fillRect(x - e.w / 2 + 2, top + 14, 12, 4);
  ctx.fillRect(x + e.w / 2 - 14, top + 14, 12, 4);
  // Shoulder spikes.
  ctx.fillStyle = glow;
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(x - e.w / 2 + 1 + i * 4, top + 10, 3, 5);
    ctx.fillRect(x + e.w / 2 - 14 + i * 4, top + 10, 3, 5);
  }
  // Arms hanging at sides.
  ctx.fillStyle = armor;
  ctx.fillRect(x - e.w / 2 + 2, top + 26, 6, 18);
  ctx.fillRect(x + e.w / 2 - 8, top + 26, 6, 18);
  ctx.fillStyle = body;
  ctx.fillRect(x - e.w / 2 + 1, top + 42, 8, 6);
  ctx.fillRect(x + e.w / 2 - 9, top + 42, 8, 6);
  // Head — heavy helmet with horns.
  ctx.fillStyle = armor;
  ctx.fillRect(x - 10, top + 2, 20, 16);
  ctx.fillStyle = body;
  ctx.fillRect(x - 9, top + 4, 18, 12);
  // Horns.
  ctx.fillStyle = armor;
  ctx.fillRect(x - 12, top - 4, 4, 8);
  ctx.fillRect(x + 8, top - 4, 4, 8);
  ctx.fillStyle = glow;
  ctx.fillRect(x - 12, top - 6, 4, 3);
  ctx.fillRect(x + 8, top - 6, 4, 3);
  // Eye slits — glowing.
  ctx.fillStyle = '#000';
  ctx.fillRect(x - 8, top + 8, 7, 3);
  ctx.fillRect(x + 1, top + 8, 7, 3);
  ctx.fillStyle = glow;
  ctx.fillRect(x - 7, top + 9, 5, 1);
  ctx.fillRect(x + 2, top + 9, 5, 1);
  ctx.fillStyle = '#fff';
  ctx.fillRect(x - 6, top + 9, 1, 1);
  ctx.fillRect(x + 3, top + 9, 1, 1);
  // Jaw line.
  ctx.fillStyle = armor;
  ctx.fillRect(x - 8, top + 14, 16, 2);
  ctx.fillStyle = glow;
  for (let i = -7; i < 7; i += 2) ctx.fillRect(x + i, top + 14, 1, 2);
}

function drawBullet(b, camX, camY) {
  if (b.kind === 'knife') {
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = '#fff';
    for (let i = 1; i <= 3; i++) {
      ctx.fillRect(Math.floor(b.x - camX - b.vx * 0.02 * i), Math.floor(b.y - camY - b.vy * 0.02 * i), 1, 1);
    }
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.translate(Math.floor(b.x - camX), Math.floor(b.y - camY));
    ctx.rotate(b.angle);
    ctx.drawImage(knifeSprite, -5, -2);
    ctx.restore();
  } else if (b.kind === 'ice') {
    const grad = ctx.createRadialGradient(b.x - camX, b.y - camY, 1, b.x - camX, b.y - camY, 10);
    grad.addColorStop(0, 'rgba(170, 220, 255, 0.55)');
    grad.addColorStop(1, 'rgba(170, 220, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(b.x - camX - 10, b.y - camY - 10, 20, 20);
    ctx.save();
    ctx.translate(Math.floor(b.x - camX), Math.floor(b.y - camY));
    ctx.rotate(b.angle + Math.PI / 2);
    ctx.drawImage(iceShardSprite, -4, -5);
    ctx.restore();
  } else if (b.kind === 'holy') {
    ctx.save();
    ctx.translate(Math.floor(b.x - camX), Math.floor(b.y - camY));
    ctx.rotate(b.t * 6);
    ctx.drawImage(holyWaterSprite, -4, -5);
    ctx.restore();
    if (Math.random() < 0.5) {
      world.particles.push({
        x: b.x, y: b.y, vx: 0, vy: 20,
        life: 0.25, maxLife: 0.25, size: 1, color: '#aae0ff', gravity: 60,
      });
    }
  } else if (b.kind === 'shardFrag') {
    ctx.save();
    ctx.translate(Math.floor(b.x - camX), Math.floor(b.y - camY));
    ctx.rotate(b.angle + Math.PI / 2);
    ctx.scale(0.7, 0.7);
    ctx.drawImage(iceShardSprite, -4, -5);
    ctx.restore();
  }
}

function drawShard(s, camX, camY) {
  ctx.save();
  ctx.translate(Math.floor(s.x - camX), Math.floor(s.y - camY));
  ctx.rotate(s.angle + Math.PI / 2 + world.time * 6);
  ctx.scale(1.1, 1.1);
  // Glow
  const grad = ctx.createRadialGradient(0, 0, 1, 0, 0, 8);
  grad.addColorStop(0, 'rgba(220, 240, 255, 0.6)');
  grad.addColorStop(1, 'rgba(220, 240, 255, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(-8, -8, 16, 16);
  ctx.drawImage(iceShardSprite, -4, -5);
  ctx.restore();
}

function drawHole(h, camX, camY) {
  const x = Math.floor(h.x - camX);
  const y = Math.floor(h.y - camY);
  const r = h.r;
  // Outer purple aura ring.
  const t = h.t / h.duration;
  const ring = 0.6 + 0.4 * Math.sin(world.time * 8);
  ctx.globalAlpha = 0.8;
  const grad = ctx.createRadialGradient(x, y, 1, x, y, r);
  grad.addColorStop(0, 'rgba(0, 0, 0, 1)');
  grad.addColorStop(0.4, 'rgba(40, 8, 70, 0.85)');
  grad.addColorStop(0.85, `rgba(170, 68, 221, ${0.35 * ring})`);
  grad.addColorStop(1, 'rgba(170, 68, 221, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = 1;
  // Implosion glow toward end.
  if (t > 0.7) {
    const glow = (t - 0.7) / 0.3;
    ctx.fillStyle = `rgba(255, 204, 68, ${glow * 0.5})`;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.4, 0, TAU);
    ctx.fill();
  }
  // Inner rim.
  ctx.strokeStyle = `rgba(220, 160, 255, ${0.6 * ring})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.95, 0, TAU);
  ctx.stroke();
}

function drawBeam(bm, camX, camY) {
  const a = clamp(bm.life / bm.maxLife, 0, 1);
  const ex = bm.x + Math.cos(bm.angle) * bm.length;
  const ey = bm.y + Math.sin(bm.angle) * bm.length;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.strokeStyle = '#ffcc44';
  ctx.lineWidth = bm.width;
  ctx.beginPath();
  ctx.moveTo(bm.x - camX, bm.y - camY);
  ctx.lineTo(ex - camX, ey - camY);
  ctx.stroke();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = bm.width * 0.45;
  ctx.beginPath();
  ctx.moveTo(bm.x - camX, bm.y - camY);
  ctx.lineTo(ex - camX, ey - camY);
  ctx.stroke();
  ctx.restore();
}

function drawPickup(pk, camX, camY) {
  const yoff = Math.sin(pk.bob) * 2;
  const x = Math.floor(pk.x - camX);
  const y = Math.floor(pk.y - camY + yoff);
  let glowColor = null;
  if (pk.kind === 'gem') {
    glowColor = pk.sprite === gemLarge ? 'rgba(255, 204, 68, 0.5)' :
                pk.sprite === gemMed ? 'rgba(136, 255, 102, 0.4)' :
                'rgba(102, 221, 255, 0.4)';
  } else if (pk.kind === 'heal') glowColor = 'rgba(255, 100, 100, 0.5)';
  else if (pk.kind === 'magnet') glowColor = 'rgba(255, 100, 100, 0.6)';
  else if (pk.kind === 'bomb') glowColor = 'rgba(255, 150, 50, 0.6)';
  else if (pk.kind === 'chest') glowColor = 'rgba(255, 204, 68, 0.8)';
  if (glowColor) {
    const r = 12;
    ctx.drawImage(getGlowSprite(glowColor, r), x - r, y - r);
  }
  if (pk.kind === 'gem') {
    ctx.drawImage(pk.sprite, x - pk.sprite.width / 2, y - pk.sprite.height / 2);
    if (((pk.t * 2) | 0) % 2 === 0) { ctx.fillStyle = '#fff'; ctx.fillRect(x + 3, y - 4, 1, 1); }
  } else if (pk.kind === 'heal') {
    ctx.drawImage(heartSprite, x - 5, y - 5);
  } else if (pk.kind === 'magnet') {
    ctx.drawImage(magnetSprite, x - 5, y - 5);
  } else if (pk.kind === 'bomb') {
    ctx.drawImage(bombSprite, x - 5, y - 6);
    if (((pk.t * 8) | 0) % 2 === 0) { ctx.fillStyle = '#fff'; ctx.fillRect(x, y - 7, 1, 1); }
  } else if (pk.kind === 'chest') {
    ctx.fillStyle = '#5a3a18';
    ctx.fillRect(x - 6, y - 4, 12, 8);
    ctx.fillStyle = '#7a5028';
    ctx.fillRect(x - 6, y - 4, 12, 2);
    ctx.fillStyle = '#ffcc44';
    ctx.fillRect(x - 6, y - 1, 12, 1);
    ctx.fillRect(x - 1, y - 3, 2, 4);
    ctx.fillStyle = '#3a2010';
    ctx.fillRect(x - 6, y + 3, 12, 1);
    if (((pk.t * 6) | 0) % 2 === 0) { ctx.fillStyle = '#fff'; ctx.fillRect(x + 3, y - 3, 1, 1); }
  }
}

// ---------- WAVE MODE ----------
// Maps a wave number to the mid-game-time we'd be at in a normal run, so the
// spawn table (tier gating, brute/spitter unlocks, lateGameMult) lines up with
// the player's progression.
function waveMappedTime(N) { return N * 30 - 15; }

// How many enemies to spawn over the wave, based on the normal-game spawner's
// rate × burst at the wave's mapped time. Intentionally generous because the
// wave only ends once every spawn has been killed.
function waveEnemyCount(N) {
  const t = waveMappedTime(N);
  const rate = Math.max(0.18, 0.85 - Math.sqrt(t) * 0.04);
  const burst = 1 + Math.floor(Math.sqrt(t / 12));
  return Math.max(8, Math.round((burst / rate) * 30));
}

function startWave(N) {
  world.wave = N;
  world.waveQueued = 0;
  world.waveSpawnCd = 0;
  world.waveSpawnTime = null;
  if (N === 30) {
    // Final wave is the Titan — clear the field and spawn it like the normal mode.
    world.waveBanner = { t: 3.0, tMax: 3.0, line1: 'WAVE 30 / 30', line2: 'THE TITAN APPROACHES' };
    world.titanSpawned = true;
    spawnTitan();
    return;
  }
  const t = waveMappedTime(N);
  world.waveSpawnTime = t;
  world.waveSpawnRate = Math.max(0.18, 0.85 - Math.sqrt(t) * 0.04);
  world.waveBurst = 1 + Math.floor(Math.sqrt(t / 12));
  world.waveQueued = waveEnemyCount(N);
  // Cap the spawn window to 10s so late waves don't trickle in over 30s.
  // Keep the rate (so the cadence still feels like a real spawner) and bump
  // the per-tick burst to whatever's needed to drain the queue within 10s.
  const MAX_SPAWN_TIME = 10;
  const maxTicks = Math.max(1, Math.floor(MAX_SPAWN_TIME / world.waveSpawnRate));
  const requiredBurst = Math.ceil(world.waveQueued / maxTicks);
  if (requiredBurst > world.waveBurst) world.waveBurst = requiredBurst;
  world.waveBanner = { t: 2.0, tMax: 2.0, line1: `WAVE ${N} / 30`, line2: `${world.waveQueued} ENEMIES` };
  SFX.bossSpawn();
}

function updateWaveSpawner(dt) {
  if (world.waveIntermissionT > 0) {
    world.waveIntermissionT -= dt;
    if (world.waveIntermissionT <= 0) startWave(world.wave + 1);
    return;
  }
  if (world.wave === 30) return; // Titan handles itself
  // Drain the queue at the wave's natural rate.
  if (world.waveQueued > 0) {
    world.waveSpawnCd -= dt;
    if (world.waveSpawnCd <= 0) {
      world.waveSpawnCd = world.waveSpawnRate;
      const burst = Math.min(world.waveBurst, world.waveQueued);
      for (let i = 0; i < burst; i++) spawnEnemy();
      world.waveQueued -= burst;
    }
    return;
  }
  // Queue is empty — wait for the field to be clear, then queue up next wave.
  if (world.enemies.length === 0) {
    if (world.wave < 30) {
      world.waveBanner = { t: 1.5, tMax: 1.5, line1: `WAVE ${world.wave} CLEAR`, line2: 'NEXT WAVE INCOMING' };
      world.waveIntermissionT = 1.5;
    }
  }
}

// ---------- LORE INTRO ----------
const SKIN_DESC = {
  cleric: 'LAST OF THE LAST CHAPEL',
  knight: 'OATH-SWORN TO THE DAWN',
  ninja:  'WRAITH OF THE SILENT ROAD',
  bandit: 'WANTED IN SEVEN KINGDOMS',
  mage:   'KEEPER OF THE OLD FIRE',
};

// Reveal speed (seconds/character) and "hold the text" linger before the next
// beat starts. Tuned so a beat ends ~1s after its last character appears.
const LORE_REVEAL_PER_CHAR = 0.03;

function makeLoreBeat(lines, scene, isSpeedrun) {
  const text = lines.join(' ');
  const revealT = text.length * LORE_REVEAL_PER_CHAR;
  const linger  = isSpeedrun ? 0.9 : 1.4;
  const minDur  = isSpeedrun ? 1.2 : 1.8;
  return { lines, scene, dur: Math.max(minDur, revealT + linger) };
}

function buildLoreScript(players, isSpeedrun) {
  const isCoop = players.length === 2;
  const p1 = players[0];
  const p2 = players[1] || null;
  const skin = p => (p.skinName || 'HERO').toUpperCase();
  const desc = p => SKIN_DESC[p.skinId] || 'A SURVIVOR OF THE LONG NIGHT';

  let beats;
  if (!isCoop && !isSpeedrun) {
    beats = [
      makeLoreBeat(['THE DEAD WALK.', 'THE LIVING DO NOT.'], 'horde', false),
      makeLoreBeat([`${skin(p1)},`, desc(p1), 'STANDS ALONE.'], 'hero', false),
      makeLoreBeat(['FIFTEEN MINUTES UNTIL', 'THE TITAN WAKES.', '— SURVIVE —'], 'titan', false),
    ];
  } else if (!isCoop && isSpeedrun) {
    beats = [
      makeLoreBeat(['THIRTY TRIALS.', 'ONE TITAN.'], 'horde', true),
      makeLoreBeat([`${skin(p1)},`, desc(p1), 'CLOCK STARTS.'], 'hero', true),
      makeLoreBeat(['NO ONE HAS DONE IT FASTER.', '— GO —'], 'titan', true),
    ];
  } else if (isCoop && !isSpeedrun) {
    beats = [
      makeLoreBeat(['WHERE ONE FALLS,', 'TWO STAND.'], 'horde', false),
      makeLoreBeat([`${skin(p1)} AND ${skin(p2)}`, 'BOUND AGAINST THE NIGHT.'], 'hero', false),
      makeLoreBeat(['FIFTEEN MINUTES UNTIL', 'THE TITAN WAKES.', '— HOLD THE LINE —'], 'titan', false),
    ];
  } else {
    beats = [
      makeLoreBeat(['TWO SOULS.', 'THIRTY WAVES.', 'ONE RECORD.'], 'horde', true),
      makeLoreBeat([`${skin(p1)} AND ${skin(p2)}`, 'MOVE AS ONE.'], 'hero', true),
      makeLoreBeat(['THE TITAN WAITS.', '— RUN —'], 'titan', true),
    ];
  }
  const totalT = beats.reduce((a, b) => a + b.dur, 0);
  return { beats, totalT };
}

function startLoreIntro(players, isSpeedrun) {
  const script = buildLoreScript(players, isSpeedrun);
  // Pre-compute beat start offsets so the typewriter knows where each beat is.
  let acc = 0;
  for (const b of script.beats) { b.start = acc; acc += b.dur; }
  world.lore = {
    script,
    isSpeedrun,
    t: 0,
    beatIdx: 0,
    lastTickAt: 0,
    finished: false,
  };
  world.paused = true;
  document.getElementById('hud').style.display = 'none';
  // Opening hit — a deep boss-spawn cue.
  SFX.tone({ freq: 110, freq2: 55, dur: 1.0, type: 'sawtooth', vol: 0.20 });
  SFX.noise({ dur: 0.8, vol: 0.10, lp: 600, hp: 50, rampLp: 80 });
}

function endLore() {
  if (!world.lore) return;
  world.lore = null;
  world.paused = false;
  document.getElementById('hud').style.display = 'flex';
  // After the cinematic finishes, kick off the first wave (speedrun) — the
  // normal mode spawner runs off world.time, so no extra hookup needed there.
  if (world.waveMode && world.wave === 0) startWave(1);
}

function skipLore() {
  if (world.lore && !world.lore.finished) {
    SFX.click();
    endLore();
  }
}

function tickLore(dt) {
  const L = world.lore;
  if (!L || L.finished) return;
  L.t += dt;
  const beats = L.script.beats;
  // Find which beat we're on; play a hit when advancing.
  let idx = 0;
  for (let i = 0; i < beats.length; i++) {
    if (L.t >= beats[i].start && L.t < beats[i].start + beats[i].dur) { idx = i; break; }
    if (i === beats.length - 1 && L.t >= beats[i].start + beats[i].dur) idx = beats.length;
  }
  if (idx !== L.beatIdx) {
    L.beatIdx = idx;
    if (idx < beats.length) {
      const scene = beats[idx].scene;
      if (scene === 'titan') {
        SFX.titanRoar();
      } else {
        SFX.tone({ freq: 90, freq2: 50, dur: 0.45, type: 'sawtooth', vol: 0.22 });
      }
    }
  }
  // Typewriter tick — light click while characters are still revealing.
  const beat = beats[Math.min(idx, beats.length - 1)];
  const localT = L.t - beat.start;
  const fullText = beat.lines.join(' ');
  const revealAt = LORE_REVEAL_PER_CHAR; // seconds per character
  const totalChars = fullText.length;
  const charsShown = Math.min(totalChars, Math.floor(localT / revealAt));
  if (charsShown > L.lastTickAt && L.t - (L.lastTickAtTime || 0) > 0.05) {
    L.lastTickAt = charsShown;
    L.lastTickAtTime = L.t;
    // Quiet click — only every other char to avoid sound spam.
    if (charsShown % 2 === 0) {
      SFX.tone({ freq: 700 + Math.random() * 80, dur: 0.018, type: 'square', vol: 0.04 });
    }
  }
  if (L.t >= L.script.totalT) {
    L.finished = true;
    endLore();
  }
}

function renderLore() {
  const L = world.lore;
  if (!L) return;
  // Black backdrop covers everything; mode/HUD beneath is irrelevant.
  ctx.fillStyle = '#05030a';
  ctx.fillRect(0, 0, W, H);
  // CRT scanlines for atmosphere.
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let y = 0; y < H; y += 2) ctx.fillRect(0, y, W, 1);

  const beats = L.script.beats;
  const idx = Math.min(L.beatIdx, beats.length - 1);
  const beat = beats[idx];
  const localT = L.t - beat.start;

  // Scene art per beat.
  if (beat.scene === 'horde') drawLoreHorde(localT);
  else if (beat.scene === 'hero') drawLoreHero(localT);
  else if (beat.scene === 'titan') drawLoreTitan(localT);

  // Typewriter text — center-anchored, line by line.
  const revealAt = LORE_REVEAL_PER_CHAR;
  const fullText = beat.lines.join('\n');
  const charsShown = Math.min(fullText.length, Math.floor(localT / revealAt));
  const shown = fullText.slice(0, charsShown);
  const lines = shown.split('\n');
  const lineH = 14;
  const baseY = Math.floor(H * 0.18);
  ctx.textAlign = 'center';
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const isAccent = ln.startsWith('—') || ln.endsWith('—');
    ctx.font = isAccent ? 'bold 14px Courier New' : 'bold 12px Courier New';
    ctx.fillStyle = '#000';
    ctx.fillText(ln, W / 2 + 1, baseY + i * lineH + 1);
    ctx.fillStyle = isAccent ? '#ffcc44' : '#e8e8f0';
    ctx.fillText(ln, W / 2, baseY + i * lineH);
  }

  // Skip hint, bottom-right.
  ctx.font = 'bold 8px Courier New';
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(170, 170, 200, 0.65)';
  ctx.fillText('SPACE / CLICK TO SKIP', W - 6, H - 6);

  // Faint progress bar across the bottom.
  const pct = clamp(L.t / L.script.totalT, 0, 1);
  ctx.fillStyle = 'rgba(255,204,68,0.18)';
  ctx.fillRect(0, H - 2, W, 1);
  ctx.fillStyle = '#ffcc44';
  ctx.fillRect(0, H - 2, W * pct, 1);
}

function drawLoreHorde(localT) {
  // Five drifting zombie silhouettes across the bottom half.
  const baseY = Math.floor(H * 0.62);
  const sprites = [zombieSets[2][0], zombieSets[2][1]];
  const fr = Math.max(0, Math.floor(localT * 4)) % 2;
  ctx.globalAlpha = 0.55;
  for (let i = 0; i < 7; i++) {
    const x = ((i * (W / 6)) + localT * 6 + i * 11) % (W + 60) - 30;
    const yJit = Math.sin(localT * 2 + i) * 1.5;
    const scale = 4;
    ctx.save();
    ctx.translate(Math.floor(x), Math.floor(baseY + yJit));
    ctx.scale(scale, scale);
    ctx.drawImage(sprites[fr], -7, -16);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  // Foreground silhouettes overlay (darker)
  ctx.fillStyle = 'rgba(80, 20, 30, 0.18)';
  ctx.fillRect(0, baseY - 30, W, 60);
}

function drawLoreHero(localT) {
  const ps = world.players;
  if (!ps || ps.length === 0) return;
  const baseY = Math.floor(H * 0.62);
  const fr = Math.max(0, Math.floor(localT * 4)) % 2;
  const scale = 6;
  const bob = Math.floor(Math.sin(localT * 4) * 1.5);
  if (ps.length === 1) {
    const p = ps[0];
    ctx.save();
    ctx.translate(Math.floor(W / 2), Math.floor(baseY + bob));
    ctx.scale(scale, scale);
    ctx.drawImage(p.sprites[fr], -7, -16);
    ctx.restore();
    // Light beam under the hero.
    const grad = ctx.createRadialGradient(W/2, baseY+20, 4, W/2, baseY+20, 80);
    grad.addColorStop(0, 'rgba(255,204,68,0.35)');
    grad.addColorStop(1, 'rgba(255,204,68,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(W/2 - 80, baseY - 40, 160, 80);
  } else {
    const offsets = [-Math.floor(W * 0.12), Math.floor(W * 0.12)];
    for (let i = 0; i < 2; i++) {
      const p = ps[i];
      ctx.save();
      ctx.translate(Math.floor(W / 2 + offsets[i]), Math.floor(baseY + bob));
      ctx.scale(scale, scale);
      ctx.drawImage(p.sprites[fr], -7, -16);
      ctx.restore();
    }
  }
}

function drawLoreTitan(localT) {
  // A dark silhouette rises from the bottom and grows; players small in front.
  const rise = clamp(localT / 1.6, 0, 1);
  const cx = Math.floor(W / 2);
  const baseY = H + 20 - Math.floor(rise * (H * 0.55));
  // Body
  ctx.fillStyle = 'rgba(40, 8, 14, 0.92)';
  const bw = 96, bh = 124;
  ctx.fillRect(cx - bw / 2, baseY - bh, bw, bh);
  // Shoulder hump
  ctx.fillRect(cx - bw / 2 - 14, baseY - bh + 18, bw + 28, 28);
  // Glowing eyes
  const glow = 0.5 + 0.5 * Math.sin(localT * 8);
  ctx.fillStyle = `rgba(255, 200, 80, ${0.6 + glow * 0.35})`;
  ctx.fillRect(cx - 18, baseY - bh + 24, 8, 6);
  ctx.fillRect(cx + 10, baseY - bh + 24, 8, 6);
  // Red mist
  ctx.fillStyle = 'rgba(120, 8, 24, 0.18)';
  ctx.fillRect(0, baseY - 6, W, 12);
  // Players small in front
  const ps = world.players;
  if (ps && ps.length > 0) {
    const fr = Math.max(0, Math.floor(localT * 4)) % 2;
    const scale = 3;
    const py = baseY - 4;
    const pX = ps.length === 1 ? [cx] : [cx - 24, cx + 24];
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      ctx.save();
      ctx.translate(Math.floor(pX[i]), Math.floor(py));
      ctx.scale(scale, scale);
      ctx.drawImage(p.sprites[fr], -7, -16);
      ctx.restore();
    }
  }
}

// ---------- START / RESET ----------
function startGame() {
  SFX.init();
  lastTime = performance.now();
  lastHudSlotsKey = '';
  lastP2Key = '';
  world.enemies = [];
  world.bullets = [];
  world.pickups = [];
  world.particles = [];
  world.damageNumbers = [];
  world.puddles = [];
  world.lightning = [];
  world.shards = [];
  world.holes = [];
  world.thorns = [];
  world.shockwaves = [];
  world.gasPuddles = [];
  world.spits = [];
  world.beams = [];
  world.bossWarning = null;
  world.nextBossAt = BOSS_INTERVAL;
  world.titanSpawned = false;
  world.titanDefeated = false;
  world.recentBosses = [];
  world.activeLevelUpPlayer = null;

  const p1 = createPlayer({
    id: 1, name: 'P1', team: 'blue',
    controls: { up: 'w', down: 's', left: 'a', right: 'd' },
    skin: selectedSkin[0],
    theme: '#6abfff',
    x: selectedMode === 'coop' ? -12 : 0, y: 0,
  });
  world.players = [p1];

  if (selectedMode === 'coop') {
    const p2 = createPlayer({
      id: 2, name: 'P2', team: 'red',
      controls: { up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright' },
      skin: selectedSkin[1],
      theme: '#ff6666',
      x: 12, y: 0,
    });
    world.players.push(p2);
  }

  world.camera.x = -W / 2; world.camera.y = -H / 2;
  world.camera.shake = 0; world.flash = 0; world.auraFlash = 0;
  world.time = 0; world.kills = 0;
  world.spawnTimer = 0;
  world.paused = false;
  world.userPaused = false;
  world.gameOver = false;
  world.clickMarker = null;
  world.tier2Unlocked = false;
  // Speedrun wave-mode reset.
  world.waveMode = !!selectedSpeedrun;
  world.wave = 0;
  world.waveQueued = 0;
  world.waveSpawnCd = 0;
  world.waveSpawnTime = null;
  world.waveIntermissionT = 0;
  world.waveBanner = null;
  moveTarget = null;
  document.getElementById('overlay').style.display = 'none';
  document.getElementById('hud').style.display = 'flex';
  cacheHUD();
  // Lore plays before anything else. endLore() will trigger wave 1 in
  // speedrun mode; normal mode just starts ticking once paused = false.
  startLoreIntro(world.players, !!selectedSpeedrun);
}

// ---------- BOOT ----------
showStartScreen();
requestAnimationFrame(loop);
