// 코스 탭 "모두의 코스" 목록·정렬, 공개 코스 상세·신고·안 보기 (설계 2부, 시안 ⑦⑧)
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SharedDetail, SharedSummary } from '../../src/types/shared';

const h = vi.hoisted(() => ({
  list: [] as unknown[],
  detail: null as unknown,
  calls: [] as string[],
  signedIn: true,
  onPhone: null as unknown,
}));
const gate = (lat: number) => ({ lat, lon: 127.5, bearingDeg: 0, widthM: 30 });
const line = (n: number): Array<[number, number]> => Array.from({ length: n }, (_, i) => [37.5 + i * 0.0001, 127.5] as [number, number]);
const summary = (id: string, p: Partial<SharedSummary> = {}): SharedSummary => ({ id, name: `코스 ${id}`, region: '경기', kind: 'point_to_point', lengthM: 7800, start: { lat: 37.5, lon: 127.5 }, thumb: line(5), adds: 51, by: '바람', byId: 'owner-1', createdAt: 1, mine: false, ...p });
const detail = (id: string, p: Partial<SharedDetail> = {}): SharedDetail => ({ ...summary(id), line: line(100), startGate: gate(37.5), finishGate: gate(37.51), sectorBoundsM: null, status: 'open', ...p });

vi.mock('../../src/app/sharedCourses', async (orig) => ({
  ...(await orig<typeof import('../../src/app/sharedCourses')>()),
  fetchShared: async () => h.list,
  fetchSharedDetail: async () => h.detail,
  sharedOnPhone: async () => h.onPhone,
  addSharedToPhone: async (id: string) => {
    h.calls.push(`add ${id}`);
    return { id: 'local-1', name: 'x', shared: { id, by: '바람' } };
  },
  reportShared: async (id: string, reason: string) => void h.calls.push(`report ${id} ${reason}`),
  blockUser: async (u: string) => void h.calls.push(`block ${u}`),
  unpublishById: async (id: string) => void h.calls.push(`unpublish ${id}`),
}));
vi.mock('../../src/app/account', async (orig) => {
  const real = await orig<typeof import('../../src/app/account')>();
  return { ...real, useAccount: () => ({ ...real.getAccountState(), status: 'ready', kakao: h.signedIn, apple: false }) };
});
vi.mock('../../src/app/drive', async (orig) => ({
  ...(await orig<typeof import('../../src/app/drive')>()),
  beginPrepare: () => void h.calls.push('prepare'),
  chooseCourse: (c: { id: string }) => void h.calls.push(`choose ${c.id}`),
}));

const { CoursesScreen } = await import('../../src/ui/screens/CoursesScreen');
const { SharedCourseScreen } = await import('../../src/ui/screens/SharedCourseScreen');
const { updateSettings, DEFAULT_SETTINGS } = await import('../../src/app/settings');

beforeEach(() => {
  cleanup();
  h.list = [summary('a', { name: '유명산 업힐', adds: 51 }), summary('b', { name: '미시령 옛길', region: '강원', adds: 8, by: 'R1' })];
  h.detail = detail('a', { name: '유명산 업힐' });
  h.calls = [];
  h.signedIn = true;
  h.onPhone = null;
  window.location.hash = '#/courses';
  updateSettings({ ...DEFAULT_SETTINGS, courseFilter: 'all' });
});

describe('코스 탭 › 모두의 코스 (시안 ⑦)', () => {
  it('칩 "모두의 코스" → 정렬 칩 3개, 줄에 이름·종류·길이·지역·올린 사람·받은 수', async () => {
    render(<CoursesScreen />);
    fireEvent.click(screen.getByRole('button', { name: '모두의 코스' }));
    const sorts = screen.getByRole('group', { name: '모두의 코스 정렬' });
    expect(within(sorts).getAllByRole('button').map((b) => b.textContent)).toEqual(['가까운 순', '많이 받은 순', '새로 올라온 순']);
    fireEvent.click(within(sorts).getByRole('button', { name: '많이 받은 순' }));
    const rows = await screen.findAllByRole('link', { name: /업힐|옛길/ });
    expect(rows[0]).toHaveTextContent('유명산 업힐');
    expect(rows[0]).toHaveTextContent('편도 · 7.8km · 경기');
    expect(rows[0]).toHaveTextContent('올린 사람 바람 · 51명 받음');
    expect(rows[0]).toHaveAttribute('href', '#/shared/a');
  });
});

describe('공개 코스 상세 (시안 ⑧)', () => {
  it('이 코스로 주행: 주행 준비를 먼저 열고(탭 안에서) 받은 코스를 고른다', async () => {
    render(<SharedCourseScreen id="a" />);
    fireEvent.click(await screen.findByRole('button', { name: '이 코스로 주행' }));
    await waitFor(() => expect(h.calls).toEqual(['prepare', 'add a', 'choose local-1']));
  });

  it('내 코스에 담기 → "내 코스에 있어요", 이미 있으면 처음부터 그 코스로 가는 링크', async () => {
    const { unmount } = render(<SharedCourseScreen id="a" />);
    fireEvent.click(await screen.findByRole('button', { name: '내 코스에 담기' }));
    expect(await screen.findByRole('link', { name: '내 코스에 있어요 ›' })).toHaveAttribute('href', '#/course/local-1');
    unmount();
    h.onPhone = { id: 'have-1' };
    render(<SharedCourseScreen id="a" />);
    expect(await screen.findByRole('link', { name: '내 코스에 있어요 ›' })).toHaveAttribute('href', '#/course/have-1');
  });

  it('신고 창 → 이유 고르고 신고, 안내 문구', async () => {
    render(<SharedCourseScreen id="a" />);
    fireEvent.click(await screen.findByRole('button', { name: '신고' }));
    const dlg = screen.getByRole('dialog', { name: '이 코스를 신고할까요?' });
    expect(within(dlg).getAllByRole('radio').map((r) => r.parentElement!.textContent)).toEqual(['위험한 길', '불법 주행 유도', '이름이 불쾌함', '기타']);
    fireEvent.click(within(dlg).getByRole('radio', { name: '위험한 길' }));
    fireEvent.click(within(dlg).getByRole('button', { name: '신고하기' }));
    expect(await screen.findByText('신고했어요. 3명이 신고하면 바로 숨겨지고 운영자가 확인해요')).toBeInTheDocument();
    expect(h.calls).toEqual(['report a danger']);
  });

  it('로그인 안 한 계정은 신고 대신 안내', async () => {
    h.signedIn = false;
    render(<SharedCourseScreen id="a" />);
    fireEvent.click(await screen.findByRole('button', { name: '신고' }));
    expect(screen.getByText('신고하려면 카카오나 Apple로 로그인해 주세요')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('이 사람 코스 안 보기 → 확인 → 차단하고 목록으로', async () => {
    render(<SharedCourseScreen id="a" />);
    fireEvent.click(await screen.findByRole('button', { name: '이 사람 코스 안 보기' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '안 보기' }));
    await waitFor(() => expect(h.calls).toEqual(['block owner-1']));
    expect(window.location.hash).toBe('#/courses');
  });

  it('내가 올린 코스: 신고·안 보기 대신 공개 내리기, 숨겨졌으면 안내', async () => {
    h.detail = detail('a', { mine: true, status: 'hidden' });
    render(<SharedCourseScreen id="a" />);
    expect(await screen.findByText('신고로 숨겨졌어요. 운영자가 확인하고 있어요')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '신고' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '공개 내리기' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '내리기' }));
    await waitFor(() => expect(h.calls).toEqual(['unpublish a']));
  });
});
