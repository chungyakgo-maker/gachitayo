// 그룹 주행 초대 보내기: 카카오 키가 없으면 폰 공유 창, 그것도 없으면 링크 복사 (설계 2026-11-16 group-drive)
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyInviteLink, formatRoomCode, inviteLink, kakaoShareReady, shareInvite } from '../../src/app/kakaoShare';

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
});

describe('초대 보내기', () => {
  it('link is the web app #/join/{code}; code shown as 3+3', () => {
    expect(inviteLink('482917')).toMatch(/\/#\/join\/482917$/);
    expect(formatRoomCode('482917')).toBe('482 917');
    expect(kakaoShareReady()).toBe(false);
  });

  it('without a Kakao key uses the phone share sheet', async () => {
    const share = vi.fn(async (_d: ShareData) => {});
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    expect(await shareInvite({ code: '482917', destName: '만항재', count: 4 })).toBe('shared');
    expect(share.mock.calls[0]![0].url).toMatch(/#\/join\/482917$/);
    expect(share.mock.calls[0]![0].text).toContain('만항재까지');
  });

  it('closing the share sheet is not an error; no share sheet → copies the link', async () => {
    Object.defineProperty(navigator, 'share', { value: vi.fn(async () => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' }))), configurable: true });
    expect(await shareInvite({ code: '482917', destName: null, count: 1 })).toBe('shared');
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    const writeText = vi.fn(async (_s: string) => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    expect(await shareInvite({ code: '482917', destName: null, count: 1 })).toBe('copied');
    expect(writeText.mock.calls[0]![0]).toMatch(/#\/join\/482917$/);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => Promise.reject(new Error('no'))) }, configurable: true });
    expect(await copyInviteLink('482917')).toBe(false);
  });
});
