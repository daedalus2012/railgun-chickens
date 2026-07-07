import { FINAL_WAVE } from './progression.js';

export { FINAL_WAVE };

const KEY = 'railhill-save';

const DEFAULT_LEVELS = {
  damage: 0, fireRate: 0, reload: 0, piercing: 0, beamWidth: 0, explosion: 0,
  chain: 0, magazine: 0, cryo: 0, fortify: 0, salvage: 0, nanites: 0,
};

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

export function saveGame(state, chickens, aimYaw, aimPitch) {
  if (state.phase === 'menu' || state.phase === 'gameover' || state.phase === 'victory') {
    sessionStorage.removeItem(KEY);
    return;
  }
  try {
    sessionStorage.setItem(KEY, JSON.stringify(buildSavePayload(state, chickens, aimYaw, aimPitch)));
  } catch { /* quota / private mode */ }
}

export function loadGame() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || (data.v !== 1 && data.v !== 2)) return null;
    if (data.phase === 'menu' || data.phase === 'gameover' || data.phase === 'victory') return null;
    data.levels = { ...DEFAULT_LEVELS, ...data.levels };
    return data;
  } catch {
    return null;
  }
}

export function clearSave() {
  sessionStorage.removeItem(KEY);
}
