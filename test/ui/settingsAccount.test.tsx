import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// 설정 계정 칸 (설계 5.6, 계획 Task 7): 카카오로 로그인 / 카카오 연결됨 + 로그아웃 / 끊긴 계정 / 되살리는 중
const API = 'https://gachitayo-api.example.workers.dev';
let fetchMock: ReturnType<typeof vi.fn>;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function account(p: { kakao?: boolean; lost?: boolean } = {}) {
  localStorage.setItem('gachitayo.userId', 'u1');
  localStorage.setItem('gachitayo.nickname', '민수');
  localStorage.setItem('gachitayo.onboarded', '1');
  if (!p.lost) localStorage.setItem('gachitayo.token', 't'.repeat(43));
  if (p.kakao) localStorage.setItem('gachitayo.kakao', '1');
}
async function showSettings() {
  vi.resetModules();
  const { SettingsScreen } = await import('../../src/ui/screens/SettingsScreen');
  render(<SettingsScreen />);
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  vi.stubEnv('VITE_API_URL', API);
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).endsWith('/auth/providers')) return json(200, { kakao: true });
    if (String(url).endsWith('/api/sessions')) return json(200, [{ id: 'on-server' }]);
    return json(404, {});
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('설정: 카카오 계정', () => {
  it('연결 안 된 계정은 "카카오로 로그인"과 안내를 보인다', async () => {
    account();
    await showSettings();
    expect(await screen.findByRole('button', { name: '카카오로 로그인' })).toBeInTheDocument();
    expect(screen.getByText('로그인하면 폰을 바꿔도 기록이 돌아와요')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '로그아웃' })).toBeNull();
  });

  it('연결된 계정은 "카카오 연결됨"과 로그아웃을 보인다', async () => {
    account({ kakao: true });
    await showSettings();
    expect(screen.getByText('카카오 연결됨')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '로그아웃' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '카카오로 로그인' })).toBeNull();
    expect(screen.getByText(/카카오 계정에 연결돼 있어요/)).toBeInTheDocument();
  });

  it('끊긴 계정에도 카카오로 로그인을 보인다', async () => {
    account({ lost: true });
    await showSettings();
    expect(await screen.findByRole('button', { name: '카카오로 로그인' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '새 계정 만들기' })).toBeInTheDocument();
  });

  it('로그아웃 확인 창에 이 폰에만 있는 기록 수를 보인다', async () => {
    account({ kakao: true });
    vi.resetModules();
    const rec = await import('../../src/app/recording');
    await rec.clearLocalData();
    const device = { os: 'iOS', browser: 'Safari', userAgent: 'ua', standalone: true };
    for (const id of ['on-server', 'only-1', 'only-2']) await rec.getRepo().create({ id, courseId: null, courseVersion: null, status: 'uploaded', startedAt: 1, endedAt: null, device, calibration: null, summary: null });
    const { SettingsScreen } = await import('../../src/ui/screens/SettingsScreen');
    render(<SettingsScreen />);
    fireEvent.click(screen.getByRole('button', { name: '로그아웃' }));
    expect(await screen.findByText(/로그아웃하면 이 폰의 기록과 내 코스가 지워져요/)).toBeInTheDocument();
    expect(screen.getByText('이 폰에만 있는 기록 2개는 되살릴 수 없어요.')).toBeInTheDocument();
    await rec.clearLocalData();
  });

  it('되살리는 중이면 진행 상황을 보인다', async () => {
    account({ kakao: true });
    vi.resetModules();
    const { RestoreBanner } = await import('../../src/ui/components/RestoreBanner');
    const { restoreProgressText } = await import('../../src/ui/components/RestoreBanner');
    expect(restoreProgressText({ running: true, done: 12, total: 40, failed: 0 })).toBe('기록 되살리는 중 12/40');
    expect(restoreProgressText({ running: true, done: 12, total: 40, failed: 2 })).toBe('기록 되살리는 중 12/40 · 실패 2 (다음에 다시)');
    expect(restoreProgressText({ running: false, done: 0, total: 0, failed: 0 })).toBeNull();
    expect(restoreProgressText({ running: false, done: 3, total: 5, failed: 2 })).toBe('기록 되살리기: 실패 2 (다음에 다시)');
    render(<RestoreBanner />);
    await waitFor(() => expect(document.body).toBeTruthy());
  });
});
