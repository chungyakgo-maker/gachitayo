// G 보정 진단 (실차 도구, M11): 원본 기록으로 G 보정(사양서 7.2)이 어디서 왜 막혔는지 센다.
// 분석 화면에서 한국어 줄로 보여주고, 사용자가 캡처해 보내면 원인을 찾을 수 있게 숫자를 다 담는다.
import { config } from '../config';
import { prepareGps } from '../fusion/gpsObs';
import { resampleMotion } from '../../normalize/resample';
import { diagnoseMount, type MountDiagnosis } from '../../normalize/mount';
import type { GpsSample, RawMotionSample } from '../../types/samples';

export interface CalDiagnosis {
  /** 기록 시작 (세션 시계 ms) */
  t0: number;
  motion: { n: number; hz: number; gaps: number; maxGapMs: number; gyroFrac: number };
  gps: { n: number; medianDtS: number; speedMissingFrac: number };
  /** 동작 센서나 GPS가 부족하면 null */
  mount: MountDiagnosis | null;
}

const G = 9.80665;

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function diagnoseCalibration(gpsIn: GpsSample[], motionIn: RawMotionSample[]): CalDiagnosis {
  const motion = [...motionIn].sort((a, b) => a.t - b.t);
  const gps = [...gpsIn].sort((a, b) => a.tRecv - b.tRecv);
  let gaps = 0;
  let maxGapMs = 0;
  for (let i = 1; i < motion.length; i++) {
    const d = motion[i]!.t - motion[i - 1]!.t;
    if (d > config.motion.maxGapMs) gaps += 1;
    maxGapMs = Math.max(maxGapMs, d);
  }
  const span = motion.length > 1 ? (motion[motion.length - 1]!.t - motion[0]!.t) / 1000 : 0;
  const gyro = motion.filter((s) => s.rx !== null && s.ry !== null && s.rz !== null).length;
  const dts: number[] = [];
  for (let i = 1; i < gps.length; i++) dts.push((gps[i]!.tRecv - gps[i - 1]!.tRecv) / 1000);
  const t0 = Math.min(motion[0]?.t ?? Infinity, gps[0]?.tRecv ?? Infinity);
  const ok = motion.length > 1 && gps.length >= 3;
  return {
    t0: Number.isFinite(t0) ? t0 : 0,
    motion: { n: motion.length, hz: span > 0 ? (motion.length - 1) / span : 0, gaps, maxGapMs, gyroFrac: motion.length ? gyro / motion.length : 0 },
    gps: { n: gps.length, medianDtS: median(dts), speedMissingFrac: gps.length ? gps.filter((g) => g.speed === null || g.speed < 0).length / gps.length : 0 },
    mount: ok ? diagnoseMount(resampleMotion(motion), prepareGps(gps, { lat: gps[0]!.lat, lon: gps[0]!.lon })) : null,
  };
}

export interface DiagLine {
  label: string;
  text: string;
  /** 문제로 보이는 줄 */
  bad?: boolean;
}

const gs = (a: number) => (a / G).toFixed(2);
const sec = (ms: number) => `${Math.round(ms / 1000)}초`;
const pct = (f: number) => `${Math.round(f * 100)}%`;

/** 분석 화면에 보여줄 줄 (캡처해서 보내면 원인을 볼 수 있게 숫자를 다 넣는다) */
export function calDiagnosisLines(d: CalDiagnosis): DiagLine[] {
  const cm = config.mount;
  const out: DiagLine[] = [];
  const m = d.mount;
  if (d.motion.n <= 1) out.push({ label: '결과', text: '동작 센서 값이 없어요. 동작 센서 권한이 꺼졌거나 이 기기가 지원하지 않아요', bad: true });
  else if (!m) out.push({ label: '결과', text: 'GPS 기록이 부족해서 볼 수 없어요', bad: true });
  else {
    const e = m.end;
    const text =
      e.stage === 'done'
        ? `보정 끝 (출발 ${sec(m.stages.done! - d.t0)} 뒤)`
        : e.stage === 'stationary'
          ? '1단계 "정차 3초"에서 멈춤'
          : e.stage === 'forward'
            ? `2단계 "직진 가감속"에서 멈춤 (${e.fwd}/${e.fwdNeed})`
            : `3단계 "가감속·코너 확인"에서 멈춤 (가감속 ${Math.min(e.fwd, e.fwdNeed)}/${e.fwdNeed} · 코너 ${Math.min(e.turns, e.turnsNeed)}/${e.turnsNeed})`;
    out.push({ label: '결과', text, bad: e.stage !== 'done' });
  }
  const mo = d.motion;
  out.push({
    label: '동작 센서',
    text: `초당 ${Math.round(mo.hz)}회 · 0.2초 넘게 끊김 ${mo.gaps}번 (가장 길게 ${(mo.maxGapMs / 1000).toFixed(1)}초) · 자이로 ${mo.gyroFrac >= 0.9 ? '있음' : mo.gyroFrac > 0 ? `일부 ${pct(mo.gyroFrac)}` : '없음'}`,
    bad: mo.n > 1 && (mo.hz < 30 || mo.gaps > 10),
  });
  out.push({ label: 'GPS', text: `${d.gps.medianDtS.toFixed(1)}초마다 · ${d.gps.n}점 · 속도 값 없음 ${pct(d.gps.speedMissingFrac)}` });
  if (m) {
    const s = m.still;
    out.push({
      label: '1 정차',
      text:
        `GPS로 멈춘 시간 ${Math.round(s.gpsStillS)}초 · 3초 창 ${s.windows}개 중 통과 ${s.ok}` +
        ` (GPS 점 부족 ${s.fewFixes}, 센서 끊김 ${s.motionGap}, 흔들림 큼 ${s.shaky})` +
        ` · 가장 작은 흔들림 ${s.minStd === null ? '—' : s.minStd.toFixed(2)} m/s² (기준 ${cm.stationaryAccStdMax} 미만)`,
      bad: s.ok === 0,
    });
    const f = m.fwd;
    out.push({
      label: '2 직진 가감속',
      text:
        `${gs(cm.forwardMinAccelMps2)}g 이상 ${f.strong}번 → 통과 ${f.ok} (회전 중 ${f.turning}, 센서 끊김 ${f.motionGap})` +
        ` · ${gs(cm.fwdCheckMinAccelMps2)}~${gs(cm.forwardMinAccelMps2)}g ${f.weak}번` +
        ` · 가장 센 가감속 ${gs(f.maxA)}g (직진 중 ${gs(f.maxAStraight)}g)`,
      bad: f.ok < cm.forwardMinIntervals,
    });
    const st = m.stages;
    out.push({
      label: '단계 시각',
      text: `직진 가감속 ${st.forward === null ? '—' : sec(st.forward - d.t0)} · 확인 ${st.signs === null ? '—' : sec(st.signs - d.t0)} · 끝 ${st.done === null ? '—' : sec(st.done - d.t0)}`,
    });
  }
  return out;
}
