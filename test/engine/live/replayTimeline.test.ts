import { describe, expect, it } from 'vitest';
import { defaultSensorOpts, simulateDrive, stadiumTrack, synthesizeSensors, type DriveOpts } from '../../generators';
import { processDrive } from '../../../src/engine/process/processDrive';
import { LivePipeline } from '../../../src/engine/live/livePipeline';
import { buildReplayTimeline } from '../../../src/app/replayTimeline';
import type { Course } from '../../../src/types/course';
import type { GpsSample, RawMotionSample } from '../../../src/types/samples';

const oval = stadiumTrack();
const base: DriveOpts = { laps: 3, startStopS: 5, endStopS: 3, vMax: 40, aLatMax: 8, aAccel: 3, aBrake: 6 };
const drive = (laps: number, seed: number) => synthesizeSensors(simulateDrive(oval, { ...base, laps }), { ...defaultSensorOpts, seed });

/** 같은 입력을 직접 흘려, 고른 시각의 화면 상태를 복사해 둔다 (path는 계속 자라는 배열이라 복사) */
function direct(course: Course | null, gps: GpsSample[], motion: RawMotionSample[], at: number[]) {
  const p = new LivePipeline({ course, ref: null });
  const end = Math.max(gps.at(-1)!.tRecv, motion.at(-1)!.t);
  const want = new Set(at);
  const out = new Map<number, { lapNo: number | null; speedKmh: number | null; pos: unknown; path: number[][]; pathFrom: number; pathDropped: number }>();
  let i = 0;
  let j = 0;
  for (let t = 0; t <= end; t += 100) {
    while (i < gps.length && gps[i]!.tRecv <= t) p.pushGps(gps[i++]!);
    while (j < motion.length && motion[j]!.t <= t) p.pushMotion(motion[j++]!);
    const s = p.tick(t);
    if (want.has(t)) out.set(t, { lapNo: s.state?.lapNo ?? null, speedKmh: s.state?.speedKmh ?? null, pos: s.pos, path: s.path.map((q) => [...q]), pathFrom: s.pathFrom, pathDropped: s.pathDropped });
  }
  return { out, end };
}

const pick = (f: { state: { lapNo: number; speedKmh: number } | null; pos: unknown; path: ReadonlyArray<readonly [number, number]>; pathFrom: number; pathDropped: number }) => ({
  lapNo: f.state?.lapNo ?? null,
  speedKmh: f.state?.speedKmh ?? null,
  pos: f.pos,
  path: f.path.map((q) => [...q]),
  pathFrom: f.pathFrom,
  pathDropped: f.pathDropped,
});

describe('재생 타임라인 (사양서 10.2: 시작할 때 전부 계산해 두고 막대로 옮긴다)', () => {
  const first = drive(3, 91);
  const course = processDrive({ gps: first.gps, motion: first.motion, events: [{ t: 0, type: 'start' }], course: null }).course!;

  it('코스 없는 주행: 어느 시각의 프레임이든 처음부터 흘려 본 화면과 같다', async () => {
    const tl = await buildReplayTimeline({ gps: first.gps, motion: first.motion, course: null, ref: null });
    const ticks = [0, Math.round(tl.endMs / 300) * 100, Math.round((2 * tl.endMs) / 300) * 100, Math.floor(tl.endMs / 100) * 100];
    const { out } = direct(null, first.gps, first.motion, ticks);
    for (const t of ticks) expect(pick(tl.frameAt(tl.indexAt(t)))).toEqual(out.get(t));
  });

  it('코스 있는 주행: 이번 랩 지나온 길(pathFrom)과 랩 번호까지 같다 (뒤로 옮겨도 그 시점 것)', async () => {
    const second = drive(3, 92);
    const tl = await buildReplayTimeline({ gps: second.gps, motion: second.motion, course, ref: null });
    const ticks = [Math.round(tl.endMs / 300) * 100, Math.round((2 * tl.endMs) / 300) * 100, Math.floor(tl.endMs / 100) * 100];
    const { out } = direct(course, second.gps, second.motion, ticks);
    // 끝에서 앞으로 되돌아가며 꺼내도 같다
    for (const t of [...ticks].reverse()) {
      const f = tl.frameAt(tl.indexAt(t));
      expect(pick(f)).toEqual(out.get(t));
      expect(f.path.slice(f.pathFrom)).toEqual(out.get(t)!.path.slice(out.get(t)!.pathFrom));
    }
    expect(new Set(ticks.map((t) => tl.frameAt(tl.indexAt(t)).state?.lapNo)).size).toBeGreaterThan(1);
  });

  it('긴 주행(지나온 길 6000점 넘음): 잘린 뒤에도 마지막 프레임의 길이 같다', async () => {
    const long = drive(20, 93);
    const tl = await buildReplayTimeline({ gps: long.gps, motion: long.motion, course: null, ref: null });
    const last = Math.floor(tl.endMs / 100) * 100;
    const { out } = direct(null, long.gps, long.motion, [last]);
    const f = tl.frameAt(tl.length - 1);
    expect(out.get(last)!.pathDropped).toBeGreaterThan(0);
    expect(pick(f)).toEqual(out.get(last));
  });

  it('번호는 범위 안으로 자르고, 진행률은 늘어나기만 하다 1로 끝난다', async () => {
    const seen: number[] = [];
    const tl = await buildReplayTimeline({ gps: first.gps, motion: first.motion, course: null, ref: null }, { onProgress: (f) => seen.push(f), yieldEvery: 200 });
    expect(tl.stepMs).toBe(100);
    expect(tl.indexAt(-500)).toBe(0);
    expect(tl.indexAt(tl.endMs + 9999)).toBe(tl.length - 1);
    expect(tl.indexAt(1049)).toBe(10);
    expect(seen.length).toBeGreaterThan(2);
    expect(seen.every((v, k) => k === 0 || v >= seen[k - 1]!)).toBe(true);
    expect(seen.at(-1)).toBe(1);
  });

  it('시간으로 양보한다: 계산이 느린 구간(코스 밖)에서도 한 번에 30 ms 넘게 붙잡지 않고, 시작 전에도 한 번 양보한다 (검토 지적)', async () => {
    // 가짜 시계: 부를 때마다 20 ms 지난 것처럼
    let clock = 0;
    const now = () => (clock += 20);
    const seen: number[] = [];
    const tl = await buildReplayTimeline({ gps: first.gps, motion: first.motion, course: null, ref: null }, { onProgress: (f) => seen.push(f), yieldEvery: 1e9, budgetMs: 30, now });
    expect(seen[0]).toBe(0);
    expect(seen.length).toBeGreaterThan(tl.length / 3);
  });

  it('취소하면 멈추고 거절된다 (준비 중에 재생을 끝냈을 때)', async () => {
    const signal = { aborted: false };
    const p = buildReplayTimeline({ gps: first.gps, motion: first.motion, course: null, ref: null }, { yieldEvery: 100, signal, onProgress: () => (signal.aborted = true) });
    await expect(p).rejects.toThrow('취소');
  });
});
