// 코스 분류 칩 (설계 docs/superpowers/specs/2026-11-16-course-browse-design.md): 메인 지도·코스 목록이 같이 쓴다.
// 인기 도로를 고르면 둘째 줄에 기간 (사용자 요청 "최근30일, 최근7일, 전체기간, 계절, 실시간")
import { FILTERS, PERIODS, type CourseFilter, type PopularPeriod } from '../../app/courseFilter';

export function CourseChips({ filter, period, onFilter, onPeriod }: { filter: CourseFilter; period: PopularPeriod; onFilter: (f: CourseFilter) => void; onPeriod: (p: PopularPeriod) => void }) {
  return (
    <>
      <div className="browse-chips" role="group" aria-label="코스 분류">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className="browse-chip" aria-pressed={filter === f.id} onClick={() => onFilter(f.id)}>
            {f.id === 'fav' && (
              <span className="fav" aria-hidden="true">
                ★
              </span>
            )}
            {f.label}
          </button>
        ))}
      </div>
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
