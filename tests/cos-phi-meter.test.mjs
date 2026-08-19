import assert from "node:assert/strict";
import test from "node:test";
import { CIC_COS_PHI_PROFILE, interpolateCosPhi } from "../src/lib/cosPhiCalibration.js";
import { analyzeCosPhiPixels, cameraErrorMessage, confidenceLevel, stopMediaStream } from "../src/lib/cosPhiMeter.js";

const point = (state, value) => CIC_COS_PHI_PROFILE.points.find(item => item.state === state && item.value === value);

test("jarum tepat pada unity menghasilkan 1,00", () => {
  assert.deepEqual(interpolateCosPhi(point("UNITY", 1).angle), { value: 1, state: "UNITY", segment: "UNITY 1" });
});

test("jarum sekitar 0,9 LEAD", () => {
  const result = interpolateCosPhi(point("LEAD", .9).angle);
  assert.equal(result.value, .9); assert.equal(result.state, "LEAD");
});

test("jarum di antara 0,9 LEAD dan unity diinterpolasi nonlinier", () => {
  const result = interpolateCosPhi(150);
  assert.equal(result.state, "LEAD"); assert.ok(result.value > .94 && result.value < .96);
});

test("jarum sekitar 0,9 LAG", () => {
  const result = interpolateCosPhi(point("LAG", .9).angle);
  assert.equal(result.value, .9); assert.equal(result.state, "LAG");
});

test("jarum mendekati 0,5 tetap dalam rentang praktis", () => {
  assert.equal(interpolateCosPhi(178).state, "LEAD");
  assert.ok(interpolateCosPhi(178).value >= .5);
  assert.ok(interpolateCosPhi(89).value >= .5);
});

test("sudut di luar calibration range ditolak", () => {
  assert.equal(interpolateCosPhi(70), null); assert.equal(interpolateCosPhi(190), null);
});

function frame({ angle = 150, needle = true, dark = false } = {}) {
  const width = 260, height = 260;
  const data = new Uint8ClampedArray(width * height * 4);
  const background = dark ? 12 : 218;
  for (let offset = 0; offset < data.length; offset += 4) data.set([background, background, background, 255], offset);
  const setPixel = (x, y, value = 18, radius = 1) => {
    for (let dy = -radius; dy <= radius; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
      const sx = Math.round(x + dx), sy = Math.round(y + dy);
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
      const offset = (sy * width + sx) * 4; data[offset] = value; data[offset + 1] = value; data[offset + 2] = value;
    }
  };
  if (!dark) {
    for (let edge = 0; edge < 8; edge += 1) for (let index = 0; index < width; index += 1) {
      setPixel(index, edge, 25, 0); setPixel(index, height - 1 - edge, 25, 0); setPixel(edge, index, 25, 0); setPixel(width - 1 - edge, index, 25, 0);
    }
    const pivot = { x: width * .75, y: height * .74 };
    for (let tickAngle = 90; tickAngle <= 179; tickAngle += 5) for (let radius = 112; radius <= 120; radius += 1) {
      const rad = tickAngle * Math.PI / 180; setPixel(pivot.x + Math.cos(rad) * radius, pivot.y - Math.sin(rad) * radius, 55, 0);
    }
    if (needle) for (let radius = 18; radius <= 145; radius += .4) {
      const rad = angle * Math.PI / 180; setPixel(pivot.x + Math.cos(rad) * radius, pivot.y - Math.sin(rad) * radius, 12, 2);
    }
  }
  return { data, width, height };
}

test("detector menemukan garis jarum sintetis dan sisi LEAD", () => {
  const result = analyzeCosPhiPixels(frame());
  assert.equal(result.ok, true); assert.equal(result.state, "LEAD"); assert.ok(Math.abs(result.value - .95) <= .02);
});

test("detector menolak gambar tanpa jarum", () => {
  const result = analyzeCosPhiPixels(frame({ needle: false }));
  assert.equal(result.ok, false); assert.match(result.code, /needle-not-found|low-confidence/);
});

test("detector menolak gambar terlalu gelap", () => {
  const result = analyzeCosPhiPixels(frame({ dark: true }));
  assert.equal(result.ok, false); assert.equal(result.code, "too-dark");
});

test("pesan permission kamera mudah dipahami dan manual tetap tersedia", () => {
  assert.match(cameraErrorMessage({ name: "NotAllowedError" }), /Izin kamera/);
  assert.match(cameraErrorMessage({ name: "NotAllowedError" }), /manual/);
});

test("pembatalan kamera menghentikan seluruh track", () => {
  let stopped = 0;
  stopMediaStream({ getTracks: () => [{ stop: () => stopped += 1 }, { stop: () => stopped += 1 }] });
  assert.equal(stopped, 2);
});

test("threshold confidence mengikuti aturan UX", () => {
  assert.equal(confidenceLevel(85), "high"); assert.equal(confidenceLevel(65), "medium"); assert.equal(confidenceLevel(64), "low");
});

