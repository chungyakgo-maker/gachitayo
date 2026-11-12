import { describe, expect, it } from 'vitest';
import { closeParallelTrack, simulateDrive, stadiumTrack, windingWithHairpins, type Track } from '../../generators';
import { buildGeometry } from '../../../src/engine/course/geometry';
import { STracker } from '../../../src/engine/course/sTracker';
import { courseFromTrack } from './helpers';

const opts = { laps: 2, startStopS: 2, endStopS: 1, vMax: 40, aLatMax: 8, aAccel: 3, aBrake: 6 };

function follow(track: Track) {
  const truth = simulateDrive(track, opts);
  const tr = new STracker(buildGeometry(courseFromTrack(track)));
  const out: Array<{ t: number; s: number | null; on: boolean; v: number }> = [];
  for (let i = 0; i < truth.t.length; i += 2) {
    const r = tr.update(truth.x[i]!, truth.y[i]!, truth.v[i]!, truth.t[i]! * 1000);
    out.push({ t: truth.t[i]!, s: r.s, on: r.onCourse, v: truth.v[i]! });
  }
  return { out, length: track.length };
}

describe('코스 거리 s 추적 (사양서 7.6)', () => {
  for (const [name, track] of [
    ['헤어핀 와인딩', windingWithHairpins()],
    ['20 m 평행 코스', closeParallelTrack()],
    ['오벌', stadiumTrack()],
  ] as const) {
    it(`${name}: 정답 궤적을 따라가면 s가 옆 구간으로 튀지 않는다`, () => {
      const { out, length } = follow(track);
      for (let i = 1; i < out.length; i++) {
        const a = out[i - 1]!;
        const b = out[i]!;
        expect(b.on).toBe(true);
        let ds = b.s! - a.s!;
        if (track.closed && ds < -length / 2) ds += length; // 바퀴를 넘어감
        expect(ds).toBeGreaterThan(-2);
        expect(ds).toBeLessThan(b.v * (b.t - a.t) + 5);
      }
    });
  }

  it('횡거리 30 m를 넘으면 이탈로 보고 s를 멈추며, 돌아오면 이어간다', () => {
    const track = stadiumTrack();
    const tr = new STracker(buildGeometry(courseFromTrack(track)));
    let t = 0;
    let last = 0;
    for (let x = 0; x <= 200; x += 2) last = tr.update(x, 0, 20, (t += 100)).s!;
    expect(last).toBeCloseTo(200, 0);
    const off = tr.update(210, -40, 20, (t += 100));
    expect(off.onCourse).toBe(false);
    expect(off.s).toBeCloseTo(last, 6);
    const back = tr.update(230, 0, 20, (t += 1000));
    expect(back.onCourse).toBe(true);
    expect(back.s).toBeCloseTo(230, 0);
  });

  it('출발선을 지나면 0으로 다시 맞출 수 있다', () => {
    const track = stadiumTrack();
    const tr = new STracker(buildGeometry(courseFromTrack(track)));
    tr.update(50, 0, 10, 0);
    tr.resetAtStart();
    expect(tr.update(51, 0, 10, 100).s).toBeLessThan(55);
  });
});
