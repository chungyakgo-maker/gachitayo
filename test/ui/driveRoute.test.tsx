// 주행 화면의 목적지 경로 (설계 docs/superpowers/specs/2026-11-16-destination-route-design.md 5.4): 다음 커브 표지판, 칸 1 제목, 지도 선
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DriveView, type DriveViewProps } from '../../src/ui/screens/DriveScreen';
import { DEFAULT_SETTINGS } from '../../src/app/settings';
import type { NavLive } from '../../src/app/routeNav';
import { fromLocal } from '../../src/engine/geo';
import type { LiveSnapshot } from '../../src/engine/live/livePipeline';
import type { LiveState } from '../../src/engine/live/liveEngine';
import type { RouteStep } from '../../src/engine/route/routeGuide';
import { RouteGuide } from '../../src/engine/route/routeGuide';
import { routeMapModel } from '../../src/ui/overlay/minimap';
import type { Course } from '../../src/types/course';
import type { RefLapRecord } from '../../src/types/drive';

const O = { lat: 37.5, lon: 127 };
function routePoints(): Array<[number, number]> {
  const xy: Array<[number, number]> = [];
  for (let y = 0; y <= 300; y += 30) xy.push([0, y]);
  for (let a = 172.5; a >= 90; a -= 7.5) xy.push([40 + 40 * Math.cos((a * Math.PI) / 180), 300 + 40 * Math.sin((a * Math.PI) / 180)]);
  for (let x = 70; x <= 340; x += 45) xy.push([x, 340]);
  return xy.map(([x, y]) => {
    const p = fromLocal(O, x, y);
    return [p.lat, p.lon];
  });
}
const guide = new RouteGuide(routePoints(), O);
const step = (p: Partial<RouteStep> = {}): RouteStep => ({ s: 280, onRoute: true, lateralM: 0, remainingM: 383, arrived: false, wantReroute: false, ...p });
const navOf = (p: Partial<RouteStep> = {}, status: NavLive['status'] = 'guiding'): NavLive => ({
  guide,
  route: { distanceM: 663, durationS: 90, points: routePoints(), destName: null },
  step: step(p),
  status,
});

function state(p: Partial<LiveState> = {}): LiveState {
  return {
    t: 100_000,
    speedKmh: 72,
    lapNo: 0,
    lapElapsedMs: 72_449,
    lastLap: null,
    bestLapMs: null,
    sectorTimesMs: [null, null, null],
    currentSector: null,
    sectorDeltas: [null, null, null],
    maxSpeedKmh: 90,
    distM: 0,
    avgKmh: null,
    delta: null,
    s: null,
    onCourse: true,
    offCourseM: null,
    gx: 0,
    gy: 0,
    gEstimated: false,
    status: { gpsWeak: false, offCourse: false, gNotCalibrated: false, courseRecording: true },
    ...p,
  };
}
const snap = (st: LiveState): LiveSnapshot => ({
  t: st.t,
  state: st,
  frame: 'session',
  origin: O,
  utcOffsetMs: 0,
  pos: { x: 0, y: 280, psi: Math.PI / 2 },
  gps: { ready: true, hAcc: 4, ageMs: 300 },
  calibration: { state: 'calibrated', stillProgress: 1, signsConfirmed: true, motionActive: true },
  ghost: null,
  path: [],
  pathFrom: 0,
  pathDropped: 0,
});
const props = (p: Partial<DriveViewProps> = {}): DriveViewProps => ({
  snap: snap(state()),
  course: null,
  refLap: null,
  mode: 'map',
  settings: DEFAULT_SETTINGS,
  replay: null,
  error: null,
  onCycle: () => {},
  onEnd: () => {},
  ...p,
});
const top = () => screen.getAllByRole('button').find((b) => b.getAttribute('aria-label')?.startsWith('칸 1 · '))!.getAttribute('aria-label');

describe('목적지 경로 주행 화면', () => {
  it('route shows next curve sign', () => {
    render(<DriveView {...props({ nav: navOf() })} />);
    expect(screen.getByRole('img', { name: /^오른쪽/ })).toBeTruthy();
  });

  it('headline shows distance to destination', () => {
    render(<DriveView {...props({ nav: navOf() })} />);
    expect(top()).toBe('칸 1 · 목적지까지 383m · 누르면 바꾸기');
  });

  it('off route hides sign and says so', () => {
    render(<DriveView {...props({ nav: navOf({ onRoute: false, lateralM: 80 }, 'off') })} />);
    expect(screen.queryByRole('img', { name: /^오른쪽/ })).toBeNull();
    expect(top()).toBe('칸 1 · 경로를 벗어났어요 · 누르면 바꾸기');
  });

  it('rerouting and arrived labels', () => {
    const { unmount } = render(<DriveView {...props({ nav: navOf({ onRoute: false }, 'rerouting') })} />);
    expect(top()).toBe('칸 1 · 새 경로 찾는 중… · 누르면 바꾸기');
    unmount();
    render(<DriveView {...props({ nav: navOf({ arrived: true, remainingM: 10 }, 'arrived') })} />);
    expect(top()).toBe('칸 1 · 도착했어요 · 누르면 바꾸기');
    expect(screen.queryByRole('img', { name: /^오른쪽/ })).toBeNull();
  });

  it('no record suffix', () => {
    render(<DriveView {...props({ nav: navOf(), noRecord: true })} />);
    expect(top()).toBe('칸 1 · 목적지까지 383m · 기록 안 함 · 누르면 바꾸기');
  });

  it('minimal mode shows distance to destination', () => {
    render(<DriveView {...props({ nav: navOf(), mode: 'minimal' })} />);
    expect(screen.getByText('목적지까지 383m')).toBeTruthy();
    expect(screen.queryByText('코스 기록 중')).toBeNull();
  });

  it('without route keeps free drive label', () => {
    render(<DriveView {...props()} />);
    expect(top()).toBe('칸 1 · 코스 기록 중 · 출발 뒤 · 누르면 바꾸기');
  });

  it('course drive unchanged', () => {
    const course = {
      id: 'c1',
      name: '테스트',
      kind: 'loop',
      source: 'auto',
      origin: O,
      startGate: { lat: O.lat, lon: O.lon, bearingDeg: 0, widthM: 30 },
      finishGate: { lat: O.lat, lon: O.lon, bearingDeg: 0, widthM: 30 },
      centerline: routePoints(),
      lengthM: 663,
      sectorBoundsM: [200, 400],
      version: 1,
    } as Course;
    const ref = { id: 's:1', courseId: 'c1', courseVersion: 1, sessionId: 's', lapNo: 1, startedAt: 0, lapTimeMs: 60_000, sectorTimesMs: [20_000, 20_000, 20_000], trace: { stepM: 5, t: [0], v: [0], alt: [null] } } as RefLapRecord;
    render(<DriveView {...props({ course, refLap: ref, nav: navOf(), snap: snap(state({ lapNo: 1, delta: -0.2, s: 100 })) })} />);
    expect(top()).toMatch(/^칸 1 · 베스트 대비/);
  });

  it('route map model', () => {
    const m = routeMapModel(guide);
    // 그리기는 카카오 점 그대로 (2 m로 다시 찍은 선은 길면 수만 점이라 매 프레임 그리기에 무겁다)
    expect(m.line).toHaveLength(guide.raw.x.length);
    expect(m.line.length).toBeLessThan(guide.line.x.length);
    expect(m.loop).toBe(false);
    expect(m.start).toBeNull();
    expect(m.finish).not.toBeNull();
    expect(m.finish!.cx).toBeCloseTo(340, 0);
    expect(m.finish!.cy).toBeCloseTo(340, 0);
    expect(routeMapModel(guide)).toBe(m);
  });
});
