// GPS 상태 아이콘 (사용자 요청): 글자 없이 색으로만. 초록 좋음 · 노랑 대기(준비 전·오차 큼) · 빨강 약함(끊김) · 회색 없음.
// 주행 지도·메인 지도 오른쪽 위 모서리에 둔다. 메인 지도에서는 누르면 내 위치로 간다 (onClick, 사용자 요청).
import type { CSSProperties } from 'react';
import { IconGps } from '../icons';

export type GpsState = 'good' | 'wait' | 'weak' | 'none';

const COLOR: Record<GpsState, string> = { good: '#3EE08F', wait: '#FFB224', weak: '#FF5B4F', none: '#5E656D' };
const WORD: Record<GpsState, string> = { good: '좋음', wait: '기다리는 중', weak: '약함', none: '없음' };

export function GpsIcon({
  state,
  hAcc,
  className = 'gps-icon',
  style,
  onClick,
  label,
}: {
  state: GpsState;
  hAcc?: number | null;
  className?: string;
  style?: CSSProperties;
  /** 있으면 누를 수 있는 버튼 (색은 그대로 GPS 상태) */
  onClick?: () => void;
  /** 내 위치에서 벗어났을 때 버튼에 붙는 글자 ("내 위치로", 2026-11-18): 알약 모양으로 커진다 */
  label?: string;
}) {
  const acc = hAcc === null || hAcc === undefined ? '' : ` · 오차 ${Math.round(Math.min(hAcc, 999))}m`;
  if (onClick) {
    return (
      <button type="button" className={`${className}${label ? ' gps-pill' : ''}`} style={style} aria-label={`내 위치로 (GPS ${WORD[state]}${acc})`} data-gps={state} onClick={onClick}>
        {label ? (
          <>
            <span className="gps-dot" aria-hidden="true">
              <IconGps size={18} color={COLOR[state]} />
            </span>
            <span aria-hidden="true">{label}</span>
          </>
        ) : (
          <IconGps size={22} color={COLOR[state]} />
        )}
      </button>
    );
  }
  return (
    <span className={className} style={style} role="img" aria-label={`GPS ${WORD[state]}${acc}`} data-gps={state}>
      <IconGps size={22} color={COLOR[state]} />
    </span>
  );
}
