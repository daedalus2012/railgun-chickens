import { FINAL_WAVE } from './progression.js';

export { FINAL_WAVE };

const SESSION_KEY = 'railhill-save';
const MANUAL_KEY = 'railhill-manual';

const DEFAULT_LEVELS = {
  damage: 0, fireRate: 0, reload: 0, piercing: 0, beamWidth: 0, explosion: 0,
  chain: 0, magazine: 0, cryo: 0, fortify: 0, salvage: 0, nanites: 0,
};

function normalizeSave(data) {
  if (!data || (data.v !== 1 && data.v !== 2)) return null;
  if (data.phase === 'menu' || data.phase === 'gameover' || data.phase === 'victory') return null;
  data.levels = { ...DEFAULT_LEVELS, ...data.levels };
  return data;
}

export function buildSavePayload(state, chickens, aimYaw, aimPitch) {
  const phase = state.phase === 'awaiting-lock' ? 'paused' : state.phase;
  return {
    v: 2,
    ts: Date.now(),
    phase,
    wave: state.wave,
    score: state.score,
    money: state.money,
    health: state.health,
    maxHealth: state.maxHealth,
    levels: { ...state.levels },
    ammo: state.ammo,
    cooldown: state.cooldown,
    reloading: state.reloading,
    spawnQueue: [...state.spawnQueue],
    spawnTimer: state.spawnTimer,
    spawnInterval: state.spawnInterval,
    waveScale: state.waveScale ? { ...state.waveScale } : null,
    aimYaw,
    aimPitch,
    chickens: chickens.serialize(),
  };
}

// Auto-save (session) — survives refresh / tab close in same session
export function saveGame(state, chickens, aimYaw, aimPitch) {
  if (state.phase === 'menu' || state.phase === 'gameover' || state.phase === 'victory') {
    sessionStorage.removeItem(SESSION_KEY);
    return;
  }
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(buildSavePayload(state, chickens, aimYaw, aimPitch)));
  } catch { /* quota / private mode */ }
}

export function loadGame() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return normalizeSave(JSON.parse(raw));
  } catch {
    return null;
  }
}

// Manual save (localStorage) — persists across browser restarts
export function saveGameManual(state, chickens, aimYaw, aimPitch) {
  if (state.phase === 'menu' || state.phase === 'gameover' || state.phase === 'victory') return false;
  try {
    localStorage.setItem(MANUAL_KEY, JSON.stringify(buildSavePayload(state, chickens, aimYaw, aimPitch)));
    return true;
  } catch {
    return false;
  }
}

export function loadGameManual() {
  try {
    const raw = localStorage.getItem(MANUAL_KEY);
    if (!raw) return null;
    return normalizeSave(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function getManualSaveInfo() {
  const data = loadGameManual();
  if (!data) return null;
  return {
    wave: data.wave,
    score: data.score,
    money: data.money,
    health: data.health,
    phase: data.phase,
    savedAt: data.ts,
  };
}

export function hasManualSave() {
  return loadGameManual() !== null;
}

export function clearSave() {
  sessionStorage.removeItem(SESSION_KEY);
}

export function clearManualSave() {
  localStorage.removeItem(MANUAL_KEY);
}
