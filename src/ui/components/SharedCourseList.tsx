// 코스 탭 › 모두의 코스 목록 (설계 2부, 시안 ⑦): 서버가 주는 공개 코스 요약을 폰에서 정렬한다.
// 가까운 순은 지금 위치(이 폰에서만 씀)로 정렬하고, 위치를 모르면 많이 받은 순
import { useEffect, useMemo, useState } from 'react';
import { fetchShared, sortShared, type SharedSort } from '../../app/sharedCourses';
import type { Course } from '../../types/course';
import type { SharedSummary } from '../../types/shared';
import { useLocationPreview } from '../hooks/useLocationPreview';
import { formatLength } from '../format';
import { CourseThumb } from './CourseThumb';

/** 작은 그림용 가짜 코스 (요약의 thumb 점·출발점만) */
export function thumbCourse(s: SharedSummary): Course {
  const last = s.thumb[s.thumb.length - 1] ?? [s.start.lat, s.start.lon];
  const g = (lat: number, lon: number) => ({ lat, lon, bearingDeg: 0, widthM: 30 });
  return { id: s.id, name: s.name, kind: s.kind, source: 'shared', origin: s.start, startGate: g(s.start.lat, s.start.lon), finishGate: g(last[0], last[1]), centerline: s.thumb, lengthM: s.lengthM, sectorBoundsM: null, version: 1 };
}

export function sharedLine(s: Pick<SharedSummary, 'kind' | 'lengthM' | 'region'>): string {
  return [s.kind === 'loop' ? '랩' : '편도', formatLength(s.lengthM), s.region].filter(Boolean).join(' · ');
}

export function SharedCourseList({ sort }: { sort: SharedSort }) {
  const [list, setList] = useState<SharedSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { fix } = useLocationPreview(sort === 'near');
  useEffect(() => {
    let alive = true;
    fetchShared().then(
      (l) => alive && setList(l),
      (e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      alive = false;
    };
  }, []);
  const sorted = useMemo(() => (list ? sortShared(list, sort, fix ? { lat: fix.lat, lon: fix.lon } : null) : null), [list, sort, fix]);
  if (error) return <div className="notice warn">{error}</div>;
  if (!sorted) return <span className="sub">불러오는 중…</span>;
  if (sorted.length === 0) return <span className="sub">아직 공개된 코스가 없어요. 내 코스 상세에서 "모두에게 공개"로 올릴 수 있어요.</span>;
  return (
    <ul className="rows" aria-label="모두의 코스">
      {sorted.map((s) => (
        <li key={s.id} className="course-li">
          <a className="row-card course-row" href={`#/shared/${encodeURIComponent(s.id)}`}>
            <CourseThumb course={thumbCourse(s)} />
            <span className="card-col course-row-text">
              <strong style={{ fontSize: 16 }}>{s.name}</strong>
              <span className="sub">{sharedLine(s)}</span>
              <span className="sub">{`올린 사람 ${s.by} · ${s.adds}명 받음`}</span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
