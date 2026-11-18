// Neon Harbor — save game: localStorage, autosaves on mission completion
// and every 20 seconds, plus on quit. Continue restores money, missions,
// position, health and wanted level.
const KEY = 'neon-harbor-save-v1';

export function loadSave() {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data.money !== 'number') return null;
    return data;
  } catch (e) {
    return null;
  }
}

export function writeSave(state) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({
      v: 1,
      savedAt: Date.now(),
      money: state.money,
      completed: state.completed,
      x: state.x,
      z: state.z,
      health: state.health,
      wantedHeat: state.wantedHeat,
      day: state.day,
      clockMinutes: state.clockMinutes,
    }));
    return true;
  } catch (e) {
    return false;
  }
}

export function clearSave() {
  try { window.localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}
