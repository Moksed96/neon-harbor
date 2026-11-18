// Neon Harbor — people: the player character on foot and city pedestrians.
// Original character designs built from simple geometry.
import * as THREE from 'three';
import { mulberry32, randRange, pick, clamp } from './util.js';

const SHIRT_COLORS = [0xd95f4b, 0x4b7ad9, 0x5fae5f, 0xe8c84a, 0x9b5fd9, 0xe8e4da, 0x3a3f46];
const SKIN_COLORS = [0xe8b98a, 0xc98d5f, 0x8a5a3b, 0xf0c8a0];

export function buildPersonMesh(shirt, skin, scale = 1) {
  const g = new THREE.Group();
  g.name = 'person';
  const shirtMat = new THREE.MeshLambertMaterial({ color: shirt });
  const skinMat = new THREE.MeshLambertMaterial({ color: skin });
  const pantsMat = new THREE.MeshLambertMaterial({ color: 0x2b3242 });
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.8, 0.24), pantsMat);
  legs.position.y = 0.4;
  g.add(legs);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), shirtMat);
  torso.position.y = 1.11;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), skinMat);
  head.position.y = 1.62;
  g.add(head);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.4),
    new THREE.MeshLambertMaterial({ color: 0x1d2126 }));
  cap.position.y = 1.66;
  g.add(cap);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.6, 0.14), shirtMat);
  armL.position.set(-0.34, 1.1, 0);
  g.add(armL);
  const armR = armL.clone();
  armR.position.x = 0.34;
  g.add(armR);
  g.userData.armL = armL;
  g.userData.armR = armR;
  g.scale.setScalar(scale);
  return g;
}

// The player on foot: WASD movement relative to camera yaw, sprint, punch.
export class Player {
  constructor(scene, x, z) {
    this.mesh = buildPersonMesh(0xff2e88, 0xe8b98a, 1.05);
    this.mesh.position.set(x, 0, z);
    scene.add(this.mesh);
    this.x = x; this.z = z;
    this.yaw = Math.PI;       // facing direction
    this.camYaw = Math.PI;    // camera orbit yaw
    this.speed = 0;
    this.health = 100;
    this.inCar = null;        // Vehicle or null
    this.punchTimer = 0;
    this.walkPhase = 0;
  }

  update(dt, input, city) {
    if (this.inCar) return;
    const sprint = input.sprint ? 1.55 : 1;
    const maxSpeed = 6.2 * sprint;
    let mx = 0, mz = 0;
    if (input.forward) { mx += Math.sin(this.camYaw); mz += Math.cos(this.camYaw); }
    if (input.back) { mx -= Math.sin(this.camYaw); mz -= Math.cos(this.camYaw); }
    if (input.left) { mx += Math.sin(this.camYaw - Math.PI / 2); mz += Math.cos(this.camYaw - Math.PI / 2); }
    if (input.right) { mx += Math.sin(this.camYaw + Math.PI / 2); mz += Math.cos(this.camYaw + Math.PI / 2); }
    const len = Math.hypot(mx, mz);
    const target = len > 0 ? maxSpeed : 0;
    this.speed += (target - this.speed) * Math.min(1, dt * 10);
    if (len > 0) {
      mx /= len; mz /= len;
      this.yaw = Math.atan2(mx, mz);
      const nx = this.x + mx * this.speed * dt;
      const nz = this.z + mz * this.speed * dt;
      const fixed = city.collideCircle(nx, nz, 0.6);
      this.x = fixed.x; this.z = fixed.z;
      this.walkPhase += dt * this.speed * 1.6;
    }
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = this.yaw;
    // walk swing
    const swing = Math.sin(this.walkPhase) * 0.5 * clamp(this.speed / 6, 0, 1);
    this.mesh.userData.armL.rotation.x = swing;
    this.mesh.userData.armR.rotation.x = -swing;
    // punch animation
    if (this.punchTimer > 0) {
      this.punchTimer -= dt;
      const p = 1 - this.punchTimer / 0.35;
      this.mesh.userData.armR.rotation.x = -1.4 * Math.sin(p * Math.PI);
    }
  }
}

// Pedestrians: wander the sidewalks, scatter when scared.
export function createPedestrians(scene, city, count = 22) {
  const rng = mulberry32(4242);
  const peds = [];
  for (let i = 0; i < count; i++) {
    const street = pick(rng, city.streets);
    const along = randRange(rng, -170, 170);
    const side = pick(rng, [-9.5, 9.5]);
    const horizontal = rng() < 0.5;
    const x = horizontal ? along : street + side;
    const z = horizontal ? street + side : along;
    const mesh = buildPersonMesh(pick(rng, SHIRT_COLORS), pick(rng, SKIN_COLORS));
    mesh.position.set(x, 0, z);
    scene.add(mesh);
    peds.push({
      mesh, x, z,
      heading: randRange(rng, 0, Math.PI * 2),
      speed: randRange(rng, 1.2, 2.2),
      state: 'walk',       // walk | flee | down
      stateT: randRange(rng, 2, 8),
      health: 100,
      walkPhase: randRange(rng, 0, 6),
    });
  }
  return {
    peds,
    update(dt, danger) {
      // danger: {x, z, radius, kind} — a car or gunshot that scares people
      for (const p of peds) {
        if (p.state === 'down') continue;
        p.stateT -= dt;
        let scared = false;
        if (danger) {
          const d2 = (p.x - danger.x) ** 2 + (p.z - danger.z) ** 2;
          if (d2 < danger.radius * danger.radius) scared = true;
        }
        if (scared && p.state !== 'flee') { p.state = 'flee'; p.stateT = randRange(rng, 2, 4); }
        if (p.state === 'flee') {
          const dx = p.x - danger.x, dz = p.z - danger.z;
          const d = Math.hypot(dx, dz) || 1;
          p.heading = Math.atan2(dx / d, dz / d);
          p.speed = 5.2;
          if (p.stateT <= 0) { p.state = 'walk'; p.speed = randRange(rng, 1.2, 2.2); }
        } else {
          if (p.stateT <= 0) {
            p.heading += randRange(rng, -1.2, 1.2);
            p.stateT = randRange(rng, 3, 9);
          }
        }
        const nx = p.x + Math.sin(p.heading) * p.speed * dt;
        const nz = p.z + Math.cos(p.heading) * p.speed * dt;
        const fixed = city.collideCircle(nx, nz, 0.5);
        // peds avoid the water / road centre: nudge back onto sidewalks
        p.x = fixed.x; p.z = fixed.z;
        p.walkPhase += dt * p.speed * 2.2;
        p.mesh.position.set(p.x, 0, p.z);
        p.mesh.rotation.y = p.heading;
        const swing = Math.sin(p.walkPhase) * 0.45;
        p.mesh.userData.armL.rotation.x = swing;
        p.mesh.userData.armR.rotation.x = -swing;
      }
    },
    // nearest pedestrian within range of a point
    nearest(x, z, range) {
      let best = null, bd = range * range;
      for (const p of peds) {
        if (p.state === 'down') continue;
        const d2 = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d2 < bd) { bd = d2; best = p; }
      }
      return best;
    },
    respawn(p) {
      p.state = 'walk';
      p.health = 100;
      p.mesh.visible = true;
      p.mesh.rotation.x = 0;
    },
  };
}
