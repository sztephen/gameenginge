'use strict';

// ============================================================
//  ui.js — DOM-driven panels: level-up cards, super info,
//  victory / game-over / run-summary, mode + skin pickers, HUD.
// ============================================================

let selectedMode = 'solo';
let selectedSkin = [0, 1]; // [P1, P2] indices into PLAYER_SKINS
let selectedSpeedrun = false;

// localStorage key for the speedrun personal best (seconds it took to fell the Titan).
const SPEEDRUN_BEST_KEY = 'pixelSurvivors_speedrun_best';
function getSpeedrunBest() {
  try {
    const v = localStorage.getItem(SPEEDRUN_BEST_KEY);
    return v == null ? null : Number(v);
  } catch { return null; }
}
function setSpeedrunBest(seconds) {
  try { localStorage.setItem(SPEEDRUN_BEST_KEY, String(seconds)); } catch {}
}

function formatTime(t) {
  const m = Math.floor(t / 60).toString().padStart(2, '0');
  const s = Math.floor(t % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// ---------- LEVEL-UP CARD ROLL ----------
function rollUpgrades(p) {
  const readySupers = SUPERS
    .filter(s => !p.superUnlocked[s.id] && isSuperReady(p, s))
    .map(s => ({
      id: s.id, name: s.name, desc: s.desc, max: 1,
      isSuper: true, iconKind: s.iconKind, apply: s.apply,
    }));

  // Shallow-copy so we can decorate with `isEpic` without mutating UPGRADES.
  const stats = UPGRADES.filter(u => {
    const lvl = p.upgradeLevels[u.id] || 0;
    if (lvl >= u.max) return false;
    if (u.weaponId && !p.slots.includes(u.weaponId)) return false;
    return true;
  }).map(u => ({ ...u }));

  const unlocks = [];
  if (p.slots.length < MAX_SLOTS) {
    for (const id in WEAPONS) {
      const w = WEAPONS[id];
      if (w.tier === 0) continue;
      if (p.slots.includes(id)) continue;
      unlocks.push({
        id: 'unlock_' + id,
        weaponId: id,
        name: w.name,
        desc: 'UNLOCK new weapon — adds to your loadout',
        max: 1, isUnlock: true,
        iconKind: w.iconId,
      });
    }
  }

  const out = readySupers.slice(0, 3);

  // Always offer at least one unlock when slots are open.
  if (out.length < 3 && unlocks.length > 0) {
    const i = irand(0, unlocks.length - 1);
    out.push(unlocks.splice(i, 1)[0]);
  }

  // Pool the rest. Unlocks weighted 3× so they keep appearing.
  const pool = [...stats];
  for (const u of unlocks) for (let k = 0; k < 3; k++) pool.push(u);
  while (out.length < 3 && pool.length > 0) {
    const i = irand(0, pool.length - 1);
    const pick = pool.splice(i, 1)[0];
    if (out.some(o => o.id === pick.id)) continue;
    out.push(pick);
  }

  // Roll EPIC on stat upgrades only — supers/unlocks can't be doubled.
  for (const opt of out) {
    if (opt.isSuper || opt.isUnlock) continue;
    if (Math.random() < EPIC_CHANCE) {
      const lvl = p.upgradeLevels[opt.id] || 0;
      if (opt.max - lvl >= 2) opt.isEpic = true;
    }
  }
  return out;
}

function isSuperReady(p, s) {
  if (!p.slots.includes(s.weaponId)) return false;
  return s.requires.every(r => (p.upgradeLevels[r.id] || 0) >= r.level);
}

// ---------- LEVEL-UP PANEL ----------
function showLevelUp() {
  const p = world.players.find(pl => pl && !pl.dead && pl.levelUpQueue > 0);
  if (!p) return;
  const options = rollUpgrades(p);
  if (options.length === 0) {
    p.levelUpQueue = 0;
    showLevelUp();
    return;
  }
  p.levelUpQueue--;
  world.activeLevelUpPlayer = p;
  world.paused = true;
  SFX.levelUp();
  renderLevelUpPanel(p, options);
}

function renderLevelUpPanel(p, options) {
  const panel = document.getElementById('panel');

  const slotsHtml = (() => {
    const cells = [];
    for (let i = 0; i < MAX_SLOTS; i++) {
      const id = p.slots[i];
      if (!id) {
        cells.push(`<div class="slot empty">
          <div class="slot-placeholder">+</div>
          <div class="slot-name">EMPTY</div>
          <div class="slot-hint">pick a weapon</div>
        </div>`);
        continue;
      }
      const w = WEAPONS[id];
      const canRemove = !(id === 'knife' && p.slots.length === 1);

      const sup = SUPERS.find(s => s.weaponId === id);
      let supHtml = '';
      let reqRowsHtml = '';
      if (sup) {
        const unlocked = !!p.superUnlocked[sup.id];
        const metCount = sup.requires.filter(r => (p.upgradeLevels[r.id] || 0) >= r.level).length;
        const total = sup.requires.length;
        const ready = !unlocked && metCount === total;
        const cls = unlocked ? 'done' : ready ? 'ready' : 'locked';
        const icon = unlocked ? '★' : ready ? '◆' : '🔒';
        const status = unlocked ? 'OWNED' : `${metCount}/${total}`;
        supHtml = `<div class="slot-super ${cls}" title="${sup.desc.replace(/"/g, '&quot;')}">
          <span class="sup-icon">${icon}</span>
          <span class="sup-name">${sup.name}</span>
          <span class="sup-count">${status}</span>
        </div>`;
        if (unlocked) {
          reqRowsHtml = `<div class="sup-req-row done">
            <span class="sup-req-name">★ EVOLUTION UNLOCKED</span>
          </div>`;
        } else {
          reqRowsHtml = sup.requires.map(r => {
            const u = UPGRADES.find(x => x.id === r.id);
            const lvl = p.upgradeLevels[r.id] || 0;
            const met = lvl >= r.level;
            const rcls = met ? 'met' : '';
            return `<div class="sup-req-row ${rcls}">
              <span class="sup-req-name">${met ? '✓' : '○'} ${u ? u.name : r.id}</span>
              <span class="sup-req-lvl">${lvl}/${r.level}</span>
            </div>`;
          }).join('');
        }
      }

      cells.push(`<div class="slot filled" data-slot-id="${id}">
        ${canRemove ? `<button class="slot-remove" data-remove="${id}" title="Remove ${w.name}">×</button>` : ''}
        <canvas width="36" height="36" data-slot-icon="${w.iconId}"></canvas>
        <div class="slot-name">${w.name}</div>
        <div class="slot-sup-label">${sup ? 'EVOLUTION REQUIREMENTS' : ''}</div>
        <div class="slot-sup-reqs">${reqRowsHtml}</div>
        ${supHtml}
      </div>`);
    }
    return cells.join('');
  })();

  const tier2Bit = world.tier2Unlocked ? ` &nbsp;·&nbsp; <span style="color:#ffcc44">★ ADVANCED</span>` : '';
  const isCoop = world.players.length > 1;
  const teamColor = p.theme || '#6abfff';
  const teamLabel = p.team === 'red' ? 'RED TEAM' : 'BLUE TEAM';
  // A wide banner on top of the level-up panel that uses the team color, so
  // the player who's leveling up reads instantly even at a glance.
  const playerBanner = `
    <div class="lvl-banner" style="--team:${teamColor}">
      <div class="lvl-banner-bar"></div>
      <div class="lvl-banner-row">
        <div class="lvl-banner-name">${p.name}</div>
        <div class="lvl-banner-team">${teamLabel}</div>
        <div class="lvl-banner-level">LEVEL <b>${p.level}</b></div>
      </div>
    </div>`;

  panel.innerHTML = `
    ${playerBanner}
    <h2>LEVEL UP</h2>
    <div class="upgrades">
      ${options.map((u, i) => {
        const lvl = p.upgradeLevels[u.id] || 0;
        const isSuper = u.isSuper;
        const isUnlock = u.isUnlock;
        const isEpic = u.isEpic;
        const cls = isSuper ? 'super' : isUnlock ? 'unlock' : isEpic ? 'epic' : '';
        const iconKind = u.iconKind || u.id;
        const tag = isSuper ? 'SUPER' : isUnlock ? 'NEW' : isEpic ? 'EPIC ×2' : '';
        const descTxt = isEpic ? `${u.desc} <b style="color:#dda4ff">×2</b>` : u.desc;
        return `<div class="upgrade ${cls}" data-i="${i}">
          ${tag ? `<div class="tag">${tag}</div>` : ''}
          <canvas width="56" height="56" data-icon="${iconKind}"></canvas>
          <div class="name">${u.name}</div>
          <div class="desc">${descTxt}</div>
          <div class="lvl">${isSuper ? 'EVOLUTION' : isUnlock ? 'UNLOCK' : `LV ${lvl} / ${u.max}`}</div>
        </div>`;
      }).join('')}
    </div>
    <div class="loadout">
      <div class="loadout-title">${isCoop ? `${p.name} ` : ''}LOADOUT &nbsp; ${p.slots.length}/${MAX_SLOTS}${tier2Bit}</div>
      <div class="slots-row">${slotsHtml}</div>
    </div>
    <div class="credit-tag">by stephen</div>
  `;
  document.getElementById('overlay').style.display = 'flex';
  panel.querySelectorAll('canvas[data-icon]').forEach(c => drawIcon(c, c.dataset.icon));
  panel.querySelectorAll('canvas[data-slot-icon]').forEach(c => drawIcon(c, c.dataset.slotIcon));

  // Brief input lockout so clicks at panel-open don't auto-pick.
  const openedAt = performance.now();
  const LOCKOUT_MS = 500;
  panel.style.pointerEvents = 'none';
  setTimeout(() => { panel.style.pointerEvents = ''; }, LOCKOUT_MS);
  const guard = (handler) => (ev) => {
    if (performance.now() - openedAt < LOCKOUT_MS) { ev.preventDefault(); ev.stopPropagation(); return; }
    handler(ev);
  };

  panel.querySelectorAll('.upgrade').forEach(el => {
    el.addEventListener('click', guard(() => pickUpgrade(options[+el.dataset.i])));
  });
  panel.querySelectorAll('.slot-super').forEach(el => {
    el.addEventListener('click', guard((ev) => {
      ev.stopPropagation();
      const slotEl = el.closest('.slot');
      const slotId = slotEl && slotEl.dataset.slotId;
      if (slotId) showSuperInfo(p, slotId);
    }));
  });
  panel.querySelectorAll('.slot-remove').forEach(btn => {
    btn.addEventListener('click', guard((ev) => {
      ev.stopPropagation();
      removeWeapon(p, btn.dataset.remove);
      renderLevelUpPanel(p, rollUpgrades(p));
    }));
  });
}

function showSuperInfo(p, weaponId) {
  const sup = SUPERS.find(s => s.weaponId === weaponId);
  if (!sup) return;
  const existing = document.getElementById('supInfo');
  if (existing) existing.remove();
  const unlocked = !!p.superUnlocked[sup.id];
  const metCount = sup.requires.filter(r => (p.upgradeLevels[r.id] || 0) >= r.level).length;
  const totalReqs = sup.requires.length;
  const reqHtml = sup.requires.map(r => {
    const u = UPGRADES.find(x => x.id === r.id);
    const lvl = p.upgradeLevels[r.id] || 0;
    const met = lvl >= r.level;
    return `<div class="sup-req ${met ? 'met' : ''}">
      <span>${met ? '✓' : '○'} ${u ? u.name : r.id}</span>
      <span>${lvl} / ${r.level}</span>
    </div>`;
  }).join('');
  const status = unlocked
    ? '★ EVOLUTION UNLOCKED'
    : (metCount === totalReqs ? '◆ READY — APPEARS NEXT LEVEL UP' : `REQUIREMENTS (${metCount}/${totalReqs})`);
  const div = document.createElement('div');
  div.id = 'supInfo';
  div.innerHTML = `
    <div class="sup-info-panel">
      <button class="sup-info-close" title="Close">×</button>
      <h3>${sup.name}</h3>
      <div class="sup-info-desc">${sup.desc}</div>
      <div class="sup-info-status">${status}</div>
      <div class="sup-info-reqs">${reqHtml}</div>
    </div>
  `;
  document.body.appendChild(div);
  const close = () => { div.remove(); };
  div.addEventListener('click', (e) => { if (e.target === div) close(); });
  div.querySelector('.sup-info-close').addEventListener('click', close);
  SFX.click();
}

function pickUpgrade(u) {
  const p = world.activeLevelUpPlayer;
  if (!p) return;
  if (u.isUnlock) {
    addWeapon(p, u.weaponId);
    SFX.click();
  } else if (u.isSuper) {
    u.apply(p);
    p.superUnlocked[u.id] = true;
    if (!world.tier2Unlocked) world.tier2Unlocked = true;
    for (let i = 0; i < 80; i++) {
      const a = Math.random() * TAU;
      const s = rand(60, 220);
      world.particles.push({
        x: p.x, y: p.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(0.5, 1.0), maxLife: 1.0, size: 2,
        color: ['#ffcc44', '#ffee88', '#fff', '#ff66cc'][irand(0, 3)], gravity: 0,
      });
    }
    world.flash = 0.6;
    SFX.superUnlock();
  } else {
    // EPIC = apply twice (clamped to max), bumping level by 2.
    const curLvl = p.upgradeLevels[u.id] || 0;
    const stacks = u.isEpic ? Math.min(2, u.max - curLvl) : 1;
    for (let i = 0; i < stacks; i++) u.apply(p);
    p.upgradeLevels[u.id] = curLvl + stacks;
    SFX.click();
  }
  document.getElementById('overlay').style.display = 'none';
  world.activeLevelUpPlayer = null;
  world.paused = false;
  showLevelUp();
}

// ---------- RUN SUMMARY ----------
function buildRunSummaryHtml() {
  const isCoop = world.players.length > 1;
  const playerCards = world.players.map(pl => {
    if (!pl) return '';
    const dmgEntries = Object.entries(pl.stats.damageByWeapon).sort((a, b) => b[1] - a[1]);
    const totalDmg = dmgEntries.reduce((a, [, v]) => a + v, 0) || 1;
    const dmgRows = dmgEntries.length
      ? dmgEntries.map(([id, dmg]) => {
          const w = WEAPONS[id];
          const label = w ? w.name : id.toUpperCase();
          const pct = Math.round(dmg / totalDmg * 100);
          return `<div class="rs-dmg-row">
            <span class="rs-dmg-name">${label}</span>
            <span class="rs-dmg-bar"><span class="rs-dmg-fill" style="width:${pct}%"></span></span>
            <span class="rs-dmg-val">${Math.round(dmg).toLocaleString()}</span>
          </div>`;
        }).join('')
      : '<div class="rs-dmg-row rs-dmg-empty">no damage logged</div>';
    const slotsHtml = pl.slots.map(id => {
      const w = WEAPONS[id];
      return w ? `<span class="rs-slot">${w.name}</span>` : '';
    }).join('');
    const themeColor = pl.theme || pl.tint || '#ff66cc';
    return `<div class="rs-player" style="border-color:${themeColor}; box-shadow:0 0 18px ${themeColor}44;">
      <div class="rs-name" style="color:${themeColor}">${pl.name} — ${pl.skinName || ''}</div>
      <div class="rs-grid">
        <div><span class="rs-k">LEVEL</span><span class="rs-v">${pl.level}</span></div>
        <div><span class="rs-k">KILLS</span><span class="rs-v">${pl.stats.kills}</span></div>
        <div><span class="rs-k">DAMAGE</span><span class="rs-v">${Math.round(pl.stats.dmgDealt).toLocaleString()}</span></div>
        <div><span class="rs-k">HEALED</span><span class="rs-v">${Math.round(pl.stats.healed)}</span></div>
        <div><span class="rs-k">XP GAINED</span><span class="rs-v">${pl.stats.xpGained}</span></div>
        <div><span class="rs-k">STATUS</span><span class="rs-v" style="color:${pl.dead ? '#ff6666' : '#aaffaa'}">${pl.dead ? 'DOWNED' : 'ALIVE'}</span></div>
      </div>
      <div class="rs-slots">${slotsHtml}</div>
      <div class="rs-dmg-title">DAMAGE BY WEAPON</div>
      ${dmgRows}
    </div>`;
  }).join('');
  return `
    <div class="rs-meta">TIME <b style="color:#ffcc44">${formatTime(world.time)}</b> &nbsp; • &nbsp; TOTAL KILLS <b style="color:#ffcc44">${world.kills}</b></div>
    <div class="rs-grid-players ${isCoop ? 'coop' : ''}">${playerCards}</div>
  `;
}

// ---------- VICTORY ----------
function showVictory() {
  world.paused = true;
  world.gameOver = true;
  SFX.victory();
  world.flash = 0.8;
  for (const pl of alivePlayers()) {
    for (let i = 0; i < 120; i++) {
      const a = Math.random() * TAU;
      const s = rand(80, 260);
      world.particles.push({
        x: pl.x, y: pl.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(0.8, 1.6), maxLife: 1.6, size: 2,
        color: ['#ffcc44', '#ff66cc', '#66ddff', '#aaffaa', '#fff', '#ffee88'][irand(0, 5)], gravity: 60,
      });
    }
  }
  // Speedrun: record/update personal best on Titan defeat.
  let speedrunHtml = '';
  if (world.waveMode) {
    const finalTime = world.time;
    const prev = getSpeedrunBest();
    const isNewBest = prev == null || finalTime < prev;
    if (isNewBest) setSpeedrunBest(finalTime);
    const bestStr = formatTime(isNewBest ? finalTime : prev);
    speedrunHtml = `
      <div style="margin:10px auto 14px; padding:10px 16px; border:2px solid #ffcc44;
                  background:rgba(40,28,8,0.6); max-width:420px; letter-spacing:2px;">
        <div style="font-size:11px; color:#aaeeff;">SPEEDRUN TIME</div>
        <div style="font-size:24px; color:#ffee88; font-weight:bold; margin:4px 0;">
          ${formatTime(finalTime)} ${isNewBest ? '<span style="color:#aaffaa;font-size:11px;">NEW BEST!</span>' : ''}
        </div>
        <div style="font-size:10px; color:#aaa;">BEST &nbsp; <b style="color:#ffcc44">${bestStr}</b></div>
      </div>`;
  }
  const panel = document.getElementById('panel');
  panel.innerHTML = `
    <h1 style="color:#ffcc44">VICTORY!</h1>
    <p style="color:#ffee88; font-size:13px; letter-spacing:2px;">
      You felled <b>THE TITAN</b> — the survivors live to fight another day.
    </p>
    ${speedrunHtml}
    ${buildRunSummaryHtml()}
    <div style="display:flex; gap:14px; justify-content:center; margin-top:18px; flex-wrap:wrap;">
      <button id="restartBtn" style="background:linear-gradient(180deg,#7a3aa0 0%,#5a2880 100%); border-color:#aaeeff;">PLAY AGAIN</button>
    </div>
  `;
  document.getElementById('overlay').style.display = 'flex';
  document.getElementById('restartBtn').addEventListener('click', () => { showStartScreen(); });
}

// ---------- GAME OVER ----------
function gameOver() {
  if (world.gameOver) return;
  world.gameOver = true;
  SFX.death();
  const panel = document.getElementById('panel');
  panel.innerHTML = `
    <h1>YOU DIED</h1>
    <p>Survived: <b style="color:#ff66cc">${formatTime(world.time)}</b></p>
    ${buildRunSummaryHtml()}
    <div style="display:flex; gap:14px; justify-content:center; margin-top:18px; flex-wrap:wrap;">
      <button id="restartBtn">TRY AGAIN</button>
    </div>
  `;
  document.getElementById('overlay').style.display = 'flex';
  document.getElementById('restartBtn').addEventListener('click', () => { showStartScreen(); });
}

// ---------- START / MODE / SKIN ----------
function showStartScreen() {
  const panel = document.getElementById('panel');
  const best = getSpeedrunBest();
  const bestStr = best == null ? '—' : formatTime(best);
  panel.classList.add('start-panel');
  panel.innerHTML = `
    <div class="menu-title">PIXEL SURVIVORS</div>
    <div class="menu-subtitle">SURVIVE 15 MINUTES &nbsp;→&nbsp; <b>DEFEAT THE TITAN</b></div>

    <div class="menu-section">
      <div class="menu-section-title">MODE</div>
      <div id="modeButtons" class="mode-row">
        <button class="mode-btn ${selectedMode === 'solo' ? 'selected' : ''}" data-mode="solo">
          <span class="mode-btn-label">SOLO</span>
          <span class="mode-btn-sub">1 player</span>
        </button>
        <button class="mode-btn ${selectedMode === 'coop' ? 'selected' : ''}" data-mode="coop">
          <span class="mode-btn-label">CO-OP</span>
          <span class="mode-btn-sub">2 players</span>
        </button>
      </div>
    </div>

    <div class="menu-section">
      <div class="menu-section-title">SPEEDRUN</div>
      <button id="speedrunToggle" class="mode-btn ${selectedSpeedrun ? 'selected' : ''}" style="min-width:280px;">
        <span class="mode-btn-label">${selectedSpeedrun ? 'ON' : 'OFF'}</span>
        <span class="mode-btn-sub">30 waves · last wave is the Titan</span>
      </button>
      <div style="margin-top:8px; font-size:10px; letter-spacing:2px; color:#aaa;">
        BEST TIME &nbsp; <b style="color:#ffcc44">${bestStr}</b>
      </div>
    </div>

    <div class="menu-section">
      <div class="menu-section-title">CHARACTER</div>
      <div id="skinPicker"></div>
    </div>

    <div class="menu-controls">
      <span><b>P1</b> WASD / Click</span>
      <span><b>P2</b> Arrows</span>
      <span><b>SPACE</b> Pause</span>
      <span><b>M</b> Mute</span>
    </div>

    <button id="startBtn" class="start-button">START</button>
    <div class="credit-tag">by stephen</div>
  `;
  document.getElementById('overlay').style.display = 'flex';
  document.getElementById('hud').style.display = 'none';
  document.getElementById('startBtn').addEventListener('click', () => {
    panel.classList.remove('start-panel');
    startGame();
  });
  document.getElementById('speedrunToggle').addEventListener('click', () => {
    selectedSpeedrun = !selectedSpeedrun;
    SFX.click();
    showStartScreen();
  });
  wireModeButtons();
}

function renderSkinPicker() {
  const wrap = document.getElementById('skinPicker');
  if (!wrap) return;
  const isCoop = selectedMode === 'coop';
  const slots = isCoop
    ? [{ idx: 0, name: 'P1', team: 'blue', theme: '#6abfff' },
       { idx: 1, name: 'P2', team: 'red',  theme: '#ff6666' }]
    : [{ idx: 0, name: 'P1', team: 'blue', theme: '#6abfff' }];
  wrap.innerHTML = slots.map(slot => `
    <div class="skin-row" data-player="${slot.idx}" style="--team:${slot.theme}">
      <div class="skin-row-label">
        <span class="skin-row-tag">${slot.name}</span>
        <span class="skin-row-team">${slot.team.toUpperCase()} TEAM</span>
      </div>
      <div class="skin-options">
        ${PLAYER_SKINS.map((s, i) => `
          <button class="skin-btn ${selectedSkin[slot.idx] === i ? 'selected' : ''}"
                  data-player="${slot.idx}" data-skin="${i}">
            <div class="skin-preview">
              <canvas width="48" height="56" data-skin-canvas="${i}" data-skin-team="${slot.team}"></canvas>
            </div>
            <div class="skin-name">${s.name}</div>
          </button>
        `).join('')}
      </div>
    </div>
  `).join('');
  wrap.querySelectorAll('canvas[data-skin-canvas]').forEach(c => {
    const idx = +c.dataset.skinCanvas;
    const team = c.dataset.skinTeam;
    const sprite = playerSkinFrames[team][idx][0];
    const ic = c.getContext('2d');
    ic.imageSmoothingEnabled = false;
    ic.clearRect(0, 0, c.width, c.height);
    // Center the 14×16 sprite at 2.5× scale (35×40) inside the 48×56 canvas.
    const dw = 14 * 2.5, dh = 16 * 2.5;
    ic.drawImage(sprite, (c.width - dw) / 2, (c.height - dh) / 2 + 2, dw, dh);
  });
  wrap.querySelectorAll('.skin-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pl = +btn.dataset.player;
      const sk = +btn.dataset.skin;
      selectedSkin[pl] = sk;
      SFX.click();
      renderSkinPicker();
    });
  });
}

function wireModeButtons() {
  // Restrict to buttons with a data-mode attribute. The speedrun toggle also
  // uses .mode-btn for styling but has no data-mode — if we caught it here,
  // clicking it would set selectedMode to undefined and silently break co-op.
  const btns = document.querySelectorAll('.mode-btn[data-mode]');
  btns.forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedMode = b.dataset.mode;
      btns.forEach(x => x.classList.toggle('selected', x.dataset.mode === selectedMode));
      SFX.click();
      renderSkinPicker();
    });
  });
  renderSkinPicker();
}

// ---------- HUD ----------
const hudEls = {};
function cacheHUD() {
  hudEls.lvl = document.getElementById('lvl');
  hudEls.time = document.getElementById('time');
  hudEls.kills = document.getElementById('kills');
  hudEls.xpbar = document.getElementById('xpbar');
  hudEls.xplbl = document.getElementById('xplbl');
  hudEls.slots = document.getElementById('hud-slots');
  hudEls.p2 = document.getElementById('hud-p2');
}
let lastHudSlotsKey = '';
let lastP2Key = '';
function updateHUD() {
  const p1 = world.player;
  if (!p1) return;
  hudEls.lvl.textContent = p1.level;
  if (world.waveMode) {
    const elapsed = formatTime(world.time);
    hudEls.time.innerHTML = `<span style="color:#ffcc44">WAVE ${world.wave}/30</span> &nbsp;·&nbsp; ${elapsed}`;
  } else {
    const min = Math.floor(world.time / 60).toString().padStart(2, '0');
    const sec = Math.floor(world.time % 60).toString().padStart(2, '0');
    hudEls.time.innerHTML = `${min}:${sec} <span style="color:#888">/ <span style="color:#ffcc44">15:00</span></span>`;
  }
  hudEls.time.style.color = world.titanSpawned ? '#ff6666' : (world.time >= VICTORY_TIME - 30 ? '#ffcc44' : '');
  hudEls.kills.textContent = world.kills;
  hudEls.xpbar.style.width = `${(p1.xp / p1.xpNext) * 100}%`;
  hudEls.xplbl.textContent = `${p1.xp} / ${p1.xpNext}`;
  const slotsKey = p1.slots.join('|');
  if (hudEls.slots && slotsKey !== lastHudSlotsKey) {
    lastHudSlotsKey = slotsKey;
    let html = '';
    for (let i = 0; i < MAX_SLOTS; i++) {
      const id = p1.slots[i];
      html += id
        ? `<span class="hud-slot filled" title="${WEAPONS[id].name}">${WEAPONS[id].name.charAt(0)}</span>`
        : `<span class="hud-slot empty">·</span>`;
    }
    hudEls.slots.innerHTML = html;
  }
  if (hudEls.p2) {
    const p2 = world.players[1];
    const shown = !!p2;
    const key = shown ? `${p2.dead ? 'D' : 'A'}|${p2.level}|${p2.xp}/${p2.xpNext}|${Math.ceil(p2.hp)}/${p2.hpMax}|${p2.slots.join(',')}` : '';
    if (key !== lastP2Key) {
      lastP2Key = key;
      if (!shown) {
        hudEls.p2.style.display = 'none';
      } else {
        hudEls.p2.style.display = '';
        const pct = clamp(p2.hp / p2.hpMax, 0, 1) * 100;
        const xpPct = clamp(p2.xp / p2.xpNext, 0, 1) * 100;
        let slotsP2 = '';
        for (let i = 0; i < MAX_SLOTS; i++) {
          const id = p2.slots[i];
          slotsP2 += id
            ? `<span class="hud-slot filled" title="${WEAPONS[id].name}">${WEAPONS[id].name.charAt(0)}</span>`
            : `<span class="hud-slot empty">·</span>`;
        }
        hudEls.p2.innerHTML = p2.dead
          ? `<div class="p2-label">P2 — DOWN — revives when P1 levels up</div>`
          : `<div class="p2-label">P2 &nbsp; LVL <span style="color:#ffcc44">${p2.level}</span> &nbsp; ${slotsP2}</div>
             <div class="bar hp p2-bar"><div style="width:${pct}%"></div>
               <div class="label">${Math.max(0, Math.ceil(p2.hp))} / ${p2.hpMax}</div>
             </div>
             <div class="bar xp p2-bar"><div style="width:${xpPct}%"></div>
               <div class="label">${p2.xp} / ${p2.xpNext}</div>
             </div>`;
      }
    }
  }
}
