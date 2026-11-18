// 팀·팀 주행·프로필 사진 화면 (설계 docs/superpowers/specs/2026-11-18-team-drive-design.md, 시안 6장 + 프사 시안)
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { GroupState } from '../../src/app/group';
import type { Team, TeamsState } from '../../src/app/teams';
import type { Friend } from '../../src/app/friends';

const T = (id: string, over: Partial<Team> = {}): Team => ({
  id,
  name: `팀${id}`,
  ownerId: 'me',
  members: [
    { userId: 'me', nickname: '세영', avatar: null },
    { userId: 'b', nickname: '민수', avatar: 'ab'.repeat(16) },
  ],
  gapS: 2,
  drive: null,
  ...over,
});
const F = (id: string, nickname: string, over: Partial<Friend> = {}): Friend => ({ userId: id, nickname, since: '', sharing: false, avatar: null, full: false, ...over });

const h = vi.hoisted(() => ({
  teams: { teams: [], loaded: true } as TeamsState,
  friends: [] as Friend[],
  group: { room: null, me: 'me', connected: true, offer: null, later: null, acceptedVersion: 0, error: null } as GroupState,
  calls: [] as string[],
  openFail: null as Error | null,
  myAvatar: null as string | null | undefined,
  loadGate: null as Promise<void> | null,
  loadFail: null as Error | null,
}));
vi.mock('../../src/app/teams', async (orig) => ({
  ...(await orig<typeof import('../../src/app/teams')>()),
  useTeams: () => h.teams,
  getTeams: () => h.teams,
  loadTeams: async () => {
    h.calls.push('loadTeams');
    if (h.loadGate) await h.loadGate;
    if (h.loadFail) throw h.loadFail;
  },
  openTeamDrive: async (id: string) => {
    h.calls.push(`drive ${id}`);
    if (h.openFail) throw h.openFail;
  },
  createTeam: async (name: string, ids: string[]) => {
    h.calls.push(`create ${name} ${ids.join(',')}`);
    return T('new', { name });
  },
  loadTeam: async (id: string) => void h.calls.push(`loadTeam ${id}`),
  updateTeam: async (id: string, p: unknown) => {
    h.calls.push(`update ${id} ${JSON.stringify(p)}`);
    return T(id);
  },
  deleteTeam: async (id: string) => void h.calls.push(`delete ${id}`),
  leaveTeam: async (id: string) => void h.calls.push(`leave ${id}`),
  watchTeams: () => () => {},
}));
vi.mock('../../src/app/friends', async (orig) => ({
  ...(await orig<typeof import('../../src/app/friends')>()),
  useFriends: () => ({ code: 'K7QX29MD', friends: h.friends, loaded: true, busy: false, error: null, notice: null, sharing: false }),
  loadFriends: async () => void h.calls.push('loadFriends'),
  addFriendByCode: async (c: string) => {
    h.calls.push(`addFriend ${c}`);
    return true;
  },
}));
vi.mock('../../src/app/group', async (orig) => ({
  ...(await orig<typeof import('../../src/app/group')>()),
  useGroup: () => h.group,
  leaveGroupRoom: async () => void h.calls.push('leaveRoom'),
}));
vi.mock('../../src/app/account', async (orig) => ({
  ...(await orig<typeof import('../../src/app/account')>()),
  useAccount: () => ({ status: 'ready', onboarded: true, userId: 'me', nickname: '세영' }),
  getAuth: () => ({ userId: 'me', token: 'tok' }),
}));
vi.mock('../../src/app/avatar', async (orig) => ({
  ...(await orig<typeof import('../../src/app/avatar')>()),
  useMyAvatar: () => h.myAvatar,
  loadMyAvatar: async () => void h.calls.push('loadMyAvatar'),
  uploadAvatar: async (f: File) => {
    h.calls.push(`upload ${f.name}`);
    return 'cd'.repeat(16);
  },
  removeAvatar: async () => void h.calls.push('removeAvatar'),
}));
vi.mock('../../src/server/config', async (orig) => ({ ...(await orig<typeof import('../../src/server/config')>()), serverConfig: { apiUrl: 'https://api.test' }, accountEnabled: () => true }));

const { DriveChoiceSheet } = await import('../../src/ui/components/DriveChoiceSheet');
const { TeamSheet } = await import('../../src/ui/components/TeamSheet');
const { TeamEditScreen } = await import('../../src/ui/screens/TeamEditScreen');
const { GroupScreen } = await import('../../src/ui/screens/GroupScreen');
const { Avatar } = await import('../../src/ui/components/Avatar');
const { TeamNotice } = await import('../../src/ui/components/TeamNotice');
const { FriendInviteScreen } = await import('../../src/ui/screens/FriendInviteScreen');
const { rememberPendingLink, takePendingLink } = await import('../../src/app/pendingJoin');
const { ProfilePhoto } = await import('../../src/ui/components/ProfilePhoto');
const { TeamsSection } = await import('../../src/ui/components/TeamsSection');

const flush = () => act(async () => {
  await new Promise((r) => setTimeout(r, 0));
});

beforeEach(() => {
  cleanup();
  h.teams = { teams: [T('1')], loaded: true };
  h.friends = [];
  h.calls = [];
  h.openFail = null;
  h.loadGate = null;
  h.loadFail = null;
  h.group = { room: null, me: 'me', connected: true, offer: null, later: null, acceptedVersion: 0, error: null };
  window.location.hash = '#/';
});

describe('주행 시작', () => {
  it('"그룹 주행"이 "팀 주행"으로', () => {
    render(<DriveChoiceSheet course={null} onChoose={() => {}} onFree={() => {}} onGroup={() => {}} onClose={() => {}} />);
    expect(screen.getByText('팀 주행')).toBeInTheDocument();
    expect(screen.queryByText('그룹 주행')).toBeNull();
  });
});

describe('팀 고르기', () => {
  it('팀이 하나면 고르지 않고 바로 그 팀 대기실로', async () => {
    const close = vi.fn();
    render(<TeamSheet onClose={close} />);
    await flush();
    expect(h.calls).toContain('drive 1');
    expect(window.location.hash).toBe('#/group');
    expect(close).toHaveBeenCalled();
  });

  it('팀이 없으면 팀 만들기로', async () => {
    h.teams = { teams: [], loaded: true };
    render(<TeamSheet onClose={() => {}} />);
    await flush();
    expect(window.location.hash).toBe('#/team/new');
  });

  it('여러 개면 고른다: 주행 중 표시, 팀장 편집·팀원 보기, 5개면 만들기 막힘', async () => {
    h.teams = { teams: [T('1', { drive: { roomId: 'r', count: 3 } }), T('2', { ownerId: 'b' }), T('3'), T('4'), T('5')], loaded: true };
    render(<TeamSheet onClose={() => {}} />);
    await flush();
    expect(h.calls).not.toContain('drive 1');
    expect(screen.getByText(/지금 주행 중 · 3명/)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /편집/ }).length).toBe(4);
    expect(screen.getByRole('link', { name: /팀2 보기/ })).toHaveAttribute('href', '#/team/2');
    expect(screen.getByRole('button', { name: /팀 만들기/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /팀2 고르기/ }));
    await flush();
    expect(h.calls).toContain('drive 2');
  });

  it('저장된 목록이 아니라 새로 받은 목록으로 고른다 (검토 지적)', async () => {
    let open!: () => void;
    h.loadGate = new Promise<void>((r) => (open = r));
    render(<TeamSheet onClose={() => {}} />);
    await flush();
    expect(h.calls).not.toContain('drive 1');
    open();
    await flush();
    expect(h.calls).toContain('drive 1');
  });

  it('목록을 못 받으면 알려 주고 다시 해 볼 수 있다 (검토 지적: "불러오는 중"에 멈췄다)', async () => {
    h.loadFail = new Error('통신 오류');
    render(<TeamSheet onClose={() => {}} />);
    await flush();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    h.loadFail = null;
    fireEvent.click(screen.getByRole('button', { name: '다시 해 보기' }));
    await flush();
    expect(h.calls).toContain('drive 1');
  });

  it('팀 하나로 바로 들어가다 실패하면 다시 해 볼 수 있다', async () => {
    const { ApiError } = await import('../../src/server/api');
    h.openFail = new ApiError(409, '잠시 뒤 다시 해 주세요');
    render(<TeamSheet onClose={() => {}} />);
    await flush();
    h.openFail = null;
    fireEvent.click(screen.getByRole('button', { name: '다시 해 보기' }));
    await flush();
    expect(h.calls.filter((c) => c === 'drive 1').length).toBe(2);
  });

  it('들어가지 못하면 서버가 준 말을 보여 준다', async () => {
    const { ApiError } = await import('../../src/server/api');
    h.openFail = new ApiError(403, '팀원만 팀 주행에 들어올 수 있어요');
    render(<TeamSheet onClose={() => {}} />);
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('팀원만 팀 주행에 들어올 수 있어요');
  });
});

describe('팀 만들기·편집', () => {
  it('친구를 골라 만든다: 나 포함 인원, 가득 찬 친구는 못 고름', async () => {
    h.friends = [F('b', '민수'), F('c', '지훈'), F('d', '준호', { full: true })];
    render(<TeamEditScreen teamId={null} />);
    fireEvent.change(screen.getByLabelText('팀 이름'), { target: { value: '북악 새벽팀' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /민수/ }));
    expect(screen.getByText('나 포함 2 / 15명')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /준호/ })).toBeDisabled();
    expect(screen.getByText(/팀이 가득 찬 친구/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '팀 만들기' }));
    await flush();
    expect(h.calls).toContain('create 북악 새벽팀 b');
  });

  it('15명이 차면 더 못 고른다', async () => {
    h.friends = Array.from({ length: 15 }, (_, i) => F(`f${i}`, `친구${i + 1}`));
    render(<TeamEditScreen teamId={null} />);
    for (let i = 0; i < 14; i++) fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(`^친구${i + 1}$`) }));
    expect(screen.getByText('나 포함 15 / 15명')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /^친구15$/ })).toBeDisabled();
  });

  it('팀장은 이름·팀원을 고쳐 저장하고 지울 수 있다', async () => {
    h.friends = [F('b', '민수'), F('c', '지훈')];
    render(<TeamEditScreen teamId="1" />);
    expect(screen.getByRole('checkbox', { name: /민수/ })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: /지훈/ }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await flush();
    expect(h.calls).toContain(`update 1 ${JSON.stringify({ name: '팀1', memberIds: ['b', 'c'] })}`);
    fireEvent.click(screen.getByRole('button', { name: '팀 지우기' }));
    fireEvent.click(screen.getByRole('button', { name: /한 번 더 누르면 팀을 지워요/ }));
    await flush();
    expect(h.calls).toContain('delete 1');
  });

  it('편집 화면은 열 때 팀을 새로 받고, 이름만 바꾸면 팀원 목록은 보내지 않는다 (검토 지적: 오래된 목록으로 나간 사람을 되살렸다)', async () => {
    h.friends = [F('b', '민수')];
    render(<TeamEditScreen teamId="1" />);
    await flush();
    expect(h.calls).toContain('loadTeam 1');
    fireEvent.change(screen.getByLabelText('팀 이름'), { target: { value: '새 이름' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await flush();
    expect(h.calls).toContain(`update 1 ${JSON.stringify({ name: '새 이름' })}`);
  });

  it('팀원은 목록만 보고 나갈 수 있다', async () => {
    h.teams = { teams: [T('2', { ownerId: 'b' })], loaded: true };
    render(<TeamEditScreen teamId="2" />);
    expect(screen.queryByRole('button', { name: '저장' })).toBeNull();
    expect(screen.getByText('민수')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '팀 나가기' }));
    fireEvent.click(screen.getByRole('button', { name: /한 번 더 누르면 팀에서 나가요/ }));
    await flush();
    expect(h.calls).toContain('leave 2');
  });
});

describe('팀 대기실', () => {
  it('팀 이름, 방 코드 대신 카톡 알리기, 아직 안 들어온 팀원, 프사', () => {
    h.teams = { teams: [T('1', { members: [...T('1').members, { userId: 'c', nickname: '지훈', avatar: null }] })], loaded: true };
    h.group = {
      ...h.group,
      room: {
        roomId: 'r1',
        code: '',
        teamId: '1',
        teamName: '북악 새벽팀',
        members: [
          { userId: 'me', nickname: '세영', color: 0, order: 1, host: true, avatar: null },
          { userId: 'b', nickname: '민수', color: 1, order: 2, host: false, avatar: 'ab'.repeat(16) },
        ],
        gapS: 2,
        dest: null,
        routeVersion: 0,
      },
    };
    render(<GroupScreen />);
    expect(screen.getByRole('heading', { name: '북악 새벽팀' })).toBeInTheDocument();
    expect(screen.queryByText('방 코드')).toBeNull();
    expect(screen.getByRole('button', { name: /주행 열었어요/ })).toBeInTheDocument();
    const waiting = screen.getByLabelText('아직 안 들어온 팀원');
    expect(within(waiting).getByText('지훈')).toBeInTheDocument();
    expect(screen.getByText('2 / 3명')).toBeInTheDocument();
    const img = screen.getAllByRole('presentation').find((e) => e.tagName === 'IMG');
    expect(img).toHaveAttribute('src', `https://api.test/avatar/${'ab'.repeat(16)}.jpg`);
    expect(screen.getByRole('button', { name: '팀 주행에서 나가기' })).toBeInTheDocument();
  });
});

describe('메인 알림', () => {
  it('내 팀이 주행을 열었으면 "주행 중 · 들어가기"', async () => {
    h.teams = { teams: [T('1', { name: '북악 새벽팀', drive: { roomId: 'r', count: 3 } })], loaded: true };
    render(<TeamNotice />);
    expect(screen.getByText(/북악 새벽팀/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /들어가기/ }));
    await flush();
    expect(h.calls).toContain('drive 1');
    expect(window.location.hash).toBe('#/group');
  });

  it('들어가 있으면 대기실 열기, 열린 주행이 없으면 아무것도 없다', () => {
    h.teams = { teams: [T('1')], loaded: true };
    const { container } = render(<TeamNotice />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('프로필 사진', () => {
  it('사진이 없으면 닉네임 첫 글자, 있으면 동그란 사진', () => {
    const { rerender } = render(<Avatar id={null} name="지훈" />);
    expect(screen.getByText('지')).toBeInTheDocument();
    rerender(<Avatar id={'ab'.repeat(16)} name="민수" />);
    expect(screen.getByRole('presentation')).toHaveAttribute('src', `https://api.test/avatar/${'ab'.repeat(16)}.jpg`);
  });
});

describe('카톡 친구 초대 링크', () => {
  it('누르면 "친구가 될까요?" → 친구 되기', async () => {
    render(<FriendInviteScreen code="K7QX29MD" name="세영" />);
    expect(screen.getByText(/세영님이 친구 초대를 보냈어요/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '친구 되기' }));
    await flush();
    expect(h.calls).toContain('addFriend K7QX29MD');
  });

  it('초대 화면을 열면 들고 있던 링크는 다 쓴 것 (메인으로 갈 때 다시 끌려오지 않게, 검토 지적)', () => {
    rememberPendingLink('/friend/K7QX29MD/세영');
    render(<FriendInviteScreen code="K7QX29MD" name="세영" />);
    expect(takePendingLink()).toBeNull();
  });

  it('주소에 실린 긴 한글 이름(퍼센트 글자)도 들고 있는다 (검토 지적)', () => {
    const path = `/friend/K7QX29MD/${encodeURIComponent('드라이브왕세영')}`;
    rememberPendingLink(path);
    expect(takePendingLink()).toBe(path);
  });

  it('첫 실행 안내 중에는 받은 링크를 들고 있다가 돌려준다 (친구·팀 주행 링크)', () => {
    rememberPendingLink('/friend/K7QX29MD/세영');
    expect(takePendingLink()).toBe('/friend/K7QX29MD/세영');
    expect(takePendingLink()).toBeNull();
    rememberPendingLink('/evil');
    expect(takePendingLink()).toBeNull();
  });
});

describe('설정: 내 프로필 사진 · 팀', () => {
  it('사진 바꾸기로 고른 사진을 올리고, 있으면 지울 수 있다', async () => {
    h.myAvatar = null;
    const { rerender } = render(<ProfilePhoto />);
    expect(screen.queryByRole('button', { name: '사진 지우기' })).toBeNull();
    const input = screen.getByLabelText('사진 바꾸기') as HTMLInputElement;
    expect(input.accept).toBe('image/*');
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([1])], 'me.jpg', { type: 'image/jpeg' })] } });
    await flush();
    expect(h.calls).toContain('upload me.jpg');
    h.myAvatar = 'cd'.repeat(16);
    rerender(<ProfilePhoto />);
    fireEvent.click(screen.getByRole('button', { name: '사진 지우기' }));
    await flush();
    expect(h.calls).toContain('removeAvatar');
  });

  it('팀 카드: 내 팀 목록(팀장·팀원 표시)과 팀 만들기 (5개면 막힘)', () => {
    h.teams = { teams: [T('1'), T('2', { ownerId: 'b' })], loaded: true };
    const { rerender } = render(<TeamsSection />);
    expect(screen.getByText('2 / 5')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /팀1/ })).toHaveAttribute('href', '#/team/1');
    expect(screen.getByRole('link', { name: '＋ 팀 만들기' })).toHaveAttribute('href', '#/team/new');
    h.teams = { teams: ['1', '2', '3', '4', '5'].map((i) => T(i)), loaded: true };
    rerender(<TeamsSection />);
    expect(screen.queryByRole('link', { name: '＋ 팀 만들기' })).toBeNull();
    expect(screen.getByText(/팀은 5개까지/)).toBeInTheDocument();
  });
});
