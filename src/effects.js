import * as THREE from 'three';

// ---------------- Additive spark particles (GPU points, CPU simulated, pooled) ----------------
const MAX_SPARKS = 1500;
const MAX_FEATHERS = 600;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.buildSparks(scene);
    this.buildFeathers(scene);
    this.buildBeams(scene);
    this.buildFlashes(scene);
    this.lights = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 30, 2);
      scene.add(l);
      this.lights.push({ light: l, life: 0, max: 1 });
    }
  }

  // ---- sparks ----
  buildSparks(scene) {
    this.sparkData = [];
    for (let i = 0; i < MAX_SPARKS; i++) {
      this.sparkData.push({ life: 0, max: 1, vx: 0, vy: 0, vz: 0, x: 0, y: 0, z: 0, size: 1, r: 1, g: 1, b: 1, grav: 0 });
    }
    this.sparkCursor = 0;

    const geo = new THREE.BufferGeometry();
    this.sparkPos = new Float32Array(MAX_SPARKS * 3);
    this.sparkCol = new Float32Array(MAX_SPARKS * 3);
    this.sparkSize = new Float32Array(MAX_SPARKS);
    geo.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.sparkSize, 1));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        attribute float size;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (240.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vColor;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vColor * a, a);
        }`,
      vertexColors: true,
    });
    this.sparkMesh = new THREE.Points(geo, mat);
    this.sparkMesh.frustumCulled = false;
    scene.add(this.sparkMesh);
  }

  emitSpark(x, y, z, opts) {
    const p = this.sparkData[this.sparkCursor];
    this.sparkCursor = (this.sparkCursor + 1) % MAX_SPARKS;
    p.x = x; p.y = y; p.z = z;
    p.vx = opts.vx; p.vy = opts.vy; p.vz = opts.vz;
    p.life = p.max = opts.life;
    p.size = opts.size;
    p.r = opts.r; p.g = opts.g; p.b = opts.b;
    p.grav = opts.grav ?? 14;
  }

  // impact burst — hot blue-white core + orange sparks
  impact(x, y, z, dir, strength = 1) {
    const n = Math.floor(14 * strength);
    for (let i = 0; i < n; i++) {
      const spread = 6 + Math.random() * 9;
      this.emitSpark(x, y, z, {
        vx: -dir.x * spread * 0.5 + (Math.random() - 0.5) * spread,
        vy: Math.random() * spread * 0.8 + 2,
        vz: -dir.z * spread * 0.5 + (Math.random() - 0.5) * spread,
        life: 0.25 + Math.random() * 0.3,
        size: 0.5 + Math.random() * 0.7,
        r: 1.5, g: 0.8 + Math.random() * 0.5, b: 0.4,
      });
    }
    for (let i = 0; i < 6 * strength; i++) {
      this.emitSpark(x, y, z, {
        vx: (Math.random() - 0.5) * 4, vy: Math.random() * 4, vz: (Math.random() - 0.5) * 4,
        life: 0.12 + Math.random() * 0.12,
        size: 1.4 + Math.random() * 1.2,
        r: 0.7, g: 1.3, b: 2.0, grav: 0,
      });
    }
    this.flashLight(x, y + 0.5, z, 0x7fd4ff, 60 * strength, 0.12);
  }

  muzzle(x, y, z, dir) {
    for (let i = 0; i < 10; i++) {
      const sp = 8 + Math.random() * 14;
      this.emitSpark(x, y, z, {
        vx: dir.x * sp + (Math.random() - 0.5) * 5,
        vy: dir.y * sp + (Math.random() - 0.5) * 5 + 1,
        vz: dir.z * sp + (Math.random() - 0.5) * 5,
        life: 0.1 + Math.random() * 0.14,
        size: 0.8 + Math.random() * 1.0,
        r: 0.8, g: 1.5, b: 2.2, grav: 0,
      });
    }
    this.flashLight(x, y, z, 0x66ccff, 140, 0.09);
  }

  explosion(x, y, z, scale = 1) {
    const n = Math.floor(30 * scale);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const el = Math.random() * Math.PI * 0.5;
      const sp = (5 + Math.random() * 12) * scale;
      this.emitSpark(x, y, z, {
        vx: Math.cos(a) * Math.cos(el) * sp,
        vy: Math.sin(el) * sp + 3,
        vz: Math.sin(a) * Math.cos(el) * sp,
        life: 0.3 + Math.random() * 0.45,
        size: (0.9 + Math.random() * 1.6) * scale,
        r: 2.0, g: 0.75 + Math.random() * 0.4, b: 0.25,
      });
    }
    // smoke-ish dim particles
    for (let i = 0; i < 8 * scale; i++) {
      this.emitSpark(x, y + 0.5, z, {
        vx: (Math.random() - 0.5) * 3, vy: 1.5 + Math.random() * 2.5, vz: (Math.random() - 0.5) * 3,
        life: 0.5 + Math.random() * 0.5,
        size: (2.2 + Math.random() * 2) * scale,
        r: 0.25, g: 0.2, b: 0.16, grav: -2,
      });
    }
    this.spawnFlash(x, y, z, 2.4 * scale, 0xffa044);
    this.flashLight(x, y + 1, z, 0xff8833, 220 * scale, 0.22);
  }

  // ---- feathers (instanced quads with flutter) ----
  buildFeathers(scene) {
    this.featherData = [];
    for (let i = 0; i < MAX_FEATHERS; i++) {
      this.featherData.push({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rot: 0, rotV: 0, tilt: 0, size: 1, white: 1 });
    }
    this.featherCursor = 0;

    const geo = new THREE.PlaneGeometry(0.22, 0.34);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.95,
    });
    this.featherMesh = new THREE.InstancedMesh(geo, mat, MAX_FEATHERS);
    this.featherMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.featherMesh.count = 0;
    this.featherMesh.frustumCulled = false;
    this.featherMesh.setColorAt(0, new THREE.Color(1, 1, 1));
    scene.add(this.featherMesh);
  }

  feathers(x, y, z, scale = 1) {
    const n = Math.min(10 + Math.floor(scale * 6), 26);
    for (let i = 0; i < n; i++) {
      const f = this.featherData[this.featherCursor];
      this.featherCursor = (this.featherCursor + 1) % MAX_FEATHERS;
      f.x = x + (Math.random() - 0.5) * scale;
      f.y = y + (Math.random() - 0.5) * scale;
      f.z = z + (Math.random() - 0.5) * scale;
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 4.5 * scale;
      f.vx = Math.cos(a) * sp;
      f.vy = 2 + Math.random() * 4;
      f.vz = Math.sin(a) * sp;
      f.rot = Math.random() * Math.PI * 2;
      f.rotV = (Math.random() - 0.5) * 14;
      f.tilt = Math.random() * Math.PI;
      f.size = (0.7 + Math.random() * 0.8) * Math.min(scale, 1.8);
      f.white = 0.85 + Math.random() * 0.15;
      f.life = f.max = 0.9 + Math.random() * 0.8;
    }
  }

  // ---- railgun beams (pooled stretched cylinders) ----
  buildBeams(scene) {
    this.beams = [];
    const geo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
    geo.rotateX(Math.PI / 2); // align along z
    for (let i = 0; i < 6; i++) {
      const core = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0xd6f4ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      const glow = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0x2fa8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      core.visible = glow.visible = false;
      scene.add(core, glow);
      this.beams.push({ core, glow, life: 0, max: 0.16, width: 1 });
    }
    this.beamCursor = 0;
  }

  beam(from, to, width = 0.07) {
    const b = this.beams[this.beamCursor];
    this.beamCursor = (this.beamCursor + 1) % this.beams.length;
    const mid = from.clone().add(to).multiplyScalar(0.5);
    const len = from.distanceTo(to);
    for (const mesh of [b.core, b.glow]) {
      mesh.position.copy(mid);
      mesh.lookAt(to);
      mesh.visible = true;
    }
    b.core.scale.set(width, width, len);
    b.glow.scale.set(width * 3.4, width * 3.4, len);
    b.life = b.max = 0.16;
    b.width = width;
  }

  // ---- expanding flash spheres (explosions) ----
  buildFlashes(scene) {
    this.flashes = [];
    const geo = new THREE.SphereGeometry(1, 12, 8);
    for (let i = 0; i < 5; i++) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0xffaa44, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      mesh.visible = false;
      scene.add(mesh);
      this.flashes.push({ mesh, life: 0, max: 0.25, size: 1 });
    }
    this.flashCursor = 0;

    // reused each frame — avoids GC in the feather update loop
    this._fM = new THREE.Matrix4();
    this._fQ = new THREE.Quaternion();
    this._fE = new THREE.Euler();
    this._fS = new THREE.Vector3();
    this._fPos = new THREE.Vector3();
  }

  spawnFlash(x, y, z, size, color) {
    const f = this.flashes[this.flashCursor];
    this.flashCursor = (this.flashCursor + 1) % this.flashes.length;
    f.mesh.position.set(x, y, z);
    f.mesh.material.color.setHex(color);
    f.mesh.visible = true;
    f.life = f.max = 0.25;
    f.size = size;
  }

  flashLight(x, y, z, color, intensity, dur) {
    let slot = this.lights[0];
    for (const l of this.lights) if (l.life < slot.life) slot = l;
    slot.light.position.set(x, y, z);
    slot.light.color.setHex(color);
    slot.light.intensity = intensity;
    slot.baseIntensity = intensity;
    slot.life = slot.max = dur;
  }

  // Lightning arc between two points — reuses spark pool
  chainArc(x0, y0, z0, x1, y1, z1) {
    const steps = 7;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const j = (Math.random() - 0.5) * 0.35;
      this.emitSpark(
        x0 + (x1 - x0) * t + j,
        y0 + (y1 - y0) * t + Math.abs(j) * 0.5,
        z0 + (z1 - z0) * t + j,
        {
          vx: (Math.random() - 0.5) * 2, vy: Math.random() * 2, vz: (Math.random() - 0.5) * 2,
          life: 0.14 + Math.random() * 0.1,
          size: 1.1 + Math.random() * 0.8,
          r: 0.6, g: 1.6, b: 2.4, grav: 0,
        }
      );
    }
    this.flashLight((x0 + x1) * 0.5, (y0 + y1) * 0.5, (z0 + z1) * 0.5, 0x88eeff, 35, 0.08);
    this._active = true;
  }

  update(dt) {
    let anyActive = false;
    // sparks
    let alive = 0;
    for (const p of this.sparkData) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.vy -= p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.02 && p.grav > 0) { p.y = 0.02; p.vy *= -0.3; p.vx *= 0.7; p.vz *= 0.7; }
      const k = Math.max(p.life / p.max, 0);
      const i3 = alive * 3;
      this.sparkPos[i3] = p.x; this.sparkPos[i3 + 1] = p.y; this.sparkPos[i3 + 2] = p.z;
      this.sparkCol[i3] = p.r * k; this.sparkCol[i3 + 1] = p.g * k; this.sparkCol[i3 + 2] = p.b * k;
      this.sparkSize[alive] = p.size * (0.5 + k * 0.5);
      alive++;
    }
    if (alive > 0) anyActive = true;
    this.sparkMesh.geometry.setDrawRange(0, alive);
    if (alive > 0) {
      this.sparkMesh.geometry.attributes.position.needsUpdate = true;
      this.sparkMesh.geometry.attributes.color.needsUpdate = true;
      this.sparkMesh.geometry.attributes.size.needsUpdate = true;
    }

    // feathers
    const m = this._fM, q = this._fQ, e = this._fE, s = this._fS, pos = this._fPos;
    let fAlive = 0;
    for (const f of this.featherData) {
      if (f.life <= 0) continue;
      f.life -= dt;
      f.vy -= 3.2 * dt;
      if (f.vy < -1.6) f.vy = -1.6;
      f.vx *= 1 - dt * 1.6; f.vz *= 1 - dt * 1.6;
      f.x += f.vx * dt + Math.sin(f.life * 9 + f.tilt) * dt * 1.4;
      f.y += f.vy * dt;
      f.z += f.vz * dt;
      f.rot += f.rotV * dt;
      const k = Math.min(1, f.life / 0.3);
      e.set(f.tilt + Math.sin(f.life * 7) * 0.6, f.rot, Math.cos(f.life * 8) * 0.5);
      q.setFromEuler(e);
      s.setScalar(f.size * k);
      pos.set(f.x, f.y, f.z);
      m.compose(pos, q, s);
      this.featherMesh.setMatrixAt(fAlive, m);
      fAlive++;
    }
    this.featherMesh.count = fAlive;
    if (fAlive > 0) {
      anyActive = true;
      this.featherMesh.instanceMatrix.needsUpdate = true;
    }

    // beams
    for (const b of this.beams) {
      if (b.life <= 0) { b.core.visible = b.glow.visible = false; continue; }
      anyActive = true;
      b.life -= dt;
      const k = Math.max(b.life / b.max, 0);
      b.core.material.opacity = k;
      b.glow.material.opacity = k * 0.45;
      const w = b.width * (0.6 + 0.4 * k);
      b.core.scale.x = b.core.scale.y = w;
      b.glow.scale.x = b.glow.scale.y = w * 3.4;
    }

    // flashes
    for (const f of this.flashes) {
      if (f.life <= 0) { f.mesh.visible = false; continue; }
      anyActive = true;
      f.life -= dt;
      const k = Math.max(f.life / f.max, 0);
      f.mesh.material.opacity = k * 0.85;
      const sc = f.size * (1.4 - k * 0.9);
      f.mesh.scale.setScalar(sc);
    }

    // lights
    for (const l of this.lights) {
      if (l.life <= 0) { l.light.intensity = 0; continue; }
      anyActive = true;
      l.life -= dt;
      l.light.intensity = (l.baseIntensity || 0) * Math.max(l.life / l.max, 0);
    }
  }
}
