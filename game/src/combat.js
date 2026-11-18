// Neon Harbor — combat: pistol shooting with tracers, melee punch,
// damage to pedestrians, cops and cars. Raycast-based, no hitscan cheats.
import * as THREE from 'three';
import { clamp } from './util.js';

export class Combat {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 90;
    this.ammo = 12;
    this.reserve = 48;
    this.cooldown = 0;
    this.muzzle = new THREE.PointLight(0xffc27a, 0, 12);
    this.scene.add(this.muzzle);
    // tracer pool
    this.tracers = [];
    const mat = new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95 });
    for (let i = 0; i < 16; i++) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(geo, mat.clone());
      line.visible = false;
      line.frustumCulled = false;
      scene.add(line);
      this.tracers.push({ line, life: 0 });
    }
    this.center = new THREE.Vector2(0, 0);
  }

  update(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    for (const t of this.tracers) {
      if (t.life > 0) {
        t.life -= dt;
        t.line.material.opacity = Math.max(0, t.life / 0.09);
        if (t.life <= 0) t.line.visible = false;
      }
    }
    this.muzzle.intensity = Math.max(0, this.muzzle.intensity - dt * 60);
  }

  // fire from the camera centre; returns what was hit
  shoot(origin, dir, targets) {
    if (this.cooldown > 0) return null;
    if (this.ammo <= 0) return { type: 'empty' };
    this.cooldown = 0.22;
    this.ammo -= 1;
    this.raycaster.set(origin, dir);
    const hits = this.raycaster.intersectObjects(targets, true);
    const end = hits.length ? hits[0].point : origin.clone().add(dir.clone().multiplyScalar(80));
    // tracer from the gun (just below camera) to impact
    const start = origin.clone().add(dir.clone().multiplyScalar(1.2));
    start.y -= 0.35;
    const t = this.tracers.find((x) => x.life <= 0) || this.tracers[0];
    t.line.geometry.setFromPoints([start, end]);
    t.line.visible = true;
    t.life = 0.09;
    this.muzzle.position.copy(start);
    this.muzzle.intensity = 6;
    if (!hits.length) return { type: 'miss', point: end };
    const hit = hits[0];
    let obj = hit.object;
    while (obj && !obj.userData.hitKind) obj = obj.parent;
    return { type: 'hit', kind: obj ? obj.userData.hitKind : null, ref: obj ? obj.userData.hitRef : null, point: hit.point };
  }

  reload() {
    if (this.ammo === 12 || this.reserve <= 0) return false;
    const need = 12 - this.ammo;
    const take = Math.min(need, this.reserve);
    this.ammo += take;
    this.reserve -= take;
    return true;
  }
}

// Simple particle bursts (impacts, smoke, sparks) as pooled points.
export class Particles {
  constructor(scene, max = 400) {
    this.scene = scene;
    this.max = max;
    this.positions = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.head = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    const mat = new THREE.PointsMaterial({ size: 0.55, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  burst(x, y, z, color, n = 14, speed = 6, up = 4) {
    for (let i = 0; i < n; i++) {
      const idx = this.head;
      this.head = (this.head + 1) % this.max;
      this.positions[idx * 3] = x;
      this.positions[idx * 3 + 1] = y;
      this.positions[idx * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.vel[idx * 3] = Math.cos(a) * s;
      this.vel[idx * 3 + 1] = Math.random() * up;
      this.vel[idx * 3 + 2] = Math.sin(a) * s;
      const c = new THREE.Color(color);
      this.colors[idx * 3] = c.r;
      this.colors[idx * 3 + 1] = c.g;
      this.colors[idx * 3 + 2] = c.b;
      this.life[idx] = 0.5 + Math.random() * 0.5;
    }
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.positions[i * 3 + 1] = -100; continue; }
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= 12 * dt;
      this.positions[i * 3] += this.vel[i * 3] * dt;
      this.positions[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.positions[i * 3 + 1] < 0.05) { this.positions[i * 3 + 1] = 0.05; this.vel[i * 3 + 1] = 0; }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

// Skid marks: fading dark quads left by hard cornering.
export class SkidMarks {
  constructor(scene, max = 120) {
    this.scene = scene;
    this.max = max;
    this.marks = [];
    const mat = new THREE.MeshBasicMaterial({ color: 0x141414, transparent: true, opacity: 0.55, depthWrite: false });
    this.geo = new THREE.PlaneGeometry(0.35, 1.6);
    this.mat = mat;
  }

  add(x, z, heading) {
    const m = new THREE.Mesh(this.geo, this.mat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = -heading;
    m.position.set(x, 0.09, z);
    this.scene.add(m);
    this.marks.push({ mesh: m, life: 6 });
    if (this.marks.length > this.max) {
      const old = this.marks.shift();
      this.scene.remove(old.mesh);
    }
  }

  update(dt) {
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const m = this.marks[i];
      m.life -= dt;
      if (m.life <= 0) {
        this.scene.remove(m.mesh);
        this.marks.splice(i, 1);
      } else if (m.life < 2) {
        m.mesh.material = m.mesh.material; // shared mat; fade via removal only
      }
    }
  }
}
