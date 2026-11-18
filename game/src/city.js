// Neon Harbor — the city of Port Delmar.
// A sun-soaked harbor city on a street grid: Downtown towers in the middle,
// the Marina and open water to the west, the Industrial Port to the east,
// and the Beachfront to the south. All geometry is generated here from
// boxes, cylinders and planes — no external models or textures.
import * as THREE from 'three';
import { mulberry32, randRange, pick, clamp } from './util.js';

export const WORLD = {
  half: 200,            // playable half-extent (x and z)
  streetStep: 40,       // distance between street centrelines
  roadHalf: 7,          // half width of a road
  waterX: -176,         // west of this is the harbor water
  beachZ: 168,          // south of this is sand and sea
};

const DISTRICTS = [
  { name: 'Marina', test: (x, z) => x < -120 },
  { name: 'Industrial Port', test: (x, z) => x > 120 },
  { name: 'Beachfront', test: (x, z) => z > 120 },
  { name: 'Downtown', test: (x, z) => Math.abs(x) <= 80 && Math.abs(z) <= 80 },
  { name: 'Uptown', test: () => true },
];

export function districtAt(x, z) {
  for (const d of DISTRICTS) if (d.test(x, z)) return d.name;
  return 'Uptown';
}

// Colliders are axis-aligned boxes the player and cars must not enter.
export function createCity(scene) {
  const rng = mulberry32(20261118);
  const colliders = [];
  const group = new THREE.Group();
  group.name = 'city';
  scene.add(group);

  const mats = {
    asphalt: new THREE.MeshLambertMaterial({ color: 0x2b2f36 }),
    sidewalk: new THREE.MeshLambertMaterial({ color: 0x8d9299 }),
    grass: new THREE.MeshLambertMaterial({ color: 0x4d7a45 }),
    sand: new THREE.MeshLambertMaterial({ color: 0xd9c28a }),
    water: new THREE.MeshLambertMaterial({ color: 0x1d6f8e }),
    waterDeep: new THREE.MeshLambertMaterial({ color: 0x14506b }),
    concrete: new THREE.MeshLambertMaterial({ color: 0x6d7278 }),
    container: [
      new THREE.MeshLambertMaterial({ color: 0xc23b2e }),
      new THREE.MeshLambertMaterial({ color: 0x2e7dc2 }),
      new THREE.MeshLambertMaterial({ color: 0xe8a13a }),
      new THREE.MeshLambertMaterial({ color: 0x3a9e5f }),
    ],
    trunk: new THREE.MeshLambertMaterial({ color: 0x6b4a2f }),
    leaf: new THREE.MeshLambertMaterial({ color: 0x2f8f4e }),
    lamp: new THREE.MeshLambertMaterial({ color: 0x3a3f46 }),
    glow: new THREE.MeshBasicMaterial({ color: 0xffe9a8 }),
    neonPink: new THREE.MeshBasicMaterial({ color: 0xff2e88 }),
    neonTeal: new THREE.MeshBasicMaterial({ color: 0x19d3c5 }),
    neonGold: new THREE.MeshBasicMaterial({ color: 0xffc233 }),
    hull: new THREE.MeshLambertMaterial({ color: 0xe8e4da }),
    hull2: new THREE.MeshLambertMaterial({ color: 0x2e5f8a }),
  };

  function box(w, h, d, mat, x, y, z, parent = group) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }
  function addCollider(x, z, hw, hd) {
    colliders.push({ minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd });
  }

  // ---- ground: base slab, water west, sand south ----
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(560, 560), mats.grass);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.05, 0);
  group.add(ground);

  const sea = new THREE.Mesh(new THREE.PlaneGeometry(200, 560), mats.water);
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(-276, 0.02, 0);
  group.add(sea);
  const seaSouth = new THREE.Mesh(new THREE.PlaneGeometry(560, 200), mats.waterDeep);
  seaSouth.rotation.x = -Math.PI / 2;
  seaSouth.position.set(0, 0.02, 300);
  group.add(seaSouth);
  // beach strip
  const beach = new THREE.Mesh(new THREE.PlaneGeometry(560, 44), mats.sand);
  beach.rotation.x = -Math.PI / 2;
  beach.position.set(0, 0.0, 190);
  group.add(beach);

  // ---- streets: grid of asphalt ribbons + sidewalk frames ----
  const streets = [];
  for (let c = -160; c <= 160; c += WORLD.streetStep) streets.push(c);
  for (const c of streets) {
    const ns = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.roadHalf * 2, 420), mats.asphalt);
    ns.rotation.x = -Math.PI / 2;
    ns.position.set(c, 0.06, 0);
    group.add(ns);
    const ew = new THREE.Mesh(new THREE.PlaneGeometry(420, WORLD.roadHalf * 2), mats.asphalt);
    ew.rotation.x = -Math.PI / 2;
    ew.position.set(0, 0.06, c);
    group.add(ew);
    // centre dashes
    for (let d = -180; d <= 180; d += 16) {
      box(0.5, 0.02, 3, new THREE.MeshBasicMaterial({ color: 0xd8c95a }), c, 0.08, d);
      box(3, 0.02, 0.5, new THREE.MeshBasicMaterial({ color: 0xd8c95a }), d, 0.08, c);
    }
  }

  // ---- buildings: one per block, sized by district ----
  const buildingPalette = [
    0x9aa3ad, 0x7d8aa0, 0xb0a08a, 0x8a7f72, 0x6f7f8a, 0xa88f6a, 0x5f6f7f, 0x94847a,
  ];
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x2f4a63 });
  const buildings = [];
  const blockCenters = [];
  for (let bx = -160; bx <= 120; bx += WORLD.streetStep) {
    for (let bz = -160; bz <= 120; bz += WORLD.streetStep) {
      blockCenters.push([bx + 20, bz + 20]);
    }
  }
  for (const [cx, cz] of blockCenters) {
    if (cx < WORLD.waterX + 24) continue; // marina boardwalk, no buildings
    const downtown = Math.abs(cx) <= 60 && Math.abs(cz) <= 60;
    const port = cx > 120;
    const beach = cz > 120;
    const r = rng();
    if (port && r < 0.45) continue; // container yard instead
    if (beach && r < 0.35) continue; // open sand / palms
    const w = randRange(rng, 16, 24);
    const d = randRange(rng, 16, 24);
    let h;
    if (downtown) h = randRange(rng, 34, 78);
    else if (port) h = randRange(rng, 8, 16);
    else if (beach) h = randRange(rng, 8, 18);
    else h = randRange(rng, 12, 30);
    const color = pick(rng, buildingPalette);
    const mat = new THREE.MeshLambertMaterial({ color });
    const b = box(w, h, d, mat, cx, h / 2, cz);
    buildings.push(b);
    addCollider(cx, cz, w / 2, d / 2);
    // window band for tall towers
    if (h > 30) {
      const floors = Math.floor(h / 6);
      for (let f = 1; f < floors; f++) {
        const band = box(w + 0.3, 0.7, d + 0.3, glassMat, cx, f * 6, cz);
        band.material = glassMat;
      }
      // rooftop neon sign
      const signMat = pick(rng, [mats.neonPink, mats.neonTeal, mats.neonGold]);
      box(w * 0.5, 1.2, 0.4, signMat, cx, h + 0.8, cz - d / 2 - 0.1);
    } else if (rng() < 0.5) {
      // awning strip
      box(w * 0.8, 0.5, 2, pick(rng, [mats.neonPink, mats.neonTeal, mats.neonGold]), cx, 3.2, cz + d / 2 + 0.6);
    }
  }

  // ---- industrial port: container stacks + cranes ----
  for (let i = 0; i < 26; i++) {
    const x = randRange(rng, 132, 188);
    const z = randRange(rng, -150, 150);
    if (Math.abs(z) < 10) continue;
    const stack = Math.floor(randRange(rng, 1, 4));
    for (let s = 0; s < stack; s++) {
      box(12, 2.6, 2.6, pick(rng, mats.container), x, 1.3 + s * 2.7, z);
    }
    addCollider(x, z, 6, 1.6);
  }
  // gantry cranes (visual, legs collide)
  for (const cz of [-80, 0, 80]) {
    const crane = new THREE.Group();
    crane.position.set(168, 0, cz);
    const legMat = new THREE.MeshLambertMaterial({ color: 0xd8a13a });
    for (const [lx, lz] of [[-6, -5], [6, -5], [-6, 5], [6, 5]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(1.4, 26, 1.4), legMat);
      leg.position.set(lx, 13, lz);
      crane.add(leg);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(26, 2, 3), legMat);
    beam.position.set(-4, 26, 0);
    crane.add(beam);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 3), new THREE.MeshLambertMaterial({ color: 0x333333 }));
    cab.position.set(-10, 24, 0);
    crane.add(cab);
    group.add(crane);
    addCollider(168, cz, 8, 7);
  }

  // ---- marina: boardwalk, piers, boats ----
  const boardwalk = box(24, 0.6, 400, new THREE.MeshLambertMaterial({ color: 0xa88a5f }), -164, 0.3, 0);
  boardwalk.name = 'boardwalk';
  for (let z = -160; z <= 160; z += 40) {
    const pier = box(26, 0.5, 5, new THREE.MeshLambertMaterial({ color: 0x8a6f4a }), -186, 0.25, z);
    pier.name = 'pier';
  }
  const boatMats = [mats.hull, mats.hull2];
  for (let i = 0; i < 7; i++) {
    const z = -150 + i * 50 + randRange(rng, -8, 8);
    const boat = new THREE.Group();
    boat.position.set(-196 - randRange(rng, 0, 18), 0.4, z);
    boat.rotation.y = randRange(rng, -0.15, 0.15);
    const hull = new THREE.Mesh(new THREE.BoxGeometry(16, 2.2, 5), pick(rng, boatMats));
    hull.position.y = 0.6;
    boat.add(hull);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(6, 2.4, 3.6), new THREE.MeshLambertMaterial({ color: 0xf0ece2 }));
    cabin.position.set(-1, 2.6, 0);
    boat.add(cabin);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 9, 6), mats.trunk);
    mast.position.set(3, 6, 0);
    boat.add(mast);
    group.add(boat);
  }

  // ---- beachfront palms + umbrellas ----
  for (let i = 0; i < 26; i++) {
    const x = randRange(rng, -150, 170);
    const z = randRange(rng, 172, 205);
    const palm = new THREE.Group();
    palm.position.set(x, 0, z);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 7, 6), mats.trunk);
    trunk.position.y = 3.5;
    trunk.rotation.z = randRange(rng, -0.12, 0.12);
    palm.add(trunk);
    for (let f = 0; f < 5; f++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.9, 4.5, 4), mats.leaf);
      const a = (f / 5) * Math.PI * 2;
      leaf.position.set(Math.cos(a) * 1.6, 7.2, Math.sin(a) * 1.6);
      leaf.rotation.set(Math.sin(a) * 1.1, 0, -Math.cos(a) * 1.1);
      palm.add(leaf);
    }
    group.add(palm);
  }
  for (let i = 0; i < 8; i++) {
    const x = randRange(rng, -140, 160);
    const z = randRange(rng, 174, 196);
    const umb = new THREE.Group();
    umb.position.set(x, 0, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.6, 6), mats.lamp);
    pole.position.y = 1.3;
    umb.add(pole);
    const top = new THREE.Mesh(new THREE.ConeGeometry(2.4, 1.1, 8), pick(rng, [mats.neonPink, mats.neonTeal, mats.neonGold]));
    top.position.y = 2.9;
    umb.add(top);
    group.add(umb);
  }

  // ---- street lamps along every street ----
  const lampGeo = new THREE.CylinderGeometry(0.12, 0.12, 6, 6);
  for (const c of streets) {
    for (let d = -160; d <= 160; d += 80) {
      const pole = new THREE.Mesh(lampGeo, mats.lamp);
      pole.position.set(c + 8.5, 3, d + 8.5);
      group.add(pole);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), mats.glow);
      head.position.set(c + 8.5, 6.1, d + 8.5);
      group.add(head);
    }
  }

  // ---- city edge: low wall / fence so the player stays in bounds ----
  const edgeMat = new THREE.MeshLambertMaterial({ color: 0x4a4f55 });
  box(420, 2, 1.5, edgeMat, 0, 1, -202);
  box(420, 2, 1.5, edgeMat, 0, 1, 212);
  box(1.5, 2, 420, edgeMat, 202, 1, 0);
  addCollider(0, -202, 210, 1);
  addCollider(0, 212, 210, 1);
  addCollider(202, 0, 1, 210);
  // west edge is the water: block walking into the sea past the boardwalk
  addCollider(-212, 0, 10, 210);

  // ---- sun, sky, fog ----
  const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x8a7a5a, 0.95);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe6b8, 1.6);
  sun.position.set(120, 180, 60);
  scene.add(sun);
  scene.background = new THREE.Color(0x87b5d9);
  scene.fog = new THREE.Fog(0x9fc3dd, 160, 420);

  return {
    group,
    colliders,
    streets,
    // resolve a circle (x, z, radius) against building colliders; returns push-out
    collideCircle(x, z, r) {
      let px = x, pz = z;
      for (const c of colliders) {
        const cx = clamp(px, c.minX, c.maxX);
        const cz = clamp(pz, c.minZ, c.maxZ);
        const dx = px - cx, dz = pz - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 < r * r) {
          if (d2 > 1e-6) {
            const d = Math.sqrt(d2);
            px = cx + (dx / d) * r;
            pz = cz + (dz / d) * r;
          } else {
            // centre inside the box: push out along the smallest penetration
            const pl = Math.min(px - c.minX, c.maxX - px);
            const pd = Math.min(pz - c.minZ, c.maxZ - pz);
            if (pl < pd) px = px - c.minX < c.maxX - px ? c.minX - r : c.maxX + r;
            else pz = pz - c.minZ < c.maxZ - pz ? c.minZ - r : c.maxZ + r;
          }
        }
      }
      // world bounds
      px = clamp(px, WORLD.waterX + 2, WORLD.half);
      pz = clamp(pz, -WORLD.half, WORLD.half + 8);
      return { x: px, z: pz };
    },
    // is this point on a road?
    onRoad(x, z) {
      for (const c of streets) {
        if (Math.abs(x - c) <= WORLD.roadHalf + 1) return true;
        if (Math.abs(z - c) <= WORLD.roadHalf + 1) return true;
      }
      return false;
    },
    nearestStreet(x, z) {
      let best = streets[0], bd = Infinity;
      for (const c of streets) {
        const d = Math.min(Math.abs(x - c), Math.abs(z - c));
        if (d < bd) { bd = d; best = c; }
      }
      return best;
    },
  };
}
