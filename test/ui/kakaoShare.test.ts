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

describe('아이폰 앱에서 초대', () => {
  it('uses the phone share sheet with the public web link, never the app address', async () => {
    vi.resetModules();
    const share = vi.fn(async (_o: { title: string; text: string; url: string }) => ({}));
    vi.doMock('../../src/platform', async (orig) => ({ ...(await orig<typeof import('../../src/platform')>()), isApp: () => true }));
    vi.doMock('@capacitor/share', () => ({ Share: { share } }));
    const k = await import('../../src/app/kakaoShare');
    expect(k.kakaoShareReady()).toBe(false);
    expect(k.inviteLink('482917')).toBe('https://chungyakgo-maker.github.io/gachitayo/#/join/482917');
    expect(await k.shareInvite({ code: '482917', destName: null, count: 2 })).toBe('shared');
    expect(share.mock.calls[0]![0]).toMatchObject({ title: '디고 · 그룹 주행 초대', url: 'https://chungyakgo-maker.github.io/gachitayo/#/join/482917' });
    vi.doUnmock('../../src/platform');
    vi.doUnmock('@capacitor/share');
  });
});

// 카톡 카드도 새 로고 미리보기 그림과 이름 디고 (2026-11-18 "카톡공유할떄 링크가 안바뀐거임")
describe('카톡 카드 (웹, 카카오 키가 있을 때)', () => {
  it('제목은 디고, 그림은 새 로고 미리보기(og-image.png)', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_KAKAO_JS_KEY', 'k');
    const sent: Array<{ content: { title: string; imageUrl: string } }> = [];
    vi.stubGlobal('Kakao', { init: () => {}, isInitialized: () => true, Share: { sendDefault: (o: (typeof sent)[number]) => sent.push(o) } });
    try {
      const m = await import('../../src/app/kakaoShare');
      expect(await m.shareInvite({ code: '482917', destName: null, count: 2 })).toBe('kakao');
      expect(sent[0]!.content.title).toBe('디고 · 그룹 주행 초대');
      expect(sent[0]!.content.imageUrl).toMatch(/\/og-image\.png$/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
