// 팀 방 코스 화면 (설계 3부, 시안 ⑨⑩): 대기실 "이번 주행" 칸, 방장 코스 고르기, 팀원 코스 받기 창
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { GroupState } from '../../src/app/group';
import type { Course } from '../../src/types/course';

const G = (lat: number) => ({ lat, lon: 127.5, bearingDeg: 0, widthM: 30 });
const course = (id: string, p: Partial<Course> = {}): Course => ({
  id,
  name: `코스 ${id}`,
  kind: 'point_to_point',
  source: 'auto',
  origin: { lat: 37.5, lon: 127.5 },
  startGate: G(37.5),
  finishGate: G(37.57),
  centerline: [
    [37.5, 127.5],
    [37.57, 127.5],
  ],
  lengthM: 7800,
  sectorBoundsM: null,
  version: 1,
  ...p,
});
const ROOM = (over: Partial<NonNullable<GroupState['room']>> = {}): NonNullable<GroupState['room']> => ({
  roomId: 'r1',
  code: '',
  teamId: 't1',
  teamName: '북악 새벽팀',
  members: [
    { userId: 'u1', nickname: '디고', color: 0, order: 1, host: true },
    { userId: 'u2', nickname: '바람', color: 1, order: 2, host: false },
  ],
  gapS: 2,
  dest: { name: '유명산 업힐 · 출발점', lat: 37.5, lon: 127.5 },
  course: { name: '유명산 업힐', kind: 'point_to_point', lengthM: 7800, key: 's:p1' },
  routeVersion: 1,
  ...over,
});
const base = (over: Partial<GroupState> = {}): GroupState => ({ room: ROOM(), me: 'u1', connected: true, offer: null, later: null, acceptedVersion: 1, error: null, ...over });
let gs: GroupState = base();
const h = vi.hoisted(() => ({
  calls: [] as string[],
  phase: 'idle' as string,
  courses: [] as Course[],
  accepted: null as unknown,
  shareFails: '' as string,
}));

vi.mock('../../src/app/group', async (orig) => ({
  ...(await orig<typeof import('../../src/app/group')>()),
  useGroup: () => gs,
  startGroupNav: () => void h.calls.push('nav'),
  acceptRouteOffer: async () => void h.calls.push('accept'),
  dismissRouteOffer: () => void h.calls.push('later'),
  reopenRouteOffer: () => void h.calls.push('reopen'),
  acceptedCourse: () => h.accepted,
  hasPendingRoute: () => true,
  shareGroupCourse: async (c: Course) => {
    if (h.shareFails) throw new Error(h.shareFails);
    h.calls.push(`share ${c.id}`);
  },
}));
vi.mock('../../src/app/teams', async (orig) => ({
  ...(await orig<typeof import('../../src/app/teams')>()),
  useTeams: () => ({ loaded: true, teams: [] }),
  loadTeams: async () => [],
}));
vi.mock('../../src/app/drive', async (orig) => ({
  ...(await orig<typeof import('../../src/app/drive')>()),
  useDrive: () => ({ phase: h.phase, replay: null, courses: h.courses }),
  loadCourses: async () => h.courses,
  getDriveState: () => ({ phase: h.phase }),
  beginPrepare: () => {
    h.calls.push('prepare');
    h.phase = 'preparing';
  },
  chooseCourse: (c: unknown) => void h.calls.push(`course ${String(c)}`),
}));
vi.mock('../../src/ui/screens/useBestTimes', () => ({ useBestTimes: () => ({}) }));

const { GroupScreen } = await import('../../src/ui/screens/GroupScreen');
const { GroupCourseScreen } = await import('../../src/ui/screens/GroupCourseScreen');
const { RouteOfferSheet } = await import('../../src/ui/components/RouteOfferSheet');

beforeEach(() => {
  cleanup();
  localStorage.clear();
  gs = base();
  h.calls = [];
  h.phase = 'idle';
  h.accepted = null;
  h.shareFails = '';
  h.courses = [course('b1', { name: '북악 스카이웨이', builtin: 'bukak' }), course('s1', { name: '유명산 업힐', source: 'shared', shared: { id: 'p1', by: '바람' } }), course('m1', { name: '내 새벽 코스', kind: 'loop', lengthM: 4100 })];
  window.location.hash = '#/group';
});

describe('대기실 › 이번 주행 · 방장이 정해요 (시안 ⑨)', () => {
  it('방장, 코스가 정해짐: [목적지|코스] 중 코스 · 이름 · 안내 · "코스 바꾸기", 목적지를 누르면 목적지 정하기로', () => {
    render(<GroupScreen />);
    const card = screen.getByRole('region', { name: '이번 주행 · 방장이 정해요' });
    const seg = within(card).getByRole('group', { name: '목적지 또는 코스' });
    expect(within(seg).getByRole('button', { name: '코스' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(seg).getByRole('button', { name: '목적지' })).toHaveAttribute('aria-pressed', 'false');
    expect(card).toHaveTextContent('유명산 업힐');
    expect(card).toHaveTextContent('편도 · 7.8km · 출발하면 각자 출발점까지 안내, 출발선부터 기록');
    expect(within(card).getByRole('link', { name: '코스 바꾸기' })).toHaveAttribute('href', '#/group/course');
    fireEvent.click(within(seg).getByRole('button', { name: '목적지' }));
    expect(window.location.hash).toBe('#/group/destination');
  });

  it('방장, 아무것도 안 정함: 목적지가 눌린 상태, 코스를 누르면 코스 고르기로', () => {
    gs = base({ room: ROOM({ dest: null, course: null, routeVersion: 0 }), acceptedVersion: 0 });
    render(<GroupScreen />);
    const seg = screen.getByRole('group', { name: '목적지 또는 코스' });
    expect(within(seg).getByRole('button', { name: '목적지' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(seg).getByRole('button', { name: '코스' }));
    expect(window.location.hash).toBe('#/group/course');
  });

  it('팀원: 칸은 보기만, 아직 안 받았으면 알리고 "코스 받기"로 다시 묻는다', () => {
    const offer = { version: 2, dest: ROOM().dest!, route: { points: [], distanceM: 0, durationS: 0, destName: null } };
    gs = base({ me: 'u2', room: ROOM({ routeVersion: 2 }), acceptedVersion: 1, later: offer });
    render(<GroupScreen />);
    const card = screen.getByRole('region', { name: '이번 주행 · 방장이 정해요' });
    for (const b of within(card).getAllByRole('button').filter((x) => ['목적지', '코스'].includes(x.textContent ?? ''))) expect(b).toBeDisabled();
    expect(within(card).queryByRole('link', { name: '코스 바꾸기' })).toBeNull();
    expect(card).toHaveTextContent('아직 이 코스를 받지 않았어요');
    fireEvent.click(within(card).getByRole('button', { name: '코스 받기' }));
    expect(h.calls).toEqual(['reopen']);
  });

  it('출발 준비: 받은 코스가 있으면 "코스 없이"로 고르지 않는다 (출발 때 그 코스)', () => {
    h.accepted = h.courses[1];
    render(<GroupScreen />);
    fireEvent.click(screen.getByRole('button', { name: '출발 준비' }));
    expect(h.calls).toEqual(['prepare', 'nav']);
  });
});

describe('방장 › 코스 고르기 (#/group/course)', () => {
  it('분류 칩 다섯 개, 폰의 코스 목록 — 줄을 누르면 방에 보내고 대기실로', async () => {
    render(<GroupCourseScreen />);
    const chips = screen.getByRole('group', { name: '코스 분류' });
    expect(within(chips).getAllByRole('button').map((b) => b.textContent)).toEqual(['전체', '기본 코스', '모두의 코스', '★즐겨찾기', '내 코스']);
    const list = screen.getByRole('list', { name: '팀 방에 정할 코스' });
    expect(within(list).getAllByRole('button').map((b) => b.querySelector('strong')!.textContent)).toEqual(['북악 스카이웨이', '유명산 업힐', '내 새벽 코스']);
    fireEvent.click(within(chips).getByRole('button', { name: '기본 코스' }));
    expect(within(list).getAllByRole('button')).toHaveLength(1);
    fireEvent.click(within(chips).getByRole('button', { name: '전체' }));
    const row = within(list).getByRole('button', { name: /내 새벽 코스/ });
    expect(row).toHaveTextContent('랩 · 4.1km');
    fireEvent.click(row);
    await waitFor(() => expect(h.calls).toEqual(['share m1']));
    expect(window.location.hash).toBe('#/group');
  });

  it('보내지 못하면 알리고 그대로', async () => {
    h.shareFails = '100 km 넘는 코스는 팀 방에 정할 수 없어요';
    window.location.hash = '#/group/course';
    render(<GroupCourseScreen />);
    fireEvent.click(screen.getByRole('button', { name: /북악 스카이웨이/ }));
    expect(await screen.findByText('100 km 넘는 코스는 팀 방에 정할 수 없어요')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/group/course');
  });

  it('방장이 아니면 고를 수 없다고 알린다', () => {
    gs = base({ me: 'u2' });
    render(<GroupCourseScreen />);
    expect(screen.getByText('방장만 코스를 정할 수 있어요')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: '팀 방에 정할 코스' })).toBeNull();
  });
});

describe('팀원 › 코스 받기 창 (시안 ⑩)', () => {
  const offer = (p: Record<string, unknown> = {}) => ({
    version: 2,
    dest: ROOM().dest!,
    route: { points: [[37.5, 127.5], [37.50001, 127.5]] as Array<[number, number]>, distanceM: 0, durationS: 0, destName: null },
    course: { name: '유명산 업힐', kind: 'point_to_point' as const, lengthM: 7800, key: 's:p1', startGate: G(37.5), finishGate: G(37.57), sectorBoundsM: null, line: [[37.5, 127.5], [37.53, 127.52], [37.57, 127.5]] as Array<[number, number]> },
    ...p,
  });

  it('제목·작은 그림·이름·문구, "이 코스로 진행"·"나중에"', () => {
    gs = base({ me: 'u2', offer: offer() });
    render(<RouteOfferSheet />);
    const dlg = screen.getByRole('dialog', { name: '방장이 코스를 정했어요' });
    expect(dlg.querySelector('.course-thumb svg path')).not.toBeNull();
    expect(dlg).toHaveTextContent('유명산 업힐');
    expect(dlg).toHaveTextContent('편도 · 7.8km · 모두 같은 출발선·도착선');
    expect(dlg).toHaveTextContent('받으면 내 폰에 담기고, 출발하면 지금 위치에서 출발점까지 안내해요');
    fireEvent.click(within(dlg).getByRole('button', { name: '이 코스로 진행' }));
    fireEvent.click(within(dlg).getByRole('button', { name: '나중에' }));
    expect(h.calls).toEqual(['accept', 'later']);
  });

  it('담지 못했으면 까닭을 보인다', () => {
    gs = base({ me: 'u2', offer: offer({ error: '내 코스가 200개예요. 안 쓰는 코스를 지운 뒤 다시 해 주세요' }) });
    render(<RouteOfferSheet />);
    expect(screen.getByRole('dialog')).toHaveTextContent('내 코스가 200개예요. 안 쓰는 코스를 지운 뒤 다시 해 주세요');
  });
});
