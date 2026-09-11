"use client";

// Tiny WebAudio ringtone — no audio asset needed. Standard dual-tone ring:
// 2s on / 4s off loop, stopped explicitly. Respects reduced-motion? Audio has
// no visual component; callers can mute via the overlay's silence button.

let ctx: AudioContext | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function getCtx(): AudioContext | null {
  try {
    if (ctx) return ctx;
    const Ctor = window.AudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

function beep(at: number, freq: number, dur: number) {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.25, at + 0.05);
  gain.gain.setValueAtTime(0.25, at + dur - 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(at);
  osc.stop(at + dur + 0.05);
}

function ringOnce() {
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") void c.resume().catch(() => undefined);
  const t = c.currentTime + 0.05;
  // Classic US ring cadence: 2s on (440+480Hz), 4s off.
  for (let i = 0; i < 4; i++) {
    beep(t + i * 0.5, 440, 0.45);
    beep(t + i * 0.5, 480, 0.45);
  }
}

export function startRingtone() {
  stopRingtone();
  ringOnce();
  timer = setInterval(ringOnce, 6000);
}

export function stopRingtone() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
