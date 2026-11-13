import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../src/sim'; // 미리 불러 둔다 (재생이 따로 불러올 때 바로 끝나게)
import { cycleReplaySpeed, getDriveState, getLiveSnapshot, seekReplay, setReplayPlaying, startCoursePreview, startReplay, stopReplay } from '../../src/app/drive';
import { BUILTIN_COURSES, builtinCourse } from '../../src/courses/builtin';
import { BUILTIN_POINTS } from '../../src/courses/builtinData';

const replay = () => getDriveState().replay!;
/** 실제 이벤트 한 번 흘리기 (가짜 시계와 따로. 브라우저 형식에는 setImmediate가 없어 globalThis에서) */
const realTick = () => new Promise<void>((res) => (globalThis as unknown as { setImmediate(f: () => void): void }).setImmediate(res));
/** 준비(타임라인 계산)가 끝날 때까지: 가짜 시계를 조금씩 돌리고 실제 이벤트도 흘린다 */
async function untilReady() {
  for (let k = 0; k < 2000; k++) {
    const r = getDriveState().replay;
    if (r && r.preparing === null) return;
    await vi.advanceTimersByTimeAsync(5);
    await realTick();
  }
  throw new Error('준비가 끝나지 않음');
}

describe('재생 플레이어 (사양서 10.2: 재생 막대·배속·모의주행)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  });
  afterEach(() => {
    stopReplay(false);
    vi.useRealTimers();
  });

  it('가상 주행: 준비 중 → 다 계산하면 막대로 옮길 수 있고 재생이 시작된다', async () => {
    const p = startReplay({ kind: 'sim', withRef: false }, 5);
    await untilReady();
    await p;
    expect(replay()).toMatchObject({ seekable: true, playing: true, preparing: null, speed: 5, returnTo: '#/dev/replay' });
    expect(replay().endMs).toBeGreaterThan(60_000);
    expect(window.location.hash).toBe('#/drive');
  });

  it('막대로 옮기면 그 시각 화면이 바로 나오고, 재생은 배속만큼 간다', async () => {
    void startReplay({ kind: 'sim', withRef: false }, 5);
    await untilReady();
    const end = replay().endMs;
    seekReplay(end / 2);
    expect(Math.abs(getLiveSnapshot()!.t - end / 2)).toBeLessThanOrEqual(100);
    seekReplay(1000);
    expect(replay().posMs).toBe(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(Math.abs(replay().posMs - 6000)).toBeLessThanOrEqual(100);
    expect(Math.abs(getLiveSnapshot()!.t - replay().posMs)).toBeLessThanOrEqual(100);
    seekReplay(-5000);
    expect(replay().posMs).toBe(0);
  });

  it('배속 버튼: 5× → 10× → 20× → 1× → 5×', async () => {
    void startReplay({ kind: 'sim', withRef: false }, 5);
    await untilReady();
    const seen: number[] = [];
    for (let k = 0; k < 4; k++) {
      cycleReplaySpeed();
      seen.push(replay().speed);
    }
    expect(seen).toEqual([10, 20, 1, 5]);
  });

  it('끝에 닿으면 그 자리에서 멈추고, 다시 재생하면 처음부터', async () => {
    void startReplay({ kind: 'sim', withRef: false }, 5);
    await untilReady();
    const end = replay().endMs;
    seekReplay(end - 50);
    await vi.advanceTimersByTimeAsync(300);
    expect(replay()).toMatchObject({ ended: true, playing: false, posMs: end });
    expect(getDriveState().phase).toBe('driving');
    setReplayPlaying(true);
    expect(replay()).toMatchObject({ ended: false, playing: true, posMs: 0 });
    setReplayPlaying(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(replay().posMs).toBe(0);
  });

  it('준비 중에 끝내면 계산을 멈추고, 끝난 뒤에도 재생이 시작되지 않는다', async () => {
    const p = startReplay({ kind: 'sim', withRef: false }, 5);
    for (let k = 0; k < 2000 && typeof getDriveState().replay?.preparing !== 'number'; k++) await realTick();
    expect(typeof replay().preparing).toBe('number');
    stopReplay();
    for (let k = 0; k < 50; k++) {
      await vi.advanceTimersByTimeAsync(5);
      await realTick();
    }
    await p;
    expect(getDriveState()).toMatchObject({ phase: 'idle', replay: null, error: null });
    expect(window.location.hash).toBe('#/dev/replay');
    await vi.advanceTimersByTimeAsync(1000);
    expect(getLiveSnapshot()).toBeNull();
  });

  it('빨리 두 번 시작해도(버튼 두 번 누름) 나중 것 하나만 재생된다', async () => {
    const b = BUILTIN_COURSES.find((x) => x.key === 'haogogae')!;
    const course = builtinCourse(b, BUILTIN_POINTS[b.key]!, { id: 'hao-twice', gateWidthM: 30 });
    void startReplay({ kind: 'sim', withRef: false }, 5);
    void startCoursePreview(course);
    await untilReady();
    for (let k = 0; k < 50; k++) {
      await vi.advanceTimersByTimeAsync(5);
      await realTick();
    }
    expect(replay().label).toBe('모의주행 · 하오고개');
    seekReplay(0);
    await vi.advanceTimersByTimeAsync(1000);
    // 재생 시계가 하나뿐이면 5×로 1초에 5초
    expect(Math.abs(replay().posMs - 5000)).toBeLessThanOrEqual(100);
    expect(replay().label).toBe('모의주행 · 하오고개');
  });

  it('코스 모의주행: 이름표·5×·코스 상세로 돌아가기, 비교 랩 없음', async () => {
    const b = BUILTIN_COURSES.find((x) => x.key === 'haogogae')!;
    const course = builtinCourse(b, BUILTIN_POINTS[b.key]!, { id: 'hao-preview', gateWidthM: 30 });
    void startCoursePreview(course);
    await untilReady();
    expect(replay()).toMatchObject({ label: '모의주행 · 하오고개', speed: 5, returnTo: '#/course/hao-preview', seekable: true });
    expect(getDriveState().ref).toBeNull();
    expect(getDriveState().course?.id).toBe('hao-preview');
    stopReplay();
    expect(window.location.hash).toBe('#/course/hao-preview');
  });
});
