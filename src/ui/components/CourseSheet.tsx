// 메인 지도에서 코스를 누르면 (사용자 요청 "설정된 지도 누르면 출발지로 바로 이동하게, 출발지·도착지 확인하게 지도 보여주면서"):
// 출발·도착 핀 지도(코스 상세와 같은 지도), 즐겨찾기, 길이·커브 수, 출발점까지 직선 거리, 출발점으로 길찾기 / 이 코스로 주행
import { useMemo } from 'react';
import { isFavorite, toggleFavorite, useCoursePrefs } from '../../app/coursePrefs';
import { buildGeometry } from '../../engine/course/geometry';
import { paceNotes } from '../../engine/course/paceNotes';
import { toLocal } from '../../engine/geo';
import type { Course } from '../../types/course';
import { formatLength } from '../format';
import { courseShapes } from '../screens/CourseDetailScreen';
import { PickMap } from './PickMap';
import { Sheet } from './Sheet';

export function CourseSheet({ course, from, onClose, onStartPoint, onDrive }: { course: Course; from: { lat: number; lon: number } | null; onClose: () => void; onStartPoint: () => void; onDrive: () => void }) {
  const prefs = useCoursePrefs();
  const fav = isFavorite(course, prefs);
  const map = useMemo(() => courseShapes(course, null), [course]);
  const curves = useMemo(() => (course.centerline && course.centerline.length >= 2 ? paceNotes(buildGeometry(course).centerline!).length : null), [course]);
  const toStart = from ? Math.hypot(toLocal(from, course.startGate.lat, course.startGate.lon).x, toLocal(from, course.startGate.lat, course.startGate.lon).y) : null;
  return (
    <Sheet title={course.name} onClose={onClose}>
      <div className="card-row">
        <span className="sub">
          {course.kind === 'loop' ? '랩' : '편도'} · {formatLength(course.lengthM)}
          {curves !== null && ` · 커브 ${curves}개`}
        </span>
        <button type="button" className="browse-chip" aria-pressed={fav} onClick={() => toggleFavorite(course)}>
          <span className="fav" aria-hidden="true">
            {fav ? '★' : '☆'}
          </span>
          즐겨찾기
        </button>
      </div>
      <PickMap shapes={map.shapes} fit={map.fit} fitKey={`${course.id}:${course.version}`} label="코스 지도: 출발점과 도착점" onPick={() => {}} className="course-map sheet-map" />
      <div className="card-row">
        <span className="label">출발점까지</span>
        <span className="mono">{toStart === null ? '위치 확인 중' : `직선 ${formatLength(toStart)}`}</span>
      </div>
      <button type="button" className="primary-btn" onClick={onStartPoint}>
        출발점으로 길찾기
      </button>
      <button type="button" className="btn" onClick={onDrive}>
        이 코스로 주행
      </button>
    </Sheet>
  );
}
