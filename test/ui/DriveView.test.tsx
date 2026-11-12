import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { DriveView, type DriveViewProps } from '../../src/ui/screens/DriveScreen';
import { DEFAULT_SETTINGS } from '../../src/app/settings';
import type { LiveSnapshot } from '../../src/engine/live/livePipeline';
import type { LiveState } from '../../src/engine/live/liveEngine';
import type { Course } from '../../src/types/course';
import type { RefLapRecord } from '../../src/types/drive';

const course: Course = {
  id: 'c1',
  name: '테스트',
  kind: 'loop',
  source: 'auto',
  origin: { lat: 37.2, lon: 127.1 },
  startGate: { lat: 37.2, lon: 127.1, bearingDeg: 90, widthM: 30 },
  finishGate: { lat: 37.2, lon: 127.1, bearingDeg: 90, widthM: 30 },
  centerline: [
    [37.2, 127.1],
    [37.201, 127.1],
    [37.201, 127.101],
  ],
  lengthM: 200,
  sectorBoundsM: [66, 133],
  version: 1,
};
const ref: RefLapRecord = { id: 's:6', courseId: 'c1', courseVersion: 1, sessionId: 's', lapNo: 6, startedAt: 0, lapTimeMs: 124_318, sectorTimesMs: [40_000, 42_000, 42_318], trace: { stepM: 5, t: [0], v: [0], alt: [null] } };

function state(p: Partial<LiveState> = {}): LiveState {
  return {
    t: 100_000,
    speedKmh: 142.4,
    lapNo: 4,
    lapElapsedMs: 72_449,
    lastLap: null,
    bestLapMs: null,
    sectorTimesMs: [41_803, null, null],
    currentSector: 1,
    sectorDeltas: [-0.12, -0.19, null],
    maxSpeedKmh: 186.2,
    delta: -0.31,
    s: 100,
    onCourse: true,
    gx: -0.31,
    gy: 0.82,
    gEstimated: false,
    status: { gpsWeak: false, offCourse: false, gNotCalibrated: false, courseRecording: false },
    ...p,
  };
}
function snap(st: LiveState | null): LiveSnapshot {
  return {
    t: st?.t ?? 0,
    state: st,
    frame: 'course',
    origin: { lat: 37.2, lon: 127.1 },
    utcOffsetMs: 1_800_000_000_000,
    pos: { x: 10, y: 20, psi: 0.5 },
    gps: { ready: true, hAcc: 4, ageMs: 300 },
    calibration: { state: 'calibrated', stillProgress: 1, signsConfirmed: true, motionActive: true },
    ghost: { x: 15, y: 25, s: 105 },
    path: [],
  };
}
const props = (p: Partial<DriveViewProps> = {}): DriveViewProps => ({
  snap: snap(state()),
  course,
  refLap: ref,
  mode: 'map',
  settings: DEFAULT_SETTINGS,
  replay: null,
  error: null,
  onCycle: () => {},
  onEnd: () => {},
  ...p,
});

describe('주행 화면 (사양서 8.4, 시안)', () => {
  it('지도 모드: 델타·랩·상단 두 칸·미니맵을 캔버스로 그린다 (사양서 8.4, 13.1 오버레이 함수)', () => {
    render(<DriveView {...props()} />);
    const delta = screen.getByRole('img', { name: '베스트 대비 · 빠름 −0.31, 랩 4 1:12.4' });
    expect(delta.closest('.delta-panel')).toHaveClass('fast');
    expect(screen.getByRole('img', { name: /G미터: 좌 0.82g, 제동 0.31g/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '속도 142 km/h' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '코스 지도: 내 위치와 베스트 고스트' })).toBeInTheDocument();
    expect(screen.getByText('두 번 탭하면 미니멀')).toBeInTheDocument();
  });

  it('지도 모드 바탕 지도: 설정에서 켜면 지도(OSM) 위에, 끄면 코스 선만 (사용자 요청)', () => {
    const on = render(<DriveView {...props()} />);
    expect(on.container.querySelector('.replay-map')).not.toBeNull();
    on.unmount();
    const off = render(<DriveView {...props({ settings: { ...DEFAULT_SETTINGS, mapTiles: false } })} />);
    expect(off.container.querySelector('.replay-map')).toBeNull();
    expect(screen.getByRole('img', { name: '코스 지도: 내 위치와 베스트 고스트' })).toBeInTheDocument();
  });

  it('지도 보기 나침반 버튼: 누를 때마다 전체 코스 → 나를 가운데 → 진행 방향 위 (사용자 요청), 두 번 탭으로 치지 않는다', () => {
    const onMapView = vi.fn();
    const onCycle = vi.fn();
    const r = render(<DriveView {...props({ onMapView, onCycle, settings: { ...DEFAULT_SETTINGS, mapTiles: false } })} />);
    const btn = screen.getByRole('button', { name: '지도 보기: 전체 코스 (누르면 나를 가운데)' });
    expect(btn).toHaveTextContent('전체 코스');
    fireEvent.pointerDown(btn);
    fireEvent.pointerDown(btn);
    fireEvent.click(btn);
    expect(onMapView).toHaveBeenLastCalledWith('follow');
    expect(onCycle).not.toHaveBeenCalled();
    r.rerender(<DriveView {...props({ onMapView, onCycle, settings: { ...DEFAULT_SETTINGS, mapTiles: false, mapView: 'heading' } })} />);
    fireEvent.click(screen.getByRole('button', { name: '지도 보기: 진행 방향 위 (누르면 전체 코스)' }));
    expect(onMapView).toHaveBeenLastCalledWith('fit');
    expect(screen.queryByRole('group', { name: '지도 보기' })).toBeNull();
  });

  it('재생 중에도 같은 나침반 버튼 (재생·주행 같은 지도)', () => {
    render(<DriveView {...props({ replay: { label: '가상', speed: 5, ended: false } })} />);
    expect(screen.getByRole('button', { name: /^지도 보기: 전체 코스/ })).toBeInTheDocument();
  });

  it('G미터 궤적: 스냅숏이 이어지면 최근 G를 곡선 조각으로 그린다, 최대값은 설정을 따른다', () => {
    const at = (t: number, gx: number) => ({ ...snap(state({ gx, gy: 0.1 })), t });
    const settings = { ...DEFAULT_SETTINGS, gMaxG: 3 };
    const r = render(<DriveView {...props({ mode: 'dashboard', settings, snap: at(1000, 0.1) })} />);
    r.rerender(<DriveView {...props({ mode: 'dashboard', settings, snap: at(1100, 0.3) })} />);
    r.rerender(<DriveView {...props({ mode: 'dashboard', settings, snap: at(1200, 0.5) })} />);
    expect(r.container.querySelectorAll('.g-trail').length).toBe(2);
    expect(screen.getByRole('img', { name: /\(최대 3g\)$/ })).toBeInTheDocument();
  });

  it('대시보드 G 칸: 글자 없이 G미터만 (사용자 요청), 임시 G는 속 빈 점, 최대값 기본 2g', () => {
    const r = render(<DriveView {...props({ mode: 'dashboard', snap: snap(state({ gx: 0, gy: 0, gEstimated: true })) })} />);
    const tile = r.container.querySelector('.dash-tile.g-tile')!;
    expect(tile.textContent).toBe('2g');
    expect(screen.getByRole('img', { name: /^G미터\(추정\): .*\(최대 2g\)$/ })).toBeInTheDocument();
    expect(tile.querySelector('.g-dot.estimated')).not.toBeNull();
  });

  it('느리면 느림 색, 고른 값은 설정을 따른다', () => {
    render(<DriveView {...props({ snap: snap(state({ delta: 0.425 })), settings: { ...DEFAULT_SETTINGS, widgets: ['sector', 'vmax'] } })} />);
    expect(screen.getByRole('img', { name: /베스트 대비 · 느림 \+0.43/ }).closest('.delta-panel')).toHaveClass('slow');
    expect(screen.getByRole('img', { name: '구간 기록 S2 −0.19' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '최고 속도 186 km/h' })).toBeInTheDocument();
  });

  it('두 번 탭하면 다음 모드, 한 번은 무시', () => {
    vi.useFakeTimers();
    const onCycle = vi.fn();
    render(<DriveView {...props({ onCycle })} />);
    const root = screen.getByTestId('drive');
    const tap = (atMs: number, x = 100) => {
      vi.setSystemTime(atMs);
      fireEvent.pointerDown(root, { clientX: x, clientY: 100 });
    };
    tap(1000);
    expect(onCycle).not.toHaveBeenCalled();
    tap(1200, 105);
    expect(onCycle).toHaveBeenCalledTimes(1);
    tap(3000);
    tap(3600);
    expect(onCycle).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('종료는 1초 길게 눌러야 한다 (사용자 요청으로 2초에서 줄임)', () => {
    vi.useFakeTimers();
    const onEnd = vi.fn();
    render(<DriveView {...props({ onEnd })} />);
    const btn = screen.getByRole('button', { name: /길게 눌러 종료/ });
    fireEvent.pointerDown(btn, { pointerId: 1 });
    act(() => {
      vi.advanceTimersByTime(700);
    });
    fireEvent.pointerUp(btn, { pointerId: 1 });
    expect(onEnd).not.toHaveBeenCalled();
    fireEvent.pointerDown(btn, { pointerId: 1 });
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(onEnd).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('미니멀: 큰 델타와 비교 랩, 랩을 통과하면 3초간 랩타임(셋째 자리)과 새 베스트', () => {
    const { rerender } = render(<DriveView {...props({ mode: 'minimal' })} />);
    expect(screen.getByText('2:04.318')).toBeInTheDocument();
    const lastLap = { lapNo: 3, timeMs: 123_871, t: 99_000, valid: true, sectorTimesMs: [null, null, null] as [null, null, null] };
    rerender(<DriveView {...props({ mode: 'minimal', snap: snap(state({ lastLap, t: 100_000 })) })} />);
    expect(screen.getByText('랩 3 완료')).toBeInTheDocument();
    expect(screen.getByText('2:03.871')).toBeInTheDocument();
    expect(screen.getByText('−0.447')).toBeInTheDocument();
    rerender(<DriveView {...props({ mode: 'minimal', snap: snap(state({ lastLap, t: 103_000 })) })} />);
    expect(screen.queryByText('랩 3 완료')).not.toBeInTheDocument();
  });

  it('대시보드: 속도, G미터, 구간 3칸(끝난 구간 기록·델타, 진행 중, 안 간 구간 —)', () => {
    render(<DriveView {...props({ mode: 'dashboard' })} />);
    expect(screen.getByText('41.803')).toBeInTheDocument();
    expect(screen.getByText('−0.12')).toBeInTheDocument();
    expect(screen.getByText('진행 중')).toBeInTheDocument();
    expect(screen.getByText('−0.19')).toBeInTheDocument();
    expect(screen.getByText('구간 3').parentElement).toHaveTextContent('—');
    expect(screen.getByText('두 번 탭하면 지도')).toBeInTheDocument();
  });

  it('첫 주행(코스 없음): 델타 대신 출발 뒤 경과 시간과 "코스 기록 중"', () => {
    render(<DriveView {...props({ course: null, refLap: null, snap: snap(state({ delta: null, lapNo: 0, status: { gpsWeak: false, offCourse: false, gNotCalibrated: false, courseRecording: true } })) })} />);
    expect(screen.getAllByText(/코스 기록 중/).length).toBeGreaterThan(0);
    expect(screen.getByRole('img', { name: /^코스 기록 중 · 출발 뒤 1:12.4$/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '코스 지도: 내 위치' })).toBeInTheDocument();
  });

  it('GPS 약함·코스 이탈 상태를 보여준다', () => {
    render(<DriveView {...props({ snap: snap(state({ status: { gpsWeak: true, offCourse: true, gNotCalibrated: false, courseRecording: false } })) })} />);
    expect(screen.getByText('GPS 약함')).toBeInTheDocument();
    expect(screen.getByText('코스 이탈')).toBeInTheDocument();
  });

  it('앞 친구 간격(M9): 큰 델타 자리에 목표와의 차이, 신호가 끊기면 상태 줄에 알림', () => {
    const gap = { nickname: '지훈', targetS: 2, gapS: 1.5, stale: false };
    const { unmount } = render(<DriveView {...props({ gap, front: { x: 30, y: 40, label: '지훈' } })} />);
    const panel = screen.getByRole('img', { name: '앞 지훈 · 목표 2.0초 · 가까움 −0.5, 랩 4 1:12.4' });
    expect(panel.closest('.delta-panel')).toHaveClass('slow');
    unmount();
    render(<DriveView {...props({ gap: { ...gap, stale: true } })} />);
    expect(screen.getByText('앞 친구 신호 없음')).toBeInTheDocument();
  });

  it('앞 친구 간격은 미니멀 모드의 큰 숫자에도 나온다', () => {
    render(<DriveView {...props({ mode: 'minimal', gap: { nickname: '지훈', targetS: 2, gapS: 2.64, stale: false } })} />);
    expect(screen.getByText('+0.6')).toBeInTheDocument();
    expect(screen.getByText('멂')).toBeInTheDocument();
  });
});

describe('G 보정 진행 (사용자 문의: G가 안 나옴)', () => {
  it('어느 단계에서 몇 번 남았는지 상태 줄에', async () => {
    const { gCalText } = await import('../../src/ui/screens/DriveScreen');
    const base = { state: 'need_forward' as const, stillProgress: 1, signsConfirmed: false, motionActive: true };
    const mk = (progress: Record<string, unknown>, still = 1) => ({ calibration: { ...base, stillProgress: still, progress } }) as unknown as Parameters<typeof gCalText>[0];
    expect(gCalText(mk({ stage: 'stationary', fwd: 0, fwdNeed: 3, turns: 0, turnsNeed: 5 }, 0.5))).toBe('G 보정: 정차 1/3초');
    expect(gCalText(mk({ stage: 'forward', fwd: 1, fwdNeed: 3, turns: 0, turnsNeed: 5 }))).toBe('G 보정: 직진 가감속 1/3');
    expect(gCalText(mk({ stage: 'signs', fwd: 7, fwdNeed: 5, turns: 2, turnsNeed: 5 }))).toBe('G 보정: 가감속 5/5 · 코너 2/5');
    expect(gCalText(null)).toBe('G 보정 안 됨');
  });
});
