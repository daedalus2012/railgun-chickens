import * as THREE from 'three';
import { World, terrainHeight, raycastTerrain } from './world.js';
import { Turret } from './turret.js';
import { ChickenManager } from './chickens.js';
import { Effects } from './effects.js';
import { GameAudio } from './audio.js';
import { FINAL_WAVE, saveGame, loadGame, clearSave } from './save.js';
import {
  waveComposition, waveScaling, waveIntel, getAct,
  milestoneBonus, waveClearReward,
} from './progression.js';

// ---------------- Renderer / scene ----------------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(64, window.innerWidth / window.innerHeight, 0.1, 900);

const world = new World(scene, renderer);
const effects = new Effects(scene);
const turret = new Turret(scene);
const chickens = new ChickenManager(scene, effects);
const audio = new GameAudio();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------- Upgrades ----------------
// cat: offense | defense | utility — unlock gates force build variety across 20 waves
const UPGRADES = {
  damage:    { name: 'DAMAGE',         cat: 'offense',  desc: '+32% beam damage per rank', base: 55,  mult: 1.55, max: 10, unlock: 1 },
  fireRate:  { name: 'FIRE RATE',      cat: 'offense',  desc: 'Faster shots between reloads', base: 48,  mult: 1.52, max: 10, unlock: 1 },
  reload:    { name: 'RELOAD SPEED',   cat: 'utility',  desc: 'Shorter magazine swap time', base: 42,  mult: 1.5,  max: 8,  unlock: 1 },
  piercing:  { name: 'PIERCING',       cat: 'offense',  desc: 'Beam pierces +1 target', base: 85,  mult: 1.85, max: 6,  unlock: 2 },
  beamWidth: { name: 'BEAM WIDTH',     cat: 'offense',  desc: 'Wider beam — easier to hit swarms', base: 65,  mult: 1.65, max: 8,  unlock: 1 },
  explosion: { name: 'IMPACT BLAST',   cat: 'offense',  desc: 'Shots explode on impact', base: 100, mult: 1.75, max: 7,  unlock: 4 },
  chain:     { name: 'CHAIN ARC',      cat: 'offense',  desc: 'Kills chain lightning to nearby foes', base: 95,  mult: 1.8,  max: 6,  unlock: 3 },
  magazine:  { name: 'OVERCHARGE MAG', cat: 'utility',  desc: '+1 round per magazine', base: 52,  mult: 1.6,  max: 7,  unlock: 2 },
  cryo:      { name: 'CRYO BEAM',      cat: 'utility',  desc: 'Slow chickens on hit — stacks', base: 75,  mult: 1.65, max: 7,  unlock: 6 },
  fortify:   { name: 'BUNKER PLATING', cat: 'defense',  desc: '−12% breach damage per rank', base: 70,  mult: 1.7,  max: 6,  unlock: 5 },
  salvage:   { name: 'SALVAGE CREW',   cat: 'utility',  desc: '+10% credits from kills', base: 60,  mult: 1.65, max: 6,  unlock: 7 },
  nanites:   { name: 'FIELD NANITES',  cat: 'defense',  desc: '+6 base repair between waves', base: 65,  mult: 1.7,  max: 6,  unlock: 8 },
};

const state = {
  phase: 'menu', // menu | playing | shop | paused | gameover | victory
  wave: 0,
  score: 0,
  money: 0,
  health: 100,
  maxHealth: 100,
  levels: { damage: 0, fireRate: 0, reload: 0, piercing: 0, beamWidth: 0, explosion: 0, chain: 0, magazine: 0, cryo: 0, fortify: 0, salvage: 0, nanites: 0 },
  // weapon runtime
  ammo: 6,
  magSize: 6,
  cooldown: 0,
  reloading: 0,
  // wave runtime
  spawnQueue: [],
  spawnTimer: 0,
  spawnInterval: 1,
  waveScale: null,
  waveClearTimer: 0,
};

const derived = {
  get damage() { return 34 * Math.pow(1.32, state.levels.damage); },
  get fireDelay() { return 0.5 * Math.pow(0.86, state.levels.fireRate); },
  get reloadTime() { return 1.7 * Math.pow(0.85, state.levels.reload); },
  get pierce() { return 1 + state.levels.piercing; },
  get beamRadius() { return 0.09 + state.levels.beamWidth * 0.075; },
  get blastRadius() { return state.levels.explosion > 0 ? 1.6 + state.levels.explosion * 0.9 : 0; },
  get magSize() { return 6 + state.levels.magazine; },
  get chainJumps() { return state.levels.chain; },
  get chainRange() { return 5 + state.levels.chain * 1.8; },
  get chainDamage() { return derived.damage * (0.52 + state.levels.chain * 0.06); },
  get slowAmount() { return state.levels.cryo * 0.11; },
  get slowRadius() { return 2 + state.levels.cryo * 0.55; },
  get breachReduction() { return state.levels.fortify * 0.12; },
  get creditBonus() { return 1 + state.levels.salvage * 0.1; },
  get waveRepair() { return 8 + state.levels.nanites * 6; },
};

function upgradeCost(key) {
  const u = UPGRADES[key];
  const waveTax = 1 + state.wave * 0.025;
  return Math.round(u.base * Math.pow(u.mult, state.levels[key]) * waveTax);
}

function syncMagSize() {
  state.magSize = derived.magSize;
  if (state.ammo > state.magSize) state.ammo = state.magSize;
  updateAmmoUI();
}

function isUpgradeUnlocked(key) {
  return state.wave >= (UPGRADES[key].unlock || 1);
}

// ---------------- Input / aiming ----------------
let aimYaw = 0, aimPitch = 0.05;
let mouseDown = false;
let resumePending = false;   // waiting to re-acquire pointer lock after unpause / start
let pausingLock = false;     // we intentionally released lock (pause/shop/etc.)
let lockGraceUntil = 0;      // ignore spurious unlock right after acquiring lock
const LOCK_GRACE_MS = 450;
const AIM_LIMIT_YAW = 1.15, AIM_MIN_PITCH = -0.3, AIM_MAX_PITCH = 0.55;

const engageEl = document.getElementById('engage');
const waveProgressFill = document.getElementById('wave-progress-fill');

function isLocked() { return document.pointerLockElement === canvas; }

function updatePointerState() {
  document.body.classList.toggle('pointer-locked', isLocked());
}

function requestPlayLock() {
  if (isLocked()) return Promise.resolve();
  return canvas.requestPointerLock().catch(() => {
    engageEl.classList.remove('hidden');
  });
}

function onLockAcquired() {
  engageEl.classList.add('hidden');
  resumePending = false;
  pausingLock = false;
  lockGraceUntil = performance.now() + LOCK_GRACE_MS;
  updatePointerState();
  if (state.phase === 'awaiting-lock') state.phase = 'playing';
  persistNow();
}

function onLockLost() {
  updatePointerState();
  if (pausingLock) return;
  // Ignore unlock caused by the same click that requested lock (Play / Resume buttons)
  if (performance.now() < lockGraceUntil) return;
  // Still waiting for the player to click the battlefield — don't open pause menu
  if (resumePending) {
    engageEl.classList.remove('hidden');
    return;
  }
  if (state.phase === 'playing') pauseGame();
}

document.addEventListener('mousemove', (e) => {
  if (state.phase !== 'playing' || !isLocked()) return;
  aimYaw -= e.movementX * 0.0016;
  aimPitch += e.movementY * 0.0016;
  aimYaw = THREE.MathUtils.clamp(aimYaw, -AIM_LIMIT_YAW, AIM_LIMIT_YAW);
  aimPitch = THREE.MathUtils.clamp(aimPitch, AIM_MIN_PITCH, AIM_MAX_PITCH);
});
document.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  mouseDown = true;
  // Click battlefield to acquire pointer lock after start / resume
  if (resumePending && state.phase === 'playing' && !isLocked()) {
    requestPlayLock();
  }
});
canvas.addEventListener('click', () => {
  if (resumePending && state.phase === 'playing' && !isLocked()) {
    requestPlayLock();
  }
});
document.addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; });
document.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR' && state.phase === 'playing') startReload();
  if (e.code === 'Escape') {
    if (state.phase === 'playing') pauseGame();
    else if (state.phase === 'paused') resumeFromPause();
  }
});
document.addEventListener('pointerlockchange', () => {
  if (isLocked()) onLockAcquired();
  else onLockLost();
});
document.addEventListener('pointerlockerror', () => {
  if (resumePending) engageEl.classList.remove('hidden');
});

// Persist progress when the tab sleeps, the laptop lid closes, or the page reloads
let saveTimer = 0;
let tabHidden = document.hidden;
function persistNow() { saveGame(state, chickens, aimYaw, aimPitch); }
function persistDebounced() {
  persistNow();
  saveTimer = 2;
}

document.addEventListener('visibilitychange', () => {
  tabHidden = document.hidden;
  if (document.hidden) {
    if (state.phase === 'playing') pauseGame(true);
    else persistNow();
  }
});
window.addEventListener('pagehide', persistNow);
window.addEventListener('beforeunload', persistNow);

// ---------------- Camera (over-shoulder + shake) ----------------
let shakeAmp = 0;
const shakeOffset = new THREE.Vector3();
const _camTarget = new THREE.Vector3();
const _lookDir = new THREE.Vector3();
const _lookAt = new THREE.Vector3();
const _beamEnd = new THREE.Vector3();

function addShake(amount) { shakeAmp = Math.min(1.2, shakeAmp + amount); }

function updateCamera(dt, t) {
  const baseX = Math.sin(aimYaw) * -2.2;
  _camTarget.set(baseX, 4.6 + aimPitch * 2.2, 19.5);
  camera.position.lerp(_camTarget, 1 - Math.pow(0.001, dt));

  shakeAmp = Math.max(0, shakeAmp - dt * 3.2);
  const s = shakeAmp * shakeAmp;
  shakeOffset.set(
    (Math.sin(t * 91) + Math.sin(t * 47)) * 0.5 * s * 0.35,
    (Math.sin(t * 83) + Math.sin(t * 59)) * 0.5 * s * 0.3,
    0
  );
  camera.position.add(shakeOffset);

  _lookDir.set(
    Math.sin(-aimYaw) * Math.cos(aimPitch),
    -Math.sin(aimPitch) + 0.12,
    -Math.cos(aimYaw) * Math.cos(aimPitch)
  );
  _lookAt.copy(camera.position).addScaledVector(_lookDir, 60);
  camera.lookAt(_lookAt);
}

// ---------------- Firing ----------------
const _muzzle = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _hitPos = new THREE.Vector3();
const _proj = new THREE.Vector3();
const _dmgOpts = { applySlow: false, slowAmount: 0 };

function tryFire() {
  if (state.cooldown > 0 || state.reloading > 0 || state.ammo <= 0) {
    if (state.ammo <= 0 && state.reloading <= 0) startReload();
    return;
  }
  state.cooldown = derived.fireDelay;
  state.ammo--;
  updateAmmoUI();

  turret.fire();
  audio.railgunShot();
  addShake(0.45);
  crosshairKick();

  turret.getMuzzleWorld(_muzzle);
  camera.getWorldDirection(_dir);
  const origin = camera.position;

  effects.muzzle(_muzzle.x, _muzzle.y, _muzzle.z, _dir);

  const hits = chickens.raycast(origin, _dir, derived.beamRadius + 0.15);
  const maxPierce = derived.pierce;
  let lastT = raycastTerrain(origin, _dir) ?? 320;
  let hitCount = 0;
  const slowAmt = derived.slowAmount;
  _dmgOpts.applySlow = slowAmt > 0;
  _dmgOpts.slowAmount = slowAmt;

  for (const h of hits) {
    if (h.t > lastT) break;
    if (hitCount >= maxPierce) break;
    hitCount++;
    const c = h.chicken;
    _hitPos.copy(origin).addScaledVector(_dir, h.t);
    effects.impact(_hitPos.x, _hitPos.y, _hitPos.z, _dir, c.def.boss ? 2 : 1);
    const heavy = c.def.boss || c.type === 'tank';
    spawnDamageNumber(_hitPos, Math.round(derived.damage), heavy);
    const killed = chickens.damage(c, derived.damage, game, _dmgOpts);
    audio.hit(killed && heavy);
    if (slowAmt > 0) chickens.applySlowPulse(c.x, c.z, derived.slowRadius, slowAmt * 0.55);
    if (killed && derived.chainJumps > 0) {
      chickens.chainFrom(c, derived.chainRange, derived.chainDamage, derived.chainJumps, game);
    }
    if (derived.blastRadius > 0) {
      chickens.areaDamage(c.x, c.z, derived.blastRadius, derived.damage * 0.45, game);
      effects.explosion(c.x, c.y + 0.5, c.z, 0.6 + derived.blastRadius * 0.14);
    }
    crosshairHit();
  }

  // beam endpoint: last pierced target or terrain/sky (drawn from the muzzle for looks)
  const endT = hitCount > 0 && hitCount >= maxPierce ? hits[Math.min(hitCount, hits.length) - 1].t : lastT;
  _beamEnd.copy(origin).addScaledVector(_dir, endT);
  effects.beam(_muzzle, _beamEnd, 0.06 + derived.beamRadius * 0.5);
  if (hitCount === 0 && lastT < 315) {
    effects.impact(_beamEnd.x, _beamEnd.y, _beamEnd.z, _dir, 0.7);
  }

  if (state.ammo <= 0) startReload();
  persistDebounced();
}

function startReload() {
  if (state.reloading > 0 || state.ammo === derived.magSize) return;
  state.reloading = derived.reloadTime;
  audio.reload();
  document.getElementById('reload-text').classList.add('show');
}

// ---------------- Damage numbers (DOM, pooled) ----------------
const dmgPool = [];
function spawnDamageNumber(worldPos, amount, crit) {
  _proj.copy(worldPos).project(camera);
  if (_proj.z > 1) return;
  const el = dmgPool.pop() || document.createElement('div');
  el.className = crit ? 'dmg-num crit' : 'dmg-num';
  el.textContent = amount;
  el.style.left = `${(_proj.x * 0.5 + 0.5) * window.innerWidth + (Math.random() - 0.5) * 30}px`;
  el.style.top = `${(-_proj.y * 0.5 + 0.5) * window.innerHeight - 10}px`;
  document.body.appendChild(el);
  setTimeout(() => { el.remove(); if (dmgPool.length < 40) dmgPool.push(el); }, 700);
}

// ---------------- Crosshair feedback ----------------
const crosshairEl = document.getElementById('crosshair');
function crosshairHit() {
  crosshairEl.classList.add('hit');
  setTimeout(() => crosshairEl.classList.remove('hit'), 90);
}
function crosshairKick() {
  crosshairEl.classList.add('expand');
  setTimeout(() => crosshairEl.classList.remove('expand'), 70);
}

// ---------------- HUD ----------------
const waveNumEl = document.getElementById('wave-num');
const scoreEl = document.getElementById('score-num');
const moneyEl = document.getElementById('money-num');
const healthBar = document.getElementById('health-bar');
const ammoWrap = document.getElementById('ammo-wrap');
const banner = document.getElementById('banner');
const damageFlash = document.getElementById('damage-flash');

function updateHUD() {
  waveNumEl.textContent = state.wave;
  scoreEl.textContent = state.score;
  moneyEl.textContent = state.money;
  const hp = Math.max(0, state.health) / state.maxHealth;
  healthBar.style.width = `${hp * 100}%`;
  healthBar.classList.toggle('low', hp < 0.35);
  if (waveProgressFill) {
    waveProgressFill.style.width = `${Math.min(100, (state.wave / FINAL_WAVE) * 100)}%`;
  }
}

function updateAmmoUI() {
  while (ammoWrap.children.length < state.magSize) {
    const cell = document.createElement('div');
    cell.className = 'ammo-cell';
    ammoWrap.appendChild(cell);
  }
  while (ammoWrap.children.length > state.magSize) ammoWrap.lastChild.remove();
  [...ammoWrap.children].forEach((cell, i) => cell.classList.toggle('empty', i >= state.ammo));
}

let bannerTimer = null;
function showBanner(text, dur = 1800) {
  banner.textContent = text;
  banner.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => banner.classList.remove('show'), dur);
}

// ---------------- Game events ----------------
const game = {
  onKill(c) {
    const creditMult = (state.waveScale?.creditMult || 1) * derived.creditBonus;
    state.score += c.def.score;
    state.money += Math.round(c.def.money * creditMult);
    if (c.def.boss) { addShake(0.7); audio.explosion(true); }
    else if (c.def.explodes) audio.explosion(false);
    if (Math.random() < 0.3) audio.cluck(1 / c.scale);
    updateHUD();
    persistDebounced();
  },
  onChainHit(c) {
    audio.hit(false);
    if (Math.random() < 0.4) spawnDamageNumber(
      _hitPos.set(c.x, c.y + 0.7 * c.scale, c.z),
      Math.round(derived.chainDamage), false
    );
  },
  onExplosionKill(c) {
    const r = c.def.boss ? 6 : 3.2;
    chickens.areaDamage(c.x, c.z, r, c.def.boss ? 120 : 45, game);
  },
  onBreach(c) {
    const dmg = Math.max(1, Math.round(c.def.dmg * (1 - derived.breachReduction)));
    state.health -= dmg;
    addShake(0.5);
    audio.hit(true);
    audio.cluck(1.4);
    damageFlash.classList.add('show');
    setTimeout(() => damageFlash.classList.remove('show'), 120);
    updateHUD();
    if (state.health <= 0) gameOver();
  },
};

// ---------------- Wave flow ----------------
function startWave(n) {
  state.wave = n;
  state.phase = 'playing';
  state.waveScale = waveScaling(n);
  state.spawnQueue = waveComposition(n);
  state.spawnInterval = state.waveScale.interval;
  state.spawnTimer = 1.2;
  state.ammo = derived.magSize;
  state.reloading = 0;
  state.cooldown = 0;
  syncMagSize();
  pausingLock = false;
  resumePending = true;
  engageEl.classList.remove('hidden');
  audio.setIntensity(Math.min(1, n / FINAL_WAVE));
  audio.waveStart();
  updateHUD();
  updateAmmoUI();
  document.getElementById('reload-text').classList.remove('show');
  const intel = waveIntel(n);
  const label = n >= FINAL_WAVE ? `FINAL WAVE ${n}` : intel.isBossWave ? `WAVE ${n} — BOSS ASSAULT` : `WAVE ${n}`;
  showBanner(`${getAct(n).name} · ${label}`);
  // Don't request lock here — wait for a click on the canvas (avoids instant pause from button click)
  persistNow();
}

function waveTick(dt) {
  if (state.spawnQueue.length > 0) {
    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0) {
      state.spawnTimer = state.spawnInterval * (0.7 + Math.random() * 0.6);
      const type = state.spawnQueue.pop();
      chickens.spawn(type, state.waveScale);
      if (Math.random() < 0.25) audio.cluck();
    }
  } else if (chickens.aliveCount === 0) {
    state.waveClearTimer += dt;
    if (state.waveClearTimer > 0.8) {
      state.waveClearTimer = 0;
      openShop();
    }
    return;
  }
  state.waveClearTimer = 0;
}

// ---------------- Shop ----------------
const shopEl = document.getElementById('shop');
const upgradeGrid = document.getElementById('upgrade-grid');

function openShop() {
  const reward = waveClearReward(state.wave);
  state.money += reward.credits;
  state.health = Math.min(state.maxHealth, state.health + reward.repair + derived.waveRepair);
  updateHUD();

  const milestone = milestoneBonus(state.wave);
  if (milestone) {
    state.money += milestone.credits;
    state.health = Math.min(state.maxHealth, state.health + milestone.repair);
    updateHUD();
    setTimeout(() => showBanner(milestone.label, 2200), 1600);
  }

  if (state.wave >= FINAL_WAVE) {
    victory();
    return;
  }

  pausingLock = true;
  resumePending = false;
  engageEl.classList.add('hidden');
  if (isLocked()) document.exitPointerLock();
  state.phase = 'shop';
  updatePointerState();
  document.getElementById('shop-wave-cleared').textContent = state.wave;
  document.getElementById('next-wave-num').textContent = state.wave + 1;
  renderShop();
  shopEl.classList.remove('hidden');
  showBanner('WAVE CLEARED', 1400);
  persistNow();
}

function renderShop() {
  document.getElementById('shop-money').textContent = state.money;
  const nextWave = state.wave + 1;
  const intel = waveIntel(nextWave);
  const intelEl = document.getElementById('wave-intel');
  if (intelEl) {
    intelEl.innerHTML = `
      <div class="intel-header">
        <span class="intel-act">${intel.act}</span>
        <span class="intel-diff">THREAT ${'█'.repeat(intel.difficulty)}${'░'.repeat(5 - intel.difficulty)}</span>
      </div>
      <div class="intel-title">INCOMING — WAVE ${nextWave} · ${intel.total} hostiles${intel.isBossWave ? ' · BOSS' : ''}</div>
      <ul class="intel-list">${intel.threats.map((t) => `<li>${t}</li>`).join('')}</ul>`;
  }

  upgradeGrid.innerHTML = '';
  const cats = { offense: 'OFFENSE', defense: 'DEFENSE', utility: 'UTILITY' };
  for (const cat of ['offense', 'defense', 'utility']) {
    const keys = Object.keys(UPGRADES).filter((k) => UPGRADES[k].cat === cat);
    if (!keys.length) continue;
    const hdr = document.createElement('div');
    hdr.className = 'upg-cat';
    hdr.textContent = cats[cat];
    upgradeGrid.appendChild(hdr);

    for (const key of keys) {
      const u = UPGRADES[key];
      const lvl = state.levels[key] || 0;
      const maxed = lvl >= u.max;
      const locked = !isUpgradeUnlocked(key);
      const cost = upgradeCost(key);
      const afford = state.money >= cost;

      const btn = document.createElement('button');
      btn.className = 'upg'
        + (maxed ? ' maxed disabled' : locked ? ' locked disabled' : afford ? '' : ' disabled');
      btn.innerHTML = `
        <div class="upg-name">${u.name}</div>
        <div class="upg-desc">${u.desc}</div>
        <div class="upg-row">
          <span class="upg-cost ${maxed ? 'maxed-label' : ''}">${
            maxed ? 'MAXED' : locked ? `UNLOCK WAVE ${u.unlock}` : '¤ ' + cost}</span>
          <span class="upg-pips">${Array.from({ length: u.max }, (_, i) =>
            `<span class="pip ${i < lvl ? 'on' : ''}"></span>`).join('')}</span>
        </div>`;
      if (!maxed && !locked && afford) {
        btn.addEventListener('click', () => {
          state.money -= cost;
          state.levels[key]++;
          if (key === 'magazine') syncMagSize();
          audio.uiClick();
          updateHUD();
          renderShop();
          updateAmmoUI();
          persistDebounced();
        });
      }
      upgradeGrid.appendChild(btn);
    }
  }
}

document.getElementById('next-wave-btn').addEventListener('click', () => {
  audio.uiClick();
  shopEl.classList.add('hidden');
  if (state.wave + 1 > FINAL_WAVE) { victory(); return; }
  startWave(state.wave + 1);
});

// ---------------- Pause ----------------
const pauseEl = document.getElementById('pause');

function pauseGame(fromHidden = false, fromLockLoss = false) {
  if (state.phase !== 'playing' && state.phase !== 'awaiting-lock') return;
  pausingLock = true;
  resumePending = false;
  engageEl.classList.add('hidden');
  state.phase = 'paused';
  if (isLocked()) document.exitPointerLock();
  document.getElementById('pause-wave').textContent = state.wave;
  document.getElementById('pause-score').textContent = state.score;
  document.getElementById('pause-money').textContent = state.money;
  document.getElementById('pause-health').textContent = `${Math.round(state.health)}%`;
  document.getElementById('pause-title').textContent = fromHidden ? 'PAUSED' : 'PAUSED';
  pauseEl.classList.remove('hidden');
  updatePointerState();
  persistNow();
}

function resumeFromPause() {
  if (state.phase !== 'paused') return;
  pauseEl.classList.add('hidden');
  audio.uiClick();
  state.phase = 'playing';
  resumePending = true;
  pausingLock = false;
  engageEl.classList.remove('hidden');
}

document.getElementById('resume-btn').addEventListener('click', resumeFromPause);

// ---------------- Game over / victory / restart ----------------
function gameOver() {
  state.phase = 'gameover';
  pausingLock = true;
  resumePending = false;
  engageEl.classList.add('hidden');
  if (isLocked()) document.exitPointerLock();
  updatePointerState();
  document.getElementById('go-wave').textContent = state.wave;
  document.getElementById('go-score').textContent = state.score;
  document.getElementById('gameover').classList.remove('hidden');
  audio.explosion(true);
  addShake(1.2);
  clearSave();
}

function victory() {
  state.phase = 'victory';
  pausingLock = true;
  resumePending = false;
  engageEl.classList.add('hidden');
  if (isLocked()) document.exitPointerLock();
  updatePointerState();
  shopEl.classList.add('hidden');
  document.getElementById('vic-score').textContent = state.score;
  document.getElementById('victory').classList.remove('hidden');
  showBanner('HILL SECURED', 2500);
  audio.waveStart();
  addShake(0.4);
  clearSave();
}

document.getElementById('restart-btn').addEventListener('click', () => {
  document.getElementById('gameover').classList.add('hidden');
  resetGame();
  startWave(1);
});

document.getElementById('vic-restart-btn').addEventListener('click', () => {
  document.getElementById('victory').classList.add('hidden');
  resetGame();
  startWave(1);
});

function resetGame() {
  state.score = 0;
  state.money = 0;
  state.health = state.maxHealth;
  state.wave = 0;
  state.levels = { damage: 0, fireRate: 0, reload: 0, piercing: 0, beamWidth: 0, explosion: 0, chain: 0, magazine: 0, cryo: 0, fortify: 0, salvage: 0, nanites: 0 };
  state.maxHealth = 100;
  syncMagSize();
  state.spawnQueue = [];
  state.spawnTimer = 0;
  chickens.clear();
  aimYaw = 0; aimPitch = 0.05;
  updateHUD();
  updateAmmoUI();
  clearSave();
}

function restoreGame(data) {
  state.phase = data.phase;
  state.wave = data.wave;
  state.score = data.score;
  state.money = data.money;
  state.health = data.health;
  state.maxHealth = data.maxHealth || 100;
  state.levels = { damage: 0, fireRate: 0, reload: 0, piercing: 0, beamWidth: 0, explosion: 0, chain: 0, magazine: 0, cryo: 0, fortify: 0, salvage: 0, nanites: 0, ...data.levels };
  state.ammo = data.ammo;
  state.cooldown = data.cooldown;
  state.reloading = data.reloading;
  state.spawnQueue = data.spawnQueue || [];
  state.spawnTimer = data.spawnTimer || 0;
  state.spawnInterval = data.spawnInterval || 1;
  state.waveScale = data.waveScale;
  aimYaw = data.aimYaw || 0;
  aimPitch = data.aimPitch ?? 0.05;
  chickens.deserialize(data.chickens || []);
  updateHUD();
  updateAmmoUI();

  document.getElementById('menu').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  document.getElementById('gameover').classList.add('hidden');
  document.getElementById('victory').classList.add('hidden');
  shopEl.classList.add('hidden');
  pauseEl.classList.add('hidden');

  if (state.phase === 'shop') {
    document.getElementById('shop-wave-cleared').textContent = state.wave;
    document.getElementById('next-wave-num').textContent = Math.min(state.wave + 1, FINAL_WAVE);
    renderShop();
    shopEl.classList.remove('hidden');
  } else if (state.phase === 'paused') {
    pauseEl.classList.remove('hidden');
    document.getElementById('pause-wave').textContent = state.wave;
    document.getElementById('pause-score').textContent = state.score;
    document.getElementById('pause-money').textContent = state.money;
    document.getElementById('pause-health').textContent = `${Math.round(state.health)}%`;
  } else if (state.phase === 'playing') {
    resumePending = true;
    engageEl.classList.remove('hidden');
  }
  audio.setIntensity(Math.min(1, state.wave / FINAL_WAVE));
}

// ---------------- Start / continue ----------------
const savedRun = loadGame();
const continueBtn = document.getElementById('continue-btn');
if (savedRun) {
  continueBtn.classList.remove('hidden');
  continueBtn.addEventListener('click', () => {
    audio.ensure();
    audio.startMusic();
    audio.uiClick();
    restoreGame(savedRun);
  });
}

document.getElementById('start-btn').addEventListener('click', () => {
  audio.ensure();
  audio.startMusic();
  audio.uiClick();
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  resetGame();
  startWave(1);
});

// ---------------- Main loop ----------------
const clock = new THREE.Clock();
let cluckTimer = 0;

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  // Skip simulation + render while hidden (saves CPU/GPU on sleep) — state is already saved
  if (tabHidden && state.phase !== 'menu') return;

  if (saveTimer > 0) {
    saveTimer -= dt;
    if (saveTimer <= 0) persistNow();
  }

  world.update(dt, renderer);

  if (state.phase === 'playing') {
    turret.aim(aimYaw, aimPitch, dt);

    if (state.cooldown > 0) state.cooldown -= dt;
    if (state.reloading > 0) {
      state.reloading -= dt;
      if (state.reloading <= 0) {
        state.ammo = derived.magSize;
        updateAmmoUI();
        document.getElementById('reload-text').classList.remove('show');
      }
    }
    if (mouseDown) tryFire();

    waveTick(dt);
    chickens.update(dt, game);

    // ambient clucks from the horde
    cluckTimer -= dt;
    if (cluckTimer <= 0 && chickens.aliveCount > 0) {
      cluckTimer = 0.5 + Math.random() * 1.6 / Math.min(chickens.aliveCount, 8);
      const c = chickens.chickens[Math.floor(Math.random() * chickens.aliveCount)];
      if (c && c.z > -80) audio.cluck(1 / c.scale);
    }
  }

  turret.update(dt);
  effects.update(dt);
  updateCamera(dt, t);
  renderer.render(scene, camera);
}
tick();
