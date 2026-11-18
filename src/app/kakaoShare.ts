// 카톡 카드 보내기 (사용자 결정 "카톡 카드로"): 카카오 JavaScript SDK 카카오톡 공유로 카드를 보낸다.
// 그룹 방 초대(예전 빌드용), 친구 초대·팀 주행 알리기 (설계 2026-11-18 team-drive, 사용자 결정 A-가 "카톡 초대는 친구 초대로")
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

/** 친구 초대: 받은 사람이 누르면 "○○님과 친구가 될까요?" */
export function friendInviteLink(code: string, nickname: string): string {
  return `${appBase()}#/friend/${code}/${encodeURIComponent(nickname.slice(0, 20))}`;
}

/** 팀 주행 알리기: 팀원이 누르면 그 팀 대기실로 */
export function teamDriveLink(teamId: string): string {
  return `${appBase()}#/team/${teamId}/drive`;
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

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** 초대 보내기: 카톡 카드 → 폰 공유 창 → 링크 복사 */
export async function shareInvite(o: { code: string; destName: string | null; count: number }): Promise<ShareResult> {
  return shareCard({
    url: inviteLink(o.code),
    title: `${appName()} · 그룹 주행 초대`,
    desc: `방 코드 ${formatRoomCode(o.code)}${o.destName ? ` · ${o.destName}까지 같이 달려요` : ' · 같이 달려요'}\n${o.count}명 참여 중`,
    button: '방에 들어가기',
    dialogTitle: '그룹 주행 초대',
  });
}

/** 친구 초대 카드 */
export function shareFriendInvite(o: { code: string; nickname: string }): Promise<ShareResult> {
  return shareCard({
    url: friendInviteLink(o.code, o.nickname),
    title: `${appName()} · 친구 초대`,
    desc: `${o.nickname}님이 친구 초대를 보냈어요\n누르면 바로 서로 친구가 돼요`,
    button: '친구 되기',
    dialogTitle: '친구 초대',
  });
}

/** 팀 주행 "주행 열었어요" 알리기 카드 (알림이 없어서) */
export function shareTeamDrive(o: { teamId: string; teamName: string; destName: string | null; count: number }): Promise<ShareResult> {
  return shareCard({
    url: teamDriveLink(o.teamId),
    title: `${o.teamName} · 팀 주행 열었어요`,
    desc: `${o.destName ? `${o.destName}까지 같이 달려요` : '같이 달려요'} · ${o.count}명 들어옴`,
    button: '대기실로',
    dialogTitle: '팀 주행 알리기',
  });
}

/** 카톡 카드 → 폰 공유 창 → 링크 복사 */
async function shareCard(o: { url: string; title: string; desc: string; button: string; dialogTitle: string }): Promise<ShareResult> {
  const { url, title, desc } = o;
  // 아이폰 앱: 폰 공유 창 (카톡을 고르면 링크가 간다)
  if (isApp()) {
    try {
      await Share.share({ title, text: desc, url, dialogTitle: o.dialogTitle });
      return 'shared';
    } catch (e) {
      if (/cancel/i.test(String((e as { message?: unknown }).message ?? e))) return 'shared';
      return (await copyText(url)) ? 'copied' : 'failed';
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
        content: { title, description: desc, imageUrl: new URL('og-image.png', appBase()).toString(), link },
        buttons: [{ title: o.button, link }],
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
  return (await copyText(url)) ? 'copied' : 'failed';
}
