import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GpsIcon } from '../../src/ui/components/GpsIcon';
import type { Course } from '../../src/types/course';

const course: Course = {
  id: 'c1',
  name: '내 와인딩',
  kind: 'point_to_point',
  source: 'auto',
  origin: { lat: 37.5, lon: 127 },
  startGate: { lat: 37.5, lon: 127, bearingDeg: 0, widthM: 30 },
  finishGate: { lat: 37.51, lon: 127, bearingDeg: 0, widthM: 30 },
  centerline: [
    [37.5, 127],
    [37.51, 127],
  ],
  lengthM: 1112,
  sectorBoundsM: [370, 741],
  version: 1,
};
let courses: Course[] = [];
const deleteCourse = vi.fn(async () => 2);
vi.mock('../../src/app/drive', () => ({ loadCourses: vi.fn(async () => courses), useDrive: () => ({ courses }) }));
vi.mock('../../src/ui/screens/useBestTimes', () => ({ useBestTimes: () => ({}) }));
vi.mock('../../src/app/courses', () => ({
  courseGpxFile: vi.fn(),
  deleteCourse,
  moveCourseGate: vi.fn(),
  recomputeCourse: vi.fn(),
  refineCourseFromLaps: vi.fn(),
  renameCourse: vi.fn(),
  sectorMarks: () => [],
  sessionsOfCourse: vi.fn(async () => [{}, {}]),
  validLapCount: vi.fn(async () => 0),
}));

const { CourseDetailScreen } = await import('../../src/ui/screens/CourseDetailScreen');

describe('코스 지우기 (사용자 요청)', () => {
  it('내 코스: 확인 창에 함께 지워질 기록 수, 지우면 코스 목록으로', async () => {
    courses = [course];
    render(<CourseDetailScreen courseId="c1" />);
    fireEvent.click(screen.getByRole('button', { name: '코스 지우기' }));
    const dialog = await screen.findByRole('dialog', { name: '코스를 지울까요?' });
    await waitFor(() => expect(dialog.textContent).toContain('내 와인딩 코스와 이 코스로 달린 기록 2개를 폰과 서버에서 모두 지워요'));
    fireEvent.click(screen.getByRole('button', { name: '지우기' }));
    await waitFor(() => expect(deleteCourse).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(window.location.hash).toBe('#/courses'));
  });

  it('기본 코스는 지우기 버튼이 없다', () => {
    courses = [{ ...course, builtin: 'baehuryeong', name: '배후령' }];
    render(<CourseDetailScreen courseId="c1" />);
    expect(screen.queryByRole('button', { name: '코스 지우기' })).toBeNull();
    expect(screen.getByText(/기본 코스/)).toBeInTheDocument();
  });
});

describe('내비로 가기 (사용자 요청)', () => {
  it('편도: 출발점·도착점마다 네이버 지도(바로 길안내)·카카오맵(자동차 길찾기)', () => {
    courses = [course];
    render(<CourseDetailScreen courseId="c1" />);
    const nav = screen.getByRole('region', { name: '내비로 가기' });
    const start = screen.getByRole('link', { name: '출발점까지 네이버 지도로 길안내' }).getAttribute('href')!;
    expect(start).toMatch(/^nmap:\/\/navigation\?dlat=37\.500000&dlng=127\.000000&dname=/);
    expect(decodeURIComponent(start)).toContain('dname=내 와인딩 출발');
    expect(screen.getByRole('link', { name: '도착점까지 카카오맵으로 길안내' }).getAttribute('href')).toBe('kakaomap://route?ep=37.510000,127.000000&by=CAR');
    expect(nav.querySelectorAll('a.btn')).toHaveLength(4);
  });

  it('랩 코스는 출발·도착점 한 줄', () => {
    courses = [{ ...course, kind: 'loop', finishGate: course.startGate }];
    render(<CourseDetailScreen courseId="c1" />);
    expect(screen.getByRole('region', { name: '내비로 가기' }).querySelectorAll('a.btn')).toHaveLength(2);
    expect(screen.getByRole('link', { name: '출발·도착점까지 네이버 지도로 길안내' })).toBeInTheDocument();
  });
});

describe('코스 상세 지도 모양 (사용자 요청 시안 2)', () => {
  it('코스 선, 출발선·도착선, 구간 경계, 핀(맨 위에 그리게 마지막)', async () => {
    const { courseShapes } = await import('../../src/ui/screens/CourseDetailScreen');
    const { shapes } = courseShapes(course, null);
    expect(shapes.map((x) => x.kind)).toEqual(['route', 'gate', 'gate', 'pin', 'pin']);
    expect(shapes.filter((x) => x.kind === 'pin').map((x) => (x.kind === 'pin' ? [x.which, x.text] : null))).toEqual([
      ['start', '출발'],
      ['finish', '도착'],
    ]);
  });
});

describe('GPS 아이콘 (메인 지도)', () => {
  it('누를 수 있으면 "내 위치로" 버튼, 색은 GPS 상태 그대로 (약하면 빨강)', () => {
    const go = vi.fn();
    render(<GpsIcon state="weak" hAcc={42} onClick={go} />);
    const b = screen.getByRole('button', { name: '내 위치로 (GPS 약함 · 오차 42m)' });
    expect(b.getAttribute('data-gps')).toBe('weak');
    expect(b.querySelector('[stroke="#FF5B4F"], [color="#FF5B4F"], [fill="#FF5B4F"]') ?? b.innerHTML.includes('#FF5B4F')).toBeTruthy();
    fireEvent.click(b);
    expect(go).toHaveBeenCalled();
  });

  it('누를 수 없으면 그림 (주행 화면)', () => {
    render(<GpsIcon state="good" />);
    expect(screen.getByRole('img', { name: 'GPS 좋음' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
