// 주행 시작 때 묻기 (사용자 요청 "근처에 코스가 있어도 코스 주행만 되면 안 된다. 혼자 달리고 싶을 수 있으니 물어"):
// 코스 주행(출발선을 지나면 랩을 잼) / 일반 기록 주행(코스 없이 달린 길만 기록)
import type { Course } from '../../types/course';
import { Sheet } from './Sheet';

export function DriveChoiceSheet({ course, onChoose, onClose }: { course: Course; onChoose: (c: Course | null) => void; onClose: () => void }) {
  return (
    <Sheet title="어떻게 달릴까요?" onClose={onClose}>
      <button type="button" className="sheet-item" onClick={() => onChoose(course)}>
        <span className="card-col">
          <strong>코스 주행 · {course.name}</strong>
          <span className="sub">출발선을 지나면 랩을 재요</span>
        </span>
      </button>
      <button type="button" className="sheet-item" onClick={() => onChoose(null)}>
        <span className="card-col">
          <strong>일반 기록 주행</strong>
          <span className="sub">코스 없이 달린 길만 기록해요</span>
        </span>
      </button>
    </Sheet>
  );
}
