import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Course } from '../../src/types/course';

// 사용자 요청: 근처에 코스가 있어도 주행을 누르면 코스 주행으로만 가지 말고, 코스 주행할지 일반 기록 주행할지 묻는다
const gate = { lat: 37.39, lon: 127.01, bearingDeg: 90, widthM: 30 };
const course: Course = { id: 'c1', name: '하오고개', kind: 'point_to_point', source: 'gpx', origin: { lat: 37.39, lon: 127.01 }, startGate: gate, finishGate: { ...gate, lat: 37.4 }, centerline: null, lengthM: 3200, sectorBoundsM: null, version: 1 };

const calls: string[] = [];
const beginPrepare = vi.fn(() => calls.push('begin'));
const chooseCourse = vi.fn((c: Course | null) => calls.push(`choose:${c?.id ?? 'none'}`));
const startDrive = vi.fn(() => calls.push('start'));
let drive: Record<string, unknown> = {};
let fix: { lat: number; lon: number; hAcc: number } | null = null;

vi.mock('../../src/app/drive', async (orig) => ({
  ...(await orig<typeof import('../../src/app/drive')>()),
  useDrive: () => drive,
  beginPrepare: () => beginPrepare(),
  chooseCourse: (c: Course | null) => chooseCourse(c),
  startDrive: () => startDrive(),
  loadCourses: async () => [],
}));
vi.mock('../../src/app/recording', async (orig) => ({
  ...(await orig<typeof import('../../src/app/recording')>()),
  useRecording: () => ({ phase: drive.phase === 'preparing' ? 'recording' : 'idle', sessionId: null, wakeLock: 'active', locationPermission: 'granted', motionPermission: 'granted', gpsError: null }),
}));
vi.mock('../../src/ui/hooks/useLocationPreview', () => ({ useLocationPreview: () => ({ fix, permission: 'granted' }) }));

const idle = () => ({ phase: 'idle', replay: null, courses: [course], course: null, courseChosen: false, refs: [], ref: null, mode: 'map', error: null });

describe('주행 시작: 코스 주행 / 일반 기록 주행 묻기 (사용자 요청)', () => {
  beforeEach(() => {
    cleanup();
    calls.length = 0;
    beginPrepare.mockClear();
    chooseCourse.mockClear();
    startDrive.mockClear();
  });

  it('메인: 근처에 코스가 있으면 주행 시작을 누를 때 묻고, 일반 기록을 고르면 코스 없이 준비', async () => {
    drive = idle();
    fix = { lat: 37.39, lon: 127.01, hAcc: 5 };
    const { MainScreen } = await import('../../src/ui/screens/MainScreen');
    render(<MainScreen />);
    fireEvent.click(screen.getByRole('button', { name: /주행 시작/ }));
    expect(beginPrepare).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /코스 주행 · 하오고개/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /일반 기록 주행/ }));
    expect(calls).toEqual(['begin', 'choose:none']);
  });

  it('메인: 코스 주행을 고르면 그 코스로 준비', async () => {
    drive = idle();
    fix = { lat: 37.39, lon: 127.01, hAcc: 5 };
    const { MainScreen } = await import('../../src/ui/screens/MainScreen');
    render(<MainScreen />);
    fireEvent.click(screen.getByRole('button', { name: /주행 시작/ }));
    fireEvent.click(screen.getByRole('button', { name: /코스 주행 · 하오고개/ }));
    expect(calls).toEqual(['begin', 'choose:c1']);
  });

  it('메인: 근처에 코스가 없으면 묻지 않고 바로 준비', async () => {
    drive = idle();
    fix = null;
    const { MainScreen } = await import('../../src/ui/screens/MainScreen');
    render(<MainScreen />);
    fireEvent.click(screen.getByRole('button', { name: /주행 시작/ }));
    expect(calls).toEqual(['begin']);
    expect(screen.queryByRole('button', { name: /일반 기록 주행/ })).toBeNull();
  });

  it('준비: 위치로 자동 감지된 코스면 기록 시작을 누를 때 한 번 묻는다. 직접 고른(또는 이미 답한) 코스면 바로 시작', async () => {
    drive = { ...idle(), phase: 'preparing', course, courseChosen: false };
    const { PrepareScreen } = await import('../../src/ui/screens/PrepareScreen');
    const r = render(<PrepareScreen />);
    fireEvent.click(screen.getByRole('button', { name: '기록 시작' }));
    expect(startDrive).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /일반 기록 주행/ }));
    expect(calls).toEqual(['choose:none', 'start']);
    r.unmount();
    calls.length = 0;
    drive = { ...idle(), phase: 'preparing', course, courseChosen: true };
    render(<PrepareScreen />);
    fireEvent.click(screen.getByRole('button', { name: '기록 시작' }));
    expect(calls).toEqual(['start']);
  });
});
