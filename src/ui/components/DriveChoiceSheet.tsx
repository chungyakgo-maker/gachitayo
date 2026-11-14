// 주행 시작 때 묻기 (사용자 요청 "근처에 코스가 있어도 코스 주행만 되면 안 된다. 혼자 달리고 싶을 수 있으니 물어",
// "기록 주행 말고도 그냥 일반 주행 모드 버튼"): 코스 주행(근처 코스가 있을 때) / 일반 기록 주행 / 일반 주행(기록 안 남김)
import type { Course } from '../../types/course';
import { Sheet } from './Sheet';

export function DriveChoiceSheet({
  course,
  onChoose,
  onFree,
  onClose,
}: {
  course: Course | null;
  onChoose: (c: Course | null) => void;
  onFree: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="어떻게 달릴까요?" onClose={onClose}>
      {course && (
        <button type="button" className="sheet-item" onClick={() => onChoose(course)}>
          <span className="card-col">
            <strong>코스 주행 · {course.name}</strong>
            <span className="sub">출발선을 지나면 랩을 재요</span>
          </span>
        </button>
      )}
      <button type="button" className="sheet-item" onClick={() => onChoose(null)}>
        <span className="card-col">
          <strong>일반 기록 주행</strong>
          <span className="sub">코스 없이 달린 길만 기록해요</span>
        </span>
      </button>
      <button type="button" className="sheet-item" onClick={onFree}>
        <span className="card-col">
          <strong>일반 주행</strong>
          <span className="sub">기록을 남기지 않아요 · 화면만 보며 달려요</span>
        </span>
      </button>
    </Sheet>
  );
}
