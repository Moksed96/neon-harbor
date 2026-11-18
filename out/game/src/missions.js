// Neon Harbor — story missions.
// Rook Calloway, courier driver, is pulled into the harbor underworld by the
// fixer Marla Voss. Three missions, a briefing each, gold markers, rewards.
import * as THREE from 'three';
import { clamp } from './util.js';

export const MISSIONS = [
  {
    id: 1,
    title: 'FIRST DROP',
    fixer: 'Marla Voss',
    briefing: [
      'Rook. You owe the harbor, and the harbor collects. First job is easy: a package for the marina, Pier 3.',
      'Take any car — yours, theirs, I don\'t care — and get it there before the tide turns. Four minutes. Don\'t make me regret calling you.',
    ],
    objective: 'Deliver the package to Pier 3 at the Marina',
    target: { x: -170, z: -40, r: 8 },
    timeLimit: 240,
    reward: 500,
    start: { x: -20, z: 20 },
  },
  {
    id: 2,
    title: 'HOT WHEELS',
    fixer: 'Marla Voss',
    briefing: [
      'A client wants a Vortex GT — cherry red, parked outside the Delmar Grand downtown. It has to be that one. Don\'t ask.',
      'Lift it and bring it to the garage on the east side. The boys in blue will be watching, so make it quick and make it clean.',
    ],
    objective: 'Steal the red Vortex GT and deliver it to the east-side garage',
    target: { x: 140, z: 60, r: 7 },
    carTarget: { x: 20, z: -20, type: 'sports', color: 0xc2185b },
    timeLimit: 0,
    reward: 1200,
    start: { x: -20, z: 20 },
  },
  {
    id: 3,
    title: 'THE HARBOR HEIST',
    fixer: 'Marla Voss',
    briefing: [
      'Last job, Rook, and then your debt is clean. A crate of harbor gold sits in the port container yard — no guards, just cameras and a fence.',
      'Grab the crate, then run. Every cop in Port Delmar will be on you. Get it to the safehouse on the beach and we\'re done. Good luck.',
    ],
    objective: 'Grab the crate at the Port, then escape to the beach safehouse',
    target: { x: 150, z: -80, r: 6 },
    escape: { x: 60, z: 180, r: 7 },
    timeLimit: 0,
    reward: 3000,
    start: { x: -20, z: 20 },
  },
];

export class MissionManager {
  constructor(scene) {
    this.scene = scene;
    this.completed = [false, false, false];
    this.active = null;      // {def, step, t, phase}
    this.dialogQueue = [];
    this.dialogCb = null;
    // marker: glowing ring + light beam
    const ringGeo = new THREE.RingGeometry(3.2, 4.2, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffc233, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
    this.marker = new THREE.Mesh(ringGeo, ringMat);
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    scene.add(this.marker);
    const beamGeo = new THREE.CylinderGeometry(0.7, 0.7, 60, 10, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xffc233, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
    this.beam = new THREE.Mesh(beamGeo, beamMat);
    this.beam.visible = false;
    scene.add(this.beam);
  }

  get nextIndex() {
    return this.completed.findIndex((c) => !c);
  }

  get nextMission() {
    const i = this.nextIndex;
    return i >= 0 ? MISSIONS[i] : null;
  }

  start(index, hooks) {
    const def = MISSIONS[index];
    if (!def || this.active) return false;
    this.active = { def, step: 'go', t: def.timeLimit, phase: 'briefing' };
    this.dialogQueue = def.briefing.map((text) => ({ who: def.fixer, text }));
    this.hooks = hooks;
    this.showMarker(def.target);
    return true;
  }

  showMarker(target) {
    this.marker.position.set(target.x, 0.15, target.z);
    this.beam.position.set(target.x, 30, target.z);
    this.marker.visible = true;
    this.beam.visible = true;
  }

  hideMarker() {
    this.marker.visible = false;
    this.beam.visible = false;
  }

  // advance the mission; returns events for main.js to act on
  update(dt, player, ctx) {
    const ev = [];
    if (!this.active) return ev;
    const a = this.active;
    const def = a.def;
    // marker pulse
    if (this.marker.visible) {
      const s = 1 + Math.sin(performance.now() * 0.004) * 0.12;
      this.marker.scale.setScalar(s);
      this.marker.rotation.z += dt * 0.6;
    }
    if (a.t > 0) {
      a.t -= dt;
      if (a.t <= 0) { ev.push({ type: 'failed', reason: 'Out of time.' }); this.fail(); return ev; }
    }
    const px = player.x, pz = player.z;
    const inCar = !!player.inCar;
    if (def.id === 2 && a.step === 'go') {
      // wait until the player is driving the target car
      if (inCar && inCar.isMissionCar) {
        a.step = 'deliver';
        ev.push({ type: 'step', text: 'Got it. Now lose the heat and deliver it to the garage.' });
        this.showMarker(def.target);
      }
      return ev;
    }
    if (def.id === 3 && a.step === 'go') {
      const d = Math.hypot(px - def.target.x, pz - def.target.z);
      if (d < def.target.r) {
        a.step = 'escape';
        ev.push({ type: 'step', text: 'Crate secured! Every cop in the city is coming — run to the beach safehouse!' });
        ev.push({ type: 'wanted', stars: 3 });
        this.showMarker(def.escape);
      }
      return ev;
    }
    const target = a.step === 'escape' ? def.escape : def.target;
    const d = Math.hypot(px - target.x, pz - target.z);
    if (d < target.r) {
      ev.push({ type: 'complete', reward: def.reward });
      this.completed[def.id - 1] = true;
      this.active = null;
      this.hideMarker();
    }
    return ev;
  }

  fail() {
    this.active = null;
    this.hideMarker();
  }

  // objective text for the HUD
  objectiveText() {
    if (!this.active) {
      const next = this.nextMission;
      return next
        ? { label: `Next job — ${next.title}`, text: `Press ${next.id} to take the job from Marla Voss.`, sub: '' }
        : { label: 'Free Roam', text: 'Story complete. The harbor is yours — drive, steal, survive.', sub: '' };
    }
    const a = this.active;
    const sub = a.t > 0 ? `Time left: ${Math.ceil(a.t)}s` : '';
    return { label: `Mission ${a.def.id} — ${a.def.title}`, text: a.def.objective, sub };
  }

  markerPos() {
    if (!this.active || !this.marker.visible) return null;
    return { x: this.marker.position.x, z: this.marker.position.z };
  }
}
