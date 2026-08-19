import { CIC_COS_PHI_PROFILE, interpolateCosPhi } from "./cosPhiCalibration.js";

export const COS_PHI_CONFIDENCE = Object.freeze({ high: 85, medium: 65 });

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function luminancePixels(data) {
  const gray = new Uint8Array(data.length / 4);
  let sum = 0;
  for (let source = 0, target = 0; source < data.length; source += 4, target += 1) {
    const value = Math.round(data[source] * 0.299 + data[source + 1] * 0.587 + data[source + 2] * 0.114);
    gray[target] = value;
    sum += value;
  }
  return { gray, mean: sum / gray.length };
}

function regionMean(gray, width, height, left, top, right, bottom) {
  const x1 = Math.floor(width * left), x2 = Math.ceil(width * right);
  const y1 = Math.floor(height * top), y2 = Math.ceil(height * bottom);
  let sum = 0, count = 0;
  for (let y = y1; y < y2; y += 2) for (let x = x1; x < x2; x += 2) {
    sum += gray[y * width + x]; count += 1;
  }
  return count ? sum / count : 0;
}

function sampleDarkness(gray, width, height, x, y, radius = 1) {
  let darkest = 255;
  for (let dy = -radius; dy <= radius; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
    const sx = Math.round(x + dx), sy = Math.round(y + dy);
    if (sx >= 0 && sy >= 0 && sx < width && sy < height) darkest = Math.min(darkest, gray[sy * width + sx]);
  }
  return darkest;
}

function scoreAngle(gray, width, height, pivot, angle, background) {
  const radians = angle * Math.PI / 180;
  const radius = Math.min(width, height);
  const start = radius * 0.085, end = radius * 0.57;
  const samples = 58;
  let darkness = 0, darkCount = 0, longest = 0, current = 0;
  for (let index = 0; index < samples; index += 1) {
    const distance = start + (end - start) * index / (samples - 1);
    const x = pivot.x + Math.cos(radians) * distance;
    const y = pivot.y - Math.sin(radians) * distance;
    const value = sampleDarkness(gray, width, height, x, y, Math.max(1, Math.round(radius / 380)));
    const pointDarkness = clamp((background - value) / 155, 0, 1);
    darkness += pointDarkness;
    if (pointDarkness > 0.42) { current += 1; longest = Math.max(longest, current); }
    else current = 0;
    if (pointDarkness > 0.32) darkCount += 1;
  }
  return darkness / samples * 0.58 + darkCount / samples * 0.22 + longest / samples * 0.20;
}

function findPivot(gray, width, height, profile, background) {
  const size = Math.min(width, height);
  const expected = { x: width * profile.pivot.x, y: height * profile.pivot.y };
  let best = { ...expected, score: -Infinity };
  const step = Math.max(3, Math.round(size * 0.012));
  for (let y = expected.y - size * .07; y <= expected.y + size * .07; y += step) {
    for (let x = expected.x - size * .09; x <= expected.x + size * .05; x += step) {
      let ringDarkness = 0, samples = 0;
      for (const radiusRatio of [.045, .06, .075]) for (let angle = 0; angle < 360; angle += 15) {
        const radians = angle * Math.PI / 180;
        const value = sampleDarkness(gray, width, height, x + Math.cos(radians) * size * radiusRatio, y + Math.sin(radians) * size * radiusRatio, 1);
        ringDarkness += clamp((background - value) / 170, 0, 1); samples += 1;
      }
      const score = ringDarkness / samples - Math.hypot(x - expected.x, y - expected.y) / size * .18;
      if (score > best.score) best = { x, y, score };
    }
  }
  return best;
}

function findNeedle(gray, width, height, profile, background) {
  const pivot = findPivot(gray, width, height, profile, background);
  const candidates = [];
  for (let angle = profile.points[0].angle; angle <= profile.points.at(-1).angle; angle += 0.5) {
    candidates.push({ angle, score: scoreAngle(gray, width, height, pivot, angle, background) });
  }
  candidates.sort((left, right) => right.score - left.score);
  const best = candidates[0];
  const alternative = candidates.find(candidate => Math.abs(candidate.angle - best.angle) >= 5) || candidates[1];
  return { ...best, margin: best.score - (alternative?.score || 0), pivot };
}

export function confidenceLevel(confidence) {
  if (confidence >= COS_PHI_CONFIDENCE.high) return "high";
  if (confidence >= COS_PHI_CONFIDENCE.medium) return "medium";
  return "low";
}

export function analyzeCosPhiPixels({ data, width, height }, profile = CIC_COS_PHI_PROFILE) {
  if (!data || !width || !height) throw new Error("Frame kamera tidak valid.");
  const { gray, mean } = luminancePixels(data);
  let variance = 0;
  for (let index = 0; index < gray.length; index += Math.max(1, Math.floor(gray.length / 12000))) variance += (gray[index] - mean) ** 2;
  const sampled = Math.ceil(gray.length / Math.max(1, Math.floor(gray.length / 12000)));
  const contrast = Math.sqrt(variance / sampled);
  if (mean < 48) return { ok: false, code: "too-dark", confidence: 0, message: "Foto terlalu gelap. Nyalakan penerangan dan foto ulang." };
  if (contrast < 14) return { ok: false, code: "meter-not-found", confidence: 0, message: "Meter belum ditemukan. Pastikan bingkai dan seluruh skala terlihat." };

  const corners = [
    regionMean(gray, width, height, .08, .08, .25, .25), regionMean(gray, width, height, .75, .08, .92, .25),
    regionMean(gray, width, height, .08, .75, .25, .92), regionMean(gray, width, height, .75, .75, .92, .92),
  ];
  const cornerSpread = Math.max(...corners) - Math.min(...corners);
  const perspectiveQuality = clamp(1 - cornerSpread / 105, 0, 1);
  const needle = findNeedle(gray, width, height, profile, clamp(mean + contrast * 0.8, 100, 245));
  if (needle.score < 0.28) return { ok: false, code: "needle-not-found", confidence: Math.round(needle.score * 100), message: "Jarum meter belum dapat dibaca. Dekatkan kamera dan pastikan skala terlihat jelas." };
  const calibrated = interpolateCosPhi(needle.angle, profile);
  if (!calibrated) return { ok: false, code: "outside-range", confidence: 0, message: "Posisi jarum berada di luar rentang kalibrasi. Silakan foto ulang." };

  const exposureQuality = clamp(1 - Math.abs(mean - 145) / 145, 0, 1);
  const lineQuality = clamp((needle.score - 0.22) / 0.42, 0, 1);
  const uniqueness = clamp(needle.margin / 0.16, 0, 1);
  const confidence = Math.round(100 * (lineQuality * 0.55 + uniqueness * 0.2 + exposureQuality * 0.12 + perspectiveQuality * 0.13));
  if (perspectiveQuality < 0.25) return { ok: false, code: "perspective", confidence: Math.min(confidence, 49), message: "Foto terlalu miring atau terkena pantulan. Posisikan kamera sejajar lalu foto ulang." };
  if (confidence < COS_PHI_CONFIDENCE.medium) return { ok: false, code: "low-confidence", confidence, message: "Pembacaan meter kurang jelas. Silakan foto ulang atau isi nilai COS Phi secara manual.", debug: { angle: needle.angle, pivot: needle.pivot, score: needle.score } };
  return {
    ok: true, value: calibrated.value, state: calibrated.state, confidence,
    level: confidenceLevel(confidence),
    debug: { angle: needle.angle, pivot: needle.pivot, segment: calibrated.segment, score: needle.score },
  };
}

export function cameraErrorMessage(error) {
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") return "Izin kamera diperlukan untuk membaca COS Phi secara otomatis. Anda tetap dapat memasukkan nilainya secara manual.";
  if (error?.name === "NotFoundError" || error?.name === "OverconstrainedError") return "Kamera belakang tidak ditemukan. Coba kamera lain atau isi COS Phi secara manual.";
  return "Kamera tidak dapat dibuka. Periksa izin browser atau isi COS Phi secara manual.";
}

export function stopMediaStream(stream) {
  stream?.getTracks?.().forEach(track => track.stop());
}

export function analyzeCosPhiCanvas(canvas, profile = CIC_COS_PHI_PROFILE) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  return analyzeCosPhiPixels(context.getImageData(0, 0, canvas.width, canvas.height), profile);
}
