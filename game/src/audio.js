// Neon Harbor — synthesized sound: WebAudio only, no audio files.
// Engine hum, two-tone police siren, gunshots, impacts, and a looping
// synthwave bass groove. Everything is generated at runtime.
export function createAudio() {
  let ctx = null;
  let master = null;
  let engineOsc = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let musicTimer = null;
  let muted = false;
  let musicStep = 0;

  function ensure() {
    if (ctx) return true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
      // engine: sawtooth + lowpass, pitch follows speed
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 55;
      const engineFilter = ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 320;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(master);
      engineOsc.start();
      // siren: square wave alternating two tones
      sirenOsc = ctx.createOscillator();
      sirenOsc.type = 'triangle';
      sirenOsc.frequency.value = 700;
      sirenGain = ctx.createGain();
      sirenGain.gain.value = 0;
      sirenOsc.connect(sirenGain);
      sirenGain.connect(master);
      sirenOsc.start();
      let sirenHigh = false;
      setInterval(() => {
        if (!ctx || !sirenOsc) return;
        sirenHigh = !sirenHigh;
        sirenOsc.frequency.setTargetAtTime(sirenHigh ? 950 : 700, ctx.currentTime, 0.05);
      }, 380);
      startMusic();
      return true;
    } catch (e) {
      return false;
    }
  }

  function startMusic() {
    // 8-step bassline in A minor over a soft hat tick, looped.
    const bassNotes = [55, 0, 55, 65.41, 55, 0, 49, 58.27];
    const stepMs = 210;
    musicTimer = setInterval(() => {
      if (!ctx || muted) return;
      const note = bassNotes[musicStep % bassNotes.length];
      musicStep += 1;
      if (note > 0) {
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = note;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.11, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.19);
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 500;
        o.connect(f); f.connect(g); g.connect(master);
        o.start();
        o.stop(ctx.currentTime + 0.2);
      }
      // hat tick every other step
      if (musicStep % 2 === 0) {
        const dur = 0.03;
        const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const g = ctx.createGain();
        g.gain.value = 0.05;
        const f = ctx.createBiquadFilter();
        f.type = 'highpass';
        f.frequency.value = 6000;
        src.connect(f); f.connect(g); g.connect(master);
        src.start();
      }
    }, stepMs);
  }

  function noiseBurst(dur, freq, gainVal, type = 'lowpass') {
    if (!ctx) return;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = gainVal;
    src.connect(f); f.connect(g); g.connect(master);
    src.start();
  }

  function tone(freq, dur, gainVal, type = 'sine', slideTo = null) {
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainVal, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g); g.connect(master);
    o.start();
    o.stop(ctx.currentTime + dur + 0.02);
  }

  return {
    ensure,
    resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); },
    setMuted(m) {
      muted = m;
      if (master) master.gain.value = m ? 0 : 0.5;
    },
    isMuted() { return muted; },
    setEngine(speedNorm, inCar) {
      if (!ctx) return;
      const target = inCar ? 0.05 + speedNorm * 0.12 : 0;
      engineGain.gain.setTargetAtTime(target, ctx.currentTime, 0.1);
      engineOsc.frequency.setTargetAtTime(55 + speedNorm * 130, ctx.currentTime, 0.08);
    },
    setSiren(on) {
      if (!ctx) return;
      sirenGain.gain.setTargetAtTime(on ? 0.045 : 0, ctx.currentTime, 0.15);
    },
    shot() { noiseBurst(0.12, 1800, 0.5, 'highpass'); tone(180, 0.08, 0.25, 'square', 60); },
    punch() { noiseBurst(0.08, 500, 0.3); },
    crash() { noiseBurst(0.3, 400, 0.6); tone(70, 0.25, 0.4, 'sine', 40); },
    pickup() { tone(660, 0.12, 0.2, 'sine'); tone(990, 0.18, 0.2, 'sine'); },
    missionDone() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.25, 0.22, 'triangle'), i * 110)); },
    failed() { tone(220, 0.4, 0.25, 'sawtooth', 110); },
    horn() { tone(370, 0.18, 0.18, 'square'); tone(466, 0.18, 0.15, 'square'); },
    click() { tone(800, 0.05, 0.12, 'sine'); },
  };
}
