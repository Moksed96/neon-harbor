// Neon Harbor — HUD: DOM readouts plus a canvas minimap.
// The minimap draws the street grid, water, buildings, the player arrow,
// the mission marker, traffic and police as live dots.
import { districtAt } from './city.js';

export function createHud(city) {
  const el = (id) => document.getElementById(id);
  const starsEl = el('stars');
  const moneyEl = el('money');
  const clockEl = el('clock');
  const objLabel = document.querySelector('#objective .label');
  const objText = document.querySelector('#objective .text');
  const objSub = document.querySelector('#objective .sub');
  const healthFill = el('health-fill');
  const healthNum = el('health-num');
  const weaponLine = el('weapon-line');
  const speedNum = el('speed-num');
  const vehicleName = el('vehicle-name');
  const toastEl = el('toast');
  const hintEl = el('hint');
  const districtEl = el('district');
  const crosshair = el('crosshair');
  const damageEl = el('damage');
  const dialogEl = el('dialog');
  const map = el('minimap');
  const mapCtx = map.getContext('2d');

  let toastTimer = null;

  function drawMinimap(state) {
    const S = 380;
    const half = 210;
    const scale = S / (half * 2);
    const toMap = (x, z) => [(x + half) * scale, (z + half) * scale];
    mapCtx.clearRect(0, 0, S, S);
    // land + water
    mapCtx.fillStyle = '#232a33';
    mapCtx.fillRect(0, 0, S, S);
    mapCtx.fillStyle = '#1d6f8e';
    mapCtx.fillRect(0, 0, (-176 + half) * scale, S);
    mapCtx.fillStyle = '#d9c28a';
    mapCtx.fillRect(0, (168 + half) * scale, S, S - (168 + half) * scale);
    // buildings
    mapCtx.fillStyle = '#3a414b';
    for (const c of city.colliders) {
      if (c.minX < -170 || c.minX > 200) continue; // skip edge walls/containers look fine to keep
      const [x1, z1] = toMap(c.minX, c.minZ);
      const [x2, z2] = toMap(c.maxX, c.maxZ);
      mapCtx.fillRect(x1, z1, x2 - x1, z2 - z1);
    }
    // roads
    mapCtx.strokeStyle = '#565e68';
    mapCtx.lineWidth = 9 * scale;
    for (const s of city.streets) {
      const [x1] = toMap(s, 0);
      mapCtx.beginPath(); mapCtx.moveTo(x1, 0); mapCtx.lineTo(x1, S); mapCtx.stroke();
      const [, z1] = toMap(0, s);
      mapCtx.beginPath(); mapCtx.moveTo(0, z1); mapCtx.lineTo(S, z1); mapCtx.stroke();
    }
    // mission marker
    if (state.marker) {
      const [mx, mz] = toMap(state.marker.x, state.marker.z);
      mapCtx.fillStyle = '#ffc233';
      mapCtx.beginPath(); mapCtx.arc(mx, mz, 9, 0, Math.PI * 2); mapCtx.fill();
      mapCtx.strokeStyle = '#fff';
      mapCtx.lineWidth = 2;
      mapCtx.beginPath(); mapCtx.arc(mx, mz, 12, 0, Math.PI * 2); mapCtx.stroke();
    }
    // traffic dots
    mapCtx.fillStyle = '#cfd6de';
    for (const v of state.traffic) {
      const [tx, tz] = toMap(v.x, v.z);
      mapCtx.fillRect(tx - 2, tz - 2, 4, 4);
    }
    // police dots
    mapCtx.fillStyle = '#2e6bff';
    for (const v of state.policeCars) {
      const [tx, tz] = toMap(v.x, v.z);
      mapCtx.beginPath(); mapCtx.arc(tx, tz, 5, 0, Math.PI * 2); mapCtx.fill();
    }
    // player arrow (north = -z up on the map)
    const [px, pz] = toMap(state.player.x, state.player.z);
    mapCtx.save();
    mapCtx.translate(px, pz);
    mapCtx.rotate(-state.player.heading);
    mapCtx.fillStyle = '#ff2e88';
    mapCtx.beginPath();
    mapCtx.moveTo(0, -10); mapCtx.lineTo(7, 8); mapCtx.lineTo(-7, 8); mapCtx.closePath();
    mapCtx.fill();
    mapCtx.strokeStyle = '#fff';
    mapCtx.lineWidth = 1.5;
    mapCtx.stroke();
    mapCtx.restore();
  }

  return {
    show() { el('hud').hidden = false; },
    hide() { el('hud').hidden = true; },
    setStars(n) {
      const spans = starsEl.querySelectorAll('span');
      spans.forEach((s, i) => {
        s.className = i < n ? '' : 'off';
        s.textContent = '★';
      });
      starsEl.classList.toggle('hot', n >= 3);
    },
    setMoney(m) { moneyEl.textContent = `$${Math.floor(m).toLocaleString('en-US')}`; },
    setClock(day, minutes) {
      const h = Math.floor(minutes / 60) % 24;
      const mm = Math.floor(minutes % 60);
      clockEl.textContent = `DAY ${day} · ${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    },
    setObjective(label, text, sub) {
      objLabel.textContent = label;
      objText.textContent = text;
      objSub.textContent = sub || '';
    },
    setHealth(hp) {
      const pct = Math.max(0, Math.min(100, hp));
      healthFill.style.width = `${pct}%`;
      healthFill.classList.toggle('low', pct < 30);
      healthNum.textContent = `${Math.ceil(pct)} HP`;
    },
    setWeapon(text) { weaponLine.textContent = text; },
    setSpeed(mph, vehicle) {
      speedNum.innerHTML = `${Math.round(mph)} <small>MPH</small>`;
      vehicleName.textContent = vehicle;
    },
    setDistrict(x, z) { districtEl.textContent = districtAt(x, z); },
    setCrosshair(on) { crosshair.classList.toggle('on', on); },
    setDamage(flash) { damageEl.style.opacity = flash ? String(flash) : '0'; },
    toast(title, sub, kind) {
      toastEl.querySelector('h2').textContent = title;
      toastEl.querySelector('p').textContent = sub || '';
      toastEl.className = `on ${kind || ''}`;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toastEl.className = ''; }, 2600);
    },
    hint(text) {
      if (!text) { hintEl.hidden = true; return; }
      hintEl.textContent = text;
      hintEl.hidden = false;
    },
    showDialog(who, text) {
      dialogEl.querySelector('.who').textContent = who;
      dialogEl.querySelector('.text').textContent = text;
      dialogEl.hidden = false;
    },
    hideDialog() { dialogEl.hidden = true; },
    drawMinimap,
  };
}
