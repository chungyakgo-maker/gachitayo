// 아이폰 앱으로 열린 링크 (출시 준비, 사용자 요청 "앱 출시하면 바로 앱으로 입장"):
// 방 초대 링크로 앱이 열리면 그 방으로 간다. 받는 모양
//   dgo://join/482917                                  (앱 주소 체계)
//   kakao{네이티브 앱 키}://kakaolink?code=482917        (카톡 카드의 "앱에서 열기")
//   https://chungyakgo-maker.github.io/gachitayo/#/join/482917 (웹 초대 링크)
import { App } from '@capacitor/app';
import { isApp } from '../platform';

/** 링크에서 방 코드 6자리 (없으면 null) */
export function parseJoinLink(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const six = (s: string | null | undefined) => (s && /^\d{6}$/.test(s) ? s : null);
  if (u.protocol === 'dgo:') return six(/^\/*join\/(\d{6})\/?$/.exec(`${u.host}${u.pathname}`)?.[1] ?? null);
  if (/^kakao[0-9a-f]+:$/.test(u.protocol) && u.host === 'kakaolink') return six(u.searchParams.get('code'));
  if (u.protocol === 'https:') return six(/^#\/join\/(\d{6})$/.exec(u.hash)?.[1] ?? null);
  return null;
}

function go(url: string | undefined): void {
  const code = url ? parseJoinLink(url) : null;
  if (code) window.location.hash = `#/join/${code}`;
}

/** 앱에서만: 링크로 열렸을 때(처음 켤 때·켜져 있을 때 모두) 방 입장 화면으로 */
export function startAppLinks(): void {
  if (!isApp()) return;
  void App.addListener('appUrlOpen', (e) => go(e.url));
  void App.getLaunchUrl().then((r) => go(r?.url), () => {});
}
