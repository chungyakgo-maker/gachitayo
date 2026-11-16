import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// 첫 화면 카카오 버튼 (설계 5.6, 계획 Task 7)
const API = 'https://gachitayo-api.example.workers.dev';
let fetchMock: ReturnType<typeof vi.fn>;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function showWelcome(kakaoOn: boolean) {
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).endsWith('/auth/providers')) return json(200, { kakao: kakaoOn });
    if (String(url).endsWith('/auth/kakao/start')) return json(200, { url: `https://kauth.kakao.com/oauth/authorize?state=${'S'.repeat(32)}` });
    return json(404, {});
  });
  vi.resetModules();
  const k = await import('../../src/app/kakaoLogin');
  const go = vi.fn();
  k.kakaoNav.go = go;
  const { WelcomeScreen } = await import('../../src/ui/screens/WelcomeScreen');
  render(<WelcomeScreen />);
  return { go };
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  vi.stubEnv('VITE_API_URL', API);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('첫 화면: 카카오로 시작하기', () => {
  it('서버가 카카오를 켜 두었으면 버튼을 보이고, 안전 안내에 체크해야 눌린다. 닉네임은 비어도 된다', async () => {
    const { go } = await showWelcome(true);
    const btn = await screen.findByRole('button', { name: '카카오로 시작하기' });
    expect(screen.getByText('폰을 바꿔도 카카오로 로그인하면 기록이 돌아와요')).toBeInTheDocument();
    expect(btn).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    await waitFor(() => expect(go).toHaveBeenCalledTimes(1));
  });

  it('닉네임 시작 버튼은 "로그인 없이 시작"', async () => {
    await showWelcome(true);
    expect(screen.getByRole('button', { name: '로그인 없이 시작' })).toBeInTheDocument();
  });

  it('서버가 카카오를 꺼 두었으면 카카오 버튼이 없다', async () => {
    await showWelcome(false);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('button', { name: '카카오로 시작하기' })).toBeNull();
  });

  it('로그인이 진행 중이면 번호 입력 칸을 보이고 6자리를 보낸다', async () => {
    localStorage.setItem('gachitayo.kakaoLogin', JSON.stringify({ state: 'S'.repeat(32), verifier: 'v'.repeat(43), from: '#/', startedAt: Date.now() }));
    await showWelcome(true);
    fetchMock.mockResolvedValueOnce(json(200, { userId: 'u9', token: 'n'.repeat(43), nickname: 'x', kind: 'created' }));
    expect(screen.getByText(/카카오 로그인을 마치는 중이에요/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('6자리 번호'), { target: { value: '482913' } });
    fireEvent.click(screen.getByRole('button', { name: '확인' }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/auth/kakao/finish'))).toBe(true));
    const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/auth/kakao/finish'))!;
    expect(JSON.parse(call[1].body).pin).toBe('482913');
  });

  it('진행 중 로그인을 취소할 수 있다', async () => {
    localStorage.setItem('gachitayo.kakaoLogin', JSON.stringify({ state: 'S'.repeat(32), verifier: 'v'.repeat(43), from: '#/', startedAt: Date.now() }));
    await showWelcome(true);
    fireEvent.click(screen.getByRole('button', { name: '로그인 취소' }));
    expect(screen.queryByText(/카카오 로그인을 마치는 중이에요/)).toBeNull();
    expect(localStorage.getItem('gachitayo.kakaoLogin')).toBeNull();
  });
});
