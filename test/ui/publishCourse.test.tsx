// 내 코스 › 모두에게 공개 · 공개 중 · 바꾸기 · 내리기 (설계 2부, 시안 ⑥)
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Course } from '../../src/types/course';

const base: Course = {
  id: 'c1',
  name: '북악 새벽 코스',
  kind: 'loop',
  source: 'auto',
  origin: { lat: 37.88, lon: 127.73 },
  startGate: { lat: 37.88, lon: 127.73, bearingDeg: 0, widthM: 30 },
  finishGate: { lat: 37.88, lon: 127.73, bearingDeg: 0, widthM: 30 },
  centerline: [
    [37.88, 127.73],
    [37.89, 127.73],
  ],
  lengthM: 4100,
  sectorBoundsM: null,
  version: 1,
};
const h = vi.hoisted(() => ({ courses: [] as Course[], calls: [] as string[], signedIn: true, detail: { adds: 23, status: 'open' } as unknown, detailFails: 0 }));
vi.mock('../../src/app/drive', () => ({ loadCourses: vi.fn(async () => h.courses), useDrive: () => ({ courses: h.courses }), prepareWithCourse: vi.fn(), startCoursePreview: vi.fn() }));
vi.mock('../../src/ui/screens/useBestTimes', () => ({ useBestTimes: () => ({}) }));
vi.mock('../../src/app/courses', () => ({
  courseGpxFile: vi.fn(),
  deleteCourse: vi.fn(),
  makeReverseCourse: vi.fn(),
  moveCourseGate: vi.fn(),
  recomputeCourse: vi.fn(),
  refineCourseFromLaps: vi.fn(),
  renameCourse: vi.fn(),
  sectorMarks: () => [],
  sessionsOfCourse: vi.fn(async () => []),
  validLapCount: vi.fn(async () => 0),
}));
vi.mock('../../src/ui/components/PickMap', () => ({ PickMap: () => <div /> }));
vi.mock('../../src/app/account', async (orig) => {
  const real = await orig<typeof import('../../src/app/account')>();
  return { ...real, useAccount: () => ({ ...real.getAccountState(), status: 'ready', kakao: h.signedIn, apple: false }) };
});
vi.mock('../../src/app/sharedCourses', async (orig) => ({
  ...(await orig<typeof import('../../src/app/sharedCourses')>()),
  publishCourse: async (id: string, region: string) => (h.calls.push(`publish ${id} ${region}`), 'pub-1'),
  updatePublished: async (id: string) => void h.calls.push(`update ${id}`),
  unpublish: async (id: string) => void h.calls.push(`unpublish ${id}`),
  fetchSharedDetail: async () => {
    if (h.detailFails) {
      const { ApiError } = await import('../../src/server/api');
      throw new ApiError(h.detailFails, '없음');
    }
    return h.detail;
  },
  forgetPublished: async (id: string) => void h.calls.push(`forget ${id}`),
}));

const { CourseDetailScreen } = await import('../../src/ui/screens/CourseDetailScreen');

beforeEach(() => {
  cleanup();
  h.calls = [];
  h.signedIn = true;
  h.courses = [base];
  h.detail = { adds: 23, status: 'open' };
  h.detailFails = 0;
});

describe('모두에게 공개 (시안 ⑥)', () => {
  it('선 없는 코스·기본 코스·받은 코스엔 단추가 없다', () => {
    for (const c of [{ ...base, centerline: null }, { ...base, builtin: 'key' }, { ...base, shared: { id: 'p', by: 'x' } }]) {
      h.courses = [c as Course];
      const { unmount } = render(<CourseDetailScreen courseId="c1" />);
      expect(screen.queryByRole('button', { name: '모두에게 공개' })).toBeNull();
      unmount();
    }
  });

  it('공개 창: 정보·지역(짐작값)·경고·체크해야 공개 → publishCourse', async () => {
    render(<CourseDetailScreen courseId="c1" />);
    fireEvent.click(screen.getByRole('button', { name: '모두에게 공개' }));
    const dlg = screen.getByRole('dialog', { name: '모두에게 공개할까요?' });
    expect(dlg).toHaveTextContent('북악 새벽 코스');
    expect(dlg).toHaveTextContent('랩 · 4.1km');
    expect(within(dlg).getByRole('combobox', { name: '지역' })).toHaveValue('강원');
    expect(dlg).toHaveTextContent('코스 선·이름·내 닉네임이 모두에게 보여요. 출발·도착이 집이나 회사 근처면 공개하지 마세요.');
    expect(dlg).toHaveTextContent('기록(랩 시간)은 올라가지 않아요. 언제든 공개를 내릴 수 있어요.');
    // 애플 심사 1.2: 불쾌·위험한 콘텐츠는 지운다는 이용 규칙을 공개 전에 보인다
    expect(dlg).toHaveTextContent('위험하거나 불쾌한 코스는 신고되면 숨겨지고, 운영자가 지우고 공개를 막을 수 있어요.');
    const go = within(dlg).getByRole('button', { name: '공개하기' });
    expect(go).toBeDisabled();
    fireEvent.change(within(dlg).getByRole('combobox', { name: '지역' }), { target: { value: '경기' } });
    fireEvent.click(within(dlg).getByRole('checkbox', { name: '일반 도로 법규를 지키며 달릴 수 있는 길이에요' }));
    fireEvent.click(go);
    await waitFor(() => expect(h.calls).toEqual(['publish c1 경기']));
  });

  it('로그인 안 했으면 창 대신 안내', () => {
    h.signedIn = false;
    render(<CourseDetailScreen courseId="c1" />);
    fireEvent.click(screen.getByRole('button', { name: '모두에게 공개' }));
    expect(screen.getByText('공개하려면 카카오나 Apple로 로그인해 주세요')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('공개 중: 받은 수, 선·이름을 고친 뒤에만 "바꾸기" 켜짐, 내리기 확인 → unpublish', async () => {
    h.courses = [{ ...base, publishedId: 'pub-1', publishedVersion: 1, publishedName: base.name }];
    const { unmount } = render(<CourseDetailScreen courseId="c1" />);
    expect(await screen.findByText('공개 중 · 23명 받음')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '공개 코스도 고친 선으로 바꾸기' })).toBeDisabled();
    unmount();
    h.courses = [{ ...base, version: 2, publishedId: 'pub-1', publishedVersion: 1, publishedName: base.name }];
    render(<CourseDetailScreen courseId="c1" />);
    fireEvent.click(screen.getByRole('button', { name: '공개 코스도 고친 선으로 바꾸기' }));
    await waitFor(() => expect(h.calls).toEqual(['update c1']));
    fireEvent.click(screen.getByRole('button', { name: '공개 내리기' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '내리기' }));
    await waitFor(() => expect(h.calls).toEqual(['update c1', 'unpublish c1']));
  });

  it('숨겨졌으면 알리고, 서버에서 내려졌으면(404) 공개 표시를 지운다 (검토 지적)', async () => {
    h.courses = [{ ...base, publishedId: 'pub-1', publishedVersion: 1, publishedName: base.name }];
    h.detail = { adds: 5, status: 'hidden' };
    const { unmount } = render(<CourseDetailScreen courseId="c1" />);
    expect(await screen.findByText('숨겨졌어요 (신고 또는 운영자) · 다른 사람에게는 안 보여요')).toBeInTheDocument();
    unmount();
    h.detailFails = 404;
    render(<CourseDetailScreen courseId="c1" />);
    await waitFor(() => expect(h.calls).toEqual(['forget pub-1']));
  });
});
