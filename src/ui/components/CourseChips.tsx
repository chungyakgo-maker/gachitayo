// 코스 분류 칩 (설계 docs/superpowers/specs/2026-11-16-course-browse-design.md): 메인 지도·코스 목록이 같이 쓴다.
// 인기 도로를 고르면 둘째 줄에 기간 (사용자 요청 "최근30일, 최근7일, 전체기간, 계절, 실시간")
import { FILTER_DOT, FILTERS, PERIODS, type CourseFilter, type PopularPeriod } from '../../app/courseFilter';

const SORTS: Array<{ id: 'near' | 'adds' | 'new'; label: string }> = [
  { id: 'near', label: '가까운 순' },
  { id: 'adds', label: '많이 받은 순' },
  { id: 'new', label: '새로 올라온 순' },
];

export function CourseChips({
  filter,
  period,
  onFilter,
  onPeriod,
  sharedSort,
  onSharedSort,
}: {
  filter: CourseFilter;
  period: PopularPeriod;
  onFilter: (f: CourseFilter) => void;
  onPeriod: (p: PopularPeriod) => void;
  /** 모두의 코스 정렬 칩 (코스 탭에서만) */
  sharedSort?: 'near' | 'adds' | 'new';
  onSharedSort?: (s: 'near' | 'adds' | 'new') => void;
}) {
  return (
    <>
      <div className="browse-chips" role="group" aria-label="코스 분류">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className="browse-chip" aria-pressed={filter === f.id} onClick={() => onFilter(f.id)}>
            {FILTER_DOT[f.id] && <span className={`chip-dot ${FILTER_DOT[f.id]}`} aria-hidden="true" />}
            {f.id === 'fav' && (
              <span className="fav" aria-hidden="true">
                ★
              </span>
            )}
            {f.label}
          </button>
        ))}
      </div>
      {filter === 'shared' && sharedSort && onSharedSort && (
        <div className="browse-chips small" role="group" aria-label="모두의 코스 정렬">
          {SORTS.map((x) => (
            <button key={x.id} type="button" className="browse-chip" aria-pressed={sharedSort === x.id} onClick={() => onSharedSort(x.id)}>
              {x.label}
            </button>
          ))}
        </div>
      )}
      {filter === 'popular' && (
        <div className="browse-chips small" role="group" aria-label="인기 도로 기간">
          {PERIODS.map((p) => (
            <button key={p.id} type="button" className="browse-chip" aria-pressed={period === p.id} onClick={() => onPeriod(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
