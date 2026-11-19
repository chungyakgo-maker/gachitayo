// 설정 › 계정 번호 · 안 보는 사람 · 관리자 화면 (모두의 코스 설계 2부: 관리자는 세영, 신고·숨김 먼저)
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const h = vi.hoisted(() => ({ admin: false, blocks: [] as Array<{ userId: string; nickname: string }>, rows: [] as unknown[], calls: [] as string[] }));
vi.mock('../../src/app/account', async (orig) => {
  const real = await orig<typeof import('../../src/app/account')>();
  return { ...real, useAccount: () => ({ ...real.getAccountState(), status: 'ready', userId: '12345678-aaaa-4bbb-8ccc-1234567890ab', admin: h.admin }) };
});
vi.mock('../../src/app/sharedCourses', async (orig) => ({
  ...(await orig<typeof import('../../src/app/sharedCourses')>()),
  listBlocks: async () => h.blocks,
  unblockUser: async (u: string) => {
    h.calls.push(`unblock ${u}`);
    h.blocks = h.blocks.filter((b) => b.userId !== u);
  },
  adminList: async () => h.rows,
  adminSet: async (id: string, a: string) => void h.calls.push(`${a} ${id}`),
  adminDelete: async (id: string) => void h.calls.push(`delete ${id}`),
  adminBan: async (u: string) => void h.calls.push(`ban ${u}`),
  adminUnban: async (u: string) => void h.calls.push(`unban ${u}`),
}));

const { SettingsScreen } = await import('../../src/ui/screens/SettingsScreen');
const { AdminSharedScreen } = await import('../../src/ui/screens/AdminSharedScreen');

const row = (id: string, p: Record<string, unknown> = {}) => ({ id, name: `코스 ${id}`, region: '경기', kind: 'loop', lengthM: 4100, start: { lat: 37, lon: 127 }, thumb: [], adds: 0, by: '바람', byId: `owner-${id}`, createdAt: 1, mine: false, status: 'open', reports: 0, reasons: {}, ...p });

beforeEach(() => {
  cleanup();
  h.admin = false;
  h.blocks = [];
  h.rows = [];
  h.calls = [];
});

describe('설정: 계정 번호 · 안 보는 사람 · 관리자 링크', () => {
  it('계정 번호 복사: 앞 8자리만 보이고 누르면 전체를 복사한다', async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    render(<SettingsScreen />);
    fireEvent.click(screen.getByRole('button', { name: /계정 번호 복사/ }));
    expect(screen.getByRole('button', { name: /계정 번호 복사/ })).toHaveTextContent('12345678…');
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('12345678-aaaa-4bbb-8ccc-1234567890ab'));
  });

  it('안 보는 사람이 있으면 닉네임과 풀기', async () => {
    h.blocks = [{ userId: 'u9', nickname: '나쁜사람' }];
    render(<SettingsScreen />);
    const sec = await screen.findByRole('region', { name: '안 보는 사람' });
    expect(sec).toHaveTextContent('나쁜사람');
    fireEvent.click(within(sec).getByRole('button', { name: '나쁜사람 풀기' }));
    await waitFor(() => expect(h.calls).toEqual(['unblock u9']));
  });

  it('관리자 링크는 관리자에게만', () => {
    const { unmount } = render(<SettingsScreen />);
    expect(screen.queryByRole('link', { name: /관리자 · 모두의 코스 관리/ })).toBeNull();
    unmount();
    h.admin = true;
    render(<SettingsScreen />);
    expect(screen.getByRole('link', { name: /관리자 · 모두의 코스 관리/ })).toHaveAttribute('href', '#/admin/shared');
  });
});

describe('관리자 화면', () => {
  it('관리자 아니면 안내만', async () => {
    render(<AdminSharedScreen />);
    expect(screen.getByText('관리자만 볼 수 있어요')).toBeInTheDocument();
  });

  it('숨김·신고 먼저(서버 순서 그대로), 신고 이유 수, 숨기기·풀기·지우기(확인)·공개 막기(확인)', async () => {
    h.admin = true;
    h.rows = [row('r', { status: 'hidden', reports: 3, reasons: { danger: 2, name: 1 } }), row('q')];
    render(<AdminSharedScreen />);
    const items = await screen.findAllByRole('listitem');
    expect(items[0]).toHaveTextContent('코스 r');
    expect(items[0]).toHaveTextContent('숨김 · 신고 3 (위험한 길 2 · 이름이 불쾌함 1)');
    fireEvent.click(within(items[0]!).getByRole('button', { name: '숨김 풀기' }));
    await waitFor(() => expect(within(items[1]!).getByRole('button', { name: '숨기기' })).toBeEnabled());
    fireEvent.click(within(items[1]!).getByRole('button', { name: '숨기기' }));
    await waitFor(() => expect(within(items[1]!).getByRole('button', { name: '지우기' })).toBeEnabled());
    fireEvent.click(within(items[1]!).getByRole('button', { name: '지우기' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '지우기' }));
    await waitFor(() => expect(h.calls).toContain('delete q'));
    await waitFor(() => expect(within(items[0]!).getByRole('button', { name: '이 계정 공개 막기' })).toBeEnabled());
    fireEvent.click(within(items[0]!).getByRole('button', { name: '이 계정 공개 막기' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '막기' }));
    await waitFor(() => expect(h.calls).toEqual(['show r', 'hide q', 'delete q', 'ban owner-r']));
  });

  it('공개 막힌 계정이면 표시하고 "공개 막기 풀기"', async () => {
    h.admin = true;
    h.rows = [row('b', { status: 'hidden', banned: true })];
    render(<AdminSharedScreen />);
    const [item] = await screen.findAllByRole('listitem');
    expect(item).toHaveTextContent('공개 막힌 계정');
    fireEvent.click(within(item!).getByRole('button', { name: '공개 막기 풀기' }));
    await waitFor(() => expect(h.calls).toEqual(['unban owner-b']));
  });
});
