// Neon Harbor — the wanted system and the Harbor Police Department.
// Stars rise with crimes; police cars chase and ram, foot cops try to arrest.
// Break line of sight and stay quiet and the heat cools off.
import * as THREE from 'three';
import { Vehicle, VEHICLE_TYPES } from './vehicles.js';
import { buildPersonMesh } from './people.js';
import { clamp, angleLerp, randRange } from './util.js';

export class Police {
  constructor(scene, city) {
    this.scene = scene;
    this.city = city;
    this.wanted = 0;               // 0..5 stars
    this.heat = 0;                 // 0..100, drives star changes
    this.cars = [];
    this.cops = [];
    this.bustedT = 0;              // arrest progress while a cop is close
    this.coolT = 0;                // time since last crime
    this.spawnT = 0;
    this.sirenOn = false;
  }

  addHeat(amount, reason) {
    this.heat = clamp(this.heat + amount, 0, 100);
    this.coolT = 0;
    const stars = this.heat <= 0 ? 0 : this.heat < 18 ? 1 : this.heat < 38 ? 2 : this.heat < 58 ? 3 : this.heat < 80 ? 4 : 5;
    const rose = stars > this.wanted;
    this.wanted = stars;
    return { rose, stars, reason };
  }

  clearWanted() {
    this.wanted = 0;
    this.heat = 0;
    this.bustedT = 0;
    for (const c of this.cars) { this.scene.remove(c.mesh); }
    for (const c of this.cops) { this.scene.remove(c.mesh); }
    this.cars = [];
    this.cops = [];
  }

  spawnCarNear(px, pz) {
    const a = randRange(Math.random, 0, Math.PI * 2);
    const d = randRange(Math.random, 28, 42);
    let x = clamp(px + Math.sin(a) * d, -190, 190);
    let z = clamp(pz + Math.cos(a) * d, -190, 190);
    // snap onto a street
    const s = this.city.nearestStreet(x, z);
    if (Math.abs(x - s) < Math.abs(z - s)) x = s + 3.2; else z = s + 3.2;
    const v = new Vehicle(this.scene, 'police', x, z, Math.atan2(px - x, pz - z));
    v.driver = 'police';
    v.speed = 12;
    this.cars.push(v);
    return v;
  }

  spawnCopNear(px, pz) {
    const a = randRange(Math.random, 0, Math.PI * 2);
    const x = clamp(px + Math.sin(a) * 10, -190, 190);
    const z = clamp(pz + Math.cos(a) * 10, -190, 190);
    const mesh = buildPersonMesh(0x1a2a4a, 0xc98d5f, 1.08);
    mesh.position.set(x, 0, z);
    this.scene.add(mesh);
    const cop = { mesh, x, z, heading: a, speed: 0, health: 100, state: 'chase' };
    this.cops.push(cop);
    return cop;
  }

  update(dt, player, playerInCar, onBusted, onCopShot) {
    const px = player.x, pz = player.z;
    this.coolT += dt;
    // heat decays when quiet
    if (this.coolT > 6 && this.wanted > 0) {
      this.heat = Math.max(0, this.heat - dt * (playerInCar ? 1.2 : 2.2));
      const stars = this.heat <= 0 ? 0 : this.heat < 18 ? 1 : this.heat < 38 ? 2 : this.heat < 58 ? 3 : this.heat < 80 ? 4 : 5;
      if (stars < this.wanted) this.wanted = stars;
      if (this.wanted === 0) this.clearWanted();
    }
    this.sirenOn = this.wanted > 0;

    // maintain pursuit force
    const wantCars = this.wanted === 0 ? 0 : Math.min(1 + this.wanted, 5);
    const wantCops = this.wanted >= 3 ? Math.min(this.wanted - 1, 3) : 0;
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      if (this.cars.length < wantCars) this.spawnCarNear(px, pz);
      else if (this.cops.length < wantCops && !playerInCar) this.spawnCopNear(px, pz);
      this.spawnT = 1.2;
    }
    // despawn far units
    this.cars = this.cars.filter((c) => {
      const d = Math.hypot(c.x - px, c.z - pz);
      if (d > 130) { this.scene.remove(c.mesh); return false; }
      return true;
    });
    this.cops = this.cops.filter((c) => {
      const d = Math.hypot(c.x - px, c.z - pz);
      if (d > 90) { this.scene.remove(c.mesh); return false; }
      return true;
    });

    // police cars: chase and ram
    for (const c of this.cars) {
      const dx = px - c.x, dz = pz - c.z;
      const dist = Math.hypot(dx, dz);
      const targetHeading = Math.atan2(dx, dz);
      const steer = clamp(((targetHeading - c.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI, -1, 1);
      const speedTarget = dist > 14 ? VEHICLE_TYPES.police.topSpeed * (0.9 + this.wanted * 0.04) : VEHICLE_TYPES.police.topSpeed * 0.55;
      const input = { throttle: 1, steer, brake: dist < 3, boost: false };
      // slow down a touch when about to ram so it reads as a hit, not a pass-through
      const before = c.speed;
      c.drive(dt, input, this.city);
      // override top speed toward the chase target
      if (c.speed > speedTarget) c.speed = Math.max(speedTarget, c.speed - 30 * dt);
      // flash light bar
      c.sirenPhase += dt * 8;
      const on = Math.sin(c.sirenPhase) > 0;
      if (c.mesh.userData.lightR) {
        c.mesh.userData.lightR.material.color.setHex(on ? 0xff2e2e : 0x550000);
        c.mesh.userData.lightB.material.color.setHex(on ? 0x001155 : 0x2e6bff);
      }
      // ram damage: touching the player's car or body
      if (dist < 3.4) {
        if (playerInCar) {
          playerInCar.speed *= 0.94;
          playerInCar.health -= dt * 12;
        } else if (before > 8) {
          player.health -= dt * 30;
        }
      }
    }

    // foot cops: run at the player, arrest if close and player is slow/on foot
    let copNear = false;
    for (const cop of this.cops) {
      const dx = px - cop.x, dz = pz - cop.z;
      const dist = Math.hypot(dx, dz);
      cop.heading = Math.atan2(dx, dz);
      const spd = dist > 2 ? (playerInCar ? 6.5 : 5.4) : 0;
      cop.x += Math.sin(cop.heading) * spd * dt;
      cop.z += Math.cos(cop.heading) * spd * dt;
      cop.mesh.position.set(cop.x, 0, cop.z);
      cop.mesh.rotation.y = cop.heading;
      const swing = Math.sin(performance.now() * 0.012) * 0.5;
      cop.mesh.userData.armL.rotation.x = swing;
      cop.mesh.userData.armR.rotation.x = -swing;
      if (!playerInCar && dist < 2.6) copNear = true;
    }
    if (copNear || (this.cars.some((c) => Math.hypot(c.x - px, c.z - pz) < 3.2) && !playerInCar && Math.abs(player.speed) < 1)) {
      this.bustedT += dt;
      if (this.bustedT > 1.6) { this.bustedT = 0; onBusted(); }
    } else {
      this.bustedT = Math.max(0, this.bustedT - dt * 2);
    }
    return { bustedProgress: clamp(this.bustedT / 1.6, 0, 1) };
  }
}
