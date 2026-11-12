import { describe, expect, it } from 'vitest';
import { parseUserAgent } from '../../src/sensors/deviceInfo';

describe('parseUserAgent', () => {
  it('아이폰 사파리', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1';
    expect(parseUserAgent(ua)).toEqual({ os: 'iOS 18.4', browser: 'Safari 18.4' });
  });

  it('안드로이드 크롬', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 15; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36';
    expect(parseUserAgent(ua)).toEqual({ os: 'Android 15', browser: 'Chrome 142' });
  });

  it('아이폰 크롬은 사파리 엔진이라 따로 표시한다', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0.7444.77 Mobile/15E148 Safari/604.1';
    expect(parseUserAgent(ua)).toEqual({ os: 'iOS 18.4', browser: 'Chrome 142 (iOS)' });
  });

  it('삼성 인터넷', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36';
    expect(parseUserAgent(ua)).toEqual({ os: 'Android 14', browser: 'Samsung Internet 28' });
  });

  it('모르는 형식', () => {
    expect(parseUserAgent('something')).toEqual({ os: '알 수 없음', browser: '알 수 없음' });
  });
});
