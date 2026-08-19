export const CIC_COS_PHI_PROFILE = Object.freeze({
  id: "cic-square-400v-5a-v1",
  label: "CIC COSφ 400 V / 5 A",
  // Sudut memakai sumbu X positif ke kanan dan arah berlawanan jarum jam.
  // Titik awal diturunkan dari posisi garis skala pada foto referensi 1000467745.jpg.
  // Tambahkan profil baru (jangan mengubah detector) untuk tipe meter yang berbeda.
  points: Object.freeze([
    { angle: 88.5, value: 0.5, state: "LAG" },
    { angle: 99.0, value: 0.7, state: "LAG" },
    { angle: 112.5, value: 0.9, state: "LAG" },
    { angle: 119.0, value: 0.95, state: "LAG" },
    { angle: 134.0, value: 1.0, state: "UNITY" },
    { angle: 166.0, value: 0.9, state: "LEAD" },
    { angle: 173.0, value: 0.7, state: "LEAD" },
    { angle: 179.0, value: 0.5, state: "LEAD" },
  ]),
  pivot: Object.freeze({ x: 0.75, y: 0.74 }),
  validRange: Object.freeze({ min: 0.5, max: 1 }),
});

export function interpolateCosPhi(angle, profile = CIC_COS_PHI_PROFILE) {
  const points = profile.points;
  if (!Number.isFinite(angle) || angle < points[0].angle || angle > points.at(-1).angle) return null;
  const exact = points.find(point => Math.abs(point.angle - angle) < 1e-9);
  if (exact) return { value: exact.value, state: exact.state, segment: `${exact.state} ${exact.value}` };
  const upperIndex = points.findIndex(point => point.angle > angle);
  const left = points[upperIndex - 1];
  const right = points[upperIndex];
  const ratio = (angle - left.angle) / (right.angle - left.angle);
  const value = left.value + (right.value - left.value) * ratio;
  const state = left.state === "UNITY" ? right.state : right.state === "UNITY" ? left.state : left.state;
  return {
    value: Math.round(value * 100) / 100,
    state,
    segment: `${left.state} ${left.value} → ${right.state} ${right.value}`,
  };
}

