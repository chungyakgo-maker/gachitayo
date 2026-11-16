// 메인 화면 둘러보기 (설계 docs/superpowers/specs/2026-11-16-course-browse-design.md): 검색창, 분류 칩, 즐겨찾기 보라, 코스 누르면 창
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Course } from '../../src/types/course';

const gate = (lat: number, lon: number) => ({ lat, lon, bearingDeg: 0, widthM: 20 });
const hao = { id: 'hao', name: '하오고개', kind: 'point_to_point', source: 'gpx', builtin: 'haogogae', origin: { lat: 37.39, lon: 127 }, startGate: gate(37.39, 127.01), finishGate: gate(37.4, 127.02), centerline: null, lengthM: 3300, sectorBoundsM: null, version: 1 } as unknown as Course;
const mine = { ...hao, id: 'mine', name: '내 길', builtin: null } as unknown as Course;
let mapProps: Record<string, unknown> = {};
let fix: { lat: number; lon: number; hAcc: number } | null = { lat: 37.38, lon: 127, hAcc: 5 };
const calls: string[] = [];
const findPlaces = vi.fn(async (_q: string) => [{ name: '만항재', category: '고개,골짜기', address: '강원 정선', lat: 37.1487, lon: 128.8994 }]);
let popularRows: Array<{ builtin: string; drivers: number }> | null = [{ builtin: 'haogogae', drivers: 4 }];

vi.mock('../../src/app/drive', async (orig) => ({
  ...(await orig<typeof import('../../src/app/drive')>()),
  useDrive: () => ({ phase: 'idle', replay: null, courses: [hao, mine], course: null }),
  loadCourses: async () => [hao, mine],
  beginPrepare: () => calls.push('begin'),
  chooseCourse: (c: Course | null) => calls.push(`choose:${c?.id ?? 'none'}`),
}));
vi.mock('../../src/ui/hooks/useLocationPreview', () => ({ useLocationPreview: () => ({ fix, permission: fix ? 'granted' : 'prompt' }) }));
vi.mock('../../src/ui/components/MainMap', () => ({
  MainMap: (p: Record<string, unknown> & { children?: React.ReactNode }) => {
    mapProps = p;
    return <div data-testid="map">{p.children}</div>;
  },
}));
vi.mock('../../src/ui/components/PickMap', () => ({ PickMap: (p: { label: string }) => <div aria-label={p.label} /> }));
vi.mock('../../src/app/routeNav', async (orig) => ({ ...(await orig<typeof import('../../src/app/routeNav')>()), findPlaces: (q: string) => findPlaces(q) }));
vi.mock('../../src/app/popular', () => ({ usePopular: (_p: string, on: boolean) => ({ rows: on ? popularRows : null, error: null }) }));

const { MainScreen } = await import('../../src/ui/screens/MainScreen');
const { peekHandedDestination, clearHandedDestination } = await import('../../src/app/routeNav');
const { updateSettings, getSettings } = await import('../../src/app/settings');
const prefs = await import('../../src/app/coursePrefs');

beforeEach(() => {
  cleanup();
  calls.length = 0;
  mapProps = {};
  fix = { lat: 37.38, lon: 127, hAcc: 5 };
  clearHandedDestination();
  updateSettings({ courseFilter: 'all', popularPeriod: '30d' });
  if (prefs.isFavorite(hao)) prefs.toggleFavorite(hao);
  window.location.hash = '#/';
});
const mapIds = () => (mapProps.courses as Course[]).map((c) => c.id);

describe('메인 둘러보기', () => {
  it('top has the search box, no new-course card or course toggle chip', () => {
    render(<MainScreen />);
    expect(screen.getByRole('searchbox', { name: '목적지 검색' })).toBeInTheDocument();
    expect(screen.queryByText('새 코스')).toBeNull();
    expect(screen.queryByText(/현재 위치에서 감지됨/)).toBeNull();
    expect(screen.queryByRole('button', { name: /코스 보기/ })).toBeNull();
    expect(mapProps.course).toBeNull();
  });

  it('search results open the destination screen with the place', async () => {
    render(<MainScreen />);
    fireEvent.change(screen.getByRole('searchbox', { name: '목적지 검색' }), { target: { value: '만항재' } });
    fireEvent.submit(screen.getByRole('searchbox', { name: '목적지 검색' }));
    fireEvent.click(await screen.findByRole('button', { name: /^만항재 · 고개,골짜기/ }));
    expect(window.location.hash).toBe('#/destination');
    expect(peekHandedDestination()).toEqual({ lat: 37.1487, lon: 128.8994, name: '만항재', kind: 'search' });
  });

  it('chips filter the map and favorites go purple', () => {
    prefs.toggleFavorite(hao);
    render(<MainScreen />);
    expect(mapIds()).toEqual(['hao', 'mine']);
    expect([...(mapProps.favorites as Set<string>)]).toEqual(['hao']);
    fireEvent.click(screen.getByRole('button', { name: '내 코스' }));
    expect(getSettings().courseFilter).toBe('mine');
    expect(mapIds()).toEqual(['mine']);
    fireEvent.click(screen.getByRole('button', { name: /즐겨찾기/ }));
    expect(mapIds()).toEqual(['hao']);
  });

  it('popular shows period chips and ranked built-in courses', () => {
    render(<MainScreen />);
    fireEvent.click(screen.getByRole('button', { name: '인기 도로' }));
    for (const p of ['실시간', '7일', '30일', '봄', '여름', '가을', '겨울']) expect(screen.getByRole('button', { name: p })).toBeInTheDocument();
    expect(mapIds()).toEqual(['hao']);
    fireEvent.click(screen.getByRole('button', { name: '실시간' }));
    expect(getSettings().popularPeriod).toBe('live');
  });

  it('tapping a course opens its sheet; start point routes via the destination screen', () => {
    render(<MainScreen />);
    act(() => (mapProps.onCourseTap as (id: string) => void)('hao'));
    const dialog = screen.getByRole('dialog', { name: '하오고개' });
    expect(within(dialog).getByLabelText('코스 지도: 출발점과 도착점')).toBeInTheDocument();
    expect(within(dialog).getByText(/편도 · 3\.3km/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /즐겨찾기/ }));
    expect(prefs.isFavorite(hao)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '출발점으로 길찾기' }));
    expect(window.location.hash).toBe('#/destination');
    expect(peekHandedDestination()).toEqual({ lat: 37.39, lon: 127.01, name: '하오고개 · 출발점', kind: 'course-start' });
  });

  it('the sheet can start a course drive right away', () => {
    render(<MainScreen />);
    act(() => (mapProps.onCourseTap as (id: string) => void)('hao'));
    fireEvent.click(screen.getByRole('button', { name: '이 코스로 주행' }));
    expect(calls).toEqual(['begin', 'choose:hao']);
  });
});
