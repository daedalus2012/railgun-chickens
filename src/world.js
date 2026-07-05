import * as THREE from 'three';

// ---------------- Terrain shape ----------------
const HILL_LENGTH = 150;   // z from 0 (base) to -150 (top)
const HILL_HEIGHT = 42;

function slopeH(z) {
  const t = THREE.MathUtils.clamp(-z / HILL_LENGTH, 0, 1);
  return t * t * (3 - 2 * t) * HILL_HEIGHT;
}

function bumps(x, z) {
  return (
    Math.sin(x * 0.14 + 1.7) * Math.cos(z * 0.11) * 1.3 +
    Math.sin(x * 0.31 + z * 0.23) * 0.7 +
    Math.sin(x * 0.05 - z * 0.07) * 1.8
  );
}

export function terrainHeight(x, z) {
  let h = slopeH(z);
  const t = THREE.MathUtils.clamp(-z / HILL_LENGTH, 0, 1);
  h += Math.pow(Math.abs(x) / 62, 2.2) * 26 * (0.35 + 0.65 * t);
  const path = Math.max(0, 1 - Math.abs(x) / 9);
  h += bumps(x, z) * (0.25 + 0.75 * t) * (1 - path * 0.85);
  return h;
}

// Precomputed height field — bilinear lookup for hot paths (chicken movement)
const CACHE_W = 72, CACHE_D = 104;
const CACHE_X0 = -78, CACHE_Z0 = -174;
const CACHE_XS = 156 / CACHE_W, CACHE_ZS = 198 / CACHE_D;
const _heightCache = new Float32Array(CACHE_W * CACHE_D);
for (let iz = 0; iz < CACHE_D; iz++) {
  for (let ix = 0; ix < CACHE_W; ix++) {
    const x = CACHE_X0 + (ix + 0.5) * CACHE_XS;
    const z = CACHE_Z0 + (iz + 0.5) * CACHE_ZS;
    _heightCache[iz * CACHE_W + ix] = terrainHeight(x, z);
  }
}

export function terrainHeightFast(x, z) {
  const fx = (x - CACHE_X0) / CACHE_XS;
  const fz = (z - CACHE_Z0) / CACHE_ZS;
  if (fx < 0 || fz < 0 || fx >= CACHE_W - 1 || fz >= CACHE_D - 1) return terrainHeight(x, z);
  const ix = fx | 0, iz = fz | 0;
  const tx = fx - ix, tz = fz - iz;
  const i00 = iz * CACHE_W + ix;
  const i10 = i00 + 1, i01 = i00 + CACHE_W, i11 = i01 + 1;
  const h0 = _heightCache[i00] + (_heightCache[i10] - _heightCache[i00]) * tx;
  const h1 = _heightCache[i01] + (_heightCache[i11] - _heightCache[i01]) * tx;
  return h0 + (h1 - h0) * tz;
}

// March a ray until it dips below the terrain. Returns distance or null.
export function raycastTerrain(origin, dir, maxDist = 400) {
  let last = 0;
  for (let d = 2; d < maxDist; d += 2) {
    const x = origin.x + dir.x * d;
    const y = origin.y + dir.y * d;
    const z = origin.z + dir.z * d;
    if (y < terrainHeight(x, z)) {
      // refine between last and d
      let lo = last, hi = d;
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        const my = origin.y + dir.y * mid;
        if (my < terrainHeight(origin.x + dir.x * mid, origin.z + dir.z * mid)) hi = mid;
        else lo = mid;
      }
      return hi;
    }
    last = d;
  }
  return null;
}

// ---------------- World ----------------
export class World {
  constructor(scene, renderer) {
    this.scene = scene;
    this.time = 0;
    this.windUniforms = [];

    this.buildSky(scene);
    this.buildLights(scene);
    this.buildTerrain(scene);
    this.buildGrass(scene);
    this.buildProps(scene);

    scene.fog = new THREE.Fog(0xc9b8a6, 70, 320);
  }

  buildSky(scene) {
    const geo = new THREE.SphereGeometry(700, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x3a6ea8) },
        midColor: { value: new THREE.Color(0x9cb8cf) },
        horizonColor: { value: new THREE.Color(0xf2c98f) },
        sunDir: { value: new THREE.Vector3(-0.35, 0.28, -0.89).normalize() },
        sunColor: { value: new THREE.Color(0xffd9a0) },
      },
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 topColor, midColor, horizonColor, sunColor, sunDir;
        varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y, 0.0, 1.0);
          vec3 col = mix(horizonColor, midColor, smoothstep(0.0, 0.18, h));
          col = mix(col, topColor, smoothstep(0.12, 0.65, h));
          float sun = max(dot(normalize(vDir), sunDir), 0.0);
          col += sunColor * pow(sun, 220.0) * 1.6;   // disc
          col += sunColor * pow(sun, 8.0) * 0.28;    // haze
          // below horizon: ground haze
          col = mix(col, horizonColor * 0.85, smoothstep(0.0, -0.15, vDir.y));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    scene.add(new THREE.Mesh(geo, mat));
  }

  buildLights(scene) {
    const hemi = new THREE.HemisphereLight(0xaec8e8, 0x6b5b43, 0.85);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffe0b0, 2.6);
    sun.position.set(-70, 90, -140);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.autoUpdate = false;
    sun.shadow.needsUpdate = true;
    const cam = sun.shadow.camera;
    cam.left = -90; cam.right = 90; cam.top = 120; cam.bottom = -60;
    cam.near = 20; cam.far = 420;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.6;
    sun.target.position.set(0, 10, -60);
    scene.add(sun, sun.target);
    this.sun = sun;
  }

  buildTerrain(scene) {
    const W = 240, D = 260, SEG = 140;
    const geo = new THREE.PlaneGeometry(W, D, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    // center the play area: z from -190 to +70
    geo.translate(0, 0, -60);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const grassA = new THREE.Color(0x5e8f3e);
    const grassB = new THREE.Color(0x8fae54);
    const dirt = new THREE.Color(0x8a6a44);
    const rock = new THREE.Color(0x8d8578);
    const c = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = terrainHeight(x, z);
      pos.setY(i, h);

      const n = (bumps(x * 2.3, z * 1.9) + 2) / 4; // 0..1
      c.copy(grassA).lerp(grassB, n);
      // dirt path
      const pathW = 6.5 + Math.sin(z * 0.08) * 1.5;
      const pathMix = THREE.MathUtils.smoothstep(pathW - Math.abs(x + Math.sin(z * 0.05) * 2), 0, 3.5);
      c.lerp(dirt, pathMix * 0.9);
      // rocky at steep valley walls
      const wall = THREE.MathUtils.smoothstep(Math.abs(x), 40, 75);
      c.lerp(rock, wall * 0.7);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.94, metalness: 0.0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  buildGrass(scene) {
    const COUNT = 5200;
    const blade = new THREE.PlaneGeometry(0.16, 1, 1, 3);
    blade.translate(0, 0.5, 0);

    const mat = new THREE.MeshStandardMaterial({
      color: 0x7da84e, roughness: 0.9, side: THREE.DoubleSide,
    });
    // wind sway via vertex shader injection
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      this.windUniforms.push(shader.uniforms.uTime);
      shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float sway = sin(uTime * 1.7 + wp.x * 0.35 + wp.z * 0.5) * 0.5
                     + sin(uTime * 3.3 + wp.z * 0.8) * 0.22;
          float k = position.y * position.y; // bend more at tip
          transformed.x += sway * k * 0.55;
          transformed.z += sway * k * 0.2;
        }`
      );
    };

    const inst = new THREE.InstancedMesh(blade, mat, COUNT);
    inst.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    const e = new THREE.Euler();
    const color = new THREE.Color();
    let placed = 0, guard = 0;
    while (placed < COUNT && guard++ < COUNT * 8) {
      const x = (Math.random() - 0.5) * 150;
      const z = -170 + Math.random() * 195;
      if (Math.abs(x + Math.sin(z * 0.05) * 2) < 7.5 && z < 8) continue; // keep path clear
      if (z > 0 && Math.abs(x) < 6 && z < 12) continue;                  // clear around turret
      const y = terrainHeight(x, z);
      if (y > 55) continue;
      e.set((Math.random() - 0.5) * 0.25, Math.random() * Math.PI, 0);
      q.setFromEuler(e);
      const sc = 0.7 + Math.random() * 0.9;
      s.set(sc, sc * (0.8 + Math.random() * 0.7), sc);
      m.compose(new THREE.Vector3(x, y - 0.05, z), q, s);
      inst.setMatrixAt(placed, m);
      color.setHSL(0.24 + Math.random() * 0.05, 0.5, 0.32 + Math.random() * 0.14);
      inst.setColorAt(placed, color);
      placed++;
    }
    inst.count = placed;
    inst.frustumCulled = false;
    scene.add(inst);
  }

  buildProps(scene) {
    const props = new THREE.Group();

    // --- rocks ---
    const rockGeo = new THREE.IcosahedronGeometry(1, 1);
    {
      const p = rockGeo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        p.setXYZ(i,
          p.getX(i) * (0.8 + Math.random() * 0.5),
          p.getY(i) * (0.6 + Math.random() * 0.5),
          p.getZ(i) * (0.8 + Math.random() * 0.5));
      }
      rockGeo.computeVertexNormals();
    }
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8b8478, roughness: 0.95 });
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 40);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let i = 0; i < 40; i++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const x = side * (12 + Math.random() * 45);
      const z = -160 + Math.random() * 165;
      const sc = 0.6 + Math.random() * 2.2;
      e.set(Math.random() * 0.4, Math.random() * Math.PI * 2, Math.random() * 0.4);
      q.setFromEuler(e);
      m.compose(
        new THREE.Vector3(x, terrainHeight(x, z) - sc * 0.25, z),
        q, new THREE.Vector3(sc, sc * 0.8, sc));
      rocks.setMatrixAt(i, m);
    }
    rocks.castShadow = rocks.receiveShadow = true;
    props.add(rocks);

    // --- low-poly pines ---
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 2.2, 6);
    trunkGeo.translate(0, 1.1, 0);
    const leafGeo = new THREE.ConeGeometry(1.9, 4.6, 7);
    leafGeo.translate(0, 4.2, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.9 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f5d33, roughness: 0.85 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, 26);
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, 26);
    for (let i = 0; i < 26; i++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const x = side * (16 + Math.random() * 42);
      const z = -165 + Math.random() * 160;
      const sc = 0.8 + Math.random() * 1.4;
      q.setFromEuler(e.set(0, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.08));
      m.compose(new THREE.Vector3(x, terrainHeight(x, z) - 0.1, z), q, new THREE.Vector3(sc, sc, sc));
      trunks.setMatrixAt(i, m);
      leaves.setMatrixAt(i, m);
    }
    trunks.castShadow = leaves.castShadow = true;
    trunks.receiveShadow = leaves.receiveShadow = true;
    props.add(trunks, leaves);

    // --- fences near the base ---
    const postGeo = new THREE.BoxGeometry(0.18, 1.2, 0.18);
    postGeo.translate(0, 0.6, 0);
    const railGeo = new THREE.BoxGeometry(2.1, 0.1, 0.08);
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x7a5c3a, roughness: 0.9 });
    const fence = new THREE.Group();
    for (const side of [-1, 1]) {
      for (let i = 0; i < 7; i++) {
        const x = side * (9 + i * 2.0);
        const z = 2 - i * 0.6;
        const y = terrainHeight(x, z);
        const post = new THREE.Mesh(postGeo, woodMat);
        post.position.set(x, y, z);
        post.castShadow = true;
        fence.add(post);
        if (i > 0) {
          const px = side * (9 + (i - 0.5) * 2.0);
          const pz = 2 - (i - 0.5) * 0.6;
          const py = terrainHeight(px, pz);
          for (const ry of [0.45, 0.95]) {
            const rail = new THREE.Mesh(railGeo, woodMat);
            rail.position.set(px, py + ry, pz);
            rail.rotation.y = -side * 0.29;
            rail.castShadow = true;
            fence.add(rail);
          }
        }
      }
    }
    props.add(fence);
    scene.add(props);
  }

  update(dt, renderer) {
    this.time += dt;
    for (const u of this.windUniforms) u.value = this.time;
    // Shadow refresh every other frame — chickens still move smoothly, halves shadow pass cost
    if (renderer?.shadowMap) {
      this._shadowTick = (this._shadowTick || 0) + 1;
      if (this._shadowTick >= 2) {
        this._shadowTick = 0;
        if (this.sun?.shadow) this.sun.shadow.needsUpdate = true;
      }
    }
  }
}
