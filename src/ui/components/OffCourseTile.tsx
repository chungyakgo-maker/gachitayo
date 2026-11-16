// 코스 이탈 안내 (사용자 결정 시안 B, 설계 docs/superpowers/specs/2026-11-13-off-course-design.md):
// 랩 안에서 코스를 벗어나면 커브 표지판 자리에 주황 "! 코스 이탈" 표지판 + 옆에 코스까지 거리·이 랩 무효
export const offCourseLabel = (m: number) => `코스 이탈, 코스까지 ${m} m, 이 랩 무효`;

export function OffCourseTile({ distM }: { distM: number }) {
  return (
    <div className="tile off-course-tile" role="status" aria-label={offCourseLabel(distM)}>
      <div className="off-course-sign" aria-hidden="true">
        <span className="bang">!</span>
        <span className="word">코스 이탈</span>
      </div>
      <div className="off-course-side" aria-hidden="true">
        <span className="lbl">코스까지</span>
        <span className="dist">
          {distM}
          <small>m</small>
        </span>
        <span className="lbl">이 랩 무효</span>
      </div>
    </div>
  );
}

/** 미니멀·대시보드의 가운데 칸 */
export function OffCoursePanel({ distM }: { distM: number }) {
  return (
    <div className="off-course-panel" role="status" aria-label={offCourseLabel(distM)}>
      <span className="word">코스 이탈</span>
      <span className="dist">
        코스까지 {distM}
        <small> m</small>
      </span>
      <span className="lbl">이 랩 무효</span>
    </div>
  );
}
