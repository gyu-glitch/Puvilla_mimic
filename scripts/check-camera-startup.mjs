import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
registerHooks({ resolve(s, c, next) {
  if (s.startsWith('.') && c.parentURL && !/\.[a-z]+$/i.test(s)) {
    const p = new URL(s + '.ts', c.parentURL);
    if (existsSync(p)) return next(p.href, c);
  }
  return next(s, c);
} });

// Exercise the real openCamera/UI application path without opening a camera.
const listeners = new Map(), timers = new Map();
let timerId = 0, nextTrack;
globalThis.window = { addEventListener: (name, fn) => listeners.set(name, fn) };
globalThis.setTimeout = (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; };
globalThis.clearTimeout = id => timers.delete(id);
Object.defineProperty(globalThis, 'navigator', { value: { mediaDevices: {
  getUserMedia: async () => {
    const track = nextTrack;
    return { getTracks: () => [track], getVideoTracks: () => [track] };
  },
} }, configurable: true });
const { openCamera, applyImageSettings } = await import('../src/camera.ts');
const cfg = () => ({
  deviceLabelIncludes: '', width: 640, height: 480, frameRate: 30, mirror: true,
  applyImageSettings: false, autoExposure: true, exposureTime: 300,
  exposureCompensation: 0, brightness: 128, contrast: 128, controlsHidden: false,
});
const makeTrack = (caps = {
  exposureMode: ['manual', 'continuous'], exposureTime: { min: 1, max: 1000 },
  exposureCompensation: { min: -2, max: 2 }, brightness: { min: 0, max: 255 },
  contrast: { min: 0, max: 255 },
}) => ({
  label: 'test camera', readyState: 'live', calls: [], settings: { exposureMode: 'manual' },
  getCapabilities() { return caps; },
  getSettings() { return this.settings; },
  async applyConstraints(c) {
    const values = c.advanced[0];
    this.calls.push(values);
    Object.assign(this.settings, values);
  },
  addEventListener() {},
  stop() { this.readyState = 'ended'; },
});
const open = async (track, config) => {
  nextTrack = track;
  const video = { readyState: 2, async play() {} };
  await openCamera(video, config);
};
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const runTimers = async () => {
  const pending = [...timers.values()]; timers.clear();
  for (const t of pending) { t.fn(); await flush(); }
};

const first = makeTrack(), config = cfg();
await open(first, config);
assert.equal(first.settings.exposureMode, 'continuous',
  'fresh deployment must actively enable auto exposure, even without saved image settings');
assert.deepEqual(first.calls, [{ exposureMode: 'continuous' }],
  'startup must not force device-specific brightness/contrast/manual exposure');
assert.equal(timers.size, 3, 'driver warm-up retries must run for auto defaults too');

// The user changes mode during driver warm-up: retries must use the latest choice.
Object.assign(config, { applyImageSettings: true, autoExposure: false, exposureTime: 200 });
await applyImageSettings(config);
await runTimers();
assert.equal(first.settings.exposureMode, 'manual');
assert.equal(first.settings.exposureTime, 200);

// Old retry callbacks cannot apply a prior session's settings to the new track.
await open(makeTrack(), config);
const stale = [...timers.values()];
const second = makeTrack();
await open(second, cfg());
for (const t of stale) t.fn();
await flush();
assert.deepEqual(second.calls, [{ exposureMode: 'continuous' }]);
await runTimers();
assert.equal(second.calls.length, 4);
assert.ok(second.calls.every(c => c.exposureMode === 'continuous'));
listeners.get('pagehide')();
assert.equal(timers.size, 0);

// A driver may ignore the first setting immediately after video.play().
const warming = makeTrack();
warming.applyConstraints = async function(c) {
  this.calls.push(c.advanced[0]);
  if (this.calls.length > 1) Object.assign(this.settings, c.advanced[0]);
};
await open(warming, cfg());
assert.equal(warming.settings.exposureMode, 'manual');
await runTimers();
assert.equal(warming.settings.exposureMode, 'continuous');

// Rapid UI toggles cannot finish out of order while a driver request is pending.
const ordered = makeTrack();
await open(ordered, cfg());
let unblock;
const gate = new Promise(resolve => { unblock = resolve; });
ordered.applyConstraints = async function(c) {
  this.calls.push(c.advanced[0]);
  if (c.advanced[0].exposureMode === 'manual') await gate;
  Object.assign(this.settings, c.advanced[0]);
};
const manualRequest = applyImageSettings({ ...cfg(), applyImageSettings: true, autoExposure: false });
await flush();
const autoRequest = applyImageSettings({ ...cfg(), applyImageSettings: true });
await flush();
assert.equal(ordered.calls.filter(c => c.exposureMode === 'continuous').length, 1);
unblock();
await Promise.all([manualRequest, autoRequest]);
assert.equal(ordered.settings.exposureMode, 'continuous');
listeners.get('pagehide')();

// Optional image controls rejecting a request must not prevent auto exposure.
const rejected = makeTrack(), saved = { ...cfg(), applyImageSettings: true };
rejected.applyConstraints = async function(c) {
  this.calls.push(c.advanced[0]);
  if ('brightness' in c.advanced[0]) throw new Error('device control rejected');
  Object.assign(this.settings, c.advanced[0]);
};
await open(rejected, saved);
assert.equal(rejected.settings.exposureMode, 'continuous');
listeners.get('pagehide')();

const unsupported = makeTrack({});
await open(unsupported, cfg());
assert.equal(unsupported.calls.length, 0);
listeners.get('pagehide')();
console.log('PASS: initial auto exposure, saved manual setting, ignored-first-request recovery, ordered UI toggles, session isolation, unsupported/rejected controls');
