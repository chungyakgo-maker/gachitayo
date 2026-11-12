// 정확도 보고서 (사람이 읽는 용도). 평소 테스트에서는 건너뛰고, REPORT=1일 때만 만든다.
// 결과: REPORT_DIR(기본 report-out)에 fusion-report.json과 비교 그림 SVG
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import {
  closeParallelTrack,
  defaultSensorOpts,
  ellipseTrack,
  simulateDrive,
  stadiumTrack,
  synthesizeSensors,
  truthAt,
  windingWithHairpins,
  type SensorOpts,
  type Track,
  type Truth,
} from '../generators';
import { processSession, type SmoothedTrack } from '../../src/engine/fusion/processSession';
import { FusionRunner } from '../../src/engine/fusion/forward';
import { prepareGps } from '../../src/engine/fusion/gpsObs';
import { MountCalibrator } from '../../src/normalize/mount';
import { resampleMotion } from '../../src/normalize/resample';
import { toLocal } from '../../src/engine/geo';
import { rotationAngle, type Mat3 } from '../../src/engine/linalg';

const flipUpFwd = (m: Mat3): Mat3 => [-m[0], -m[1], -m[2], m[3], m[4], m[5], -m[6], -m[7], -m[8]];

const OUT = process.env.REPORT_DIR ?? 'report-out';
const drive = (track: Track, laps = 2): Truth =>
  simulateDrive(track, { laps, startStopS: 5, endStopS: 3, vMax: 40, aLatMax: 8, aAccel: 3, aBrake: 6 });

interface Scenario {
  name: string;
  truth: Truth;
  opts: Partial<SensorOpts>;
  gaps?: Array<[number, number]>;
}

const oval = drive(stadiumTrack());
const scenarios: Scenario[] = [
  { name: '오벌 서킷 2바퀴 (기본 잡음)', truth: oval, opts: {} },
  { name: '오벌 서킷 + GPS 3초·8초 끊김', truth: oval, opts: { dropouts: [[40, 43], [70, 78]] }, gaps: [[40, 43], [70, 78]] },
  { name: '헤어핀 와인딩 편도', truth: drive(windingWithHairpins(), 1), opts: {} },
  { name: '20 m 간격 평행 코스', truth: drive(closeParallelTrack()), opts: {} },
  { name: '아이폰 흉내 (가속도 부호 반대)', truth: oval, opts: { accelSign: -1 } },
  { name: 'GPS 속도 없음', truth: oval, opts: { speedNull: true } },
  { name: '자이로 없음', truth: oval, opts: { noGyro: true } },
  { name: '모션 권한 없음 (GPS만)', truth: oval, opts: {} },
  { name: 'GPS 오차가 천천히 흐름 (1 m 잡음 + 3 m 흐름)', truth: oval, opts: { gpsNoiseM: 1, gpsDriftM: 3 } },
  { name: 'GPS 수신 지연 300 ms', truth: oval, opts: { gpsLatencyMs: 300 } },
  { name: '직선 없는 타원 서킷', truth: drive(ellipseTrack(300, 150)), opts: {} },
];

const rms = (a: number[]) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / Math.max(1, a.length));
const r2 = (v: number) => Math.round(v * 100) / 100;

function errs(track: SmoothedTrack, truth: Truth, shift: { x: number; y: number }) {
  const out: Array<{ t: number; pos: number; v: number }> = [];
  for (let k = 0; k < track.n; k++) {
    const t = track.t0 + k * track.dt;
    const tr = truthAt(truth, t / 1000);
    out.push({ t, pos: Math.hypot(track.x[k]! - tr.x - shift.x, track.y[k]! - tr.y - shift.y), v: Math.abs(track.v[k]! - tr.v) });
  }
  return out;
}

function svgPlot(
  title: string,
  truth: Truth,
  gps: Array<{ x: number; y: number }>,
  lines: Array<{ name: string; color: string; track: SmoothedTrack; shift: { x: number; y: number } }>,
  tRange: [number, number],
): string {
  const pts = (tr: SmoothedTrack, sh: { x: number; y: number }) => {
    const a: Array<[number, number]> = [];
    for (let k = 0; k < tr.n; k++) {
      const t = (tr.t0 + k * tr.dt) / 1000;
      if (t >= tRange[0] && t <= tRange[1]) a.push([tr.x[k]! - sh.x, tr.y[k]! - sh.y]);
    }
    return a;
  };
  const truthPts: Array<[number, number]> = [];
  for (let i = 0; i < truth.t.length; i++)
    if (truth.t[i]! >= tRange[0] && truth.t[i]! <= tRange[1]) truthPts.push([truth.x[i]!, truth.y[i]!]);
  const all = [...truthPts];
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const pad = 15;
  const [x0, x1, y0, y1] = [Math.min(...xs) - pad, Math.max(...xs) + pad, Math.min(...ys) - pad, Math.max(...ys) + pad];
  const W = 900;
  const H = Math.max(300, Math.round((W * (y1 - y0)) / (x1 - x0)));
  const sx = (x: number) => ((x - x0) / (x1 - x0)) * W;
  const sy = (y: number) => H - ((y - y0) / (y1 - y0)) * H;
  const path = (a: Array<[number, number]>) => a.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join('');
  const inView = gps.filter((g) => g.x >= x0 && g.x <= x1 && g.y >= y0 && g.y <= y1);
  const legend = [{ name: '정답', color: '#111' }, { name: 'GPS 원본', color: '#e8590c' }, ...lines];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + 60}" viewBox="0 0 ${W} ${H + 60}" font-family="sans-serif">
<rect width="100%" height="100%" fill="#fff"/>
<text x="12" y="24" font-size="18" font-weight="700">${title}</text>
${legend.map((l, i) => `<rect x="${12 + i * 150}" y="36" width="14" height="4" fill="${l.color}"/><text x="${32 + i * 150}" y="42" font-size="14">${l.name}</text>`).join('')}
<g transform="translate(0,56)">
<path d="${path(truthPts)}" fill="none" stroke="#111" stroke-width="5" opacity="0.25"/>
${inView.map((g) => `<circle cx="${sx(g.x).toFixed(1)}" cy="${sy(g.y).toFixed(1)}" r="4" fill="#e8590c"/>`).join('')}
${lines.map((l) => `<path d="${path(pts(l.track, l.shift))}" fill="none" stroke="${l.color}" stroke-width="2"/>`).join('')}
<text x="${W - 160}" y="${H - 10}" font-size="12" fill="#555">축척: 10 m = ${(sx(x0 + 10) - sx(x0)).toFixed(0)} px</text>
</g></svg>`;
}

/** 주행 중과 똑같이: 보정기와 융합을 시간 순서대로 함께 진행한다 (주행 후 보정을 쓰지 않음) */
function realtimeRms(s: ReturnType<typeof synthesizeSensors>, truth: Truth): number {
  const m50 = resampleMotion(s.motion);
  const obs = prepareGps(s.gps, s.origin);
  const cal = new MountCalibrator(m50);
  const runner = new FusionRunner({ m50, calibrationAt: () => cal.current });
  let j = 0;
  let se = 0;
  let n = 0;
  for (let i = 0; i < m50.n; i++) {
    const t = m50.t0 + i * m50.dt;
    while (j < obs.length && obs[j]!.t <= t) {
      cal.pushGps(obs[j]!);
      runner.pushGps(obs[j++]!);
    }
    cal.pushMotion(i);
    runner.runTo(t);
    const p = runner.current();
    if (!p || p.t !== t) continue;
    const tr = truthAt(truth, t / 1000);
    se += (p.x - tr.x) ** 2 + (p.y - tr.y) ** 2;
    n++;
  }
  return Math.sqrt(se / Math.max(1, n));
}

describe.skipIf(!process.env.REPORT)('정확도 보고서', () => {
  it('시나리오별 오차 표와 그림', () => {
    mkdirSync(OUT, { recursive: true });
    const rows: Record<string, unknown>[] = [];
    for (const [i, sc] of scenarios.entries()) {
      const s = synthesizeSensors(sc.truth, { ...defaultSensorOpts, seed: 100 + i, ...sc.opts });
      const noMotion = sc.name.startsWith('모션 권한 없음');
      const r = processSession({ gps: s.gps, motion: noMotion ? [] : s.motion });
      const shift = toLocal(r.origin, s.origin.lat, s.origin.lon);
      const raw = s.gps.map((g) => {
        const p = toLocal(s.origin, g.lat, g.lon);
        const tr = truthAt(sc.truth, g.tRecv / 1000);
        return Math.hypot(p.x - tr.x, p.y - tr.y);
      });
      const sm = errs(r.track, sc.truth, shift);
      const fi = errs(r.filtered, sc.truth, shift);
      const cal = r.calibration.segments[0]?.cal;
      const live = noMotion ? null : realtimeRms(s, sc.truth);
      const gapMax = (e: typeof sm) =>
        sc.gaps?.map(([a, b]) => r2(Math.max(...e.filter((x) => x.t >= a * 1000 && x.t <= (b + 1) * 1000).map((x) => x.pos))));
      rows.push({
        시나리오: sc.name,
        'GPS 원본 위치 RMS m': r2(rms(raw)),
        '실시간 흉내 위치 RMS m': live === null ? '-' : r2(live),
        '필터(한 방향) 위치 RMS m': r2(rms(fi.map((e) => e.pos))),
        '스무더 위치 RMS m': r2(rms(sm.map((e) => e.pos))),
        '스무더 최대 위치 오차 m': r2(Math.max(...sm.map((e) => e.pos))),
        '필터(한 방향) 속도 RMS m/s': r2(rms(fi.map((e) => e.v))),
        '스무더 속도 RMS m/s': r2(rms(sm.map((e) => e.v))),
        // 가속도 부호가 반대인 기기는 위·앞 축이 뒤집혀 잡히고 그만큼 부호 보정으로 바로잡는다
        '거치 각도 오차 °': cal && !noMotion ? r2((rotationAngle(cal.R, r.axisSigns.accel === -1 ? flipUpFwd(s.mount) : s.mount) * 180) / Math.PI) : '보정 안 됨',
        '축 부호': `${r.axisSigns.accel}/${r.axisSigns.gyro} (${r.axisSigns.confidence})`,
        'GPS만 모드': r.gpsOnly,
        '속도 품질 낮음': r.speedQualityLow,
        ...(sc.gaps ? { '끊김 구간 최대 오차 (필터) m': gapMax(fi), '끊김 구간 최대 오차 (스무더) m': gapMax(sm) } : {}),
      });
      if (sc.name.startsWith('헤어핀')) {
        const gpsLocal = s.gps.map((g) => toLocal(s.origin, g.lat, g.lon));
        writeFileSync(
          `${OUT}/plot-hairpin.svg`,
          svgPlot('헤어핀 구간: 정답 · GPS · 필터 · 스무더', sc.truth, gpsLocal, [
            { name: '필터(한 방향)', color: '#1971c2', track: r.filtered, shift },
            { name: '스무더(주행 후)', color: '#2f9e44', track: r.track, shift },
          ], [22, 40]),
        );
      }
      if (sc.gaps) {
        const gpsLocal = s.gps.map((g) => toLocal(s.origin, g.lat, g.lon));
        writeFileSync(
          `${OUT}/plot-gap8s.svg`,
          svgPlot('GPS 8초 끊김 구간 (70~78초)', sc.truth, gpsLocal, [
            { name: '필터(한 방향)', color: '#1971c2', track: r.filtered, shift },
            { name: '스무더(주행 후)', color: '#2f9e44', track: r.track, shift },
          ], [66, 82]),
        );
      }
    }
    writeFileSync(`${OUT}/fusion-report.json`, JSON.stringify(rows, null, 1));
  });
});
