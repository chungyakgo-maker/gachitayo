// 주행 지도 두 손가락 (사용자 요청 2026-11-17 "부드럽게 확대·축소가 안 되고 뚝뚝 끊겨", "손으로 지도 회전이 안 돼"):
// 벌리고 오므리는 만큼 연속으로 확대(계단 없이, 두 배 벌리면 한 단계), 비틀면 지도를 돌린다.
// 돌리기는 10° 넘게 비틀었을 때부터 (확대하다 손가락이 조금 비틀린 것으로 돌지 않게), 넘은 자리부터 튀지 않고.
import { DRIVE_ZOOM_MAX, DRIVE_ZOOM_MIN, type MapViewMode } from '../../app/settings';
import { headingToBearing } from './lineShapes';

export interface Pt {
  x: number;
  y: number;
}

/** 이만큼(°) 넘게 비틀어야 돌리기 시작 */
export const ROTATE_START_DEG = 10;

const span = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
/** 화면 각도 (°, 화면은 y가 아래라 시계 방향이 +) */
const angle = (a: Pt, b: Pt) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
/** −180 ~ 180 */
const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
const wrap360 = (d: number) => ((d % 360) + 360) % 360;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class TwoFingerGesture {
  private readonly d0: number;
  private readonly a0: number;
  private readonly z0: number;
  /** 돌리기 시작할 때의 지도 방위 (null 이면 이 보기에서는 돌리지 않는다) */
  private readonly b0: number | null;
  /** 돌리기를 시작한 손가락 각도 */
  private aRef: number | null = null;

  constructor(a: Pt, b: Pt, start: { zoom: number; bearing: number | null }) {
    this.d0 = span(a, b);
    this.a0 = angle(a, b);
    this.z0 = start.zoom;
    this.b0 = start.bearing;
  }

  /** 손으로 돌렸는지 */
  get rotated(): boolean {
    return this.aRef !== null;
  }

  /** 지금 손가락 → 확대 단계(−4 ~ +2, 소수)와 지도 방위(°, 아직 안 돌렸으면 null) */
  move(a: Pt, b: Pt): { zoom: number; bearing: number | null } {
    const d = span(a, b);
    const zoom = this.d0 > 0 && d > 0 ? clamp(this.z0 + Math.log2(d / this.d0), DRIVE_ZOOM_MIN, DRIVE_ZOOM_MAX) : this.z0;
    if (this.b0 === null) return { zoom, bearing: null };
    const now = angle(a, b);
    if (this.aRef === null) {
      if (Math.abs(wrap180(now - this.a0)) < ROTATE_START_DEG) return { zoom, bearing: null };
      this.aRef = now;
    }
    // 손가락을 시계 방향으로 돌리면 지도 그림도 시계 방향 = 위쪽 방위는 줄어든다
    return { zoom, bearing: wrap360(this.b0 - wrap180(now - this.aRef)) };
  }
}

/**
 * 지도 위쪽이 가리키는 방위(°, 북쪽 0·시계 방향). null = 북쪽 위.
 * 전체 코스는 늘 북쪽 위, 손으로 돌렸으면 그 방위, 아니면 진행 방향 위 보기에서만 진행 방향 (psi: 동쪽 기준 반시계 라디안)
 */
export function upBearing(view: MapViewMode, manual: number | null, headPsi: number | null): number | null {
  if (view === 'fit') return null;
  if (manual !== null) return manual;
  return view === 'heading' && headPsi !== null ? headingToBearing(headPsi) : null;
}
