'use strict';

// ============================================================
//  sprites.js — pixel art + icon drawing
//  All sprites are generated at runtime onto offscreen canvases.
//  Exposes globals consumed by game.js.
// ============================================================

// ---------- UTIL ----------
const rand = (a, b) => a + Math.random() * (b - a);
const irand = (a, b) => Math.floor(rand(a, b + 1));
const dist2 = (ax, ay, bx, by) => { const dx = ax-bx, dy = ay-by; return dx*dx + dy*dy; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const TAU = Math.PI * 2;

// ---------- PIXEL SPRITE GENERATOR ----------
function makeSprite(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  draw(x, w, h);
  return c;
}

// ===== PLAYER SKINS =====
// Each character has its own draw routine so they read as distinct silhouettes
// at 14×16, not just recolors of the same base figure.
const SKIN_DRAWERS = {
  // Robed monk with a skullcap, halo ring, and chest cross.
  cleric(x, p, f) {
    x.fillStyle = p.body;   x.fillRect(3, 7, 8, 7);
    x.fillStyle = p.body;   x.fillRect(4, 14, 6, 1);
    x.fillStyle = p.boot;   x.fillRect(3, 13 + f, 3, 2);
    x.fillStyle = p.boot;   x.fillRect(8, 13 - f, 3, 2);
    x.fillStyle = p.face;   x.fillRect(4, 4, 6, 4);
    x.fillStyle = p.hat;    x.fillRect(4, 4, 6, 1);
    x.fillStyle = p.acc2;   x.fillRect(3, 3, 8, 1);
    x.fillStyle = p.eye;    x.fillRect(5, 6, 1, 1); x.fillRect(8, 6, 1, 1);
    x.fillStyle = p.arm;    x.fillRect(2, 8, 1, 4); x.fillRect(11, 8, 1, 4);
    x.fillStyle = p.acc2;   x.fillRect(6, 9, 2, 3);
    x.fillStyle = p.acc2;   x.fillRect(5, 10, 4, 1);
    x.fillStyle = p.acc1;   x.fillRect(3, 12, 8, 1);
  },
  // Plate-armored knight: full helm with eye slit and a feathered plume.
  knight(x, p, f) {
    x.fillStyle = p.body;   x.fillRect(3, 7, 8, 7);
    x.fillStyle = p.boot;   x.fillRect(3, 13 + f, 3, 2);
    x.fillStyle = p.boot;   x.fillRect(8, 13 - f, 3, 2);
    x.fillStyle = p.hat;    x.fillRect(3, 3, 8, 5);
    x.fillStyle = p.hatTop; x.fillRect(3, 3, 8, 1);
    x.fillStyle = p.acc1;   x.fillRect(6, 0, 2, 3);
    x.fillStyle = p.face;   x.fillRect(4, 6, 6, 1);
    x.fillStyle = p.eye;    x.fillRect(5, 6, 1, 1); x.fillRect(8, 6, 1, 1);
    x.fillStyle = p.acc2;   x.fillRect(2, 7, 2, 1); x.fillRect(10, 7, 2, 1);
    x.fillStyle = p.arm;    x.fillRect(2, 8, 1, 4); x.fillRect(11, 8, 1, 4);
    x.fillStyle = p.acc1;   x.fillRect(6, 10, 2, 2);
  },
  // Narrow-shouldered ninja: hood, eye-slit mask, headband, katana on the back.
  ninja(x, p, f) {
    x.fillStyle = p.body;   x.fillRect(4, 7, 6, 7);
    x.fillStyle = p.boot;   x.fillRect(4, 13 + f, 2, 2);
    x.fillStyle = p.boot;   x.fillRect(8, 13 - f, 2, 2);
    x.fillStyle = p.hat;    x.fillRect(3, 3, 8, 4);
    x.fillStyle = p.face;   x.fillRect(4, 6, 6, 2);
    x.fillStyle = p.acc1;   x.fillRect(3, 5, 8, 1);
    x.fillStyle = p.acc1;   x.fillRect(2, 5, 1, 2);
    x.fillStyle = p.eye;    x.fillRect(5, 7, 1, 1); x.fillRect(8, 7, 1, 1);
    x.fillStyle = p.arm;    x.fillRect(3, 8, 1, 4); x.fillRect(10, 8, 1, 4);
    x.fillStyle = p.acc2;   x.fillRect(1, 6, 1, 5);
    x.fillStyle = p.acc1;   x.fillRect(1, 5, 1, 1);
    x.fillStyle = p.acc2;   x.fillRect(0, 8, 3, 1);
  },
  // Outlaw with a wide-brim hat and a bandana covering the lower face.
  bandit(x, p, f) {
    x.fillStyle = p.body;   x.fillRect(3, 7, 8, 7);
    x.fillStyle = p.boot;   x.fillRect(3, 13 + f, 3, 2);
    x.fillStyle = p.boot;   x.fillRect(8, 13 - f, 3, 2);
    x.fillStyle = p.face;   x.fillRect(4, 6, 6, 3);
    x.fillStyle = p.hat;    x.fillRect(4, 3, 6, 3);
    x.fillStyle = p.hatTop; x.fillRect(1, 5, 12, 1);
    x.fillStyle = p.hatTop; x.fillRect(2, 6, 1, 1); x.fillRect(11, 6, 1, 1);
    x.fillStyle = p.eye;    x.fillRect(5, 7, 1, 1); x.fillRect(8, 7, 1, 1);
    x.fillStyle = p.acc2;   x.fillRect(4, 8, 6, 1);
    x.fillStyle = p.acc2;   x.fillRect(3, 9, 8, 1);
    x.fillStyle = p.arm;    x.fillRect(2, 8, 1, 4); x.fillRect(11, 8, 1, 4);
    x.fillStyle = p.boot;   x.fillRect(3, 11, 8, 1);
    x.fillStyle = p.acc1;   x.fillRect(6, 11, 2, 1);
  },
  // Wizard: tall pointed hat with a star, long beard, staff with a glowing tip.
  mage(x, p, f) {
    x.fillStyle = p.body;   x.fillRect(3, 7, 8, 7);
    x.fillStyle = p.boot;   x.fillRect(3, 13 + f, 3, 2);
    x.fillStyle = p.boot;   x.fillRect(8, 13 - f, 3, 2);
    x.fillStyle = p.hat;    x.fillRect(6, 0, 2, 1);
    x.fillStyle = p.hat;    x.fillRect(5, 1, 4, 2);
    x.fillStyle = p.hat;    x.fillRect(4, 3, 6, 1);
    x.fillStyle = p.hat;    x.fillRect(3, 4, 8, 1);
    x.fillStyle = p.hatTop; x.fillRect(6, 0, 2, 1);
    x.fillStyle = p.acc2;   x.fillRect(3, 5, 8, 1);
    x.fillStyle = p.face;   x.fillRect(4, 6, 6, 2);
    x.fillStyle = p.eye;    x.fillRect(5, 7, 1, 1); x.fillRect(8, 7, 1, 1);
    x.fillStyle = p.acc1;   x.fillRect(4, 8, 6, 2);
    x.fillStyle = p.acc1;   x.fillRect(5, 10, 4, 1);
    x.fillStyle = p.arm;    x.fillRect(2, 9, 1, 3); x.fillRect(11, 9, 1, 3);
    x.fillStyle = p.acc2;   x.fillRect(12, 5, 1, 7);
    x.fillStyle = p.acc1;   x.fillRect(11, 4, 3, 1);
    x.fillStyle = p.acc1;   x.fillRect(12, 3, 1, 1);
  },
};

function makePlayerSkin(pal, id) {
  const draw = SKIN_DRAWERS[id] || SKIN_DRAWERS.cleric;
  const frames = [];
  for (let f = 0; f < 2; f++) {
    frames.push(makeSprite(14, 16, (x) => draw(x, pal, f)));
  }
  return frames;
}

// Each skin defines TWO themed palettes — P1 is always BLUE, P2 is always RED.
// The skin name picks the silhouette identity; the team picks the color story.
const PLAYER_SKINS = [
  { id: 'cleric', name: 'CLERIC',
    blue: { body: '#1e3a78', boot: '#0a1530', hat: '#2a5aaa', hatTop: '#5a86d8',
            face: '#0a1428', eye: '#fff', arm: '#5a78c0', acc1: '#ffcc44', acc2: '#aaeeff' },
    red:  { body: '#7a1e2e', boot: '#300a14', hat: '#aa2e3e', hatTop: '#d85070',
            face: '#280a0a', eye: '#fff', arm: '#c05870', acc1: '#ffcc44', acc2: '#ffaaaa' } },
  { id: 'knight', name: 'KNIGHT',
    blue: { body: '#5070a8', boot: '#283848', hat: '#7090c8', hatTop: '#aaccff',
            face: '#1a2238', eye: '#aaeeff', arm: '#6080b8', acc1: '#aaeeff', acc2: '#ffcc44' },
    red:  { body: '#a05060', boot: '#482830', hat: '#c07080', hatTop: '#ffaaaa',
            face: '#382020', eye: '#ffcccc', arm: '#b06070', acc1: '#ffaaaa', acc2: '#ffcc44' } },
  { id: 'ninja',  name: 'NINJA',
    blue: { body: '#10204a', boot: '#08101c', hat: '#1a2a48', hatTop: '#2a3a60',
            face: '#000',    eye: '#66ddff', arm: '#2a3a60', acc1: '#aaeeff', acc2: '#fff' },
    red:  { body: '#3a0a18', boot: '#1c0408', hat: '#481a20', hatTop: '#5a2a30',
            face: '#000',    eye: '#ff6666', arm: '#5a2a30', acc1: '#ffaaaa', acc2: '#fff' } },
  { id: 'bandit', name: 'BANDIT',
    blue: { body: '#3a5878', boot: '#0a1828', hat: '#5078a8', hatTop: '#7090c0',
            face: '#0a1828', eye: '#fff', arm: '#5a78a8', acc1: '#ffcc44', acc2: '#aaeeff' },
    red:  { body: '#783a3a', boot: '#280a0a', hat: '#a85040', hatTop: '#c07060',
            face: '#280a0a', eye: '#fff', arm: '#a85a5a', acc1: '#ffcc44', acc2: '#ffaaaa' } },
  { id: 'mage',   name: 'MAGE',
    blue: { body: '#1e3a8a', boot: '#0a1830', hat: '#2a5aaa', hatTop: '#4a7adb',
            face: '#08081a', eye: '#aaeeff', arm: '#3a6abf', acc1: '#ffcc44', acc2: '#aaeeff' },
    red:  { body: '#8a1e1e', boot: '#300a0a', hat: '#aa2a2a', hatTop: '#dd4a4a',
            face: '#1a0808', eye: '#ffaaaa', arm: '#bf3a3a', acc1: '#ffcc44', acc2: '#ffaaaa' } },
];

// Pre-bake every skin × theme combination into sprite frames.
const playerSkinFrames = {
  blue: PLAYER_SKINS.map(s => makePlayerSkin(s.blue, s.id)),
  red:  PLAYER_SKINS.map(s => makePlayerSkin(s.red, s.id)),
};
const playerSprites = playerSkinFrames.blue[0]; // default / back-compat

// ===== ZOMBIES =====
// Each tier has its own draw routine so the silhouettes read as different
// creatures, not recolors. f = walk-cycle frame (0 or 1).
function _zombieShadow(x) {
  x.fillStyle = 'rgba(0,0,0,0.5)';
  x.beginPath(); x.ellipse(7, 15, 4, 1, 0, 0, TAU); x.fill();
}
function _zombieFeet(x, pal, f) {
  x.fillStyle = pal.dark; x.fillRect(4, 12, 2, 3 + f);
  x.fillStyle = pal.dark; x.fillRect(8, 12, 2, 3 - f);
}

// Tier 0 — SHAMBLER: short, hunched, exposed ribs, naked but for a loincloth.
function makeShambler() {
  const p = { skin:'#a8c98a', skin2:'#c8e9aa', dark:'#3a5a1a', cloth:'#5a4030', stain:'#2a1a0a', eye:'#cc1111', bone:'#e0d8a0' };
  return [0, 1].map(f => makeSprite(14, 16, (x) => {
    _zombieShadow(x);
    x.fillStyle = p.skin;  x.fillRect(4, 3, 6, 5);
    x.fillStyle = p.dark;  x.fillRect(4, 7, 6, 1);
    x.fillStyle = p.skin2; x.fillRect(5, 4, 1, 1); x.fillRect(8, 4, 1, 1);
    x.fillStyle = p.eye;   x.fillRect(5, 5, 1, 1); x.fillRect(8, 5, 1, 1);
    x.fillStyle = '#660000'; x.fillRect(6, 6, 2, 1);
    x.fillStyle = p.skin;  x.fillRect(3, 8, 8, 4);
    x.fillStyle = p.bone;  x.fillRect(4, 9, 6, 1); x.fillRect(4, 11, 6, 1);
    x.fillStyle = p.dark;  x.fillRect(5, 10, 4, 1);
    x.fillStyle = p.cloth; x.fillRect(4, 12, 6, 1);
    x.fillStyle = p.skin;  x.fillRect(2, 8 + f, 1, 4);
    x.fillStyle = p.skin;  x.fillRect(11, 8 - f, 1, 4);
    _zombieFeet(x, p, f);
  }));
}

// Tier 1 — ROTTER: upright, tattered shirt with blood stains and gaps.
function makeRotter() {
  const p = { skin:'#aabb7a', skin2:'#ccdc9a', dark:'#5a6a3a', cloth:'#5a3060', cloth2:'#7a5080', stain:'#aa1111', eye:'#cc2222' };
  return [0, 1].map(f => makeSprite(14, 16, (x) => {
    _zombieShadow(x);
    x.fillStyle = p.skin;   x.fillRect(4, 2, 6, 5);
    x.fillStyle = p.dark;   x.fillRect(4, 6, 6, 1);
    x.fillStyle = p.skin2;  x.fillRect(5, 3, 1, 1); x.fillRect(8, 3, 1, 1);
    x.fillStyle = p.eye;    x.fillRect(5, 4, 1, 1); x.fillRect(8, 4, 1, 1);
    x.fillStyle = '#660000'; x.fillRect(6, 5, 2, 1);
    x.fillStyle = p.cloth;  x.fillRect(3, 7, 8, 5);
    x.fillStyle = p.cloth2; x.fillRect(3, 7, 8, 1);
    x.fillStyle = p.stain;  x.fillRect(5, 9, 1, 1); x.fillRect(7, 10, 2, 1);
    x.fillStyle = p.skin;   x.fillRect(3, 10, 1, 2); x.fillRect(10, 8, 1, 2);
    x.fillStyle = p.skin;   x.fillRect(2, 7 + f, 1, 4);
    x.fillStyle = p.skin;   x.fillRect(11, 7 - f, 1, 4);
    _zombieFeet(x, p, f);
  }));
}

// Tier 2 — GHOUL: lean predator, clawed hands, glowing eyes, jagged teeth.
function makeGhoul() {
  const p = { skin:'#9a8888', skin2:'#bca9a9', dark:'#3a2828', cloth:'#181818', cloth2:'#3a3a3a', eye:'#ff3300', claw:'#fff', tooth:'#fff' };
  return [0, 1].map(f => makeSprite(14, 16, (x) => {
    _zombieShadow(x);
    x.fillStyle = p.skin;   x.fillRect(5, 2, 4, 4);
    x.fillStyle = p.dark;   x.fillRect(5, 5, 4, 1);
    x.fillStyle = p.eye;    x.fillRect(5, 3, 1, 1); x.fillRect(8, 3, 1, 1);
    x.fillStyle = p.dark;   x.fillRect(5, 4, 4, 1);
    x.fillStyle = p.tooth;  x.fillRect(5, 4, 1, 1); x.fillRect(7, 4, 1, 1); x.fillRect(8, 4, 1, 1);
    x.fillStyle = p.cloth;  x.fillRect(4, 6, 6, 6);
    x.fillStyle = p.cloth2; x.fillRect(4, 6, 6, 1);
    x.fillStyle = p.dark;   x.fillRect(5, 8, 4, 1);
    x.fillStyle = p.skin;   x.fillRect(2, 7 + f, 1, 5);
    x.fillStyle = p.skin;   x.fillRect(11, 7 - f, 1, 5);
    x.fillStyle = p.claw;   x.fillRect(1, 11 + f, 1, 1); x.fillRect(2, 12 + f, 1, 1);
    x.fillStyle = p.claw;   x.fillRect(12, 11 - f, 1, 1); x.fillRect(11, 12 - f, 1, 1);
    _zombieFeet(x, p, f);
  }));
}

// SPITTER — bloated head with a side bile sac, dripping mouth, green chest.
function makeSpitter() {
  const p = { skin:'#5a8a3a', skin2:'#7aaa5a', dark:'#1a3a0a', cloth:'#4a3a2a', cloth2:'#6a5a4a', eye:'#ffff66', bile:'#aaff44', sac:'#88cc44' };
  return [0, 1].map(f => makeSprite(14, 16, (x) => {
    _zombieShadow(x);
    x.fillStyle = p.skin;   x.fillRect(3, 2, 8, 5);
    x.fillStyle = p.dark;   x.fillRect(3, 6, 8, 1);
    x.fillStyle = p.skin2;  x.fillRect(4, 3, 1, 1); x.fillRect(9, 3, 1, 1);
    x.fillStyle = p.sac;    x.fillRect(9, 4, 2, 2);
    x.fillStyle = p.dark;   x.fillRect(10, 5, 1, 1);
    x.fillStyle = p.eye;    x.fillRect(5, 4, 1, 1); x.fillRect(7, 4, 1, 1);
    x.fillStyle = '#220000'; x.fillRect(5, 5, 3, 1);
    x.fillStyle = p.bile;   x.fillRect(6, 6, 1, 2);
    x.fillStyle = p.cloth;  x.fillRect(3, 7, 8, 5);
    x.fillStyle = p.cloth2; x.fillRect(3, 7, 8, 1);
    x.fillStyle = p.bile;   x.fillRect(5, 9, 4, 2);
    x.fillStyle = p.sac;    x.fillRect(6, 10, 2, 1);
    x.fillStyle = p.skin;   x.fillRect(2, 7 + f, 1, 3);
    x.fillStyle = p.skin;   x.fillRect(11, 7 - f, 1, 3);
    _zombieFeet(x, p, f);
  }));
}

// EXPLODER — round bloated belly, fuse on top of head, glowing seams.
function makeExploder() {
  const p = { skin:'#6a4030', skin2:'#8a5040', dark:'#2a1010', cloth:'#3a2020', cloth2:'#5a3030', glow:'#ff7722', fuse:'#ffaa44' };
  return [0, 1].map(f => makeSprite(14, 16, (x) => {
    _zombieShadow(x);
    x.fillStyle = p.fuse;   x.fillRect(7, 0, 1, 2);
    x.fillStyle = p.glow;   x.fillRect(7, 0, 1, 1);
    x.fillStyle = p.skin;   x.fillRect(4, 2, 6, 5);
    x.fillStyle = p.dark;   x.fillRect(4, 6, 6, 1);
    x.fillStyle = p.glow;   x.fillRect(5, 4, 1, 1); x.fillRect(8, 4, 1, 1);
    x.fillStyle = '#000';   x.fillRect(6, 5, 2, 1);
    x.fillStyle = p.cloth;  x.fillRect(2, 7, 10, 5);
    x.fillStyle = p.cloth2; x.fillRect(2, 7, 10, 1);
    x.fillStyle = p.glow;   x.fillRect(4, 9, 1, 2); x.fillRect(7, 10, 1, 1); x.fillRect(9, 9, 1, 2);
    x.fillStyle = p.fuse;   x.fillRect(5, 10, 1, 1); x.fillRect(8, 9, 1, 1);
    x.fillStyle = p.skin;   x.fillRect(1, 8 + f, 1, 3);
    x.fillStyle = p.skin;   x.fillRect(12, 8 - f, 1, 3);
    _zombieFeet(x, p, f);
  }));
}

// BEHEMOTH — large 18×20 heavy zombie with a bone chestplate and massive arms.
function makeBehemoth() {
  const p = { skin:'#7a3040', skin2:'#9a5060', dark:'#2a0810', cloth:'#1a0808', cloth2:'#3a1818', bone:'#e0d0b0', eye:'#ffaa00' };
  return [0, 1].map(f => makeSprite(18, 20, (x) => {
    x.fillStyle = 'rgba(0,0,0,0.55)';
    x.beginPath(); x.ellipse(9, 19, 6, 2, 0, 0, TAU); x.fill();
    x.fillStyle = p.skin;   x.fillRect(5, 2, 8, 6);
    x.fillStyle = p.dark;   x.fillRect(5, 7, 8, 1);
    x.fillStyle = p.eye;    x.fillRect(6, 4, 2, 2); x.fillRect(10, 4, 2, 2);
    x.fillStyle = '#220000'; x.fillRect(7, 5, 1, 1); x.fillRect(11, 5, 1, 1);
    x.fillStyle = '#000';   x.fillRect(7, 6, 4, 1);
    x.fillStyle = p.bone;   x.fillRect(7, 6, 1, 1); x.fillRect(10, 6, 1, 1);
    x.fillStyle = p.cloth;  x.fillRect(2, 8, 14, 8);
    x.fillStyle = p.cloth2; x.fillRect(2, 8, 14, 2);
    x.fillStyle = p.bone;   x.fillRect(7, 9, 4, 4);
    x.fillStyle = p.dark;   x.fillRect(8, 10, 2, 2);
    x.fillStyle = p.skin;   x.fillRect(0, 10 + f, 2, 5);
    x.fillStyle = p.skin;   x.fillRect(16, 10 - f, 2, 5);
    x.fillStyle = p.dark;   x.fillRect(5, 16, 3, 3 + f);
    x.fillStyle = p.dark;   x.fillRect(10, 16, 3, 3 - f);
  }));
}

const zombieSets = [makeShambler(), makeRotter(), makeGhoul()];
const spitterSprites  = makeSpitter();
const exploderSprites = makeExploder();
const behemothSprites = makeBehemoth();

const bruteSprites = (() => {
  const out = [];
  for (let f = 0; f < 2; f++) {
    out.push(makeSprite(22, 24, (x) => {
      x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillRect(4, 23, 14, 1);
      x.fillStyle = '#4a6a2a'; x.fillRect(5, 2, 12, 8);
      x.fillStyle = '#6a8a4a'; x.fillRect(5, 2, 12, 2);
      x.fillStyle = '#2a4a1a'; x.fillRect(5, 9, 12, 1);
      x.fillStyle = '#ff3300'; x.fillRect(7, 5, 2, 2); x.fillRect(13, 5, 2, 2);
      x.fillStyle = '#ffaa00'; x.fillRect(7, 5, 1, 1); x.fillRect(13, 5, 1, 1);
      x.fillStyle = '#220000'; x.fillRect(8, 7, 6, 1);
      x.fillStyle = '#fff'; x.fillRect(9, 8, 1, 1); x.fillRect(12, 8, 1, 1);
      x.fillStyle = '#5a2828'; x.fillRect(3, 10, 16, 8);
      x.fillStyle = '#7a3838'; x.fillRect(3, 10, 16, 2);
      x.fillStyle = '#3a1818'; x.fillRect(3, 13, 1, 2); x.fillRect(18, 12, 1, 2);
      x.fillStyle = '#990000'; x.fillRect(8, 13, 6, 1);
      x.fillStyle = '#4a6a2a'; x.fillRect(0, 11, 3, 5); x.fillRect(19, 11, 3, 5);
      x.fillStyle = '#6a8a4a'; x.fillRect(0, 11, 3, 1); x.fillRect(19, 11, 3, 1);
      x.fillStyle = '#2a2a2a'; x.fillRect(5, 18, 4, 4+f);
      x.fillStyle = '#2a2a2a'; x.fillRect(13, 18, 4, 5-f);
    }));
  }
  return out;
})();

// ===== GEMS =====
function makeGem(color, color2, size) {
  return makeSprite(size, size, (x) => {
    const s = size;
    for (let i = 0; i < s; i++) {
      const w = s - Math.abs(i - (s-1)/2) * 2;
      x.fillStyle = i < s/2 ? color2 : color;
      x.fillRect((s-w)/2, i, w, 1);
    }
    x.fillStyle = 'rgba(255,255,255,0.85)';
    x.fillRect(s/2 - 1, 1, 1, Math.max(1, Math.floor(s/2 - 1)));
    x.fillStyle = 'rgba(255,255,255,0.4)';
    x.fillRect(s/2, 2, 1, Math.max(1, Math.floor(s/2 - 2)));
  });
}
const gemSmall = makeGem('#1a66cc', '#66ddff', 6);
const gemMed = makeGem('#1a8844', '#88ff66', 8);
const gemLarge = makeGem('#cc8800', '#ffcc44', 10);

// ===== PICKUPS: HEART, COIN, MAGNET, BOMB =====
const heartSprite = makeSprite(10, 9, (x) => {
  const heart = [
    "0110110",
    "1111111",
    "1111111",
    "1111111",
    "0111110",
    "0011100",
    "0001000",
  ];
  for (let r = 0; r < heart.length; r++) {
    for (let c = 0; c < heart[r].length; c++) {
      if (heart[r][c] === '1') {
        x.fillStyle = r < 2 ? '#ff8888' : '#cc2222';
        x.fillRect(c + 1, r + 1, 1, 1);
      }
    }
  }
  x.fillStyle = '#ffaaaa'; x.fillRect(2, 2, 1, 1); x.fillRect(5, 2, 1, 1);
  x.fillStyle = '#fff'; x.fillRect(2, 2, 1, 1);
});

const coinSprites = (() => {
  const out = [];
  const widths = [6, 4, 2, 4];
  for (let f = 0; f < 4; f++) {
    const w = widths[f];
    out.push(makeSprite(8, 8, (x) => {
      const cx = 4;
      x.fillStyle = '#cc8800';
      x.fillRect(cx - w/2, 1, w, 6);
      x.fillStyle = '#ffcc44';
      x.fillRect(cx - w/2, 1, w, 1);
      x.fillRect(cx - w/2, 6, w, 1);
      x.fillStyle = '#ffee88';
      if (w >= 4) {
        x.fillRect(cx - w/2 + 1, 3, 1, 2);
      }
      x.fillStyle = '#aa6600';
      x.fillRect(cx - w/2, 1, 1, 6);
    }));
  }
  return out;
})();

const magnetSprite = makeSprite(10, 10, (x) => {
  x.fillStyle = '#cc2222'; x.fillRect(2, 1, 2, 5);
  x.fillStyle = '#cc2222'; x.fillRect(6, 1, 2, 5);
  x.fillStyle = '#888'; x.fillRect(2, 6, 2, 3);
  x.fillStyle = '#888'; x.fillRect(6, 6, 2, 3);
  x.fillStyle = '#ff6666'; x.fillRect(2, 1, 1, 5);
  x.fillStyle = '#ff6666'; x.fillRect(6, 1, 1, 5);
  x.fillStyle = '#fff'; x.fillRect(2, 1, 2, 1); x.fillRect(6, 1, 2, 1);
});

const bombSprite = makeSprite(10, 11, (x) => {
  x.fillStyle = '#222'; x.fillRect(2, 3, 6, 6);
  x.fillStyle = '#444'; x.fillRect(2, 3, 6, 1);
  x.fillStyle = '#666'; x.fillRect(3, 3, 1, 1);
  x.fillStyle = '#fff'; x.fillRect(3, 4, 1, 1);
  x.fillStyle = '#888'; x.fillRect(4, 1, 2, 2);
  x.fillStyle = '#ffcc44'; x.fillRect(5, 0, 1, 1);
  x.fillStyle = '#ff6600'; x.fillRect(4, 0, 1, 1); x.fillRect(6, 0, 1, 1);
});

// ===== WEAPONS =====
const knifeSprite = makeSprite(10, 5, (x) => {
  x.fillStyle = '#aaa'; x.fillRect(0, 2, 7, 1);
  x.fillStyle = '#ddd'; x.fillRect(0, 1, 7, 1);
  x.fillStyle = '#fff'; x.fillRect(1, 1, 5, 1);
  x.fillStyle = '#8a4a2a'; x.fillRect(7, 1, 2, 3);
  x.fillStyle = '#aa6a3a'; x.fillRect(7, 1, 2, 1);
  x.fillStyle = '#ffcc44'; x.fillRect(6, 0, 1, 1); x.fillRect(6, 4, 1, 1);
});

const orbSprite = makeSprite(10, 10, (x) => {
  const g = x.createRadialGradient(5, 5, 1, 5, 5, 5);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.3, '#ffaaff');
  g.addColorStop(0.6, '#ff66cc');
  g.addColorStop(1, 'rgba(180,40,160,0)');
  x.fillStyle = g; x.fillRect(0, 0, 10, 10);
});

// Bible (a small book)
const bibleSprite = makeSprite(10, 9, (x) => {
  x.fillStyle = '#8a4a2a'; x.fillRect(0, 1, 10, 7);
  x.fillStyle = '#aa6a3a'; x.fillRect(0, 1, 10, 1);
  x.fillStyle = '#fff'; x.fillRect(1, 2, 8, 5);
  x.fillStyle = '#ddd';
  x.fillRect(1, 3, 4, 1); x.fillRect(5, 3, 4, 1);
  x.fillRect(1, 5, 4, 1); x.fillRect(5, 5, 4, 1);
  x.fillStyle = '#8a4a2a'; x.fillRect(4, 1, 2, 7);
  x.fillStyle = '#ffcc44'; x.fillRect(4, 0, 2, 1);
  x.fillStyle = '#aa0000'; x.fillRect(4, 4, 2, 1);
});

// Holy water bottle
const holyWaterSprite = makeSprite(8, 11, (x) => {
  x.fillStyle = '#cc8844'; x.fillRect(3, 0, 2, 2);
  x.fillStyle = '#ddd'; x.fillRect(3, 2, 2, 1);
  x.fillStyle = '#6abfff'; x.fillRect(1, 3, 6, 7);
  x.fillStyle = '#aae0ff'; x.fillRect(1, 3, 6, 1);
  x.fillStyle = '#aae0ff'; x.fillRect(1, 3, 1, 7);
  x.fillStyle = '#fff'; x.fillRect(1, 3, 1, 2);
  x.fillStyle = '#3a8acc'; x.fillRect(1, 10, 6, 1);
  x.fillStyle = '#ffcc44'; x.fillRect(3, 5, 2, 1); x.fillRect(3, 7, 2, 1);
});

// Holy water puddle (small)
const puddleSprite = makeSprite(20, 12, (x) => {
  x.fillStyle = 'rgba(100, 180, 255, 0.4)';
  x.beginPath();
  x.ellipse(10, 6, 10, 5, 0, 0, Math.PI*2);
  x.fill();
  x.fillStyle = 'rgba(170, 220, 255, 0.6)';
  x.fillRect(8, 4, 4, 1);
  x.fillRect(4, 7, 3, 1);
  x.fillRect(13, 7, 3, 1);
});

// Whip (used for icon and as a sweep curve reference)
const whipSprite = makeSprite(14, 7, (x) => {
  x.fillStyle = '#5a2a18'; x.fillRect(0, 2, 3, 3);
  x.fillStyle = '#aa6a3a'; x.fillRect(0, 2, 3, 1);
  for (let i = 3; i < 14; i++) {
    const y = 3 + Math.sin((i - 3) * 0.5) * 1.5 | 0;
    x.fillStyle = i % 2 ? '#888' : '#bbb';
    x.fillRect(i, y, 1, 1);
    x.fillStyle = '#444';
    x.fillRect(i, y + 1, 1, 1);
  }
});

// Ice shard
const iceShardSprite = makeSprite(8, 10, (x) => {
  x.fillStyle = '#aaddff';
  x.fillRect(3, 0, 2, 10);
  x.fillRect(2, 2, 4, 6);
  x.fillRect(1, 3, 6, 4);
  x.fillStyle = '#66bbff';
  x.fillRect(4, 4, 1, 4);
  x.fillStyle = '#ddeeff';
  x.fillRect(3, 1, 1, 6);
  x.fillStyle = '#fff';
  x.fillRect(3, 1, 1, 2);
});

// Lightning bolt sprite
const lightningSprite = makeSprite(6, 12, (x) => {
  x.fillStyle = '#ffee66';
  x.fillRect(3, 0, 2, 4);
  x.fillRect(1, 3, 4, 2);
  x.fillRect(1, 5, 2, 3);
  x.fillRect(2, 7, 3, 1);
  x.fillRect(1, 8, 2, 4);
  x.fillStyle = '#fff';
  x.fillRect(3, 0, 1, 3);
  x.fillRect(2, 6, 1, 1);
});

// ===== TERRAIN TILES =====
const tile = makeSprite(32, 32, (x) => {
  x.fillStyle = '#1f2e1a'; x.fillRect(0, 0, 32, 32);
  for (let i = 0; i < 60; i++) {
    const c = ['#2a4022','#1a2a14','#34502a','#152010'][irand(0,3)];
    x.fillStyle = c;
    x.fillRect(irand(0,31), irand(0,31), 1, 1);
  }
  for (let i = 0; i < 8; i++) {
    x.fillStyle = '#3a5a2a';
    const gx = irand(2, 29), gy = irand(2, 28);
    x.fillRect(gx, gy, 1, 2);
    x.fillRect(gx + 1, gy + 1, 1, 1);
  }
  if (Math.random() < 0.4) {
    x.fillStyle = '#4a4a3a';
    x.fillRect(irand(5, 25), irand(5, 25), 2, 1);
  }
});
const tile2 = makeSprite(32, 32, (x) => {
  x.fillStyle = '#181f14'; x.fillRect(0, 0, 32, 32);
  for (let i = 0; i < 70; i++) {
    x.fillStyle = ['#202820','#13180e','#283022'][irand(0,2)];
    x.fillRect(irand(0,31), irand(0,31), 1, 1);
  }
  if (Math.random() < 0.3) {
    x.fillStyle = '#ccc8b0';
    const bx = irand(8, 22), by = irand(8, 22);
    x.fillRect(bx, by, 4, 1);
    x.fillRect(bx-1, by-1, 2, 3);
    x.fillRect(bx+3, by-1, 2, 3);
  }
});
const tile3 = makeSprite(32, 32, (x) => {
  x.fillStyle = '#2a2a2a'; x.fillRect(0, 0, 32, 32);
  for (let i = 0; i < 50; i++) {
    x.fillStyle = ['#3a3a3a','#1a1a1a','#4a4a4a'][irand(0,2)];
    x.fillRect(irand(0,31), irand(0,31), 1, 1);
  }
  for (let i = 0; i < 10; i++) {
    x.fillStyle = '#3a5a2a';
    x.fillRect(irand(0,30), irand(0,30), 2, 1);
  }
});

// ===== UPGRADE ICONS =====
function drawIcon(c, kind) {
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  x.clearRect(0, 0, c.width, c.height);
  const cx = c.width / 2, cy = c.height / 2;
  x.fillStyle = 'rgba(20, 8, 30, 0.5)';
  x.fillRect(0, 0, c.width, c.height);
  switch (kind) {
    case 'knife_dmg':
    case 'knife_rate':
    case 'knife_pierce':
    case 'knife_count':
      x.save();
      x.translate(cx, cy);
      x.rotate(-Math.PI / 4);
      x.scale(3, 3);
      x.drawImage(knifeSprite, -5, -2);
      x.restore();
      if (kind === 'knife_dmg') { x.fillStyle = '#ff3344'; x.fillRect(c.width-8, 4, 4, 1); x.fillRect(c.width-7, 3, 2, 3); }
      if (kind === 'knife_count') { x.fillStyle = '#fff'; x.fillRect(4, c.height-10, 1, 6); x.fillRect(1, c.height-7, 7, 1); }
      if (kind === 'knife_rate') { x.fillStyle = '#66ddff'; x.fillRect(c.width-6, 4, 2, 1); x.fillRect(c.width-8, 6, 2, 1); x.fillRect(c.width-10, 8, 2, 1); }
      if (kind === 'knife_pierce') { x.strokeStyle = '#ffcc44'; x.lineWidth = 1; x.strokeRect(c.width-10, 4, 6, 6); }
      break;
    case 'orb_unlock':
    case 'orb_more':
      for (let i = 0; i < (kind === 'orb_more' ? 3 : 2); i++) {
        const ang = (i / (kind === 'orb_more' ? 3 : 2)) * TAU + 0.3;
        x.save();
        x.translate(cx + Math.cos(ang) * 12, cy + Math.sin(ang) * 12);
        x.scale(2.5, 2.5);
        x.drawImage(orbSprite, -5, -5);
        x.restore();
      }
      x.fillStyle = '#5a2880'; x.fillRect(cx - 4, cy - 4, 8, 8);
      x.fillStyle = '#ff66cc'; x.fillRect(cx - 2, cy - 2, 4, 4);
      break;
    case 'aura_unlock':
    case 'aura_dmg':
    case 'area':
      x.strokeStyle = '#ff66cc'; x.lineWidth = 2;
      x.beginPath(); x.arc(cx, cy, 16, 0, TAU); x.stroke();
      x.strokeStyle = 'rgba(255, 102, 204, 0.5)'; x.lineWidth = 2;
      x.beginPath(); x.arc(cx, cy, 20, 0, TAU); x.stroke();
      x.fillStyle = '#5a2880'; x.fillRect(cx - 3, cy - 3, 6, 6);
      x.fillStyle = '#ff66cc'; x.fillRect(cx - 2, cy - 2, 4, 4);
      break;
    case 'speed':
      x.fillStyle = '#66ddff';
      x.beginPath();
      x.moveTo(cx + 4, cy - 14);
      x.lineTo(cx - 6, cy + 2);
      x.lineTo(cx, cy + 2);
      x.lineTo(cx - 4, cy + 14);
      x.lineTo(cx + 8, cy - 2);
      x.lineTo(cx + 2, cy - 2);
      x.closePath();
      x.fill();
      x.fillStyle = '#fff';
      x.fillRect(cx, cy - 6, 3, 4);
      break;
    case 'hp':
      x.save();
      x.translate(cx - 14, cy - 14);
      x.scale(3, 3);
      x.drawImage(heartSprite, 0, 0);
      x.restore();
      break;
    case 'regen':
      x.save();
      x.translate(cx - 10, cy - 14);
      x.scale(2.2, 2.2);
      x.drawImage(heartSprite, 0, 0);
      x.restore();
      x.fillStyle = '#66ff66';
      x.fillRect(cx + 6, cy - 4, 2, 8);
      x.fillRect(cx + 3, cy - 1, 8, 2);
      break;
    case 'magnet':
      x.save();
      x.translate(cx - 15, cy - 15);
      x.scale(3, 3);
      x.drawImage(magnetSprite, 0, 0);
      x.restore();
      break;
    case 'lifesteal':
      // Heart with a red drop pulled out of an enemy.
      x.save();
      x.translate(cx - 16, cy - 14);
      x.scale(3, 3);
      x.drawImage(heartSprite, 0, 0);
      x.restore();
      x.fillStyle = '#000';
      x.fillRect(cx + 8, cy + 6, 4, 8);
      x.fillStyle = '#cc1133';
      x.beginPath();
      x.moveTo(cx + 10, cy + 4);
      x.lineTo(cx + 6, cy + 14);
      x.lineTo(cx + 14, cy + 14);
      x.closePath();
      x.fill();
      x.fillStyle = '#ff5577';
      x.fillRect(cx + 9, cy + 8, 2, 4);
      x.fillStyle = '#fff';
      x.fillRect(cx + 9, cy + 9, 1, 1);
      break;
    case 'xp_boost':
      // Big gem stack with an up arrow.
      x.save();
      x.translate(cx - 11, cy - 6);
      x.scale(2.2, 2.2);
      x.drawImage(gemMed, 0, 0);
      x.restore();
      x.save();
      x.translate(cx - 5, cy - 16);
      x.scale(1.6, 1.6);
      x.drawImage(gemSmall, 0, 0);
      x.restore();
      // Up arrow on the right
      x.fillStyle = '#aaffaa';
      x.fillRect(cx + 8, cy - 8, 3, 14);
      x.fillRect(cx + 5, cy - 5, 9, 2);
      x.fillRect(cx + 6, cy - 7, 7, 2);
      x.fillStyle = '#fff';
      x.fillRect(cx + 9, cy - 7, 1, 4);
      break;
    case 'dmg':
      x.fillStyle = '#fff';
      x.fillRect(cx - 10, cy - 12, 20, 16);
      x.fillStyle = '#000';
      x.fillRect(cx - 7, cy - 6, 5, 5);
      x.fillRect(cx + 2, cy - 6, 5, 5);
      x.fillStyle = '#ff3344';
      x.fillRect(cx - 6, cy - 5, 3, 3);
      x.fillRect(cx + 3, cy - 5, 3, 3);
      x.fillStyle = '#000';
      x.fillRect(cx - 2, cy + 2, 1, 3);
      x.fillRect(cx, cy + 2, 1, 3);
      x.fillRect(cx + 2, cy + 2, 1, 3);
      break;
    case 'super_blade':
      x.save();
      x.translate(cx, cy);
      for (let i = 0; i < 4; i++) {
        x.save();
        x.rotate((i / 4) * TAU);
        x.scale(2.5, 2.5);
        x.drawImage(knifeSprite, -2, -10);
        x.restore();
      }
      x.restore();
      x.fillStyle = '#ffee88';
      x.fillRect(cx - 2, cy - 2, 4, 4);
      x.fillStyle = '#fff';
      x.fillRect(cx - 1, cy - 1, 2, 2);
      break;
    case 'super_orb':
      for (let i = 0; i < 4; i++) {
        const ang = (i / 4) * TAU;
        const ox = cx + Math.cos(ang) * 13;
        const oy = cy + Math.sin(ang) * 13;
        x.save(); x.translate(ox, oy); x.scale(2, 2);
        x.drawImage(orbSprite, -5, -5);
        x.restore();
      }
      x.fillStyle = '#000';
      x.beginPath(); x.arc(cx, cy, 6, 0, TAU); x.fill();
      x.fillStyle = '#5a2880';
      x.beginPath(); x.arc(cx, cy, 4, 0, TAU); x.fill();
      x.fillStyle = '#ffcc44';
      x.beginPath(); x.arc(cx, cy, 2, 0, TAU); x.fill();
      break;
    case 'super_aura':
      for (let i = 3; i >= 1; i--) {
        x.strokeStyle = `rgba(255, ${100 + i * 50}, ${i * 30}, 0.8)`;
        x.lineWidth = 2;
        x.beginPath(); x.arc(cx, cy, i * 6, 0, TAU); x.stroke();
      }
      x.fillStyle = '#ff3344';
      x.fillRect(cx - 3, cy - 3, 6, 6);
      x.fillStyle = '#ffcc44';
      x.fillRect(cx - 2, cy - 2, 4, 4);
      x.fillStyle = '#fff';
      x.fillRect(cx - 1, cy - 1, 2, 2);
      break;

    // ----- BIBLE -----
    case 'bible_unlock':
    case 'bible_count':
    case 'bible_dmg':
    case 'super_bible':
      {
        const isSuper = kind === 'super_bible';
        const count = isSuper ? 4 : (kind === 'bible_count' ? 3 : 2);
        for (let i = 0; i < count; i++) {
          const ang = (i / count) * TAU + 0.4;
          const ox = cx + Math.cos(ang) * 13;
          const oy = cy + Math.sin(ang) * 13;
          x.save(); x.translate(ox, oy); x.scale(1.6, 1.6);
          x.drawImage(bibleSprite, -5, -4);
          x.restore();
        }
        x.fillStyle = '#ffcc44';
        x.beginPath(); x.arc(cx, cy, 4, 0, TAU); x.fill();
        x.fillStyle = '#fff';
        x.beginPath(); x.arc(cx, cy, 2, 0, TAU); x.fill();
        if (kind === 'bible_dmg') {
          x.fillStyle = '#ff3344';
          x.fillRect(c.width - 8, 4, 4, 1); x.fillRect(c.width - 7, 3, 2, 3);
        }
      }
      break;

    // ----- HOLY WATER -----
    case 'holy_unlock':
    case 'holy_dmg':
    case 'holy_count':
    case 'holy_duration':
      x.save();
      x.translate(cx, cy);
      x.scale(2.2, 2.2);
      x.drawImage(holyWaterSprite, -4, -5);
      x.restore();
      // Splash drops
      x.fillStyle = '#aae0ff';
      x.fillRect(cx - 14, cy + 10, 2, 2);
      x.fillRect(cx + 12, cy + 8, 2, 2);
      x.fillRect(cx - 6, cy + 14, 1, 1);
      x.fillRect(cx + 4, cy + 14, 1, 1);
      if (kind === 'holy_count') { x.fillStyle = '#fff'; x.fillRect(c.width - 8, 4, 1, 5); x.fillRect(c.width - 10, 5, 5, 1); }
      if (kind === 'holy_dmg') { x.fillStyle = '#ff3344'; x.fillRect(c.width - 8, 4, 4, 1); x.fillRect(c.width - 7, 3, 2, 3); }
      if (kind === 'holy_duration') { x.strokeStyle = '#ffcc44'; x.lineWidth = 1; x.beginPath(); x.arc(c.width - 8, 7, 4, -1.2, 1.2); x.stroke(); }
      break;

    // ----- WHIP -----
    case 'whip_unlock':
    case 'whip_dmg':
    case 'whip_size':
    case 'whip_rate':
      // Arc curve
      x.strokeStyle = '#ddd';
      x.lineWidth = 2;
      x.beginPath();
      x.arc(cx - 8, cy, 18, -0.7, 0.7);
      x.stroke();
      // Handle
      x.fillStyle = '#5a2a18';
      x.fillRect(cx - 12, cy - 3, 4, 6);
      x.fillStyle = '#aa6a3a';
      x.fillRect(cx - 12, cy - 3, 4, 2);
      // Spark at end
      x.fillStyle = '#ffcc44';
      x.fillRect(cx + 10, cy - 2, 4, 4);
      x.fillStyle = '#fff';
      x.fillRect(cx + 11, cy - 1, 2, 2);
      if (kind === 'whip_dmg') { x.fillStyle = '#ff3344'; x.fillRect(c.width - 8, 4, 4, 1); x.fillRect(c.width - 7, 3, 2, 3); }
      if (kind === 'whip_size') { x.fillStyle = '#fff'; x.fillRect(c.width - 8, 8, 1, 4); x.fillRect(c.width - 10, 10, 5, 1); }
      if (kind === 'whip_rate') { x.fillStyle = '#66ddff'; x.fillRect(c.width-6, 4, 2, 1); x.fillRect(c.width-8, 6, 2, 1); x.fillRect(c.width-10, 8, 2, 1); }
      break;

    // ----- ICE SHARD -----
    case 'ice_unlock':
    case 'ice_dmg':
    case 'ice_slow':
    case 'ice_rate':
      x.save();
      x.translate(cx, cy);
      x.scale(3, 3);
      x.drawImage(iceShardSprite, -4, -5);
      x.restore();
      // Frost particles
      x.fillStyle = '#aaddff';
      x.fillRect(cx - 16, cy - 10, 1, 1);
      x.fillRect(cx + 14, cy + 8, 1, 1);
      x.fillRect(cx - 12, cy + 12, 1, 1);
      x.fillRect(cx + 12, cy - 12, 1, 1);
      if (kind === 'ice_dmg') { x.fillStyle = '#ff3344'; x.fillRect(c.width - 8, 4, 4, 1); x.fillRect(c.width - 7, 3, 2, 3); }
      if (kind === 'ice_slow') {
        x.fillStyle = '#66ddff';
        x.fillRect(c.width - 10, 4, 6, 1);
        x.fillRect(c.width - 9, 6, 4, 1);
        x.fillRect(c.width - 8, 8, 2, 1);
      }
      if (kind === 'ice_rate') { x.fillStyle = '#66ddff'; x.fillRect(c.width-6, 4, 2, 1); x.fillRect(c.width-8, 6, 2, 1); x.fillRect(c.width-10, 8, 2, 1); }
      break;

    // ----- SUPER icons for new weapons -----
    case 'super_holy':
      // Triple bottle radial
      for (let i = 0; i < 3; i++) {
        const ang = (i / 3) * TAU - Math.PI/2;
        x.save();
        x.translate(cx + Math.cos(ang) * 10, cy + Math.sin(ang) * 10);
        x.scale(1.6, 1.6);
        x.drawImage(holyWaterSprite, -4, -5);
        x.restore();
      }
      x.fillStyle = '#ffcc44';
      x.beginPath(); x.arc(cx, cy, 5, 0, TAU); x.fill();
      x.fillStyle = '#fff';
      x.beginPath(); x.arc(cx, cy, 2, 0, TAU); x.fill();
      break;
    case 'super_whip':
      // Full circle whip swirl
      x.strokeStyle = '#ffeeaa';
      x.lineWidth = 3;
      x.beginPath(); x.arc(cx, cy, 18, 0, TAU); x.stroke();
      x.strokeStyle = '#fff';
      x.lineWidth = 1;
      x.beginPath(); x.arc(cx, cy, 14, 0, TAU); x.stroke();
      x.fillStyle = '#5a2a18';
      x.fillRect(cx - 3, cy - 3, 6, 6);
      x.fillStyle = '#ffcc44';
      x.fillRect(cx - 2, cy - 2, 4, 4);
      break;
    case 'super_ice':
      // Triple shard burst
      for (let i = 0; i < 3; i++) {
        const ang = (i / 3) * TAU - Math.PI/2;
        x.save();
        x.translate(cx + Math.cos(ang) * 11, cy + Math.sin(ang) * 11);
        x.rotate(ang + Math.PI/2);
        x.scale(2.4, 2.4);
        x.drawImage(iceShardSprite, -4, -5);
        x.restore();
      }
      x.fillStyle = '#ffee88';
      x.beginPath(); x.arc(cx, cy, 4, 0, TAU); x.fill();
      x.fillStyle = '#fff';
      x.beginPath(); x.arc(cx, cy, 2, 0, TAU); x.fill();
      break;
    case 'super_lightning':
      // Spider lightning radial
      x.strokeStyle = '#ffee66';
      x.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * TAU;
        x.beginPath();
        x.moveTo(cx, cy);
        x.lineTo(cx + Math.cos(ang) * 18, cy + Math.sin(ang) * 18);
        x.stroke();
      }
      x.fillStyle = '#fff';
      x.beginPath(); x.arc(cx, cy, 5, 0, TAU); x.fill();
      x.fillStyle = '#ffee66';
      x.beginPath(); x.arc(cx, cy, 3, 0, TAU); x.fill();
      break;

    // ----- LIGHTNING -----
    case 'lightning_unlock':
    case 'lightning_dmg':
    case 'lightning_chain':
    case 'lightning_rate':
      x.save();
      x.translate(cx, cy);
      x.scale(2.5, 2.5);
      x.drawImage(lightningSprite, -3, -6);
      x.restore();
      // Glow particles
      x.fillStyle = '#ffee66';
      x.fillRect(cx - 14, cy, 2, 1);
      x.fillRect(cx + 12, cy - 4, 2, 1);
      x.fillRect(cx - 10, cy + 12, 1, 1);
      if (kind === 'lightning_dmg') { x.fillStyle = '#ff3344'; x.fillRect(c.width - 8, 4, 4, 1); x.fillRect(c.width - 7, 3, 2, 3); }
      if (kind === 'lightning_chain') {
        x.strokeStyle = '#fff';
        x.lineWidth = 1;
        x.beginPath();
        x.moveTo(c.width - 12, 5);
        x.lineTo(c.width - 10, 8);
        x.lineTo(c.width - 6, 6);
        x.lineTo(c.width - 4, 10);
        x.stroke();
      }
      if (kind === 'lightning_rate') { x.fillStyle = '#66ddff'; x.fillRect(c.width-6, 4, 2, 1); x.fillRect(c.width-8, 6, 2, 1); x.fillRect(c.width-10, 8, 2, 1); }
      break;

    // ----- SHARDS -----
    case 'shards_unlock':
    case 'shards_dmg':
    case 'shards_count':
    case 'shards_rate':
      {
        const n = kind === 'shards_count' ? 4 : 3;
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * TAU - Math.PI / 2;
          const ox = cx + Math.cos(ang) * 13;
          const oy = cy + Math.sin(ang) * 13;
          x.save(); x.translate(ox, oy); x.rotate(ang + Math.PI / 2); x.scale(2, 2);
          x.drawImage(iceShardSprite, -4, -5);
          x.restore();
        }
        x.fillStyle = '#fff';
        x.beginPath(); x.arc(cx, cy, 4, 0, TAU); x.fill();
        x.fillStyle = '#aaeeff';
        x.beginPath(); x.arc(cx, cy, 2, 0, TAU); x.fill();
        if (kind === 'shards_dmg') { x.fillStyle = '#ff3344'; x.fillRect(c.width - 8, 4, 4, 1); x.fillRect(c.width - 7, 3, 2, 3); }
        if (kind === 'shards_rate') { x.fillStyle = '#66ddff'; x.fillRect(c.width - 6, 4, 2, 1); x.fillRect(c.width - 8, 6, 2, 1); x.fillRect(c.width - 10, 8, 2, 1); }
      }
      break;
    case 'super_shards':
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * TAU;
        const ox = cx + Math.cos(ang) * 14;
        const oy = cy + Math.sin(ang) * 14;
        x.save(); x.translate(ox, oy); x.rotate(ang + Math.PI / 2); x.scale(2.4, 2.4);
        x.drawImage(iceShardSprite, -4, -5);
        x.restore();
      }
      x.fillStyle = '#fff';
      x.beginPath(); x.arc(cx, cy, 5, 0, TAU); x.fill();
      x.fillStyle = '#ffee88';
      x.beginPath(); x.arc(cx, cy, 3, 0, TAU); x.fill();
      break;

    // ----- HOLE -----
    case 'hole_unlock':
    case 'hole_dmg':
    case 'hole_radius':
    case 'hole_rate':
      for (let rr = 18; rr > 4; rr -= 4) {
        x.strokeStyle = `rgba(170, 68, 221, ${0.2 + (18 - rr) * 0.05})`;
        x.lineWidth = 2;
        x.beginPath(); x.arc(cx, cy, rr, 0, TAU); x.stroke();
      }
      x.fillStyle = '#000';
      x.beginPath(); x.arc(cx, cy, 5, 0, TAU); x.fill();
      x.fillStyle = '#5a2880';
      x.beginPath(); x.arc(cx, cy, 3, 0, TAU); x.fill();
      if (kind === 'hole_dmg') { x.fillStyle = '#ff3344'; x.fillRect(c.width - 8, 4, 4, 1); x.fillRect(c.width - 7, 3, 2, 3); }
      if (kind === 'hole_radius') { x.fillStyle = '#fff'; x.fillRect(c.width - 8, 8, 1, 4); x.fillRect(c.width - 10, 10, 5, 1); }
      if (kind === 'hole_rate') { x.fillStyle = '#66ddff'; x.fillRect(c.width - 6, 4, 2, 1); x.fillRect(c.width - 8, 6, 2, 1); x.fillRect(c.width - 10, 8, 2, 1); }
      break;
    case 'super_hole':
      for (let rr = 22; rr > 4; rr -= 3) {
        x.strokeStyle = `rgba(170, 68, 221, ${0.15 + (22 - rr) * 0.05})`;
        x.lineWidth = 2;
        x.beginPath(); x.arc(cx, cy, rr, 0, TAU); x.stroke();
      }
      x.fillStyle = '#000';
      x.beginPath(); x.arc(cx, cy, 6, 0, TAU); x.fill();
      x.fillStyle = '#ffcc44';
      x.beginPath(); x.arc(cx, cy, 3, 0, TAU); x.fill();
      x.fillStyle = '#fff';
      x.fillRect(cx - 1, cy - 1, 2, 2);
      break;
  }
}
