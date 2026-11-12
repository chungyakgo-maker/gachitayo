import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Controller = typeof import('../../src/app/recording');

let wakeRequest: ReturnType<typeof vi.fn>;
let motionRequest: ReturnType<typeof vi.fn>;
let dbIndex = 0;

beforeEach(() => {
  vi.resetModules();
  wakeRequest = vi.fn(async () => ({ released: false, release: async () => {}, addEventListener: () => {} }));
  motionRequest = vi.fn(async () => 'granted');
  Object.defineProperty(navigator, 'wakeLock', { value: { request: wakeRequest }, configurable: true });
  Object.defineProperty(navigator, 'geolocation', {
    value: { watchPosition: vi.fn(() => 1), clearWatch: vi.fn() },
    configurable: true,
  });
  vi.stubGlobal('DeviceMotionEvent', Object.assign(class {}, { requestPermission: motionRequest }));
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  // 테스트마다 다른 IndexedDB를 쓰도록 이름을 바꾼다
  vi.doMock('../../src/storage/db', async (orig) => {
    const m = await orig<typeof import('../../src/storage/db')>();
    return { GachitayoDb: class extends m.GachitayoDb { constructor() { super(`ctrl-${++dbIndex}`); } } };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function load(): Promise<Controller> {
  const c = await import('../../src/app/recording');
  await c.initRecording();
  return c;
}

async function until(c: Controller, phase: string) {
  await vi.waitFor(() => expect(c.getRecordingState().phase).toBe(phase), { timeout: 2000 });
}

describe('기록 컨트롤러', () => {
  it('기록 시작을 누른 그 순간(await 전)에 모션 권한과 화면 꺼짐 방지를 요청한다 (아이폰 탭 규칙)', async () => {
    const c = await load();
    c.startRecording();
    expect(motionRequest).toHaveBeenCalledTimes(1);
    expect(wakeRequest).toHaveBeenCalledTimes(1);
    await until(c, 'recording');
    await c.stopRecording();
  });

  it('기록 시작을 두 번 눌러도 세션은 하나만 만든다', async () => {
    const c = await load();
    c.startRecording();
    c.startRecording();
    await until(c, 'recording');
    await c.stopRecording();
    expect((await c.getRepo().list()).length).toBe(1);
  });

  it('종료한 뒤 다시 시작하면 새 세션으로 기록한다', async () => {
    const c = await load();
    c.startRecording();
    await until(c, 'recording');
    await c.stopRecording();
    c.startRecording();
    await until(c, 'recording');
    await c.stopRecording();
    const sessions = await c.getRepo().list();
    expect(sessions.map((s) => s.status)).toEqual(['finished', 'finished']);
  });
});
