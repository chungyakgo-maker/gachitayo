// 그룹 주행 참가자: 방장이 목적지를 정하면 묻는다 (시안 "참가자 목적지 받기"). 대기실·주행 중 어디서든 뜬다
// 방장이 코스를 정했으면 코스 창 (3부, 시안 ⑩): 작은 그림·이름·종류·길이 — 받으면 폰에 담고, 출발하면 각자 출발점까지 안내
import { isDestOnly } from '../../app/destOnly';
import { useMemo, useState } from 'react';
import { acceptRouteOffer, dismissRouteOffer, useGroup } from '../../app/group';
import type { RoomCourse } from '../../app/teamCourse';
import { RouteGuide } from '../../engine/route/routeGuide';
import type { Course } from '../../types/course';
import { formatLength, formatTravelTime } from '../format';
import { CourseThumb } from './CourseThumb';
import { Overlay } from './Overlay';

/** 작은 그림용 코스 (받은 줄인 선 그대로) */
function thumbOf(c: RoomCourse): Course {
  return { id: 'room-course', name: c.name, kind: c.kind, source: 'team', origin: { lat: c.startGate.lat, lon: c.startGate.lon }, startGate: c.startGate, finishGate: c.finishGate, centerline: c.line.length >= 2 ? c.line : null, lengthM: c.lengthM || null, sectorBoundsM: c.sectorBoundsM, version: 1 };
}

export function RouteOfferSheet() {
  const { offer } = useGroup();
  const [busy, setBusy] = useState(false);
  const route = offer?.route ?? null;
  const curves = useMemo(() => (route && route.points.length >= 2 ? new RouteGuide(route.points, { lat: route.points[0]![0], lon: route.points[0]![1] }).notes.length : 0), [route]);
  const course = offer?.course ?? null;
  const thumb = useMemo(() => (course ? thumbOf(course) : null), [course]);
  if (!offer || !route) return null;
  if (course && thumb) {
    // 코스 담기는 폰 저장소를 거쳐 잠깐 걸린다 — 두 번 눌러도 한 번만
    const accept = () => {
      setBusy(true);
      void acceptRouteOffer().finally(() => setBusy(false));
    };
    return (
      <Overlay>
        <div className="sheet-backdrop" onClick={dismissRouteOffer}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label="방장이 코스를 정했어요" onClick={(e) => e.stopPropagation()}>
            <h2>방장이 코스를 정했어요</h2>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <CourseThumb course={thumb} size={128} />
            </div>
            <strong style={{ fontSize: 20 }}>{course.name}</strong>
            <span className="sub">{`${course.kind === 'loop' ? '랩' : '편도'} · ${formatLength(course.lengthM || null)} · 모두 같은 출발선·도착선`}</span>
            <span className="sub">받으면 내 폰에 담기고, 출발하면 지금 위치에서 출발점까지 안내해요</span>
            {offer.error && (
              <div className="notice warn" role="status">
                {offer.error}
              </div>
            )}
            <button type="button" className="primary-btn" disabled={busy} onClick={accept}>
              이 코스로 진행
            </button>
            <button type="button" className="ghost-btn" onClick={dismissRouteOffer}>
              나중에
            </button>
          </div>
        </div>
      </Overlay>
    );
  }
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
          <button type="button" className="primary-btn" onClick={() => void acceptRouteOffer()}>
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
