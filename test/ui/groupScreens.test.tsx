// 그룹 주행 화면 (설계 docs/superpowers/specs/2026-11-16-group-drive-design.md): 대기실·시작 창·초대 입장·목적지 받기 창·주행 지도 입력
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { GroupState } from '../../src/app/group';

const ROOM = (over: Partial<NonNullable<GroupState['room']>> = {}): NonNullable<GroupState['room']> => ({
  roomId: 'r1',
  code: '482917',
  members: [
    { userId: 'u1', nickname: '나', color: 0, order: 1, host: true },
    { userId: 'u2', nickname: '친구2', color: 1, order: 2, host: false },
    { userId: 'u3', nickname: '친구3', color: 2, order: 3, host: false },
  ],
  gapS: 2,
  dest: null,
  routeVersion: 0,
  ...over,
});
const base = (over: Partial<GroupState> = {}): GroupState => ({ room: ROOM(), me: 'u1', connected: true, points: {}, offer: null, later: null, acceptedVersion: 0, error: null, ...over });
let gs: GroupState = base();
const h = vi.hoisted(() => ({
  calls: [] as string[],
  join: vi.fn(async (_c: string) => {}),
  create: vi.fn(async () => {}),
  share: vi.fn(async () => 'copied' as const),
  phase: 'idle' as string,
  acc: 'ready' as string,
}));

vi.mock('../../src/app/group', async (orig) => {
  const o = await orig<typeof import('../../src/app/group')>();
  return {
    ...o,
    useGroup: () => gs,
    moveGroupMember: async (id: string, d: number) => void h.calls.push(`move ${id} ${d}`),
    setGroupGap: async (s: number) => void h.calls.push(`gap ${s}`),
    leaveGroupRoom: async () => void h.calls.push('leave'),
    joinGroupRoom: (c: string) => h.join(c),
    createGroupRoom: () => h.create(),
    startGroupNav: () => void h.calls.push('nav'),
    acceptRouteOffer: () => void h.calls.push('accept'),
    dismissRouteOffer: () => void h.calls.push('later'),
    reopenRouteOffer: () => void h.calls.push('reopen'),
  };
});
vi.mock('../../src/app/kakaoShare', async (orig) => ({
  ...(await orig<typeof import('../../src/app/kakaoShare')>()),
  shareInvite: () => h.share(),
}));
vi.mock('../../src/app/drive', async (orig) => ({
  ...(await orig<typeof import('../../src/app/drive')>()),
  useDrive: () => ({ phase: h.phase, replay: null, courses: [] }),
  getDriveState: () => ({ phase: h.phase }),
  beginPrepare: () => {
    h.calls.push('prepare');
    h.phase = 'preparing';
  },
  chooseCourse: (c: unknown) => void h.calls.push(`course ${String(c)}`),
}));
vi.mock('../../src/app/account', async (orig) => ({
  ...(await orig<typeof import('../../src/app/account')>()),
  useAccount: () => ({ status: h.acc, onboarded: true }),
}));

const { GroupScreen } = await import('../../src/ui/screens/GroupScreen');
const { GroupSheet } = await import('../../src/ui/components/GroupSheet');
const { JoinScreen } = await import('../../src/ui/screens/JoinScreen');
const { RouteOfferSheet } = await import('../../src/ui/components/RouteOfferSheet');
const { groupDriveInputs } = await import('../../src/ui/screens/DriveScreen');
const { rememberPendingJoin, takePendingJoin } = await import('../../src/app/pendingJoin');

beforeEach(() => {
  cleanup();
  localStorage.clear();
  gs = base();
  h.calls = [];
  h.phase = 'idle';
  h.acc = 'ready';
  h.join.mockReset().mockResolvedValue(undefined);
  h.create.mockReset().mockResolvedValue(undefined);
  window.location.hash = '#/group';
});

describe('대기실 (방장)', () => {
  it('shows the room code, members in order with host badge, and host controls', () => {
    render(<GroupScreen />);
    expect(screen.getByText('482 917')).toBeTruthy();
    expect(screen.getByText('나 (나)')).toBeTruthy();
    expect(screen.getByText('방장')).toBeTruthy();
    // 맨 앞은 앞으로 못 가고 맨 뒤는 뒤로 못 간다
    expect((screen.getByRole('button', { name: '나 앞으로' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '친구3 뒤로' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('2.0초')).toBeTruthy();
    expect(screen.getByRole('link', { name: '정하기' }).getAttribute('href')).toBe('#/group/destination');
  });

  it('moves a member and changes the gap in 0.5 s steps within 1–10 s', async () => {
    render(<GroupScreen />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '친구2 앞으로' })));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '차 간격 늘리기' })));
    expect(h.calls).toEqual(['move u2 -1', 'gap 2.5']);
    cleanup();
    gs = base({ room: ROOM({ gapS: 1 }) });
    render(<GroupScreen />);
    expect((screen.getByRole('button', { name: '차 간격 줄이기' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('invite falls back to copying the link and says so', async () => {
    render(<GroupScreen />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '초대 보내기' })));
    expect(screen.getByText('초대 링크를 복사했어요. 카톡에 붙여 넣어 보내 주세요')).toBeTruthy();
  });

  it('출발 준비 opens prepare as a recorded drive and turns on the received route', () => {
    render(<GroupScreen />);
    fireEvent.click(screen.getByRole('button', { name: '출발 준비' }));
    expect(h.calls).toEqual(['prepare', 'course null', 'nav']);
  });

  it('leaving asks for a second tap', async () => {
    render(<GroupScreen />);
    fireEvent.click(screen.getByRole('button', { name: '방 나가기' }));
    expect(h.calls).toEqual([]);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '한 번 더 누르면 방에서 나가요' })));
    expect(h.calls).toEqual(['leave']);
    expect(window.location.hash).toBe('#/');
  });

  it('while driving shows a way back instead of 출발 준비', () => {
    h.phase = 'driving';
    render(<GroupScreen />);
    expect(screen.queryByRole('button', { name: '출발 준비' })).toBeNull();
    expect(screen.getByRole('link', { name: '주행으로 돌아가기' }).getAttribute('href')).toBe('#/drive');
  });
});

describe('대기실 (참가자)', () => {
  it('has no host controls; can re-open a postponed destination', () => {
    gs = base({ me: 'u2', room: ROOM({ dest: { name: '만항재', lat: 37, lon: 128 }, routeVersion: 1 }), later: { version: 1, dest: { name: '만항재', lat: 37, lon: 128 }, route: { points: [[37, 128], [37.1, 128.1]], distanceM: 1000, durationS: 120, destName: null } } });
    render(<GroupScreen />);
    expect(screen.queryByRole('button', { name: '친구2 앞으로' })).toBeNull();
    expect(screen.queryByRole('button', { name: '차 간격 늘리기' })).toBeNull();
    expect(screen.getByText('아직 이 경로를 받지 않았어요')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '경로 받기' }));
    expect(h.calls).toEqual(['reopen']);
  });
});

describe('시작 창', () => {
  it('joins with a 6-digit code and opens the room', async () => {
    gs = base({ room: null });
    const onClose = vi.fn();
    render(<GroupSheet onClose={onClose} />);
    const input = screen.getByRole('textbox', { name: '방 코드 6자리' });
    fireEvent.change(input, { target: { value: '482-91a7' } });
    expect((input as HTMLInputElement).value).toBe('482917');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '입장' })));
    expect(h.join).toHaveBeenCalledWith('482917');
    expect(onClose).toHaveBeenCalled();
    expect(window.location.hash).toBe('#/group');
  });

  it('shows the server message when the room is missing', async () => {
    const { ApiError } = await import('../../src/server/api');
    h.join.mockRejectedValue(new ApiError(404, '방을 찾지 못했어요'));
    render(<GroupSheet onClose={() => {}} />);
    fireEvent.change(screen.getByRole('textbox', { name: '방 코드 6자리' }), { target: { value: '111111' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '입장' })));
    expect(screen.getByRole('alert').textContent).toBe('방을 찾지 못했어요');
  });
});

describe('초대 링크 #/join/{코드}', () => {
  it('joins right away when the account is ready', async () => {
    gs = base({ room: null });
    await act(async () => {
      render(<JoinScreen code="482917" />);
    });
    expect(h.join).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe('#/group');
  });

  it('asks before leaving another room', async () => {
    gs = base({ room: ROOM({ code: '111111' }) });
    await act(async () => {
      render(<JoinScreen code="482917" />);
    });
    expect(h.join).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '나가고 이 방으로' })));
    expect(h.calls).toEqual(['leave']);
    expect(h.join).toHaveBeenCalledWith('482917');
  });

  it('keeps the code across the welcome screen for 30 minutes', () => {
    rememberPendingJoin('482917', 1000);
    expect(takePendingJoin(1000 + 29 * 60_000)).toBe('482917');
    expect(takePendingJoin(1000)).toBeNull();
    rememberPendingJoin('482917', 1000);
    expect(takePendingJoin(1000 + 31 * 60_000)).toBeNull();
  });
});

describe('목적지 받기 창', () => {
  it('shows the destination and accepts or postpones', () => {
    gs = base({ me: 'u2', offer: { version: 1, dest: { name: '만항재', lat: 37, lon: 128 }, route: { points: [[37, 128], [37.1, 128.1]], distanceM: 34200, durationS: 3120, destName: null } } });
    render(<RouteOfferSheet />);
    expect(screen.getByText('만항재')).toBeTruthy();
    expect(screen.getByText(/34\.2 ?km · 52분/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '이 경로로 진행' }));
    fireEvent.click(screen.getByRole('button', { name: '나중에' }));
    expect(h.calls).toEqual(['accept', 'later']);
  });

  it('renders nothing without an offer', () => {
    const { container } = render(<RouteOfferSheet />);
    expect(container.innerHTML).toBe('');
  });
});

describe('주행 지도 입력', () => {
  it('front car = the one right before me; others as colored numbered dots; order strip', () => {
    const now = Date.now();
    gs = base({
      me: 'u2',
      points: {
        u1: [{ t: now, lat: 37.001, lon: 127, speed: 20, heading: 0, hAcc: 5 }],
        u3: [{ t: now, lat: 36.999, lon: 127, speed: 20, heading: 0, hAcc: 5 }],
      },
    });
    const r = groupDriveInputs(gs, { lat: 37, lon: 127 })!;
    expect(r.follow.friendId).toBe('group:u1');
    expect(r.follow.points).toHaveLength(1);
    expect(r.frontStyle).toEqual({ color: '#5ac8fa', no: 1, title: '앞 차 · 1 나' });
    expect(r.cars).toHaveLength(1);
    expect(r.cars[0]).toMatchObject({ label: '친구3', color: '#2ecc71', no: 3 });
    expect(r.cars[0]!.y).toBeLessThan(0);
    expect(r.order.map((m) => `${m.no}${m.label}${m.me ? '*' : ''}`)).toEqual(['1나', '2나*', '3친구3']);
  });

  it('first car has no front car; stale positions are not drawn', () => {
    gs = base({ points: { u3: [{ t: Date.now() - 120_000, lat: 37, lon: 127, speed: null, heading: null, hAcc: null }] } });
    const r = groupDriveInputs(gs, { lat: 37, lon: 127 })!;
    expect(r.follow.friendId).toBeNull();
    expect(r.frontStyle).toBeNull();
    expect(r.cars).toHaveLength(0);
    expect(groupDriveInputs(base({ room: null }), null)).toBeNull();
  });
});
