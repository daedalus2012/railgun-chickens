import * as THREE from 'three';

// Futuristic railgun turret: base platform, rotating yoke, elevating twin-rail barrel.
export class Turret {
  constructor(scene) {
    this.group = new THREE.Group();
    this.yaw = 0;
    this.pitch = 0.06;
    this.recoil = 0;
    this.heat = 0;

    const gunMetal = new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: 0.38, metalness: 0.85 });
    const darkMetal = new THREE.MeshStandardMaterial({ color: 0x22262e, roughness: 0.5, metalness: 0.8 });
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0x0a2a38, roughness: 0.3, metalness: 0.6,
      emissive: 0x2fc4e8, emissiveIntensity: 1.6,
    });
    this.accentMat = accentMat;

    // --- base platform ---
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.9, 0.5, 10), darkMetal);
    plat.position.y = 0.25;
    const platTrim = new THREE.Mesh(new THREE.TorusGeometry(2.45, 0.07, 8, 24), accentMat);
    platTrim.rotation.x = Math.PI / 2;
    platTrim.position.y = 0.52;
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.3, 1.0, 8), gunMetal);
    pedestal.position.y = 0.95;
    this.group.add(plat, platTrim, pedestal);

    // --- yaw assembly ---
    this.yawGroup = new THREE.Group();
    this.yawGroup.position.y = 1.5;
    this.group.add(this.yawGroup);

    const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.1, 0.6, 8), darkMetal);
    this.yawGroup.add(hub);
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.15, 0.9), gunMetal);
      arm.position.set(s * 0.85, 0.7, 0);
      this.yawGroup.add(arm);
    }

    // --- pitch assembly (the gun itself) ---
    this.pitchGroup = new THREE.Group();
    this.pitchGroup.position.y = 1.15;
    this.yawGroup.add(this.pitchGroup);

    // recoil carriage: everything that slides back on fire
    this.carriage = new THREE.Group();
    this.pitchGroup.add(this.carriage);

    const body = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.85, 2.6), gunMetal);
    body.position.z = 0.3;
    const bodyTop = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.3, 1.8), darkMetal);
    bodyTop.position.set(0, 0.55, 0.3);
    this.carriage.add(body, bodyTop);

    // twin rails
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.34, 4.4), gunMetal);
      rail.position.set(s * 0.3, 0, -3.0);
      const glowStrip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 4.2), accentMat);
      glowStrip.position.set(s * 0.21, 0, -3.0);
      this.carriage.add(rail, glowStrip);
    }
    // rail spacers
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.6, 0.14), darkMetal);
      ring.position.set(0, 0, -1.4 - i * 1.05);
      this.carriage.add(ring);
    }
    // muzzle emitter
    const muzzleRing = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.09, 8, 16), accentMat);
    muzzleRing.position.z = -5.25;
    this.carriage.add(muzzleRing);

    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0, -5.3);
    this.carriage.add(this.muzzle);

    // capacitor coils on the back
    for (const s of [-1, 1]) {
      const coil = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 1.2, 8), darkMetal);
      coil.rotation.x = Math.PI / 2;
      coil.position.set(s * 0.42, 0.32, 1.6);
      const coilGlow = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1.25, 8), accentMat);
      coilGlow.rotation.x = Math.PI / 2;
      coilGlow.position.copy(coil.position);
      this.carriage.add(coil, coilGlow);
    }

    this.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.group.position.set(0, 0.1, 12);
    scene.add(this.group);
  }

  aim(yaw, pitch, dt) {
    // smooth but responsive tracking
    const k = 1 - Math.pow(0.0001, dt);
    this.yaw += (yaw - this.yaw) * k;
    this.pitch += (pitch - this.pitch) * k;
    this.yawGroup.rotation.y = this.yaw;
    this.pitchGroup.rotation.x = this.pitch;
  }

  fire() {
    this.recoil = 1;
    this.heat = Math.min(1, this.heat + 0.35);
  }

  update(dt) {
    this.recoil = Math.max(0, this.recoil - dt * 5.5);
    this.heat = Math.max(0, this.heat - dt * 0.8);
    // snap back fast, return slow
    const r = this.recoil * this.recoil;
    this.carriage.position.z = r * 0.55;
    this.carriage.rotation.x = -r * 0.02;
    this.accentMat.emissiveIntensity = 1.4 + this.heat * 2.6 + this.recoil * 4;
  }

  getMuzzleWorld(target) {
    return this.muzzle.getWorldPosition(target);
  }
}
