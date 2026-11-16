import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';

// 카카오에서 돌아온 화면 (#/auth/kakao?state&pin|error, 설계 5.2-4)
const API = 'https://gachitayo-api.example.workers.dev';
const STATE = 'S'.repeat(32);
let fetchMock: ReturnType<typeof vi.fn>;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function show(hash: string) {
  window.location.hash = hash;
  vi.resetModules();
  const { KakaoAuthScreen } = await import('../../src/ui/screens/KakaoAuthScreen');
  render(<KakaoAuthScreen />);
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
  window.location.hash = '';
});

describe('카카오에서 돌아온 화면', () => {
  it('이 창에서 시작하지 않은 로그인이면 번호를 크게 보여 준다', async () => {
    await show(`#/auth/kakao?state=${STATE}&pin=482913`);
    expect(screen.getByText('482913')).toBeInTheDocument();
    expect(screen.getByText(/앱으로 돌아가서 이 번호를 입력해 주세요/)).toBeInTheDocument();
    expect(screen.getByText(/다른 사람에게 알려 주지 마세요/)).toBeInTheDocument();
    expect(screen.getByText('이 앱에서 방금 로그인을 시작하지 않았다면 이 창을 닫으세요.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('이 창에서 시작한 로그인이면 저절로 마치고 시작한 화면으로 돌아간다', async () => {
    localStorage.setItem('gachitayo.kakaoLogin', JSON.stringify({ state: STATE, verifier: 'v'.repeat(43), from: '#/settings', startedAt: Date.now() }));
    fetchMock.mockResolvedValueOnce(json(200, { userId: 'u9', token: 'n'.repeat(43), nickname: 'x', kind: 'linked' }));
    await show(`#/auth/kakao?state=${STATE}&pin=482913`);
    await waitFor(() => expect(window.location.hash).toBe('#/settings'));
    expect(fetchMock.mock.calls[0]![0]).toBe(`${API}/auth/kakao/finish`);
  });

  it('화면이 뜨기 전에 이미 마쳤으면(앱 시작 때) 번호 화면 대신 바로 돌아간다', async () => {
    localStorage.setItem('gachitayo.kakaoLogin', JSON.stringify({ state: STATE, verifier: 'v'.repeat(43), from: '#/settings', startedAt: Date.now() }));
    fetchMock.mockResolvedValueOnce(json(200, { userId: 'u9', token: 'n'.repeat(43), nickname: 'x', kind: 'linked' }));
    window.location.hash = `#/auth/kakao?state=${STATE}&pin=482913`;
    vi.resetModules();
    const k = await import('../../src/app/kakaoLogin');
    await k.finishFromHash(window.location.hash);
    const { KakaoAuthScreen } = await import('../../src/ui/screens/KakaoAuthScreen');
    render(<KakaoAuthScreen />);
    expect(screen.queryByText('482913')).toBeNull();
    await waitFor(() => expect(window.location.hash).toBe('#/settings'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('마치기에 실패하면 이유와 돌아가기를 보인다', async () => {
    localStorage.setItem('gachitayo.kakaoLogin', JSON.stringify({ state: STATE, verifier: 'v'.repeat(43), from: '#/', startedAt: Date.now() }));
    fetchMock.mockResolvedValueOnce(json(410, { error: '만료' }));
    await show(`#/auth/kakao?state=${STATE}&pin=482913`);
    expect(await screen.findByText(/로그인 시간이 지났어요/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '돌아가기' })).toBeInTheDocument();
  });

  it('카카오에서 취소했으면 알려 주고, 진행 중 표시를 지운다', async () => {
    localStorage.setItem('gachitayo.kakaoLogin', JSON.stringify({ state: STATE, verifier: 'v'.repeat(43), from: '#/settings', startedAt: Date.now() }));
    await show(`#/auth/kakao?state=${STATE}&error=cancelled`);
    expect(screen.getByText('카카오 로그인을 취소했어요')).toBeInTheDocument();
    expect(localStorage.getItem('gachitayo.kakaoLogin')).toBeNull();
    act(() => screen.getByRole('button', { name: '돌아가기' }).click());
    expect(window.location.hash).toBe('#/settings');
  });

  it('첫 실행 전이어도 #/auth/kakao는 첫 화면 대신 이 화면을 보인다', async () => {
    window.location.hash = `#/auth/kakao?state=${STATE}&pin=482913`;
    vi.resetModules();
    const { App } = await import('../../src/ui/App');
    render(<App />);
    expect(screen.getByText('482913')).toBeInTheDocument();
  });
});
