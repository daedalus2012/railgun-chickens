export const FINAL_WAVE = 20;

export const ACTS = [
  { name: 'ACT I — SCOUTS',       from: 1,  to: 5  },
  { name: 'ACT II — ASSAULT',     from: 6,  to: 10 },
  { name: 'ACT III — SIEGE',      from: 11, to: 15 },
  { name: 'ACT IV — APOCALYPSE',  from: 16, to: 20 },
];

const THREAT_LABELS = {
  normal: 'Standard flock',
  fast: 'Fast runners',
  tank: 'Heavy armor',
  explosive: 'Volatile units',
  armored: 'Plated assault',
  swarm: 'Swarm pack',
  giant: 'Giant boss',
};

export function getAct(wave) {
  return ACTS.find((a) => wave >= a.from && wave <= a.to) || ACTS[ACTS.length - 1];
}

export function waveIntel(wave) {
  const comp = waveComposition(wave);
  const counts = {};
  for (const type of comp) counts[type] = (counts[type] || 0) + 1;
  const threats = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([type, n]) => `${n}× ${THREAT_LABELS[type] || type}`);
  const bosses = counts.giant || 0;
  const act = getAct(wave);
  const difficulty = Math.min(5, Math.ceil(wave / 4));
  return {
    wave,
    act: act.name,
    total: comp.length,
    threats,
    bosses,
    difficulty,
    isBossWave: bosses > 0,
    isFinal: wave >= FINAL_WAVE,
  };
}

export function milestoneBonus(wave) {
  if (wave === 5)  return { credits: 120, repair: 22, label: 'ACT I SECURED' };
  if (wave === 10) return { credits: 220, repair: 28, label: 'MIDPOINT REACHED' };
  if (wave === 15) return { credits: 340, repair: 34, label: 'SIEGE BROKEN' };
  if (wave === 20) return { credits: 500, repair: 50, label: 'FINAL STAND' };
  return null;
}

export function waveComposition(wave) {
  const list = [];
  const push = (type, n) => { for (let i = 0; i < n; i++) list.push(type); };
  wave = Math.min(wave, FINAL_WAVE);

  const base = 5 + Math.floor(wave * 1.65);
  push('normal', base);

  if (wave >= 2)  push('fast', Math.floor(wave * 0.95));
  if (wave >= 3)  push('tank', Math.floor(wave * 0.5));
  if (wave >= 4)  push('explosive', Math.floor(wave * 0.42));
  if (wave >= 11) push('armored', Math.floor((wave - 10) * 0.85));
  if (wave >= 14) push('swarm', Math.floor((wave - 13) * 1.4));

  // Boss waves: 5, 10, 15, 20
  if (wave % 5 === 0) {
    const giants = wave === 20 ? 3 : wave === 15 ? 2 : 1;
    push('giant', giants);
  } else if (wave >= 12 && Math.random() < 0.1 + wave * 0.008) {
    push('giant', 1);
  }

  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

export function waveScaling(wave) {
  const t = wave - 1;
  return {
    hp: 1 + t * 0.085,
    speed: Math.min(2.05, 1 + t * 0.028),
    interval: Math.max(0.2, 1.05 - wave * 0.038),
    creditMult: 1 + t * 0.025,
  };
}

export function waveClearReward(wave) {
  const tier = Math.ceil(wave / 5);
  return {
    credits: 20 + wave * 12 + tier * 15,
    repair: 8 + Math.floor(wave * 0.55),
  };
}
