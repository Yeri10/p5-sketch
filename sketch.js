/*
  Wu Wei Engine
  Author: Yerie Ye
  Date: 2026-01-07

  Generative flow-field system inspired by “Wu Wei” (non-action).
  Agents move through 3D Perlin noise; interaction adds chaos, and
  inactivity restores calm. Visuals use p5.Graphics trails, with
  Arduino FSR sensors via Web Serial, plus verse text modulation.

  Usage:
  - Press C to connect the Arduino serial port (Chrome / Edge).
  - Serial format: "v1,v2\n" (two integers).
  - Shortcuts: 1 calm kick（left hold），2 chaos kick(right tap), S save, F fullscreen.
*/


// =====================================================
// Verse class + verses.json handling
// =====================================================
class Verse {
  constructor(obj) {
    this.id = obj.id;
    this.cn = obj.cn;
    this.en = obj.en;
    this.emotion = obj.emotion || 'calm';
    this.colorHSB = obj.colorHSB || [200, 30, 90];
    this.weight = (obj.weight == null) ? 1.0 : obj.weight;
  }
}

// Weighted random pick with optional avoidId
function weightedPick(list, avoidId = null) {
  if (!list || list.length === 0) return null;

  // Optionally avoid repeating the same verse
  const pool = (avoidId == null) ? list : list.filter(v => v.id !== avoidId);
  const pickFrom = (pool.length > 0) ? pool : list;

  let total = 0;
  for (const v of pickFrom) total += (v.weight ?? 1);
  let r = random(total);
  for (const v of pickFrom) {
    r -= (v.weight ?? 1);
    if (r <= 0) return v;
  }
  return pickFrom[pickFrom.length - 1];
}

// --- verses.json + bottom text panel (HTML/CSS) ---
let versesData;
let verses = [];
let verseIndex = 0;

let versePanelEl, verseCnEl, verseEnEl, chaosHoldEl, chaosTapEl;
let hasStarted = false;
let coverEl = null;
let lastChaosUiUpdate = 0;

function preload() {
  // make sure verses.json is in the same folder as index.html
  versesData = loadJSON('verses.json');
}

// Bind HTML elements for verse panel
function bindVerseUI() {
  versePanelEl = document.getElementById('verse-panel');
  verseCnEl = document.getElementById('verse-cn');
  verseEnEl = document.getElementById('verse-en');
  chaosHoldEl = document.getElementById('chaos-level-hold');
  chaosTapEl = document.getElementById('chaos-level-tap');

  if (!versePanelEl || !verseCnEl || !verseEnEl) {
    console.warn('[UI] Missing verse panel IDs in HTML: verse-panel, verse-cn, verse-en');
  }
}

function sentenceStartUppercase(text) {
  if (!text) return text;
  const match = text.match(/[A-Za-z]/);
  if (!match) return text;
  const idx = match.index;
  return text.slice(0, idx) + text.charAt(idx).toUpperCase() + text.slice(idx + 1);
}

// Apply verse to UI + CSS mode
function applyVerse(v) {
  if (!v) return;
  // update DOM text
  if (verseCnEl) verseCnEl.textContent = v.cn;
  if (verseEnEl) verseEnEl.textContent = sentenceStartUppercase(v.en);

  // expose mode to CSS (your CSS uses data-mode)
  const mode = (v.emotion === 'chaos' || v.emotion === 'overflow' || v.emotion === 'warning') ? 'chaos' : 'calm';
  if (versePanelEl) versePanelEl.dataset.mode = mode;

}

// Pick & display next verse based on weighted randomness
function nextVerse() {
  if (!verses || verses.length === 0) return;

  const currentId = (verses[verseIndex] && verses[verseIndex].id != null) ? verses[verseIndex].id : null;
  const picked = weightedPick(verses, currentId);
  if (!picked) return;

  // update verseIndex to the picked one (so we know what is current)
  const idx = verses.findIndex(v => v.id === picked.id);
  verseIndex = (idx >= 0) ? idx : 0;

  applyVerse(verses[verseIndex]);
}

// =====================================================
// Web Serial (Browser Serial) — Arduino -> p5.js
// Expected Arduino line format: "v1,v2\n"  (two integers)
// =====================================================
let serialPort = null;
let serialReader = null;
let serialIsConnected = false;
let serialBuffer = '';

// Raw + smoothed sensor values
let fsr1Raw = 0;
let fsr2Raw = 0;
let fsr1Smooth = 0;
let fsr2Smooth = 0;
let holdChaosLevel = 0;
let lastHoldTime = 0;
let lastTapTime = 0;

// Smoothing + thresholds (tune these)
const fsrAlpha = 0.30;        // EMA smoothing (0.1~0.35)
const fsrGate = 0;            // below this treated as 0 (noise gate)
const fsrPressTh = 3;         // press threshold (active)
const fsrReleaseTh = 2;       // release threshold (hysteresis)
const fsr1HoldMin = 100;      // adjust to your sensor baseline
const fsr1HoldMax = 1023;     // adjust to your sensor max
const holdRiseRate = 0.0012;  // per ms, scaled by hold pressure
const holdDecayRate = 0.0002; // per ms when released
const tapBoost = 0.18;        // increase per tap
const tapDecayRate = 0.00004; // per ms when not tapping

// Active state with hysteresis (prevents flicker)
let fsr1Active = false;
let fsr2Active = false;

// Gesture timing for "tap" detection on FSR2
let fsr1LastActive = false;
let fsr2LastActive = false;

// Track last sensor input time (used for calm decay)
let lastSensorTime = 0;
let debugTextAlpha = 180;

// Keyboard emulation for Arduino press behaviors
let key1Held = false;
let key2Held = false;
let key1LastHeld = false;
let key2LastHeld = false;
let keyHoldTime = 0;
let keyTapTime = 0;

async function connectSerial() {
  if (!('serial' in navigator)) {
    alert('Web Serial not supported. Please use Chrome / Edge.');
    throw new Error('Web Serial not supported');
  }

  // Ask user to pick a port (must be triggered by a user gesture)
  serialPort = await navigator.serial.requestPort();
  await serialPort.open({ baudRate: 9600 });

  serialIsConnected = true;

  // Create text decoder stream
  const decoder = new TextDecoderStream();
  const inputDone = serialPort.readable.pipeTo(decoder.writable);
  serialReader = decoder.readable.getReader();

  // Start read loop
  readSerialLoop();
}

async function readSerialLoop() {
  try {
    while (serialIsConnected && serialReader) {
      const { value, done } = await serialReader.read();
      if (done) break;
      if (value) {
        serialBuffer += value;
        processSerialBuffer();
      }
    }
  } catch (e) {
    console.error('[Serial] read loop error', e);
  } finally {
    serialIsConnected = false;
  }
}

function processSerialBuffer() {
  let idx;
  while ((idx = serialBuffer.indexOf('\n')) >= 0) {
    const line = serialBuffer.slice(0, idx).trim();
    serialBuffer = serialBuffer.slice(idx + 1);
    if (line.length === 0) continue;
    parseSensorLine(line);
  }
}

function parseSensorLine(line) {
  // Expect: "123,456"
  const parts = line.split(',');
  if (parts.length < 2) return;

  const a = Number(parts[0]);
  const b = Number(parts[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return;

  fsr1Raw = a;
  fsr2Raw = b;

  // EMA smoothing
  fsr1Smooth = lerp(fsr1Smooth, fsr1Raw, fsrAlpha);
  fsr2Smooth = lerp(fsr2Smooth, fsr2Raw, fsrAlpha);

  // Noise gate
  if (fsr1Smooth < fsrGate) fsr1Smooth = 0;
  if (fsr2Smooth < fsrGate) fsr2Smooth = 0;

  // Hysteresis active state (prevents flicker)
  fsr1Active = fsr1Active
    ? (fsr1Smooth > fsrReleaseTh)
    : (fsr1Smooth > fsrPressTh);

  fsr2Active = fsr2Active
    ? (fsr2Smooth > fsrReleaseTh)
    : (fsr2Smooth > fsrPressTh);

  lastSensorTime = millis();
}

// --- Map sensors to your existing interaction logic ---
function sensorUpdate() {
  // If not connected, do nothing
  if (!serialIsConnected) return;

  // 1) FSR1 -> key "1" (calm kick) on press
  const rising1 = (fsr1Active && !fsr1LastActive);
  if (rising1) {
    if (!hasStarted) startExperience(1);
    triggerKey1Kick();
  }
  if (fsr1Active) {
    if (!hasStarted) startExperience(1);
    const now = millis();
    if (lastHoldTime === 0) lastHoldTime = now;
    const dt = now - lastHoldTime;
    const pressure = constrain(map(fsr1Smooth, fsr1HoldMin, fsr1HoldMax, 0, 1), 0, 1);
    holdChaosLevel = constrain(holdChaosLevel + (holdRiseRate * dt * pressure), 0, 1);
    lastHoldTime = now;
  } else {
    const now = millis();
    if (lastHoldTime === 0) lastHoldTime = now;
    const dt = now - lastHoldTime;
    holdChaosLevel = constrain(holdChaosLevel - (holdDecayRate * dt), 0, 1);
    lastHoldTime = now;
    if (holdChaosLevel <= 0.01) {
      holdChaosLevel = 0;
    }
  }
  fsr1LastActive = fsr1Active;

  // 2) FSR2 -> tap increases chaosLevel
  const rising = (fsr2Active && !fsr2LastActive);
  if (rising) {
    if (!hasStarted) startExperience(1);
    triggerKey2Kick();
    chaosLevel = constrain(chaosLevel + tapBoost, 0, 1);
  }
  if (fsr2Active) {
    if (!hasStarted) startExperience(1);
    drawMode = 2;
    lastPressTime = millis();
  }
  const now = millis();
  if (lastTapTime === 0) lastTapTime = now;
  const dt = now - lastTapTime;
  if (!fsr2Active && dt > 0) {
    chaosLevel = constrain(chaosLevel - (tapDecayRate * dt), 0, 1);
  }
  lastTapTime = now;
  fsr2LastActive = fsr2Active;

  // 3) No input -> calm decay (wu-wei)
  // Your existing draw() already decays chaos when drawMode===2 and idle>120.
  // Here we additionally help it return to calm if BOTH sensors are idle.
  const idleSensors = (!fsr1Active && !fsr2Active);
  if (idleSensors) {
    // If we haven't received sensor data for a while, don't force states
    // (keeps the system stable when unplugged)
  }
}

// --- Keyboard -> emulate Arduino press behavior ---
function keyboardUpdate() {
  const now = millis();

  // 1) Key "1" -> hold chaos behavior (like FSR1)
  const rising1 = (key1Held && !key1LastHeld);
  if (rising1) {
    if (!hasStarted) startExperience(1);
    triggerKey1Kick();
  }
  if (key1Held) {
    if (!hasStarted) startExperience(1);
    if (keyHoldTime === 0) keyHoldTime = now;
    const dt = now - keyHoldTime;
    const pressure = 1; // keyboard has no pressure, treat as full press
    holdChaosLevel = constrain(holdChaosLevel + (holdRiseRate * dt * pressure), 0, 1);
    keyHoldTime = now;
  } else {
    if (keyHoldTime === 0) keyHoldTime = now;
    const dt = now - keyHoldTime;
    holdChaosLevel = constrain(holdChaosLevel - (holdDecayRate * dt), 0, 1);
    keyHoldTime = now;
    if (holdChaosLevel <= 0.01) {
      holdChaosLevel = 0;
    }
  }
  key1LastHeld = key1Held;

  // 2) Key "2" -> tap chaos behavior (like FSR2)
  const rising2 = (key2Held && !key2LastHeld);
  if (rising2) {
    if (!hasStarted) startExperience(1);
    triggerKey2Kick();
    chaosLevel = constrain(chaosLevel + tapBoost, 0, 1);
  }
  if (key2Held) {
    if (!hasStarted) startExperience(1);
    drawMode = 2;
    lastPressTime = now;
  }
  if (keyTapTime === 0) keyTapTime = now;
  const dtTap = now - keyTapTime;
  if (!key2Held && dtTap > 0) {
    chaosLevel = constrain(chaosLevel - (tapDecayRate * dtTap), 0, 1);
  }
  keyTapTime = now;
  key2LastHeld = key2Held;
}

// =====================================================
// Global Visual Params
// Controls: agent count, flow field scale, time evolution, trail alpha, palettes
// =====================================================

let agents = [];
let agentCount = 14000;

let noiseStrength = 10;
let noiseZRange = 0.4;

let agentAlpha = 42;
let coverAgentAlpha = 28;
let pg = null;
let strokeWidth = 0.5;
const baseMaxSpeed = 5;
const holdSpeedBoost = 1.8;

let drawMode = 1;

// Chaos control for key '2' kick
let chaosLevel = 0;          // 0..1
let lastPressTime = 0;       // ms
let chaosDecay = 0.008;      // how fast it calms when no input
let chaosBoostBase = 0.25;   // base boost per press

function triggerKey1Kick() {
  drawMode = 1;              //Switch to calm mode
  chaosLevel = lerp(chaosLevel, 0, 0.6);
}

function triggerKey2Kick() {
  drawMode = 2;
  const now = millis();
  const dt = now - lastPressTime;

  // faster presses -> larger boost
  const boost = chaosBoostBase * constrain(120 / max(dt, 30), 0.6, 2.0);
  chaosLevel = constrain(chaosLevel + boost, 0, 1);

  lastPressTime = now;
  nextVerse();
}

function setup() {
  const c = createCanvas(windowWidth, windowHeight);
  c.parent('canvas-wrapper');
  colorMode(HSB, 360, 100, 100, 100);
  background(0);
  pg = createGraphics(windowWidth, windowHeight);
  pg.colorMode(HSB, 360, 100, 100, 100);

  // --- Bind HTML/CSS verse UI + load verses.json ---
  bindVerseUI();
  coverEl = document.getElementById('cover');
  document.body.classList.add('is-locked');

  // Convert raw JSON objects into Verse instances (adds defaults)
  verses = (versesData && versesData.verses)
    ? versesData.verses.map(obj => new Verse(obj))
    : [];
  verseIndex = 0;

  // show first verse by default
  if (verses.length > 0) {
    applyVerse(verses[verseIndex]);
  }

  for (let i = 0; i < agentCount; i++) {
    agents.push(new Agent(noiseZRange));
  }
}

function draw() {
  sensorUpdate();
  keyboardUpdate();
  if (!hasStarted) {
    drawMode = 1;
    chaosLevel = 0;
    agentAlpha = coverAgentAlpha;
  } else {
    agentAlpha = 42;
  }

  const driveLevel = chaosLevel;
  const holdBloom = (holdChaosLevel >= 0.9)
    ? map(holdChaosLevel, 0.9, 1, 0, 1)
    : 0;

  // fading background (white with low alpha for trails)
  const dynamicOverlay = (holdBloom > 0)
    ? lerp(6, 2, holdBloom)
    : lerp(10, 4, driveLevel);
  pg.noStroke();
  pg.fill(35, 8, 92, dynamicOverlay);
  pg.rect(0, 0, width, height);

  // --- Chaos decay when not pressing 'hold' ---
  if (drawMode === 2) {
    const idle = millis() - lastPressTime;
    if (idle > 2000) {
      chaosLevel = constrain(chaosLevel - chaosDecay, 0, 1);
      if (chaosLevel <= 0.001) {
        drawMode = 1;
        chaosLevel = 0;
      }
    }
  }

  if (chaosHoldEl || chaosTapEl) {
    const nowUi = millis();
    if (nowUi - lastChaosUiUpdate > 250) {
      if (chaosHoldEl) {
        chaosHoldEl.textContent = `hold chaos level: ${holdChaosLevel.toFixed(3)}`;
      }
      if (chaosTapEl) {
        chaosTapEl.textContent = `tap chaos level: ${chaosLevel.toFixed(3)}`;
      }
      lastChaosUiUpdate = nowUi;
    }
  }

  // fixed monochrome stroke color handled in Agent.js

  // draw agents
  for (let i = 0; i < agents.length; i++) {
    if (drawMode === 1) {
      const speedScale = lerp(1, holdSpeedBoost, holdChaosLevel);
      agents[i].maxSpeed = baseMaxSpeed * speedScale;
      // calm preset
      agents[i].update1(
        strokeWidth,
        100,          // large scale = calm
        0.004,        // slow time evolution
        { gfx: pg }
      );
    } else {
      agents[i].maxSpeed = baseMaxSpeed;
      // chaos preset driven by tap unless hold takes over
      const chaosScale = lerp(140, 30, driveLevel);
      const chaosZVel  = lerp(0.004, 0.03, driveLevel);

      agents[i].update2(
        strokeWidth,
        chaosScale,
        noiseStrength,
        chaosZVel,
        { gfx: pg }
      );
    }
  }

  if (frameCount % 3 === 0) {
    pg.filter(BLUR, 1);
  }

  image(pg, 0, 0);

  // --- Debug overlay (serial + FSR) ---
  const now = millis();
  const isStale = (now - lastSensorTime) > 1000;
  push();
  noStroke();
  fill(0, 0, 0, 70);
  rect(18, 28, 245, 145, 8);
  fill(0, 0, 100, debugTextAlpha);
  textSize(12);
  textAlign(LEFT, TOP);
  const status = serialIsConnected ? 'connected' : 'disconnected';
  const staleNote = isStale ? ' (stale)' : '';
  text(`serial: ${status}${staleNote}`, 28, 38);
  textStyle(ITALIC);
  text(`(press C to connect)`, 28, 52);
  text(`(no serial: use key 1 = hold, key 2 = tap)`, 28, 70);
  textStyle(NORMAL);
  text(`hold: ${fsr1Raw}`, 28, 95);
  text(`tap: ${fsr2Raw}`, 28, 113);
  text(`active: ${fsr1Active ? '1' : '0'} / ${fsr2Active ? '1' : '0'}`, 28, 131);
  text(`(key's': save key; 'f': fullscreen)`, 28, 149);
  pop();
}

function startExperience(mode = 1) {
  if (hasStarted) return;
  hasStarted = true;
  if (coverEl) coverEl.classList.add('is-hidden');
  document.body.classList.remove('is-locked');

  if (mode === 2) {
    drawMode = 2;
    chaosLevel = 0.6;
    lastPressTime = millis();
  } else {
    drawMode = 1;
    chaosLevel = 0;
  }
}

function keyPressed() {
  // CALM KICK
  if (key === '1') {
    key1Held = true;
  }

  // CHAOS KICK
  if (key === '2') {
    key2Held = true;
  }

  // SAVE FRAME
  if (key === 's' || key === 'S') {
    saveCanvas('flowfield_3d', 'png');
  }

  //  FULLSCREEN
  if (key === 'f' || key === 'F') {
    let fs = fullscreen();
    fullscreen(!fs);
  }
  // CONNECT SERIAL
  if (key === 'c' || key === 'C') {
    connectSerial().catch(err => console.error('[Serial] connect failed', err));
  }
}

function keyReleased() {
  if (key === '1') {
    key1Held = false;
  }
  if (key === '2') {
    key2Held = false;
  }
}

function windowResized() {
  if (fullscreen()) {
    resizeCanvas(windowWidth, windowHeight);
    if (pg) {
      pg.resizeCanvas(windowWidth, windowHeight);
      pg.colorMode(HSB, 360, 100, 100, 100);
    }
  }
}
