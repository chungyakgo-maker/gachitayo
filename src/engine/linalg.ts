// 작은 벡터·행렬 연산 (3차원). 행렬은 행 우선 9개 값.

export type Vec3 = [number, number, number];
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export function normalize(a: Vec3): Vec3 {
  const n = norm(a);
  return n > 0 ? scale(a, 1 / n) : [0, 0, 0];
}

/** 두 벡터 사이 각도 (rad) */
export function angleBetween(a: Vec3, b: Vec3): number {
  const c = dot(a, b) / (norm(a) * norm(b));
  return Math.acos(Math.min(1, Math.max(-1, c)));
}

export const matVec = (m: Mat3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

export const transpose = (m: Mat3): Mat3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

export function matMul(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r[i * 3 + j] = a[i * 3]! * b[j]! + a[i * 3 + 1]! * b[3 + j]! + a[i * 3 + 2]! * b[6 + j]!;
  return r;
}

/** 세 행으로 행렬을 만든다 */
export const fromRows = (a: Vec3, b: Vec3, c: Vec3): Mat3 => [...a, ...b, ...c];

export const row = (m: Mat3, i: 0 | 1 | 2): Vec3 => [m[i * 3]!, m[i * 3 + 1]!, m[i * 3 + 2]!];

/** Rz(yaw)·Ry(pitch)·Rx(roll), 각도 rad */
export function rotationFromEuler(yaw: number, pitch: number, roll: number): Mat3 {
  const [cy, sy, cp, sp, cr, sr] = [
    Math.cos(yaw),
    Math.sin(yaw),
    Math.cos(pitch),
    Math.sin(pitch),
    Math.cos(roll),
    Math.sin(roll),
  ];
  return [
    cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr,
    sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr,
    -sp, cp * sr, cp * cr,
  ];
}

/** 두 회전 행렬 사이 각도 (rad) */
export function rotationAngle(a: Mat3, b: Mat3): number {
  const r = matMul(a, transpose(b));
  const c = (r[0] + r[4] + r[8] - 1) / 2;
  return Math.acos(Math.min(1, Math.max(-1, c)));
}

/** 각도를 [-π, π)로 */
export function wrapAngle(a: number): number {
  const t = (a + Math.PI) % (2 * Math.PI);
  return (t < 0 ? t + 2 * Math.PI : t) - Math.PI;
}
