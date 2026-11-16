// 목적지 고르기 화면 (설계 docs/superpowers/specs/2026-11-16-destination-route-design.md 5.4)
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Course } from '../../src/types/course';
import type { Destination, RoutePlan } from '../../src/app/routeNav';

const gate = (lat: number, lon: number) => ({ lat, lon, bearingDeg: 0, widthM: 20 });
const course = { id: 'a', name: '하오고개', kind: 'point_to_point', source: 'gpx', origin: { lat: 37.4, lon: 127 }, startGate: gate(37.4, 127), finishGate: gate(37.41, 127), centerline: null, lengthM: 1100, sectorBoundsM: null, version: 1 } as Course;

let fix: { lat: number; lon: number; hAcc: number } | null = { lat: 37.39, lon: 127, hAcc: 5 };
const idlePlan: RoutePlan = { dest: null, route: null, status: 'idle', error: null, record: true };
let plan: RoutePlan = idlePlan;
const planTo = vi.fn(async (_d: Destination, _f: { lat: number; lon: number }) => {});
const startRouteDrive = vi.fn();
const setRecord = vi.fn();
const clearPlan = vi.fn();
let mapProps: Record<string, unknown> = {};
let drivePhase = 'idle';

vi.mock('../../src/app/routeNav', async (orig) => ({
  ...(await orig<typeof import('../../src/app/routeNav')>()),
  usePlan: () => plan,
  planTo: (d: Destination, f: { lat: number; lon: number }) => planTo(d, f),
  startRouteDrive: () => startRouteDrive(),
  setRecord: (on: boolean) => setRecord(on),
  clearPlan: () => clearPlan(),
}));
vi.mock('../../src/app/drive', async (orig) => ({
  ...(await orig<typeof import('../../src/app/drive')>()),
  useDrive: () => ({ phase: drivePhase, replay: null, courses: [course] }),
  loadCourses: async () => [course],
}));
vi.mock('../../src/ui/hooks/useLocationPreview', () => ({ useLocationPreview: () => ({ fix, permission: 'granted' }) }));
vi.mock('../../src/ui/components/MainMap', () => ({
  MainMap: (p: Record<string, unknown> & { children?: React.ReactNode }) => {
    mapProps = p;
    return <div data-testid="map">{p.children}</div>;
  },
}));

const { DestinationScreen } = await import('../../src/ui/screens/DestinationScreen');
const { rememberDestination } = await import('../../src/app/routeNav');

beforeEach(() => {
  cleanup();
  localStorage.clear();
  fix = { lat: 37.39, lon: 127, hAcc: 5 };
  plan = idlePlan;
  planTo.mockClear();
  startRouteDrive.mockClear();
  setRecord.mockClear();
  clearPlan.mockClear();
  mapProps = {};
  drivePhase = 'idle';
});

const readyPlan = (): RoutePlan => ({
  dest: { lat: 37.45, lon: 127.05, name: '남산공원길 부근', kind: 'map' },
  route: {
    distanceM: 6249,
    durationS: 1018,
    points: [
      [37.39, 127],
      [37.45, 127.05],
    ],
    destName: '남산공원길',
  },
  status: 'ready',
  error: null,
  record: true,
});

describe('목적지 고르기', () => {
  it('lists recent and course points', () => {
    rememberDestination({ lat: 37.5, lon: 127.1, name: '집 근처', kind: 'map' });
    render(<DestinationScreen />);
    expect(screen.getByText('목적지 고르기')).toBeInTheDocument();
    expect(screen.getByText('지도를 길게 눌러 목적지를 찍어요')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /집 근처/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /하오고개 · 출발점 · 1\.1km/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /하오고개 · 도착점 · 2\.2km/ })).toBeInTheDocument();
  });

  it('picking a course point plans route', () => {
    render(<DestinationScreen />);
    fireEvent.click(screen.getByRole('button', { name: /하오고개 · 도착점/ }));
    expect(planTo).toHaveBeenCalledWith({ lat: 37.41, lon: 127, name: '하오고개 · 도착점', kind: 'course-finish' }, { lat: 37.39, lon: 127 });
  });

  it('long press on map plans route to that point', () => {
    render(<DestinationScreen />);
    (mapProps.onLongPress as (lat: number, lon: number) => void)(37.42, 127.03);
    expect(planTo).toHaveBeenCalledWith({ lat: 37.42, lon: 127.03, name: '지도에서 고른 곳', kind: 'map' }, { lat: 37.39, lon: 127 });
  });

  it('no fix yet', () => {
    fix = null;
    render(<DestinationScreen />);
    expect(screen.getByText('위치 확인 중')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /하오고개 · 출발점/ }));
    (mapProps.onLongPress as (lat: number, lon: number) => void)(37.42, 127.03);
    expect(planTo).not.toHaveBeenCalled();
  });

  it('loading shows searching and pin', () => {
    plan = { ...idlePlan, dest: { lat: 37.42, lon: 127.03, name: '지도에서 고른 곳', kind: 'map' }, status: 'loading' };
    render(<DestinationScreen />);
    expect(screen.getByText('경로 찾는 중…')).toBeInTheDocument();
    expect(mapProps.dest).toEqual({ lat: 37.42, lon: 127.03 });
    expect(mapProps.route).toBeNull();
  });

  it('preview shows summary and start', () => {
    plan = readyPlan();
    render(<DestinationScreen />);
    expect(screen.getByText('남산공원길 부근')).toBeInTheDocument();
    expect(screen.getByText('6.2km · 17분 · 커브 0개')).toBeInTheDocument();
    expect(mapProps.route).toEqual(plan.route!.points);
    const rec = screen.getByRole('button', { name: /기록 남기기/ });
    expect(rec).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(rec);
    expect(setRecord).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole('button', { name: '이 경로로 출발' }));
    expect(startRouteDrive).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '다시 고르기' }));
    expect(clearPlan).toHaveBeenCalled();
  });

  it('long trip shows hours', () => {
    const p = readyPlan();
    plan = { ...p, route: { ...p.route!, distanceM: 81_500, durationS: 3700 } };
    render(<DestinationScreen />);
    expect(screen.getByText('81.5km · 1시간 2분 · 커브 0개')).toBeInTheDocument();
  });

  it('record off is shown', () => {
    plan = { ...readyPlan(), record: false };
    render(<DestinationScreen />);
    expect(screen.getByRole('button', { name: /기록 남기기/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('끝나도 기록을 남기지 않아요')).toBeInTheDocument();
  });

  it('error shows message and retry', () => {
    const dest = { lat: 37.42, lon: 127.03, name: '지도에서 고른 곳', kind: 'map' as const };
    plan = { ...idlePlan, dest, status: 'error', error: '도착 지점 주변의 도로를 탐색할 수 없음' };
    render(<DestinationScreen />);
    expect(screen.getByText('도착 지점 주변의 도로를 탐색할 수 없음')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(planTo).toHaveBeenCalledWith(dest, { lat: 37.39, lon: 127 });
  });

  it('a running drive blocks starting another', () => {
    drivePhase = 'driving';
    plan = readyPlan();
    render(<DestinationScreen />);
    expect(screen.getByRole('link', { name: /진행 중인 주행이 있어요/ })).toHaveAttribute('href', '#/drive');
    expect(screen.getByRole('button', { name: '이 경로로 출발' })).toBeDisabled();
  });

  it('back goes home and clears plan', () => {
    render(<DestinationScreen />);
    const back = screen.getByRole('link', { name: '뒤로' });
    expect(back).toHaveAttribute('href', '#/');
    fireEvent.click(back);
    expect(clearPlan).toHaveBeenCalled();
  });
});
