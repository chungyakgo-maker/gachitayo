// 그룹 주행 초대 (사용자 결정 "카톡 카드로"): 카카오 JavaScript SDK 카카오톡 공유로 카드를 보낸다.
// 키(VITE_KAKAO_JS_KEY)가 없거나 SDK를 못 불러오면 폰 공유 창, 그것도 없으면 링크 복사.
// 링크는 웹 앱 주소 #/join/{코드} (앱 출시 뒤 유니버설 링크는 따로)
import { Share } from '@capacitor/share';
import { isApp, WEB_APP_URL } from '../platform';
import { appName } from '../ui/brand';

const SDK_URL = 'https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js';
/** 받은 파일이 바뀌지 않았는지 (CI 점검 2026-11-16에서 받은 값) */
const SDK_INTEGRITY = 'sha384-DKYJZ8NLiK8MN4/C5P2dtSmLQ4KwPaoqAfyA/DfmEc1VDxu4yyC7wy6K1Hs90nka';

interface KakaoSdk {
  init: (key: string) => void;
  isInitialized: () => boolean;
  Share: { sendDefault: (o: unknown) => void };
}

export type ShareResult = 'kakao' | 'shared' | 'copied' | 'failed';


const jsKey = (): string => (import.meta.env.VITE_KAKAO_JS_KEY as string | undefined) ?? '';

/** 카톡 카드로 보낼 수 있는지 (키가 들어간 웹 빌드. 아이폰 앱은 카카오 웹 SDK를 못 써서 폰 공유 창) */
export const kakaoShareReady = (): boolean => jsKey() !== '' && !isApp();

/** 이 웹 앱의 주소 (끝에 /). 앱 안에서는 공개 웹 주소 */
function appBase(): string {
  if (isApp()) return WEB_APP_URL;
  return new URL(import.meta.env.BASE_URL || '/', window.location.origin).toString();
}

export function inviteLink(code: string): string {
  return `${appBase()}#/join/${code}`;
}

export const formatRoomCode = (c: string): string => (c.length === 6 ? `${c.slice(0, 3)} ${c.slice(3)}` : c);

let loading: Promise<KakaoSdk | null> | null = null;
/** 이미 불러온 SDK (없으면 null) */
function readySdk(): KakaoSdk | null {
  const key = jsKey();
  const k = (window as unknown as { Kakao?: KakaoSdk }).Kakao;
  if (!key || !k) return null;
  try {
    if (!k.isInitialized()) k.init(key);
    return k;
  } catch {
    return null;
  }
}
/** 대기실을 열 때 미리 불러 둔다 (누른 순간에 불러오면 아이폰은 공유 허락이 사라진다, 검토 지적) */
export function preloadKakaoSdk(): void {
  void loadSdk();
}
function loadSdk(): Promise<KakaoSdk | null> {
  const key = jsKey();
  if (!key) return Promise.resolve(null);
  const ready = readySdk;
  if (ready()) return Promise.resolve(ready());
  loading ??= new Promise<KakaoSdk | null>((resolve) => {
    const s = document.createElement('script');
    s.src = SDK_URL;
    s.integrity = SDK_INTEGRITY;
    s.crossOrigin = 'anonymous';
    s.async = true;
    const t = setTimeout(() => resolve(null), 8000);
    s.onload = () => {
      clearTimeout(t);
      try {
        resolve(ready());
      } catch {
        resolve(null);
      }
    };
    s.onerror = () => {
      clearTimeout(t);
      loading = null;
      resolve(null);
    };
    document.head.appendChild(s);
  });
  return loading;
}

export async function copyInviteLink(code: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(inviteLink(code));
    return true;
  } catch {
    return false;
  }
}

/** 초대 보내기: 카톡 카드 → 폰 공유 창 → 링크 복사 */
export async function shareInvite(o: { code: string; destName: string | null; count: number }): Promise<ShareResult> {
  const url = inviteLink(o.code);
  const title = `${appName()} · 그룹 주행 초대`;
  const desc = `방 코드 ${formatRoomCode(o.code)}${o.destName ? ` · ${o.destName}까지 같이 달려요` : ' · 같이 달려요'}\n${o.count}명 참여 중`;
  // 아이폰 앱: 폰 공유 창 (카톡을 고르면 링크가 간다)
  if (isApp()) {
    try {
      await Share.share({ title, text: desc, url, dialogTitle: '그룹 주행 초대' });
      return 'shared';
    } catch (e) {
      if (/cancel/i.test(String((e as { message?: unknown }).message ?? e))) return 'shared';
      return (await copyInviteLink(o.code)) ? 'copied' : 'failed';
    }
  }
  // 미리 불러 둔 SDK만 쓴다. 아직이면 이번에는 폰 공유 창으로 (다음에는 카톡 카드)
  const k = readySdk();
  if (!k) preloadKakaoSdk();
  if (k) {
    try {
      const link = { mobileWebUrl: url, webUrl: url };
      k.Share.sendDefault({
        objectType: 'feed',
        content: { title, description: desc, imageUrl: new URL('pwa-512x512.png', appBase()).toString(), link },
        buttons: [{ title: '방에 들어가기', link }],
      });
      return 'kakao';
    } catch {
      // 아래로
    }
  }
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text: desc, url });
      return 'shared';
    } catch (e) {
      // 사용자가 공유 창을 닫은 것은 실패로 치지 않는다
      if ((e as { name?: string }).name === 'AbortError') return 'shared';
    }
  }
  return (await copyInviteLink(o.code)) ? 'copied' : 'failed';
}
