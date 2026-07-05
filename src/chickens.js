import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { terrainHeight, terrainHeightFast } from './world.js';

// ---------------- Chicken model (one merged geometry, instanced) ----------------
function paint(geo, color) {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function buildChickenGeometry() {
  const parts = [];
  const BODY = 0xffffff, DARK = 0xd8d2c8, RED = 0xd9342b, ORANGE = 0xe89b2f, LEG = 0xc98a2e;

  const body = paint(new THREE.SphereGeometry(0.52, 10, 8), BODY);
  body.scale(1, 0.92, 1.25);
  body.translate(0, 0.62, 0);
  parts.push(body);

  const head = paint(new THREE.SphereGeometry(0.3, 9, 7), BODY);
  head.translate(0, 1.18, -0.52);
  parts.push(head);

  const beak = paint(new THREE.ConeGeometry(0.11, 0.3, 5), ORANGE);
  beak.rotateX(-Math.PI / 2);
  beak.translate(0, 1.16, -0.9);
  parts.push(beak);

  const comb = paint(new THREE.BoxGeometry(0.09, 0.24, 0.34), RED);
  comb.translate(0, 1.48, -0.5);
  parts.push(comb);

  const wattle = paint(new THREE.SphereGeometry(0.08, 6, 5), RED);
  wattle.scale(1, 1.5, 1);
  wattle.translate(0, 0.98, -0.68);
  parts.push(wattle);

  for (const s of [-1, 1]) {
    const wing = paint(new THREE.SphereGeometry(0.3, 8, 6), DARK);
    wing.scale(0.42, 0.75, 1.05);
    wing.rotateZ(s * 0.22);
    wing.translate(s * 0.48, 0.66, 0.05);
    parts.push(wing);

    const leg = paint(new THREE.CylinderGeometry(0.045, 0.045, 0.38, 5), LEG);
    leg.translate(s * 0.18, 0.19, 0.1);
    parts.push(leg);

    const foot = paint(new THREE.BoxGeometry(0.16, 0.05, 0.24), LEG);
    foot.translate(s * 0.18, 0.03, 0.02);
    parts.push(foot);
  }

  const tail = paint(new THREE.SphereGeometry(0.24, 7, 6), DARK);
  tail.scale(0.7, 1.15, 0.7);
  tail.rotateX(0.7);
  tail.translate(0, 0.92, 0.62);
  parts.push(tail);

  const merged = mergeGeometries(parts);
  merged.computeBoundingSphere();
  return merged;
}

// ---------------- Types ----------------
export const TYPES = {
  normal:    { hp: 30,  speed: 6.2,  scale: 1.0, tint: 0xffffff, score: 10,  money: 10, dmg: 8 },
  fast:      { hp: 18,  speed: 11.5, scale: 0.78, tint: 0xffe38a, score: 15,  money: 14, dmg: 6 },
  tank:      { hp: 130, speed: 4.0,  scale: 1.45, tint: 0x8f9aa8, score: 30,  money: 26, dmg: 16 },
  explosive: { hp: 26,  speed: 7.0,  scale: 1.05, tint: 0xff7a66, score: 20,  money: 20, dmg: 14, explodes: true },
  giant:     { hp: 700, speed: 3.2,  scale: 3.2, tint: 0xfff2f2, score: 200, money: 150, dmg: 40, boss: true },
};

const MAX_CHICKENS = 220;
const KILL_Z = 6.5; // reaching this z = hits the base

export class ChickenManager {
  constructor(scene, effects) {
    this.scene = scene;
    this.effects = effects;
    this.chickens = [];
    this.pool = [];

    const geo = buildChickenGeometry();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_CHICKENS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    // instanceColor exists after first setColorAt
    this.mesh.setColorAt(0, new THREE.Color(0xffffff));
    scene.add(this.mesh);

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
    this._pos = new THREE.Vector3();
    this._flashCol = new THREE.Color(8, 2.5, 2);
    this._cryoCol = new THREE.Color(0x66ccff);
    this._grid = new Map();
    this._hits = [];
    this._cell = 8;
    this._rayOut = [];
    this._gridDirty = true;
    this._rayStamp = 0;
    this._chainStamp = 0;
    this._colorDirty = false;
    this._lastColorCount = -1;
  }

  _gridKey(gx, gz) { return (gx << 16) ^ (gz & 0xffff); }

  _rebuildGrid() {
    this._grid.clear();
    const cell = this._cell;
    for (const c of this.chickens) {
      const gx = (c.x / cell) | 0;
      const gz = (c.z / cell) | 0;
      const key = this._gridKey(gx, gz);
      let bucket = this._grid.get(key);
      if (!bucket) { bucket = []; this._grid.set(key, bucket); }
      bucket.push(c);
    }
  }

  _forEachCell(x, z, radius, fn) {
    const cell = this._cell;
    const r = Math.ceil(radius / cell);
    const gx0 = ((x - radius) / cell) | 0;
    const gx1 = ((x + radius) / cell) | 0;
    const gz0 = ((z - radius) / cell) | 0;
    const gz1 = ((z + radius) / cell) | 0;
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        const bucket = this._grid.get(this._gridKey(gx, gz));
        if (bucket) fn(bucket);
      }
    }
  }

  serialize() {
    return this.chickens.map((c) => ({
      type: c.type, hp: c.hp, maxHp: c.maxHp, speed: c.speed, scale: c.scale,
      x: c.x, z: c.z, y: c.y, drift: c.drift, phase: c.phase, flash: c.flash, slow: c.slow || 0,
    }));
  }

  deserialize(list) {
    this.chickens.length = 0;
    for (const d of list) {
      const t = TYPES[d.type];
      if (!t) continue;
      const c = this.pool.pop() || {};
      Object.assign(c, {
        type: d.type, def: t,
        hp: d.hp, maxHp: d.maxHp, speed: d.speed, scale: d.scale,
        x: d.x, z: d.z, y: d.y, drift: d.drift, phase: d.phase, flash: d.flash || 0,
        slow: d.slow || 0,
        dead: false,
      });
      this.chickens.push(c);
    }
    this.mesh.count = this.chickens.length;
  }

  spawn(typeName, waveScale) {
    if (this.chickens.length >= MAX_CHICKENS) return;
    const t = TYPES[typeName];
    const x = (Math.random() - 0.5) * 44;
    const z = -140 - Math.random() * 25;
    const c = this.pool.pop() || {};
    Object.assign(c, {
      type: typeName, def: t,
      hp: t.hp * waveScale.hp,
      maxHp: t.hp * waveScale.hp,
      speed: t.speed * waveScale.speed * (0.9 + Math.random() * 0.2),
      scale: t.scale * (0.92 + Math.random() * 0.16),
      x, z,
      y: terrainHeight(x, z),
      drift: (Math.random() - 0.5) * 0.9,
      phase: Math.random() * Math.PI * 2,
      flash: 0,
      slow: 0,
      dead: false,
    });
    this.chickens.push(c);
    this._gridDirty = true;
  }

  _testHit(c, ox, oy, oz, dir, radius, hits) {
    const cy = (c.y + 0.7 * c.scale) - oy;
    const cx = c.x - ox, cz = c.z - oz;
    const t = cx * dir.x + cy * dir.y + cz * dir.z;
    if (t < 0) return;
    const px = cx - dir.x * t, py = cy - dir.y * t, pz = cz - dir.z * t;
    const distSq = px * px + py * py + pz * pz;
    const r = radius + 0.72 * c.scale;
    if (distSq < r * r) hits.push(c, t);
  }

  // Beam hit test — uses spatial grid rebuilt during update()
  raycast(origin, dir, radius) {
    if (this._gridDirty) this._rebuildGrid();
    const hits = this._hits;
    hits.length = 0;
    const ox = origin.x, oy = origin.y, oz = origin.z;
    const cell = this._cell;
    const stamp = ++this._rayStamp;

    const maxT = 320;
    const step = cell * 0.85;
    for (let d = 0; d < maxT; d += step) {
      const px = ox + dir.x * d;
      const pz = oz + dir.z * d;
      const gx = (px / cell) | 0;
      const gz = (pz / cell) | 0;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = this._grid.get(this._gridKey(gx + dx, gz + dz));
          if (!bucket) continue;
          for (const c of bucket) {
            if (c._seen === stamp) continue;
            c._seen = stamp;
            this._testHit(c, ox, oy, oz, dir, radius, hits);
          }
        }
      }
    }

    const out = this._rayOut;
    out.length = 0;
    for (let i = 0; i < hits.length; i += 2) out.push({ chicken: hits[i], t: hits[i + 1] });
    out.sort((a, b) => a.t - b.t);
    return out;
  }

  damage(c, amount, game, opts = {}) {
    if (c.dead) return false;
    if (opts.applySlow && opts.slowAmount > 0) {
      c.slow = Math.min(0.72, Math.max(c.slow || 0, opts.slowAmount));
    }
    c.hp -= amount;
    c.flash = 1;
    this._colorDirty = true;
    if (c.hp <= 0) {
      c.dead = true;
      this._gridDirty = true;
      this.effects.feathers(c.x, c.y + 0.7 * c.scale, c.z, c.scale);
      if (c.def.explodes || c.def.boss) {
        this.effects.explosion(c.x, c.y + 0.5, c.z, c.def.boss ? 2.2 : 1.2);
        game.onExplosionKill(c);
      }
      game.onKill(c);
      return true;
    }
    return false;
  }

  applySlowPulse(x, z, radius, amount) {
    if (this._gridDirty) this._rebuildGrid();
    const r2 = radius * radius;
    this._forEachCell(x, z, radius, (bucket) => {
      for (const c of bucket) {
        if (c.dead) continue;
        const dx = c.x - x, dz = c.z - z;
        if (dx * dx + dz * dz < r2) {
          c.slow = Math.min(0.72, Math.max(c.slow || 0, amount));
          this._colorDirty = true;
        }
      }
    });
  }

  chainFrom(origin, range, damage, jumps, game) {
    if (this._gridDirty) this._rebuildGrid();
    const r2 = range * range;
    const stamp = ++this._chainStamp;
    origin._chainStamp = stamp;
    let from = origin;

    for (let j = 0; j < jumps; j++) {
      let best = null, bestD = r2;
      this._forEachCell(from.x, from.z, range, (bucket) => {
        for (const c of bucket) {
          if (c.dead || c._chainStamp === stamp) continue;
          const dx = c.x - from.x, dz = c.z - from.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < bestD) { bestD = d2; best = c; }
        }
      });
      if (!best) break;
      best._chainStamp = stamp;
      this.effects.chainArc(
        from.x, from.y + 0.75 * from.scale, from.z,
        best.x, best.y + 0.65 * best.scale, best.z
      );
      this.damage(best, damage, game);
      game.onChainHit?.(best);
      from = best;
    }
  }

  // area damage (explosive chain / explosion radius upgrade)
  areaDamage(x, z, radius, amount, game) {
    if (this._gridDirty) this._rebuildGrid();
    const r2 = radius * radius;
    this._forEachCell(x, z, radius, (bucket) => {
      for (const c of bucket) {
        if (c.dead) continue;
        const dx = c.x - x, dz = c.z - z;
        if (dx * dx + dz * dz < r2) this.damage(c, amount, game);
      }
    });
  }

  update(dt, game) {
    const arr = this.chickens;
    let anyFlash = false;

    for (let i = arr.length - 1; i >= 0; i--) {
      const c = arr[i];
      if (c.dead) { this.pool.push(c); arr[i] = arr[arr.length - 1]; arr.pop(); this._gridDirty = true; continue; }

      if (c.slow > 0) c.slow = Math.max(0, c.slow - dt * 0.45);

      const speedMul = 1 - (c.slow || 0);
      c.phase += dt * (4 + c.speed * 0.8) * speedMul;
      const targetX = c.drift * 14 * Math.max(0, -c.z / 120);
      c.x += (targetX - c.x) * dt * 0.4 + Math.sin(c.phase * 0.35) * dt * 1.4 * speedMul;
      c.z += c.speed * speedMul * dt;
      c.y = terrainHeightFast(c.x, c.z);
      if (c.flash > 0) { c.flash = Math.max(0, c.flash - dt * 6); anyFlash = true; }

      if (c.z >= KILL_Z) {
        game.onBreach(c);
        this.effects.feathers(c.x, c.y + 0.6, c.z, c.scale);
        this.pool.push(c);
        arr[i] = arr[arr.length - 1]; arr.pop();
        this._gridDirty = true;
      }
    }

    if (this._gridDirty) {
      this._rebuildGrid();
      this._gridDirty = false;
    }

    const m = this._m, q = this._q, e = this._e, s = this._s, col = this._c;
    const writeColor = anyFlash || this._colorDirty || arr.length !== this._lastColorCount;
    this._colorDirty = false;
    this._lastColorCount = arr.length;

    for (let i = 0; i < arr.length; i++) {
      const c = arr[i];
      const hop = Math.abs(Math.sin(c.phase)) * 0.16 * c.scale;
      const waddle = Math.sin(c.phase) * 0.13;
      const lean = Math.cos(c.phase * 0.5) * 0.05;
      e.set(0.06, Math.PI + lean * 0.3, waddle);
      q.setFromEuler(e);
      s.setScalar(c.scale);
      this._pos.set(c.x, c.y + hop, c.z);
      m.compose(this._pos, q, s);
      this.mesh.setMatrixAt(i, m);
      if (writeColor) {
        col.setHex(c.def.tint);
        if (c.slow > 0.05) col.lerp(this._cryoCol, c.slow * 0.85);
        if (c.flash > 0) col.lerp(this._flashCol, c.flash * 0.9);
        this.mesh.setColorAt(i, col);
      }
    }
    this.mesh.count = arr.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (writeColor && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear() {
    for (const c of this.chickens) this.pool.push(c);
    this.chickens.length = 0;
    this.mesh.count = 0;
  }

  get aliveCount() { return this.chickens.length; }
}

// ---------------- Wave composition ----------------
export function waveComposition(wave) {
  const list = [];
  const push = (type, n) => { for (let i = 0; i < n; i++) list.push(type); };
  wave = Math.min(wave, 10);

  const base = 6 + Math.floor(wave * 2.2);
  push('normal', base);
  if (wave >= 2) push('fast', Math.floor(wave * 1.1));
  if (wave >= 3) push('tank', Math.floor(wave * 0.6));
  if (wave >= 4) push('explosive', Math.floor(wave * 0.5));
  if (wave >= 5 && wave % 5 === 0) push('giant', Math.floor(wave / 5));
  // rare bonus giant
  else if (wave >= 8 && Math.random() < 0.12) push('giant', 1);

  // shuffle
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

export function waveScaling(wave) {
  return {
    hp: 1 + (wave - 1) * 0.12,
    speed: Math.min(1.8, 1 + (wave - 1) * 0.035),
    interval: Math.max(0.28, 1.1 - wave * 0.06),
  };
}
