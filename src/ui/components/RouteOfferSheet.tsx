// 그룹 주행 참가자: 방장이 목적지를 정하면 묻는다 (시안 "참가자 목적지 받기"). 대기실·주행 중 어디서든 뜬다
import { isDestOnly } from '../../app/destOnly';
import { useMemo } from 'react';
import { acceptRouteOffer, dismissRouteOffer, useGroup } from '../../app/group';
import { RouteGuide } from '../../engine/route/routeGuide';
import { formatLength, formatTravelTime } from '../format';
import { Overlay } from './Overlay';

export function RouteOfferSheet() {
  const { offer } = useGroup();
  const route = offer?.route ?? null;
  const curves = useMemo(() => (route && route.points.length >= 2 ? new RouteGuide(route.points, { lat: route.points[0]![0], lon: route.points[0]![1] }).notes.length : 0), [route]);
  if (!offer || !route) return null;
  // 정식 빌드 방장은 목적지만 보낸다 (방장 위치가 담긴 경로를 보내지 않게, destOnly.ts): 길은 각자 내 위치에서 찾는다
  const only = isDestOnly(route);
  return (
    <Overlay>
      <div className="sheet-backdrop" onClick={dismissRouteOffer}>
        <div className="sheet" role="dialog" aria-modal="true" aria-label="방장이 목적지를 정했어요" onClick={(e) => e.stopPropagation()}>
          <h2>방장이 목적지를 정했어요</h2>
          <strong style={{ fontSize: 20 }}>{offer.dest.name}</strong>
          {only ? (
            <span className="sub">경로는 각자 지금 위치에서 찾아요. 모두 같은 목적지로 가요</span>
          ) : (
            <>
              <span className="sub mono">{`${formatLength(route.distanceM)} · ${formatTravelTime(route.durationS)} · 커브 ${curves}개`}</span>
              <span className="sub">모두 같은 경로로 가요. 길을 벗어나면 내 위치에서 다시 찾아 같은 목적지로 이어져요</span>
            </>
          )}
          <button type="button" className="primary-btn" onClick={acceptRouteOffer}>
            {only ? '이 목적지로 진행' : '이 경로로 진행'}
          </button>
          <button type="button" className="ghost-btn" onClick={dismissRouteOffer}>
            나중에
          </button>
        </div>
      </div>
    </Overlay>
  );
}
