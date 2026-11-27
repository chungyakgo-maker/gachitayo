// 코스 목록·상세 둘러보기 (설계 docs/superpowers/specs/2026-11-16-course-browse-design.md)
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Course } from '../../src/types/course';

const gate = (lat: number, lon: number) => ({ lat, lon, bearingDeg: 0, widthM: 20 });
const hao = { id: 'hao', name: '하오고개', kind: 'point_to_point', source: 'gpx', builtin: 'haogogae', origin: { lat: 37.39, lon: 127 }, startGate: gate(37.39, 127.01), finishGate: gate(37.4, 127.02), centerline: null, lengthM: 3300, sectorBoundsM: null, version: 1 } as unknown as Course;
const nam = { ...hao, id: 'nam', name: '남한산성', builtin: 'namhansanseong' } as unknown as Course;
const mine = { ...hao, id: 'mine', name: '내 길', builtin: null } as unknown as Course;
let popularRows: Array<{ builtin: string; drivers: number }> | null = [
  { builtin: 'namhansanseong', drivers: 7 },
  { builtin: 'haogogae', drivers: 2 },
];
vi.mock('../../src/app/drive', async (orig) => ({
  ...(await orig<typeof import('../../src/app/drive')>()),
  useDrive: () => ({ phase: 'idle', replay: null, courses: [hao, nam, mine], course: null }),
  loadCourses: async () => [hao, nam, mine],
}));
vi.mock('../../src/app/popular', () => ({ usePopular: (_p: string, on: boolean) => ({ rows: on ? popularRows : null, error: null }) }));
vi.mock('../../src/ui/screens/useBestTimes', () => ({ useBestTimes: () => ({}) }));

const { CoursesScreen } = await import('../../src/ui/screens/CoursesScreen');
const { CourseBrowseControls } = await import('../../src/ui/screens/CourseDetailScreen');
const { updateSettings } = await import('../../src/app/settings');
const prefs = await import('../../src/app/coursePrefs');

beforeEach(() => {
  cleanup();
  updateSettings({ courseFilter: 'all', popularPeriod: '30d' });
  for (const c of [hao, nam, mine]) if (prefs.isFavorite(c)) prefs.toggleFavorite(c);
  prefs.setTag(mine, 'coast', false);
  prefs.setTag(hao, 'mountain', true);
  prefs.setTag(hao, 'coast', false);
});
const rows = () => screen.getAllByRole('listitem').map((li) => li.querySelector('strong')!.textContent);

describe('코스 목록', () => {
  it('chips filter the list; stars toggle favorites; tags show', () => {
    render(<CoursesScreen />);
    expect(rows()).toEqual(['내 길', '하오고개', '남한산성']);
    const haoRow = screen.getAllByRole('listitem').find((li) => li.textContent!.includes('하오고개'))!;
    expect(within(haoRow).getByText('산 길')).toBeInTheDocument();
    fireEvent.click(within(haoRow).getByRole('button', { name: '하오고개 즐겨찾기' }));
    expect(prefs.isFavorite(hao)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /^즐겨찾기$/ }));
    expect(rows()).toEqual(['하오고개']);
    fireEvent.click(screen.getByRole('button', { name: '내 코스' }));
    expect(rows()).toEqual(['내 길']);
    fireEvent.click(screen.getByRole('button', { name: '해안 길' }));
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByText('이 분류에 코스가 없어요')).toBeInTheDocument();
  });

  it('popular ranks built-in courses with driver counts', () => {
    render(<CoursesScreen />);
    fireEvent.click(screen.getByRole('button', { name: '인기 도로' }));
    expect(rows()).toEqual(['남한산성', '하오고개']);
    expect(screen.getByText('7명')).toBeInTheDocument();
    expect(screen.getByText('2명')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '가을' })).toBeInTheDocument();
  });
});

// 2026-11-27 세영 "코스리스트에 코스 검색창, 서킷 카테고리, 코스별 컬러라벨" (시안 docs/mock/2026-11-27-course-search.jpg)
describe('코스 검색·서킷·색 라벨', () => {
  it('typing filters by name across mine and built-in, inside the chosen chip; clear brings all back', () => {
    render(<CoursesScreen />);
    const box = screen.getByRole('textbox', { name: '코스 검색' });
    fireEvent.change(box, { target: { value: '남한' } });
    expect(rows()).toEqual(['남한산성']);
    expect(screen.getByText('검색 결과 1개')).toBeInTheDocument();
    fireEvent.change(box, { target: { value: '길' } });
    expect(rows()).toEqual(['내 길']);
    fireEvent.click(screen.getByRole('button', { name: '기본 코스' }));
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByText('찾는 코스가 없어요')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '검색어 지우기' }));
    expect(rows()).toEqual(['하오고개', '남한산성']);
  });

  it('rows carry coloured source and tag labels; circuit chip shows circuits', () => {
    prefs.setTag(nam, 'circuit', true);
    prefs.setTag(nam, 'mountain', false);
    render(<CoursesScreen />);
    const row = (name: string) => screen.getAllByRole('listitem').find((li) => li.querySelector('strong')!.textContent === name)!;
    expect(within(row('내 길')).getByText('내 코스')).toHaveClass('course-tag', 'src-mine');
    expect(within(row('하오고개')).getByText('기본 코스')).toHaveClass('src-builtin');
    expect(within(row('하오고개')).getByText('산 길')).toHaveClass('tag-mountain');
    expect(within(row('남한산성')).getByText('서킷')).toHaveClass('tag-circuit');
    fireEvent.click(screen.getByRole('button', { name: '서킷' }));
    expect(rows()).toEqual(['남한산성']);
    prefs.setTag(nam, 'circuit', false);
    prefs.setTag(nam, 'mountain', true);
  });
});

describe('코스 상세: 즐겨찾기·분류', () => {
  it('toggles favorite and categories', () => {
    render(<CourseBrowseControls course={mine} />);
    fireEvent.click(screen.getByRole('button', { name: /즐겨찾기/ }));
    expect(prefs.isFavorite(mine)).toBe(true);
    const coast = screen.getByRole('button', { name: '해안 길' });
    expect(coast).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(coast);
    expect(prefs.tagsOf(mine)).toEqual(['coast']);
    expect(screen.getByRole('button', { name: '해안 길' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '산 길' }));
    expect(prefs.tagsOf(mine)).toEqual(['coast', 'mountain']);
  });
});
