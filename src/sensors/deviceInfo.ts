// 기기 정보 (사양서 6.3): OS, 브라우저, user agent를 세션에 기록한다.

import type { DeviceInfo } from '../types/session';

export type { DeviceInfo };

const UNKNOWN = '알 수 없음';

function parseOs(ua: string): string {
  const ios = /(?:iPhone|iPad|iPod).*? OS (\d+)_(\d+)/.exec(ua);
  if (ios) return `iOS ${ios[1]}.${ios[2]}`;
  const android = /Android (\d+(?:\.\d+)?)/.exec(ua);
  if (android) return `Android ${android[1]}`;
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS X/.test(ua)) return 'macOS';
  if (/Linux/.test(ua)) return 'Linux';
  return UNKNOWN;
}

function parseBrowser(ua: string): string {
  // 순서가 중요하다: 많은 브라우저가 UA에 Chrome·Safari를 함께 넣는다.
  const rules: Array<[RegExp, (m: RegExpExecArray) => string]> = [
    [/SamsungBrowser\/(\d+)/, (m) => `Samsung Internet ${m[1]}`],
    [/CriOS\/(\d+)/, (m) => `Chrome ${m[1]} (iOS)`],
    [/FxiOS\/(\d+)/, (m) => `Firefox ${m[1]} (iOS)`],
    [/EdgA?\/(\d+)/, (m) => `Edge ${m[1]}`],
    [/Chrome\/(\d+)/, (m) => `Chrome ${m[1]}`],
    [/Version\/(\d+(?:\.\d+)?).*Safari\//, (m) => `Safari ${m[1]}`],
    [/Firefox\/(\d+)/, (m) => `Firefox ${m[1]}`],
  ];
  for (const [re, name] of rules) {
    const m = re.exec(ua);
    if (m) return name(m);
  }
  return UNKNOWN;
}

export function parseUserAgent(ua: string): { os: string; browser: string } {
  return { os: parseOs(ua), browser: parseBrowser(ua) };
}

interface UADataLike {
  platform?: string;
  getHighEntropyValues?(hints: string[]): Promise<{ platformVersion?: string; model?: string }>;
}

/** 브라우저에서 기기 정보를 모은다. */
export async function getDeviceInfo(): Promise<DeviceInfo> {
  const userAgent = navigator.userAgent;
  const info: DeviceInfo = {
    ...parseUserAgent(userAgent),
    userAgent,
    standalone:
      window.matchMedia?.('(display-mode: standalone)').matches === true ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
  };
  // 안드로이드 크롬은 UA의 OS 버전을 10으로 고정해서 보낸다. 실제 버전과 모델은 Client Hints로 얻는다.
  const uaData = (navigator as Navigator & { userAgentData?: UADataLike }).userAgentData;
  if (uaData?.getHighEntropyValues) {
    try {
      const hints = await uaData.getHighEntropyValues(['platformVersion', 'model']);
      if (uaData.platform === 'Android' && hints.platformVersion) {
        info.os = `Android ${hints.platformVersion.split('.')[0]}`;
      }
      if (hints.model) info.model = hints.model;
    } catch {
      // 못 얻으면 UA 값을 쓴다
    }
  }
  return info;
}
