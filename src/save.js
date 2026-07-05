const KEY = 'railhill-save';
const FINAL_WAVE = 10;

export { FINAL_WAVE };

export function buildSavePayload(state, chickens, aimYaw, aimPitch) {
  const phase = state.phase === 'awaiting-lock' ? 'paused' : state.phase;
  return {
    v: 1,
    ts: Date.now(),
    phase,
    wave: state.wave,
    score: state.score,
    money: state.money,
    health: state.health,
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
    if (!data || data.v !== 1) return null;
    if (data.phase === 'menu' || data.phase === 'gameover' || data.phase === 'victory') return null;
    return data;
  } catch {
    return null;
  }
}

export function clearSave() {
  sessionStorage.removeItem(KEY);
}
