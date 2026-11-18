// Neon Harbor — vehicles: car factory, arcade driving, traffic AI.
// All vehicle types are original designs for this game.
import * as THREE from 'three';
import { mulberry32, randRange, pick, clamp, angleLerp } from './util.js';

export const VEHICLE_TYPES = {
  sedan:   { name: 'Delmar Sedan',   topSpeed: 26, accel: 14, grip: 2.6, len: 4.4, wid: 1.9, colors: [0x8a2f2f, 0x2f4a6b, 0x5a5a5a, 0x7a6a3a] },
  taxi:    { name: 'Harbor Taxi',    topSpeed: 24, accel: 13, grip: 2.6, len: 4.4, wid: 1.9, colors: [0xe8b31a] },
  sports:  { name: 'Vortex GT',      topSpeed: 38, accel: 22, grip: 3.4, len: 4.2, wid: 2.0, colors: [0xc2185b, 0x19d3c5, 0xffc233] },
  van:     { name: 'Port Van',       topSpeed: 20, accel: 10, grip: 2.2, len: 5.2, wid: 2.1, colors: [0xe8e4da, 0x3a6b8a] },
  truck:   { name: 'Dock Truck',     topSpeed: 18, accel: 9,  grip: 2.0, len: 6.4, wid: 2.3, colors: [0x4a6b3a, 0x6b4a2f] },
  police:  { name: 'HPD Interceptor',topSpeed: 32, accel: 19, grip: 3.2, len: 4.5, wid: 2.0, colors: [0x1a1d22] },
};

const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10);
const wheelMat = new THREE.MeshLambertMaterial({ color: 0x141414 });
const hubGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.32, 8);
const hubMat = new THREE.MeshLambertMaterial({ color: 0x9aa3ad });

export function buildCarMesh(typeKey, color) {
  const type = VEHICLE_TYPES[typeKey];
  const g = new THREE.Group();
  g.name = `car-${typeKey}`;
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x1c2b3a });
  const body = new THREE.Mesh(new THREE.BoxGeometry(type.wid, 0.75, type.len), bodyMat);
  body.position.y = 0.55;
  g.add(body);
  const cabinH = typeKey === 'van' || typeKey === 'truck' ? 1.0 : 0.62;
  const cabinLen = typeKey === 'truck' ? 1.4 : type.len * 0.5;
  const cabinZ = typeKey === 'truck' ? type.len * 0.28 : -type.len * 0.05;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(type.wid * 0.88, cabinH, cabinLen), typeKey === 'van' ? bodyMat : glassMat);
  cabin.position.set(0, 0.95 + cabinH / 2 - 0.2, cabinZ);
  g.add(cabin);
  if (typeKey === 'truck') {
    const bed = new THREE.Mesh(new THREE.BoxGeometry(type.wid * 0.95, 0.9, type.len * 0.45), new THREE.MeshLambertMaterial({ color: 0x5a5f66 }));
    bed.position.set(0, 0.85, -type.len * 0.24);
    g.add(bed);
  }
  // headlights + taillights
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2e2e });
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.1), lightMat);
    hl.position.set(sx * (type.wid / 2 - 0.3), 0.55, type.len / 2 + 0.02);
    g.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.1), tailMat);
    tl.position.set(sx * (type.wid / 2 - 0.3), 0.55, -type.len / 2 - 0.02);
    g.add(tl);
  }
  if (typeKey === 'taxi') {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.22, 0.4), new THREE.MeshBasicMaterial({ color: 0xffc233 }));
    sign.position.set(0, 1.55, 0);
    g.add(sign);
  }
  if (typeKey === 'police') {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.16, 0.4), new THREE.MeshLambertMaterial({ color: 0x111111 }));
    bar.position.set(0, 1.5, 0);
    g.add(bar);
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.42), new THREE.MeshBasicMaterial({ color: 0xff2e2e }));
    r.position.set(-0.28, 1.52, 0);
    g.add(r);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.42), new THREE.MeshBasicMaterial({ color: 0x2e6bff }));
    b.position.set(0.28, 1.52, 0);
    g.add(b);
    g.userData.lightR = r;
    g.userData.lightB = b;
  }
  // wheels
  const wheels = [];
  for (const [wx, wz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const w = new THREE.Group();
    const tire = new THREE.Mesh(wheelGeo, wheelMat);
    tire.rotation.z = Math.PI / 2;
    const hub = new THREE.Mesh(hubGeo, hubMat);
    hub.rotation.z = Math.PI / 2;
    w.add(tire, hub);
    w.position.set(wx * (type.wid / 2 - 0.05), 0.38, wz * (type.len / 2 - 0.85));
    g.add(w);
    wheels.push(w);
  }
  g.userData.wheels = wheels;
  return g;
}

// A drivable / traffic vehicle instance.
export class Vehicle {
  constructor(scene, typeKey, x, z, heading, color) {
    this.typeKey = typeKey;
    this.type = VEHICLE_TYPES[typeKey];
    this.color = color ?? pick(Math.random, this.type.colors);
    this.mesh = buildCarMesh(typeKey, this.color);
    this.mesh.position.set(x, 0, z);
    this.mesh.rotation.y = heading;
    scene.add(this.mesh);
    this.x = x; this.z = z;
    this.heading = heading;
    this.speed = 0;
    this.steer = 0;
    this.driver = null;      // 'player' | 'traffic' | 'police' | null (parked)
    this.health = 100;
    this.sirenPhase = 0;
    this.skid = 0;
  }

  get forwardX() { return Math.sin(this.heading); }
  get forwardZ() { return Math.cos(this.heading); }

  // Arcade driving step. input: {throttle, steer, brake, boost}
  drive(dt, input, city) {
    const t = this.type;
    const target = input.throttle * t.topSpeed * (input.boost ? 1.25 : 1);
    const rate = input.throttle !== 0 ? t.accel : 8;
    if (this.speed < target) this.speed = Math.min(target, this.speed + rate * dt);
    else this.speed = Math.max(target, this.speed - rate * 1.6 * dt);
    if (input.brake) this.speed = Math.max(0, this.speed - 26 * dt);
    const spd = Math.abs(this.speed);
    const steerTarget = input.steer * (spd > 0.5 ? 1 : 0) * (this.speed >= 0 ? 1 : -1);
    this.steer += (steerTarget - this.steer) * Math.min(1, dt * 8);
    const turnRate = this.steer * 1.9 * clamp(spd / 10, 0, 1) * (spd > 18 ? 0.75 : 1);
    this.heading += turnRate * dt * (this.speed >= 0 ? 1 : -1);
    let nx = this.x + this.forwardX * this.speed * dt;
    let nz = this.z + this.forwardZ * this.speed * dt;
    const fixed = city.collideCircle(nx, nz, 1.6);
    if (fixed.x !== nx || fixed.z !== nz) {
      // hit a wall: scrape speed off
      this.speed *= 0.55;
      nx = fixed.x; nz = fixed.z;
    }
    this.x = nx; this.z = nz;
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = this.heading;
    // body roll + wheel spin
    this.mesh.rotation.z = -this.steer * 0.05 * clamp(spd / 12, 0, 1);
    const spin = this.speed * dt * 2.6;
    for (const w of this.mesh.userData.wheels) w.rotation.x += spin;
    const frontL = this.mesh.userData.wheels[0], frontR = this.mesh.userData.wheels[1];
    if (frontL) { frontL.rotation.y = this.steer * 0.4; frontR.rotation.y = this.steer * 0.4; }
    this.skid = Math.abs(this.steer) > 0.7 && spd > 12 ? 1 : 0;
  }
}

// Traffic: cars that cruise the street grid and turn at intersections.
export function createTraffic(scene, city, count = 14) {
  const rng = mulberry32(777);
  const cars = [];
  const keys = ['sedan', 'sedan', 'taxi', 'van', 'sports', 'truck'];
  for (let i = 0; i < count; i++) {
    const street = pick(rng, city.streets);
    const along = randRange(rng, -170, 170);
    const horizontal = rng() < 0.5;
    const lane = pick(rng, [-3.2, 3.2]);
    const x = horizontal ? along : street + lane;
    const z = horizontal ? street + lane : along;
    const heading = horizontal ? (lane > 0 ? Math.PI / 2 : -Math.PI / 2) : (lane > 0 ? 0 : Math.PI);
    const v = new Vehicle(scene, pick(rng, keys), x, z, heading);
    v.driver = 'traffic';
    v.speed = randRange(rng, 7, 11);
    v.cruise = v.speed;
    cars.push(v);
  }
  return {
    cars,
    update(dt, playerPos, policeActive) {
      for (const v of cars) {
        // slow for the player in front, then keep cruising
        const dx = playerPos.x - v.x, dz = playerPos.z - v.z;
        const ahead = dx * v.forwardX + dz * v.forwardZ;
        const dist = Math.hypot(dx, dz);
        let target = v.cruise;
        if (ahead > 0 && ahead < 12 && dist < 8) target = 0;
        if (policeActive && dist < 10) target = 0; // pull over for sirens
        v.speed += (target - v.speed) * Math.min(1, dt * 1.5);
        let nx = v.x + v.forwardX * v.speed * dt;
        let nz = v.z + v.forwardZ * v.speed * dt;
        // at an intersection, maybe turn
        const nearInt = Math.abs(((nx % 40) + 40) % 40 - 20) < 2.5 || Math.abs(((nz % 40) + 40) % 40 - 20) < 2.5;
        const onStreetX = city.streets.some((c) => Math.abs(nz - c) < 4);
        const onStreetZ = city.streets.some((c) => Math.abs(nx - c) < 4);
        if (onStreetX && onStreetZ && rng() < dt * 0.35) {
          // turn 90 degrees at random
          const turn = pick(rng, [-Math.PI / 2, Math.PI / 2]);
          v.heading = Math.round((v.heading + turn) / (Math.PI / 2)) * (Math.PI / 2);
          // snap onto the new street centre lane
          const lane = 3.2 * (rng() < 0.5 ? 1 : -1);
          if (Math.abs(Math.sin(v.heading)) > 0.5) { v.z = city.nearestStreet(v.x, v.z) + lane; }
          else { v.x = city.nearestStreet(v.x, v.z) + lane; }
        }
        const fixed = city.collideCircle(nx, nz, 1.6);
        v.x = fixed.x; v.z = fixed.z;
        v.mesh.position.set(v.x, 0, v.z);
        v.mesh.rotation.y = v.heading;
        const spin = v.speed * dt * 2.6;
        for (const w of v.mesh.userData.wheels) w.rotation.x += spin;
      }
    },
  };
}
