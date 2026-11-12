// 지도 보기 나침반 버튼 (사용자 요청): 지도 왼쪽 위 버튼 하나를 누를 때마다 전체 코스 → 나를 가운데 → 진행 방향 위.
// 바늘은 화면에서 북쪽을 가리킨다 (진행 방향 위 보기에서는 지도와 같이 돈다). 옆에 지금 보기 이름.
import type { CSSProperties } from 'react';
import { MAP_VIEW_LABEL, type MapViewMode } from '../../app/settings';

export const NEXT_MAP_VIEW: Record<MapViewMode, MapViewMode> = { fit: 'follow', follow: 'heading', heading: 'fit' };

export interface MapViewButtonProps {
  view: MapViewMode;
  /** 지도를 돌린 각도 (라디안, 반시계). 북쪽이 위면 0 */
  rot: number;
  onChange: (v: MapViewMode) => void;
  /** 자리 (지도 위에 얹은 칸 아래로 내릴 때) */
  style?: CSSProperties;
}

export function MapViewButton({ view, rot, onChange, style }: MapViewButtonProps) {
  const next = NEXT_MAP_VIEW[view];
  return (
    <button
      type="button"
      className="map-compass"
      style={style}
      aria-label={`지도 보기: ${MAP_VIEW_LABEL[view]} (누르면 ${MAP_VIEW_LABEL[next]})`}
      onClick={() => onChange(next)}
    >
      <span className="dial">
        <svg width={30} height={30} viewBox="-15 -15 30 30" aria-hidden="true" style={{ transform: `rotate(${(-rot * 180) / Math.PI}deg)` }}>
          <path d="M0 -12L4.5 0L-4.5 0Z" fill="#ff5b4f" />
          <path d="M0 12L4.5 0L-4.5 0Z" fill="#8a9199" />
        </svg>
        <span className="n" style={{ transform: `rotate(${(-rot * 180) / Math.PI}deg) translateY(-19px) rotate(${(rot * 180) / Math.PI}deg)` }}>
          N
        </span>
      </span>
      <span className="name">{MAP_VIEW_LABEL[view]}</span>
    </button>
  );
}
