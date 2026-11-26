// 코스 만들기 (2026-11-26 세영 "지도에서 새코스 → 코스 만들기 … 출발지·목적지를 지도선택 + 검색 2번", 시안 docs/mock/2026-11-26-course-create.jpg)
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  findPlaces: vi.fn(async (q: string) => [{ name: `${q} 고개`, category: '고개', address: '강원 홍천군', lat: 37.79, lon: 127.91 }]),
  findRouteBetween: vi.fn(async (_f: unknown, _t: unknown, alt = 0) => ({ distanceM: 22100 + alt, durationS: 1800, points: [[37.79, 127.91], [37.85, 127.85], [37.9, 127.8]] as Array<[number, number]>, destName: null })),
  createRouteCourse: vi.fn(async (o: { name: string; from: string; to: string }) => ({ id: 'c-new', name: o.name || `${o.from} → ${o.to}` })),
  createMapCourse: vi.fn(async () => ({ id: 'c-map' })),
  pick: null as null | ((lat: number, lon: number) => void),
}));
vi.mock('../../src/app/routeNav', () => ({ findPlaces: m.findPlaces, findRouteBetween: m.findRouteBetween, MAP_PICK_NAME: '지도에서 고른 곳' }));
vi.mock('../../src/app/courses', () => ({ createRouteCourse: m.createRouteCourse, createMapCourse: m.createMapCourse }));
vi.mock('../../src/ui/hooks/useLocationPreview', () => ({ useLocationPreview: () => ({ fix: null }) }));
vi.mock('../../src/ui/components/PickMap', () => ({
  PickMap: ({ onPick, shapes }: { onPick: (a: number, b: number) => void; shapes: Array<{ kind: string }> }) => {
    m.pick = onPick;
    return <div data-testid="map" data-shapes={shapes.map((s) => s.kind).join(',')} />;
  },
}));

const { NewCourseScreen } = await import('../../src/ui/screens/NewCourseScreen');

beforeEach(() => {
  vi.clearAllMocks();
  location.hash = '#/course-new';
});

describe('코스 만들기', () => {
  it('제목은 "코스 만들기", 기본은 출발지·도착지로', () => {
    render(<NewCourseScreen />);
    expect(screen.getByRole('heading', { name: '코스 만들기' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '출발지·도착지로' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('textbox', { name: '출발지 검색' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '도착지 검색' })).toBeInTheDocument();
  });

  it('출발지는 검색, 도착지는 지도에서 고르기 → 길찾기 선 → 이 길로 코스 만들기', async () => {
    render(<NewCourseScreen />);
    fireEvent.change(screen.getByRole('textbox', { name: '출발지 검색' }), { target: { value: '가락재' } });
    fireEvent.click(screen.getByRole('button', { name: '출발지 찾기' }));
    fireEvent.click(await screen.findByRole('button', { name: /가락재 고개/ }));
    expect(m.findPlaces).toHaveBeenCalledWith('가락재');
    fireEvent.click(screen.getByRole('button', { name: '도착지 지도에서 고르기' }));
    expect(screen.getByText('지도에서 도착지를 누르세요')).toBeInTheDocument();
    act(() => m.pick!(37.9, 127.8));
    await waitFor(() => expect(m.findRouteBetween).toHaveBeenCalledWith({ lat: 37.79, lon: 127.91 }, { lat: 37.9, lon: 127.8 }, 0));
    expect(await screen.findByText(/편도 · 22\.1 ?km/)).toBeInTheDocument();
    expect(screen.getByTestId('map').dataset.shapes).toContain('line');
    fireEvent.click(screen.getByRole('button', { name: '다른 길' }));
    await waitFor(() => expect(m.findRouteBetween).toHaveBeenLastCalledWith({ lat: 37.79, lon: 127.91 }, { lat: 37.9, lon: 127.8 }, 1));
    fireEvent.click(screen.getByRole('button', { name: '출발↔도착' }));
    await waitFor(() => expect(m.findRouteBetween).toHaveBeenLastCalledWith({ lat: 37.9, lon: 127.8 }, { lat: 37.79, lon: 127.91 }, 0));
    fireEvent.click(screen.getByRole('button', { name: '이 길로 코스 만들기' }));
    await waitFor(() => expect(m.createRouteCourse).toHaveBeenCalled());
    expect(m.createRouteCourse.mock.calls[0]![0]).toMatchObject({ name: '', from: '지도에서 고른 곳', to: '가락재 고개' });
    await waitFor(() => expect(location.hash).toBe('#/course/c-new'));
  });

  it('길찾기가 실패하면 알리고, 지도에서 직접은 예전 방식 그대로', async () => {
    m.findRouteBetween.mockRejectedValueOnce(new Error('통신이 안 돼요. 잠시 뒤 다시 해 주세요'));
    render(<NewCourseScreen />);
    fireEvent.click(screen.getByRole('button', { name: '출발지 지도에서 고르기' }));
    act(() => m.pick!(37.79, 127.91));
    fireEvent.click(screen.getByRole('button', { name: '도착지 지도에서 고르기' }));
    act(() => m.pick!(37.9, 127.8));
    expect(await screen.findByText('통신이 안 돼요. 잠시 뒤 다시 해 주세요')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '이 길로 코스 만들기' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '지도에서 직접' }));
    expect(screen.getByRole('button', { name: '랩 코스' })).toBeInTheDocument();
    expect(screen.getByText(/출발선 위치를 누르세요/)).toBeInTheDocument();
  });
});
