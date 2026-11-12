import { describe, expect, it } from 'vitest';
import { defaultSensorOpts, simulateDrive, stadiumTrack, synthesizeSensors, truthAt, upDownUp, windingWithHairpins, type DriveOpts } from '../../generators';
import { GapTracker, gapSeconds, type TrailPoint } from '../../../src/engine/live/gap';
import { toLocal } from '../../../src/engine/geo';

const base: DriveOpts = { laps: 3, startStopS: 5, endStopS: 3, vMax: 40, aLatMax: 8, aAccel: 3, aBrake: 6 };

/** 앞 친구: 가상 주행의 GPS(1초에 한 번, 잡음)를 위치 공유처럼 보낸다. 나: 같은 길을 delayS초 늦게 (정답 위치 + 잡음 2 m) */
function scenario(track: ReturnType<typeof stadiumTrack>, opts: DriveOpts, seed: number) {
  const truth = simulateDrive(track, opts);
  const s = synthesizeSensors(truth, { ...defaultSensorOpts, seed });
  const origin = s.origin;
  const trail: TrailPoint[] = s.gps.map((g) => ({ t: g.tFix, ...toLocal(origin, g.lat, g.lon) }));
  let r = seed;
  const noise = () => {
    r = (r * 1103515245 + 12345) % 2 ** 31;
    return (r / 2 ** 31 - 0.5) * 4;
  };
  const me = (tSec: number, delayS: number) => {
    const p = truthAt(truth, tSec - delayS);
    return { x: p.x + noise(), y: p.y + noise(), psi: p.psi, t: s.startedAtEpochMs + tSec * 1000 };
  };
  return { truth, trail, me, start: s.startedAtEpochMs };
}

const rms = (a: number[]) => Math.sqrt(a.reduce((m, e) => m + e * e, 0) / a.length);

describe('앞 친구 간격 (초): 앞 친구가 지금 내 자리를 몇 초 전에 지났는지', () => {
  for (const delay of [1.0, 2.0, 5.0]) {
    it(`서킷 3바퀴, 정답 간격 ${delay}초: 오차 RMS < 0.2초 (코너 포함, 바퀴가 바뀌어도 한 바퀴 전과 헷갈리지 않음)`, () => {
      const { truth, trail, me, start } = scenario(stadiumTrack(), base, 7);
      const errs: number[] = [];
      const end = truth.t.at(-1)! - 3;
      for (let t = 10 + delay; t < end; t += 0.1) {
        const m = me(t, delay);
        // 지금까지 받은 위치만 (앞 친구의 최근 3분)
        const known = trail.filter((p) => p.t <= start + t * 1000 && p.t > start + (t - 180) * 1000);
        const g = gapSeconds(known, m);
        if (g === null) continue;
        errs.push(g - delay);
      }
      expect(errs.length).toBeGreaterThan(((end - 10 - delay) / 0.1) * 0.95);
      expect(rms(errs)).toBeLessThan(0.2);
    });
  }

  it('와인딩(편도)에서 내가 앞서 있으면 간격을 모른다 (null)', () => {
    const { trail, me, start } = scenario(windingWithHairpins(), { ...base, laps: 1 }, 8);
    const t = 40;
    const m = me(t, -3); // 내가 3초 앞
    const known = trail.filter((p) => p.t <= start + t * 1000);
    expect(gapSeconds(known, m)).toBeNull();
  });

  it('같은 길을 거꾸로 지난 점(왕복)·앞서 같은 방향으로 지난 점과 헷갈리지 않고, 앞 친구 GPS 튐 하나에 흔들리지 않는다', () => {
    const { trail, me, start } = scenario(upDownUp(windingWithHairpins()), { ...base, laps: 1 }, 9);
    const errs: number[] = [];
    for (let t = 30; t < 150; t += 0.5) {
      const known = trail.filter((p) => p.t <= start + t * 1000);
      const g = gapSeconds(known, me(t, 2));
      if (g !== null) errs.push(g - 2);
    }
    expect(errs.length).toBeGreaterThan(200);
    // 거꾸로 지난 점·첫 번째 오르막과 헷갈리면 수십 초가 틀린다. 느린 헤어핀(7 m/s)에서는 GPS 잡음 때문에 0.5초 안팎
    expect(Math.max(...errs.map(Math.abs))).toBeLessThan(1);
    expect(rms(errs)).toBeLessThan(0.3);
  });

  it('GapTracker: 0.5초 동안 부드럽게 하고, 앞 친구 위치가 5초 넘게 안 오면 신호 없음', () => {
    const { trail, me, start } = scenario(stadiumTrack(), base, 7);
    const g = new GapTracker();
    let got: ReturnType<GapTracker['update']> = { gapS: null, stale: true };
    for (let t = 20; t < 40; t += 0.1) {
      for (const p of trail) if (p.t > start + (t - 0.1) * 1000 && p.t <= start + t * 1000) g.push(p);
      got = g.update(me(t, 2), start + t * 1000);
    }
    expect(got.stale).toBe(false);
    expect(Math.abs(got.gapS! - 2)).toBeLessThan(0.2);
    // 앞 친구 위치가 끊김
    for (let t = 40; t < 47; t += 0.1) got = g.update(me(t, 2), start + t * 1000);
    expect(got.stale).toBe(true);
  });

  // 사용자 문의 "델타 딜레이": 실제 폰에서는 앞 친구 위치가 GPS 1초 간격 + GPS 지연 + 통신으로 1~2초 늦게 온다.
  // 간격이 짧으면 친구 위치가 아직 내 자리까지 안 와서, 고치기 전에는 코너에서 한 바퀴 전 기록과 헷갈려 최대 43초 틀렸다
  for (const seed of [7, 8, 9]) {
    for (const lagS of [0.8, 1.5, 2.5]) {
      it(`앞 친구 위치가 ${lagS}초 늦게 와도 간격 1초를 RMS < 0.2초로, 0.5초 넘게 틀리는 때 1% 미만 (모의 주행 ${seed}, 튄 점 포함)`, () => {
        const { truth, trail, me, start } = scenario(stadiumTrack(), base, seed);
        const errs: number[] = [];
        const mine: TrailPoint[] = [];
        let n = 0;
        for (let t = 11; t < truth.t.at(-1)! - 3; t += 0.1) {
          n++;
          const m = me(t, 1);
          const known = trail.filter((p) => p.t <= start + (t - lagS) * 1000 && p.t > start + (t - 180) * 1000);
          const g = gapSeconds(known, m, mine.filter((q) => q.t > m.t - 30_000));
          mine.push({ t: m.t, x: m.x, y: m.y });
          if (g !== null) errs.push(g - 1);
        }
        expect(errs.length).toBeGreaterThan(n * 0.97);
        expect(rms(errs)).toBeLessThan(0.2);
        expect(errs.filter((e) => Math.abs(e) > 0.5).length).toBeLessThan(errs.length * 0.01);
        expect(Math.max(...errs.map(Math.abs))).toBeLessThan(lagS <= 1.5 ? 1.2 : 2.5);
      });
    }
  }

  it('간격이 바뀌면 화면 값이 0.5초 남짓 늦게 따라온다 (평활 0.5초)', () => {
    const { trail, start } = scenario(stadiumTrack(), base, 7);
    const truth = simulateDrive(stadiumTrack(), base);
    const gapAt = (t: number) => (t < 40 ? 2 : t < 45 ? 2 + (t - 40) / 5 : 3);
    const tr = new GapTracker();
    let fed = 0;
    const out: Array<{ t: number; g: number; truth: number }> = [];
    for (let t = 20; t < 60; t += 0.1) {
      while (fed < trail.length && trail[fed]!.t <= start + (t - 0.8) * 1000) tr.push(trail[fed++]!);
      const p = truthAt(truth, t - gapAt(t));
      const r = tr.update({ x: p.x, y: p.y, psi: p.psi, t: start + t * 1000 }, start + t * 1000);
      if (r.gapS !== null) out.push({ t, g: r.gapS, truth: gapAt(t) });
    }
    const lag = out.find((o) => o.g >= 2.5)!.t - out.find((o) => o.truth >= 2.5)!.t;
    expect(lag).toBeLessThan(0.7);
  });
});
