// 재생 타임라인 (사양서 10.2, 사용자 요청 "재생 막대를 끌어서 옮기기"): 재생을 시작할 때 계산 묶음(LivePipeline)을 끝까지 한 번 돌려
// 0.1초마다의 화면 상태를 저장해 둔다. 막대를 끌면 그 번호의 상태를 꺼내 바로 보여 준다.
// 지나온 길은 프레임마다 복사하지 않고 공용 기록에 한 번만 붙이고, 프레임에는 그 안의 [시작, 끝) 번호만 둔다.
import { LivePipeline, type LiveSnapshot } from '../engine/live/livePipeline';
import type { LiveRef } from '../engine/live/liveEngine';
import type { Course } from '../types/course';
import type { GpsSample, RawMotionSample } from '../types/samples';

export interface ReplayTimeline {
  stepMs: 100;
  /** 마지막 샘플 시각 (ms, 세션 시계) */
  endMs: number;
  length: number;
  /** 시각(ms) → 프레임 번호 (범위 밖은 양 끝) */
  indexAt(ms: number): number;
  frameAt(i: number): LiveSnapshot;
}

export interface ReplayInput {
  gps: GpsSample[];
  motion: RawMotionSample[];
  course: Course | null;
  ref: LiveRef | null;
}

export interface BuildOpts {
  /** 0~1 (마지막에 1) */
  onProgress?: (fraction: number) => void;
  /** 이만큼 프레임마다 화면에 한 번 양보한다 (기본 600 = 주행 1분) */
  yieldEvery?: number;
  /** 한 번에 이 시간(ms)보다 오래 붙잡지 않고 양보한다 (기본 30). 코스 밖 구간은 한 칸 계산이 수십 배 느리다 */
  budgetMs?: number;
  /** 시계 (시험용, 기본 performance.now) */
  now?: () => number;
  /** aborted가 true가 되면 멈추고 '취소'로 거절한다 */
  signal?: { aborted: boolean };
}

type Point = readonly [number, number];
interface Frame {
  snap: LiveSnapshot;
  pathStart: number;
  pathEnd: number;
  pathFromAbs: number;
}

const STEP_MS = 100;
const NO_PATH: ReadonlyArray<Point> = [];

export async function buildReplayTimeline(input: ReplayInput, opts: BuildOpts = {}): Promise<ReplayTimeline> {
  const { gps, motion } = input;
  const endMs = Math.max(gps.at(-1)?.tRecv ?? 0, motion.at(-1)?.t ?? 0);
  const length = Math.floor(endMs / STEP_MS) + 1;
  const every = Math.max(1, opts.yieldEvery ?? 600);
  const budget = opts.budgetMs ?? 30;
  const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const pause = async () => {
    await new Promise((r) => setTimeout(r, 0));
    if (opts.signal?.aborted) throw new Error('취소');
  };
  // 시작 전에 한 번 양보한다 ("준비 중"이 먼저 그려지게)
  await pause();
  opts.onProgress?.(0);
  let sliceStart = now();
  // 처음부터 코스를 넣어 만든다 (계산 좌표의 원점이 코스 원점)
  const pipeline = new LivePipeline({ course: input.course, ref: input.ref });
  const frames: Frame[] = new Array(length);
  const log: Point[] = [];
  let i = 0;
  let j = 0;
  for (let k = 0; k < length; k++) {
    const t = k * STEP_MS;
    while (i < gps.length && gps[i]!.tRecv <= t) pipeline.pushGps(gps[i++]!);
    while (j < motion.length && motion[j]!.t <= t) pipeline.pushMotion(motion[j++]!);
    const s = pipeline.tick(t);
    // 새로 생긴 점만 공용 기록에 붙인다 (잘려 나간 앞쪽은 이미 기록에 있다)
    const total = s.pathDropped + s.path.length;
    for (let a = Math.max(log.length, s.pathDropped); a < total; a++) log.push(s.path[a - s.pathDropped]!);
    frames[k] = { snap: { ...s, path: NO_PATH }, pathStart: s.pathDropped, pathEnd: total, pathFromAbs: s.pathDropped + s.pathFrom };
    if ((k + 1) % every === 0 || now() - sliceStart >= budget) {
      await pause();
      opts.onProgress?.((k + 1) / length);
      sliceStart = now();
    }
  }
  if (opts.signal?.aborted) throw new Error('취소');
  opts.onProgress?.(1);
  const clamp = (n: number) => Math.min(Math.max(n, 0), length - 1);
  return {
    stepMs: STEP_MS,
    endMs,
    length,
    indexAt: (ms) => clamp(Math.round(ms / STEP_MS)),
    frameAt(n) {
      const f = frames[clamp(Math.trunc(n))]!;
      return { ...f.snap, path: log.slice(f.pathStart, f.pathEnd), pathFrom: f.pathFromAbs - f.pathStart, pathDropped: f.pathStart };
    },
  };
}
