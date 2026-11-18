// NEON HARBOR — open-world crime game: boot, input, camera, game loop,
// car stealing, wanted escalation, missions, combat wiring and screenshots.
// ?shot=start|chase|driving|mission|onfoot stages a deterministic frame and
// freezes it for screenshots, setting window.__shotReady.
import * as THREE from 'three';
import { createCity, WORLD } from './city.js';
import { Vehicle, VEHICLE_TYPES, createTraffic } from './vehicles.js';
import { Player, createPedestrians } from './people.js';
import { Police } from './police.js';
import { MissionManager, MISSIONS } from './missions.js';
import { Combat, Particles, SkidMarks } from './combat.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { loadSave, writeSave, clearSave } from './save.js';
import { clamp, damp, angleLerp, mulberry32, pick } from './util.js';

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;
const rng = mulberry32(seed);
const SHOT_MODE = !!shot;

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 600);
camera.position.set(0, 40, 80);

const city = createCity(scene);
const hud = createHud(city);
const audio = createAudio();
const particles = new Particles(scene);
const skids = new SkidMarks(scene);
const combat = new Combat(scene, camera);
const missions = new MissionManager(scene);
const police = new Police(scene, city);
const player = new Player(scene, -20, 20);
const peds = createPedestrians(scene, city, 22);
const traffic = createTraffic(scene, city, 14);

// parked cars to steal, scattered along street edges
const parked = [];
const parkedSpots = [
  // [x, z, heading, type] — each car sits on a street lane, facing along it
  [-43.2, -60, 0, 'sedan'], [43.2, 20, Math.PI, 'taxi'],
  [60, -83.2, Math.PI / 2, 'sports'], [-20, 83.2, -Math.PI / 2, 'van'],
  [116.8, -20, 0, 'truck'], [-100, -116.8, Math.PI / 2, 'sedan'],
  [-123.2, 60, Math.PI, 'sedan'], [100, 116.8, -Math.PI / 2, 'sedan'],
  [163.2, 100, 0, 'sedan'],
];
for (const [x, z, h, type] of parkedSpots) {
  const v = new Vehicle(scene, type, x, z, h);
  v.driver = null;
  parked.push(v);
}
// mission 2 target car: cherry red Vortex GT outside the Delmar Grand
const missionCar = new Vehicle(scene, 'sports', 20, -43.2, Math.PI / 2, 0xc2185b);
missionCar.driver = null;
missionCar.isMissionCar = true;
parked.push(missionCar);

// ---------- game state ----------
const state = {
  mode: 'menu',           // menu | playing | paused | dialog | wasted | complete
  money: 250,
  day: 1,
  clockMinutes: 18 * 60 + 24,
  camYaw: Math.PI,
  camPitch: 0.22,
  lastMouseMove: -10,
  time: 0,
  autosaveT: 0,
  damageFlash: 0,
  downed: [],             // {ped, t}
  prevHealth: 100,
  frozen: false,
};
window.__game = { state, player, police, missions, traffic, peds };

function allCars() {
  return [...parked, ...traffic.cars, ...police.cars];
}
function enterableCars() {
  return [...parked, ...traffic.cars].filter((v) => v.driver !== 'police');
}

// ---------- input ----------
const keys = {};
const input = { forward: false, back: false, left: false, right: false, sprint: false };
let dragging = false;
let lastMouseX = 0, lastMouseY = 0;

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys[e.code] = true;
  if (state.mode === 'playing') {
    if (e.code === 'KeyE') tryEnterExitCar();
    if (e.code === 'KeyQ') doPunch();
    if (e.code === 'KeyR') { if (combat.reload()) hud.setWeapon(weaponText()); }
    if (e.code === 'KeyH') audio.horn();
    if (e.code === 'KeyM') toggleMute();
    if (e.code === 'KeyP' || e.code === 'Escape') pauseGame();
  } else if (state.mode === 'dialog') {
    if (e.code === 'Enter' || e.code === 'Space') advanceDialog();
  } else if (state.mode === 'paused') {
    if (e.code === 'KeyP' || e.code === 'Escape') resumeGame();
  } else if (state.mode === 'menu') {
    if (e.code === 'Digit1') startMissionFromMenu(0);
    if (e.code === 'Digit2') startMissionFromMenu(1);
    if (e.code === 'Digit3') startMissionFromMenu(2);
  }
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k of Object.keys(keys)) keys[k] = false; });

renderer.domElement.addEventListener('mousedown', (e) => {
  if (state.mode !== 'playing') return;
  dragging = true;
  lastMouseX = e.clientX; lastMouseY = e.clientY;
  if (!SHOT_MODE && document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock?.();
  }
  if (e.button === 0 && !player.inCar) doShoot();
});
window.addEventListener('mouseup', () => { dragging = false; });
window.addEventListener('mousemove', (e) => {
  if (state.mode !== 'playing') return;
  let dx = 0, dy = 0;
  if (document.pointerLockElement === renderer.domElement) {
    dx = e.movementX; dy = e.movementY;
  } else if (dragging) {
    dx = e.clientX - lastMouseX; dy = e.clientY - lastMouseY;
    lastMouseX = e.clientX; lastMouseY = e.clientY;
  }
  if (dx || dy) {
    state.camYaw -= dx * 0.0032;
    state.camPitch = clamp(state.camPitch + dy * 0.0016, -0.05, 0.55);
    state.lastMouseMove = state.time;
  }
});
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== renderer.domElement) dragging = false;
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- helpers ----------
function weaponText() {
  if (player.inCar) return `${player.inCar.type.name.toUpperCase()} · E to exit · SPACE handbrake`;
  return `PISTOL ${combat.ammo}/12 · ${combat.reserve} reserve · E near a car to steal it`;
}

function toggleMute() {
  audio.setMuted(!audio.isMuted());
  hud.toast(audio.isMuted() ? 'Sound off' : 'Sound on', '', 'teal');
}

function nearestEnterable(range = 4.5) {
  let best = null, bd = range * range;
  for (const v of enterableCars()) {
    const d2 = (v.x - player.x) ** 2 + (v.z - player.z) ** 2;
    if (d2 < bd) { bd = d2; best = v; }
  }
  return best;
}

function tryEnterExitCar() {
  if (player.inCar) {
    const car = player.inCar;
    car.driver = null;
    car.speed = 0;
    player.inCar = null;
    player.mesh.visible = true;
    // step out to the side
    player.x = car.x - Math.cos(car.heading) * 2.2;
    player.z = car.z + Math.sin(car.heading) * 2.2;
    const fixed = city.collideCircle(player.x, player.z, 0.6);
    player.x = fixed.x; player.z = fixed.z;
    player.mesh.position.set(player.x, 0, player.z);
    hud.setWeapon(weaponText());
    return;
  }
  const car = nearestEnterable();
  if (!car) return;
  if (car.driver === 'traffic') {
    const i = traffic.cars.indexOf(car);
    if (i >= 0) traffic.cars.splice(i, 1);
  }
  car.driver = 'player';
  player.inCar = car;
  player.mesh.visible = false;
  player.x = car.x; player.z = car.z;
  police.addHeat(8, 'car theft');
  hud.toast('Car stolen!', `${car.type.name} — the cops noticed.`, 'red');
  audio.crash();
  hud.setWeapon(weaponText());
}

function doShoot() {
  const origin = camera.position.clone();
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const targets = [];
  for (const p of peds.peds) if (p.state !== 'down') targets.push(p.mesh);
  for (const c of police.cops) targets.push(c.mesh);
  for (const v of allCars()) targets.push(v.mesh);
  targets.push(city.group);
  const result = combat.shoot(origin, dir, targets);
  if (!result) return;
  audio.shot();
  if (result.type === 'empty') { hud.hint('Out of ammo — press R to reload'); return; }
  if (result.type === 'miss') {
    particles.burst(result.point.x, Math.max(0.3, result.point.y), result.point.z, 0xd8c95a, 6, 3, 2);
    return;
  }
  if (result.kind === 'ped' || result.kind === 'cop') {
    const ref = result.ref;
    particles.burst(result.point.x, result.point.y, result.point.z, 0xc23b2e, 12, 5, 3);
    if (ref) {
      ref.health -= 50;
      if (ref.health <= 0) {
        if (result.kind === 'ped') {
          ref.state = 'down';
          ref.mesh.rotation.x = -Math.PI / 2;
          ref.mesh.position.y = 0.3;
          state.downed.push({ ped: ref, t: 25 });
          police.addHeat(12, 'assault');
          hud.toast('Pedestrian down!', 'The city saw that. Wanted level up.', 'red');
        } else {
          ref.state = 'down';
          ref.mesh.rotation.x = -Math.PI / 2;
          const i = police.cops.indexOf(ref);
          if (i >= 0) police.cops.splice(i, 1);
          police.addHeat(20, 'officer down');
          hud.toast('Officer down!', 'Every cop in Port Delmar is coming for you.', 'red');
          setTimeout(() => scene.remove(ref.mesh), 4000);
        }
      } else if (result.kind === 'ped') {
        ref.state = 'flee';
        ref.stateT = 3;
        police.addHeat(6, 'shots fired');
      }
    }
  } else if (result.kind === 'car') {
    const ref = result.ref;
    particles.burst(result.point.x, result.point.y, result.point.z, 0xffc233, 10, 5, 3);
    if (ref) {
      ref.health -= 25;
      if (ref.driver === 'police') police.addHeat(10, 'shot police car');
      if (ref.health <= 0) {
        particles.burst(ref.x, 1, ref.z, 0xff7a2e, 30, 9, 7);
        audio.crash();
        if (ref.driver === 'player') { player.health -= 25; }
      }
    }
  }
  hud.setWeapon(weaponText());
}

function doPunch() {
  if (player.inCar || player.punchTimer > 0) return;
  player.punchTimer = 0.35;
  audio.punch();
  const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
  const target = peds.nearest(player.x + fx * 1.6, player.z + fz * 1.6, 2.2);
  if (target) {
    target.health -= 30;
    particles.burst(target.x, 1.2, target.z, 0xffd27a, 8, 4, 3);
    if (target.health <= 0) {
      target.state = 'down';
      target.mesh.rotation.x = -Math.PI / 2;
      target.mesh.position.y = 0.3;
      state.downed.push({ ped: target, t: 25 });
      police.addHeat(10, 'assault');
    } else {
      target.state = 'flee';
      target.stateT = 3;
    }
    return;
  }
  const cop = police.cops.find((c) => Math.hypot(c.x - player.x, c.z - player.z) < 2.4);
  if (cop) {
    cop.health -= 30;
    particles.burst(cop.x, 1.2, cop.z, 0xffd27a, 8, 4, 3);
    if (cop.health <= 0) {
      police.cops.splice(police.cops.indexOf(cop), 1);
      scene.remove(cop.mesh);
      police.addHeat(18, 'officer down');
    }
  }
}

// tag meshes for combat raycasts
function tagHitTargets() {
  for (const p of peds.peds) { p.mesh.userData.hitKind = 'ped'; p.mesh.userData.hitRef = p; }
  for (const v of allCars()) { v.mesh.userData.hitKind = 'car'; v.mesh.userData.hitRef = v; }
}
tagHitTargets();

// ---------- missions / dialog ----------
function startMissionFromMenu(index) {
  if (state.mode !== 'menu') return;
  if (missions.completed[index]) { hud.toast('Job already done', MISSIONS[index].title, 'teal'); return; }
  if (missions.nextIndex !== index) { hud.toast('Finish the earlier job first', MISSIONS[index].title, ''); return; }
  startGame({ missionIndex: index });
}

function beginMission(index) {
  if (!missions.start(index)) return;
  const def = MISSIONS[index];
  hud.showDialog(def.fixer, def.briefing[0]);
  state.mode = 'dialog';
  state.dialogLine = 0;
  state.dialogDef = def;
}

function advanceDialog() {
  const def = state.dialogDef;
  state.dialogLine += 1;
  if (state.dialogLine < def.briefing.length) {
    hud.showDialog(def.fixer, def.briefing[state.dialogLine]);
  } else {
    hud.hideDialog();
    state.mode = 'playing';
    hud.setObjective(`Mission ${def.id} — ${def.title}`, def.objective, def.timeLimit ? `Time left: ${def.timeLimit}s` : '');
    hud.toast(`Mission ${def.id} — ${def.title}`, def.objective, 'gold');
    audio.pickup();
  }
}

// ---------- screens ----------
const startEl = document.getElementById('start');
const pauseEl = document.getElementById('pause');
const wastedEl = document.getElementById('wasted');
const completeEl = document.getElementById('complete');
const howEl = document.getElementById('how');

function showOnly(el) {
  for (const o of [startEl, pauseEl, wastedEl, completeEl, howEl]) o.hidden = true;
  if (el) el.hidden = false;
}

function startGame(opts = {}) {
  audio.ensure();
  audio.resume();
  showOnly(null);
  hud.show();
  state.mode = 'playing';
  state.prevHealth = player.health;
  if (opts.continueSave) {
    const s = opts.continueSave;
    state.money = s.money;
    state.day = s.day;
    state.clockMinutes = s.clockMinutes;
    player.health = s.health;
    player.x = s.x; player.z = s.z;
    missions.completed = s.completed.slice(0, 3);
    police.heat = s.wantedHeat || 0;
    police.wanted = police.heat <= 0 ? 0 : police.heat < 18 ? 1 : police.heat < 38 ? 2 : police.heat < 58 ? 3 : police.heat < 80 ? 4 : 5;
    hud.toast('Welcome back, Rook', 'Your save was loaded.', 'teal');
  }
  hud.setMoney(state.money);
  hud.setHealth(player.health);
  hud.setWeapon(weaponText());
  if (opts.missionIndex != null) beginMission(opts.missionIndex);
  else refreshObjective();
  saveGame();
}

function refreshObjective() {
  const o = missions.objectiveText();
  hud.setObjective(o.label, o.text, o.sub);
}

function pauseGame() {
  if (state.mode !== 'playing') return;
  state.mode = 'paused';
  document.exitPointerLock?.();
  const list = document.getElementById('mission-list');
  list.innerHTML = MISSIONS.map((m, i) => {
    const st = missions.completed[i] ? '<span class="st done">DONE</span>'
      : missions.active && missions.active.def.id === m.id ? '<span class="st open">ACTIVE</span>'
      : missions.nextIndex === i ? '<span class="st open">NEXT</span>' : '<span class="st locked">LOCKED</span>';
    return `<li><span>${m.id}. ${m.title} — $${m.reward.toLocaleString('en-US')}</span>${st}</li>`;
  }).join('');
  showOnly(pauseEl);
  saveGame();
}

function resumeGame() {
  showOnly(null);
  state.mode = 'playing';
  audio.resume();
}

function endRun(kind) {
  state.mode = 'wasted';
  document.exitPointerLock?.();
  document.getElementById('wasted-title').textContent = kind === 'busted' ? 'BUSTED' : 'WASTED';
  document.getElementById('wasted-text').textContent = kind === 'busted'
    ? 'The HPD hauled you in. Bail costs money — and time.'
    : 'The harbor takes another one. Patch up and get back out there.';
  showOnly(wastedEl);
  police.clearWanted();
  saveGame();
}

function respawn() {
  const fine = state.mode === 'wasted' && document.getElementById('wasted-title').textContent === 'BUSTED'
    ? Math.floor(state.money * 0.1) : 200;
  state.money = Math.max(0, state.money - fine);
  player.health = 100;
  state.prevHealth = 100;
  if (player.inCar) { player.inCar.driver = null; player.inCar = null; player.mesh.visible = true; }
  player.x = -20; player.z = 20;
  player.mesh.position.set(player.x, 0, player.z);
  showOnly(null);
  state.mode = 'playing';
  hud.setMoney(state.money);
  hud.setHealth(100);
  hud.setWeapon(weaponText());
  hud.toast('Back on the streets', `You lost $${fine.toLocaleString('en-US')}.`, 'teal');
  saveGame();
}

function saveGame() {
  writeSave({
    money: state.money,
    completed: missions.completed,
    x: player.x, z: player.z,
    health: player.health,
    wantedHeat: police.heat,
    day: state.day,
    clockMinutes: state.clockMinutes,
  });
}

document.getElementById('btn-new').addEventListener('click', () => startGame());
document.getElementById('btn-continue').addEventListener('click', () => {
  const s = loadSave();
  if (s) startGame({ continueSave: s });
});
document.getElementById('btn-how').addEventListener('click', () => showOnly(howEl));
document.getElementById('btn-how-back').addEventListener('click', () => showOnly(startEl));
document.getElementById('btn-resume').addEventListener('click', resumeGame);
document.getElementById('btn-quit').addEventListener('click', () => {
  saveGame();
  state.mode = 'menu';
  hud.hide();
  showOnly(startEl);
  refreshContinueButton();
});
document.getElementById('btn-respawn').addEventListener('click', respawn);
document.getElementById('btn-freeroam').addEventListener('click', () => {
  showOnly(null);
  state.mode = 'playing';
  refreshObjective();
});

function refreshContinueButton() {
  const s = loadSave();
  document.getElementById('btn-continue').hidden = !s;
}
refreshContinueButton();

// ---------- per-frame update ----------
function readKeys() {
  input.forward = !!(keys.KeyW || keys.ArrowUp);
  input.back = !!(keys.KeyS || keys.ArrowDown);
  input.left = !!(keys.KeyA || keys.ArrowLeft);
  input.right = !!(keys.KeyD || keys.ArrowRight);
  input.sprint = !!keys.ShiftLeft || !!keys.ShiftRight;
}

function step(dt) {
  state.time += dt;
  state.clockMinutes += dt * 0.8;
  if (state.clockMinutes >= 1440) { state.clockMinutes -= 1440; state.day += 1; }
  readKeys();

  // --- player / car ---
  let danger = null;
  if (player.inCar) {
    const car = player.inCar;
    const driveInput = {
      throttle: input.forward ? 1 : input.back ? -0.55 : 0,
      steer: (input.left ? -1 : 0) + (input.right ? 1 : 0),
      brake: !!keys.Space,
      boost: input.sprint,
    };
    const prevSpeed = car.speed;
    car.drive(dt, driveInput, city);
    player.x = car.x; player.z = car.z;
    player.yaw = car.heading;
    if (car.skid) {
      skids.add(car.x - car.forwardX * 1.2, car.z - car.forwardZ * 1.2, car.heading);
      if (Math.random() < dt * 8) particles.burst(car.x, 0.3, car.z, 0xcccccc, 2, 2, 1);
    }
    // car vs cars
    for (const other of allCars()) {
      if (other === car) continue;
      const d = Math.hypot(other.x - car.x, other.z - car.z);
      if (d < 3.1 && d > 0.01) {
        const nx = (car.x - other.x) / d, nz = (car.z - other.z) / d;
        const push = (3.1 - d) / 2;
        car.x += nx * push; car.z += nz * push;
        other.x -= nx * push; other.z -= nz * push;
        const closing = Math.abs(car.speed - other.speed);
        if (closing > 6) {
          audio.crash();
          particles.burst(car.x, 1, car.z, 0xffc233, 14, 6, 4);
          car.health -= closing * 0.8;
          other.health -= closing * 0.8;
          if (other.driver === 'police' && state.time - (car.lastPoliceHit || -99) > 2) {
            police.addHeat(5, 'hit police car');
            car.lastPoliceHit = state.time;
          }
        }
        car.speed *= 0.7;
        other.speed *= 0.7;
      }
    }
    // car vs pedestrians
    for (const p of peds.peds) {
      if (p.state === 'down') continue;
      const d = Math.hypot(p.x - car.x, p.z - car.z);
      if (d < 2.1 && Math.abs(car.speed) > 4) {
        p.state = 'down';
        p.health = 0;
        p.mesh.rotation.x = -Math.PI / 2;
        p.mesh.position.y = 0.3;
        state.downed.push({ ped: p, t: 25 });
        particles.burst(p.x, 1, p.z, 0xc23b2e, 14, 5, 4);
        audio.crash();
        police.addHeat(12, 'hit pedestrian');
        hud.toast('Pedestrian hit!', 'Wanted level up.', 'red');
        car.speed *= 0.75;
      }
    }
    danger = { x: car.x, z: car.z, radius: 10, kind: 'car' };
    if (Math.abs(car.speed) > 3) state.lastMouseMove = state.lastMouseMove; // keep auto-align timer honest
  } else {
    player.camYaw = state.camYaw;
    player.update(dt, input, city);
    danger = { x: player.x, z: player.z, radius: 6, kind: 'foot' };
  }

  // --- world life ---
  traffic.update(dt, { x: player.x, z: player.z }, police.wanted > 0);
  peds.update(dt, danger);
  // respawn downed peds after a while
  for (let i = state.downed.length - 1; i >= 0; i--) {
    state.downed[i].t -= dt;
    if (state.downed[i].t <= 0) {
      peds.respawn(state.downed[i].ped);
      state.downed.splice(i, 1);
    }
  }
  // tag new police meshes for raycasts
  for (const c of police.cops) {
    if (!c.mesh.userData.hitKind) { c.mesh.userData.hitKind = 'cop'; c.mesh.userData.hitRef = c; }
  }

  // --- police ---
  const pol = police.update(dt, player, player.inCar, () => endRun('busted'), null);
  if (pol.bustedProgress > 0) hud.hint(`Being arrested… ${Math.round(pol.bustedProgress * 100)}% — run!`);

  // --- missions ---
  const events = missions.update(dt, player, {});
  for (const ev of events) {
    if (ev.type === 'complete') {
      state.money += ev.reward;
      hud.setMoney(state.money);
      hud.toast('Mission complete!', `+$${ev.reward.toLocaleString('en-US')}`, 'gold');
      audio.missionDone();
      saveGame();
      if (missions.nextIndex < 0) {
        document.getElementById('complete-text').textContent =
          `All three jobs done, debt paid, $${state.money.toLocaleString('en-US')} in your pocket. The harbor is yours, Rook.`;
        state.mode = 'complete';
        showOnly(completeEl);
      } else {
        refreshObjective();
      }
    } else if (ev.type === 'failed') {
      hud.toast('Mission failed', ev.reason, 'red');
      audio.failed();
      refreshObjective();
    } else if (ev.type === 'step') {
      hud.toast('Objective updated', ev.text, 'gold');
      refreshObjective();
    } else if (ev.type === 'wanted') {
      police.addHeat(50, 'heist');
    }
  }

  // --- combat / fx ---
  combat.update(dt);
  particles.update(dt);
  skids.update(dt);

  // --- health / damage ---
  if (player.health < state.prevHealth) {
    state.damageFlash = clamp(state.damageFlash + 0.5, 0, 0.9);
  }
  state.prevHealth = player.health;
  state.damageFlash = Math.max(0, state.damageFlash - dt * 1.4);
  hud.setDamage(state.damageFlash);
  player.health = Math.min(100, player.health + dt * 1.5); // slow regen
  if (player.health <= 0) { player.health = 0; endRun('wasted'); return; }

  // --- hint text ---
  let hint = null;
  if (!player.inCar) {
    const near = nearestEnterable();
    if (near) hint = `Press E to steal the ${near.type.name}${near.isMissionCar ? '  ★ mission car' : ''}`;
    else if (pol.bustedProgress > 0) hint = null;
  }
  hud.hint(hint);

  // --- HUD ---
  hud.setStars(police.wanted);
  hud.setClock(state.day, state.clockMinutes);
  hud.setHealth(player.health);
  hud.setDistrict(player.x, player.z);
  hud.setCrosshair(!player.inCar && state.mode === 'playing');
  if (player.inCar) {
    const car = player.inCar;
    hud.setSpeed(Math.abs(car.speed) * 2.24, car.type.name);
    hud.setWeapon(weaponText());
  } else {
    hud.setSpeed(Math.abs(player.speed) * 2.24, 'ON FOOT');
  }
  hud.drawMinimap({
    player: { x: player.x, z: player.z, heading: player.inCar ? player.inCar.heading : player.yaw },
    marker: missions.markerPos(),
    traffic: traffic.cars,
    policeCars: police.cars,
  });

  // --- audio ---
  audio.setEngine(player.inCar ? Math.abs(player.inCar.speed) / player.inCar.type.topSpeed : 0, !!player.inCar);
  audio.setSiren(police.sirenOn);

  // --- autosave ---
  state.autosaveT += dt;
  if (state.autosaveT > 20) { state.autosaveT = 0; saveGame(); }

  // --- camera ---
  updateCamera(dt);
}

function updateCamera(dt) {
  const target = player.inCar ? player.inCar : player;
  // auto-align behind the car when the mouse has been still
  if (player.inCar && state.time - state.lastMouseMove > 1.2) {
    state.camYaw = angleLerp(state.camYaw, target.heading + Math.PI, 1 - Math.exp(-1.6 * dt));
  }
  const dist = player.inCar ? 11 : 6.5;
  const height = player.inCar ? 4.2 : 2.6;
  const fx = Math.sin(state.camYaw), fz = Math.cos(state.camYaw);
  // camera sits behind the look direction: look toward -f
  const cx = target.x + fx * dist;
  const cz = target.z + fz * dist;
  const cy = height + state.camPitch * 5;
  camera.position.x = damp(camera.position.x, cx, 8, dt);
  camera.position.y = damp(camera.position.y, cy, 8, dt);
  camera.position.z = damp(camera.position.z, cz, 8, dt);
  const lookX = target.x - fx * 4;
  const lookZ = target.z - fz * 4;
  camera.lookAt(lookX, 1.4 + state.camPitch * 2, lookZ);
}

// ---------- render loop ----------
let last = performance.now();
function loop(now) {
  if (state.frozen) return;
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state.mode === 'playing' || state.mode === 'dialog') {
    if (state.mode === 'playing') step(dt);
    else { combat.update(dt); particles.update(dt); }
  } else if (state.mode === 'menu') {
    // slow cinematic orbit behind the title screen
    const t = now * 0.00008;
    camera.position.set(Math.sin(t) * 120, 55, Math.cos(t) * 120);
    camera.lookAt(0, 8, 0);
    traffic.update(dt, { x: 9999, z: 9999 }, false);
    peds.update(dt, null);
  }
  renderer.render(scene, camera);
}
requestAnimationFrame(loop);

// ---------- screenshot staging ----------
function stageShot(name) {
  // hide menus, start playing immediately, stage the scene
  showOnly(null);
  hud.show();
  state.mode = 'playing';
  audio.setMuted(true);
  const placeInCar = (typeKey, x, z, heading, speed) => {
    const car = new Vehicle(scene, typeKey, x, z, heading);
    car.driver = 'player';
    player.inCar = car;
    player.mesh.visible = false;
    player.x = x; player.z = z;
    car.speed = speed;
    state.camYaw = heading + Math.PI;
    return car;
  };
  if (name === 'chase') {
    const car = placeInCar('sports', 0, 40, 0, 24);
    state.money = 1750;
    police.addHeat(50, 'chase');
    police.spawnCarNear(0, 40); police.spawnCarNear(0, 40); police.spawnCarNear(0, 40);
    // one interceptor ahead, closing head-on so the chase reads in frame
    const ahead = new Vehicle(scene, 'police', 3.2, 112, Math.PI);
    ahead.driver = 'police';
    ahead.speed = 8;
    police.cars.push(ahead);
    missions.start(0);
    state.mode = 'playing';
    hud.setObjective('Mission 1 — FIRST DROP', 'Deliver the package to Pier 3 at the Marina', 'Time left: 212s');
    hud.setMoney(state.money);
  } else if (name === 'driving') {
    placeInCar('sports', -40, 0, Math.PI / 2, 22);
    state.money = 1250;
    hud.setMoney(state.money);
  } else if (name === 'mission') {
    placeInCar('sedan', -120, -40, -Math.PI / 2, 10);
    missions.start(0);
    state.money = 750;
    hud.setMoney(state.money);
    hud.setObjective('Mission 1 — FIRST DROP', 'Deliver the package to Pier 3 at the Marina', 'Time left: 198s');
  } else if (name === 'onfoot') {
    player.x = 20; player.z = 20;
    player.mesh.position.set(20, 0, 20);
    state.camYaw = Math.PI * 0.75;
    police.addHeat(12, 'shots');
    police.spawnCopNear(20, 20);
    hud.setMoney(state.money);
  }
  // simulate a short burst so traffic/police settle into frame, then freeze.
  // hold the throttle so staged cars are actually moving in the shot.
  if (name === 'chase' || name === 'driving' || name === 'mission') keys.KeyW = true;
  // chase: fewer steps so the police are closing in but haven't rammed us to a stop
  const steps = name === 'chase' ? 60 : 90;
  for (let i = 0; i < steps; i++) step(1 / 60);
  keys.KeyW = false;
  // a couple of visible action touches for the cover
  if (name === 'chase') {
    particles.burst(player.x + 4, 1, player.z + 4, 0xffc233, 18, 6, 4);
    hud.toast('WANTED — 3 STARS', 'Lose the HPD and make the drop.', 'red');
  }
  renderer.render(scene, camera);
  renderer.render(scene, camera);
  state.frozen = true;
  window.__shotReady = true;
}

if (SHOT_MODE) {
  if (shot === 'start') {
    // title screen over a live city view
    hud.hide();
    showOnly(startEl);
    window.__shotReady = true;
  } else {
    // wait a frame so the renderer is warm, then stage
    requestAnimationFrame(() => setTimeout(() => stageShot(shot), 50));
  }
}

window.addEventListener('beforeunload', saveGame);
