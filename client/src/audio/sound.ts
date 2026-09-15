// All game SFX are synthesized live via the raw Web Audio API — no audio
// files to fetch/host, and bleeps/sweeps fit the phosphor-arcade visual
// language better than sampled recordings would. One shared AudioContext,
// created lazily (browsers refuse to start audio before a real user
// gesture — see unlockAudio, wired into useInput's first keydown/mousedown).

let ctx: AudioContext | null = null;
let muted = loadMuted();

function loadMuted(): boolean {
  try {
    return localStorage.getItem("nexus-muted") === "1";
  } catch {
    return false; // private browsing / storage disabled — default to on
  }
}

function saveMuted(value: boolean) {
  try {
    localStorage.setItem("nexus-muted", value ? "1" : "0");
  } catch {
    // Nothing we can do if storage is unavailable — the session-only
    // in-memory `muted` flag above still works for this visit.
  }
}

function getContext(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null; // no Web Audio support at all — sounds silently no-op
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Call on the first real user gesture — see useInput.ts. A no-op after
 * the first successful call (getContext caches the context). */
export function unlockAudio() {
  getContext();
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean) {
  muted = value;
  saveMuted(value);
  if (!value) getContext(); // re-arm immediately rather than on the next event
}

// --- low-level synthesis --------------------------------------------------

interface ToneOptions {
  type?: OscillatorType;
  volume?: number;
  delay?: number; // seconds from now
}

/** A single pitch-swept tone with an exponential decay envelope (the classic
 * "arcade bleep" shape) — freqStart/freqEnd let it rise or fall. */
function tone(freqStart: number, freqEnd: number, duration: number, opts: ToneOptions = {}) {
  const audio = getContext();
  if (!audio) return;
  const { type = "sine", volume = 0.15, delay = 0 } = opts;
  const t0 = audio.currentTime + delay;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(1, freqStart), t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + duration);
  gain.gain.setValueAtTime(volume, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

interface NoiseOptions {
  volume?: number;
  delay?: number;
  filterFreq?: number;
}

/** A short burst of filtered white noise — explosions/impacts, where a pure
 * tone would read as too clean/musical. */
function noiseBurst(duration: number, opts: NoiseOptions = {}) {
  const audio = getContext();
  if (!audio) return;
  const { volume = 0.2, delay = 0, filterFreq = 1200 } = opts;
  const t0 = audio.currentTime + delay;
  const bufferSize = Math.max(1, Math.floor(audio.sampleRate * duration));
  const buffer = audio.createBuffer(1, bufferSize, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

  const source = audio.createBufferSource();
  source.buffer = buffer;
  const filter = audio.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = filterFreq;
  const gain = audio.createGain();
  gain.gain.setValueAtTime(volume, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(audio.destination);
  source.start(t0);
  source.stop(t0 + duration + 0.02);
}

// --- named game events -----------------------------------------------------
// Kept quiet individually (volumes in the 0.05-0.25 range) since several can
// legitimately overlap in a busy frame (multiple enemies firing, a kill and
// a shield hit in the same beat) — this is about a felt rhythm, not any one
// sound standing out on its own.

export const sound = {
  playerFire() {
    tone(880, 440, 0.08, { type: "square", volume: 0.05 });
  },
  enemyFire() {
    tone(220, 120, 0.12, { type: "sawtooth", volume: 0.045 });
  },
  // The Harrier boss variant's single precision-aimed shot (see BOSS.
  // variants in constants.ts) — a sharp, higher-pitched "zap" instead of
  // the low sawtooth every other shot in the game uses, giving it its own
  // audio identity to match how visually distinct that variant already is
  // (a wide barrage reads as area danger; one accurate laser should sound
  // like a precise threat, not just another bolt in the mix).
  bossAimedShot() {
    tone(1400, 300, 0.18, { type: "square", volume: 0.09 });
    noiseBurst(0.05, { volume: 0.07, filterFreq: 4200 });
  },
  enemyHit() {
    noiseBurst(0.15, { volume: 0.16, filterFreq: 2200 });
    tone(500, 80, 0.15, { type: "square", volume: 0.09 });
  },
  shieldHit() {
    tone(220, 150, 0.08, { type: "triangle", volume: 0.1 });
  },
  playerHit() {
    noiseBurst(0.25, { volume: 0.26, filterFreq: 800 });
    tone(180, 60, 0.3, { type: "sawtooth", volume: 0.16 });
  },
  lifeLost() {
    tone(600, 100, 0.5, { type: "sawtooth", volume: 0.18, delay: 0 });
    tone(500, 80, 0.5, { type: "sawtooth", volume: 0.14, delay: 0.08 });
  },
  gameOver() {
    tone(400, 50, 1.2, { type: "sawtooth", volume: 0.2 });
  },
  waveClear() {
    // A short rising arpeggio — the one deliberately "musical" cue, for the
    // one moment (clearing a wave) that's meant to feel like a win, not
    // just an impact.
    [523, 659, 784, 1047].forEach((freq, i) =>
      tone(freq, freq, 0.14, { type: "triangle", volume: 0.13, delay: i * 0.09 }),
    );
  },
  pickupHealth() {
    tone(440, 880, 0.2, { type: "sine", volume: 0.14 });
  },
  pickupWeapon() {
    tone(660, 990, 0.16, { type: "square", volume: 0.12 });
    tone(990, 1320, 0.16, { type: "square", volume: 0.09, delay: 0.05 });
  },
  novaBomb() {
    // A rare, deliberately bigger and louder cue than anything else here —
    // this is the one pickup meant to feel like a genuine power surge, not
    // just another impact or another buff.
    noiseBurst(0.5, { volume: 0.3, filterFreq: 3000 });
    tone(120, 900, 0.4, { type: "sawtooth", volume: 0.22 });
    tone(900, 200, 0.5, { type: "sine", volume: 0.18, delay: 0.15 });
  },
  // A short, low "thunk" launch — deliberately unlike playerFire's crisp
  // square bleep, since a lobbed grenade is a heavier, slower-committing
  // action than a bolt (see GRENADE in config/constants.ts).
  grenadeThrow() {
    tone(180, 90, 0.12, { type: "triangle", volume: 0.1 });
  },
  // Bigger and lower than enemyHit/playerHit — a wide-radius blast, not a
  // single-target impact — but shorter and quieter than novaBomb's full
  // power-surge cue, matching the design intent that a grenade is a
  // frequent tactical tool, not a rare instant-win jackpot.
  grenadeExplode() {
    noiseBurst(0.35, { volume: 0.28, filterFreq: 1000 });
    tone(150, 40, 0.35, { type: "sawtooth", volume: 0.2 });
  },
};
