// 경로 안내 (설계 docs/superpowers/specs/2026-11-16-destination-route-design.md 5.2, 사용자 요청 "초행경로도 표지판이 뜨게"):
// 카카오 길찾기 경로(위경도 점들)를 주행 평면으로 바꿔 커브 표지판 목록을 한 번 계산하고, 지금 위치로 경로 위 거리·남은 거리·이탈·도착을 낸다.
// 경로 위치는 코스 주행과 같은 STracker로 따라간다 (30 m 넘게 벗어나면 경로 밖). 랩·코스 엔진과는 따로 돈다.
import { paceNotes, type PaceNote } from '../course/paceNotes';
import { makePolyline, resamplePolyline, type Polyline } from '../course/polyline';
import { STracker } from '../course/sTracker';
import { toLocal, type LatLon } from '../geo';

export const ROUTE = {
  /** 경로에서 이만큼 넘게 벗어나 있으면 다시 찾기를 셈한다 (m) */
  offM: 50,
  /** 그 상태가 이만큼 이어지면 다시 찾는다 (ms) */
  offForMs: 3000,
  /** 다시 찾기 사이 최소 간격 (ms, 앱이 지킨다) */
  rerouteGapMs: 20_000,
  /** 목적지까지 이만큼이면 도착 (m) */
  arriveM: 30,
  /** 이보다 빠를 때만 진행 방향을 같이 보낸다 (m/s) */
  headingMinMps: 3,
} as const;

/** 경로 선을 이 간격으로 고르게 다시 찍는다 (STracker는 고른 간격을 가정한다. 카카오 꼭짓점은 들쭉날쭉) */
const SPACING_M = 2;

export interface RouteStep {
  /** 경로 위 거리 (m). 벗어나 있으면 마지막으로 경로 위였던 곳 */
  s: number | null;
  onRoute: boolean;
  lateralM: number;
  remainingM: number | null;
  arrived: boolean;
  wantReroute: boolean;
}

export class RouteGuide {
  readonly line: Polyline;
  readonly notes: PaceNote[];
  readonly lengthM: number;
  private readonly st: STracker;
  private offSince: number | null = null;
  private arrived = false;

  constructor(
    points: ReadonlyArray<readonly [number, number]>,
    readonly origin: LatLon,
  ) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [lat, lon] of points) {
      const p = toLocal(origin, lat, lon);
      xs.push(p.x);
      ys.push(p.y);
    }
    const raw = makePolyline(xs, ys);
    this.line = raw.length > 0 ? resamplePolyline(raw, SPACING_M) : raw;
    this.lengthM = this.line.length;
    this.notes = paceNotes(this.line);
    this.st = new STracker({ centerline: this.line.s.length >= 2 ? this.line : null, course: { kind: 'point_to_point' } });
  }

  update(p: { t: number; x: number; y: number; v: number; gpsOk: boolean }): RouteStep {
    const tr = this.st.update(p.x, p.y, p.v, p.t);
    const remainingM = tr.s === null ? null : Math.max(0, this.lengthM - tr.s);
    if (!this.arrived) {
      const n = this.line.s.length;
      const dEnd = n ? Math.hypot(p.x - this.line.x[n - 1]!, p.y - this.line.y[n - 1]!) : Infinity;
      if ((tr.onCourse && remainingM !== null && remainingM <= ROUTE.arriveM) || dEnd <= ROUTE.arriveM) this.arrived = true;
    }
    // GPS가 괜찮을 때만 이탈 시간을 잰다 (튄 위치로 다시 찾지 않게)
    if (!this.arrived && !tr.onCourse && tr.lateral > ROUTE.offM && p.gpsOk) this.offSince ??= p.t;
    else this.offSince = null;
    return {
      s: tr.s,
      onRoute: tr.onCourse,
      lateralM: tr.lateral,
      remainingM,
      arrived: this.arrived,
      wantReroute: this.offSince !== null && p.t - this.offSince >= ROUTE.offForMs,
    };
  }
}

/** 진행 방향 ψ(동쪽 기준 반시계, 라디안) → 나침반 방위 (북쪽 0, 시계 방향, 정수 0~359) */
export function bearingOfPsi(psi: number): number {
  return ((Math.round(90 - (psi * 180) / Math.PI) % 360) + 360) % 360;
}
