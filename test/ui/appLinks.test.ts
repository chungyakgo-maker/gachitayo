// 아이폰 앱으로 열린 링크 → 방 입장 (출시 준비)
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ app: true, listeners: [] as Array<(e: { url: string }) => void>, launch: null as null | { url: string } }));
vi.mock('../../src/platform', async (orig) => ({ ...(await orig<typeof import('../../src/platform')>()), isApp: () => h.app }));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (_n: string, cb: (e: { url: string }) => void) => {
      h.listeners.push(cb);
      return Promise.resolve({ remove: () => {} });
    },
    getLaunchUrl: () => Promise.resolve(h.launch),
  },
}));
const { parseJoinLink, startAppLinks } = await import('../../src/app/appLinks');

describe('앱 링크', () => {
  it('reads the room code from the app scheme, the Kakao card app link and the web invite link', () => {
    expect(parseJoinLink('dgo://join/482917')).toBe('482917');
    expect(parseJoinLink('kakao89c5ba572b46879e01420e651551d84c://kakaolink?code=482917')).toBe('482917');
    expect(parseJoinLink('https://chungyakgo-maker.github.io/gachitayo/#/join/482917')).toBe('482917');
    expect(parseJoinLink('dgo://join/12345')).toBeNull();
    expect(parseJoinLink('https://example.com/#/settings')).toBeNull();
    expect(parseJoinLink('not a url')).toBeNull();
  });

  it('in the app, an opened link or the launch link goes to the join screen', async () => {
    h.launch = { url: 'dgo://join/111111' };
    startAppLinks();
    await new Promise((r) => setTimeout(r, 0));
    expect(window.location.hash).toBe('#/join/111111');
    h.listeners[0]!({ url: 'kakao89c5ba572b46879e01420e651551d84c://kakaolink?code=482917' });
    expect(window.location.hash).toBe('#/join/482917');
  });
});
