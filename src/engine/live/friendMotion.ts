// 앞 친구 위치 예측 (사용자 요청 "친구 아이콘이 부드럽게, 일정 속도로 가면 도로를 따라가게"):
// 친구 위치는 1초에 한 번, 0.5~2초 늦게 온다. 받은 마지막 위치에서 그 속도로 계속 간다고 보고 "지금" 위치를 예측한다.
// - 코스 선(중심선)이 있으면 그 선을 따라 거리만큼 나아간다 (도로를 따라감).
// - 없으면 최근 세 점의 방향 변화율로 휘어지며 나아간다 (일정 속도·일정 회전, 3초까지).
// 새 위치가 오면 예측이 바뀌어 아이콘이 튀므로, 그 차이를 0.6초 동안 서서히 줄여 이어 준다 (FriendMarker).
import { nearestOnPolyline, polylinePoint, type Polyline } from '../course/polyline';
import { isOutlier, type TrailPoint } from './gap';

/** 마지막 위치에서 이만큼까지만 늘려 예측한다 (초) */
const MAX_PREDICT_S = 3;
/** 회전율 상한 rad/s (튀는 값 막기) */
const MAX_YAW_RATE = 0.8;
/** 이보다 느리면 회전 없이 */
const MIN_TURN_SPEED = 2;
/** 코스 선에서 이보다 멀면 코스 선을 따르지 않는다 (m) */
const ROAD_SNAP_M = 30;
/** 새 위치가 왔을 때 화면 위치 차이를 줄이는 시간 상수 (ms) */
const BLEND_MS = 600;
/** 차이가 이보다 크면 이어 주지 않고 바로 옮긴다 (m) */
const BLEND_MAX_M = 60;

export interface FriendRoad {
  line: Polyline;
  loop: boolean;
}

export interface FriendPose {
  x: number;
  y: number;
  /** 진행 방향 (x축에서 반시계 rad) */
  psi: number;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** 앞 친구가 시각 now(GPS 기준 epoch ms)에 있을 위치. 위치가 없으면 null */
export function predictFriend(trail: readonly TrailPoint[], now: number, road?: FriendRoad | null): FriendPose | null {
  // 튀지 않은 최근 점들 (최근 6개 안에서)
  const good: TrailPoint[] = [];
  for (let j = trail.length - 1; j >= Math.max(0, trail.length - 6) && good.length < 3; j--) if (!isOutlier(trail, j)) good.unshift(trail[j]!);
  const b = good[good.length - 1];
  if (!b) return null;
  const a = good.length >= 2 ? good[good.length - 2]! : null;
  const c = good.length >= 3 ? good[good.length - 3]! : null;
  const dab = a ? (b.t - a.t) / 1000 : 0;
  if (!a || dab <= 0) return { x: b.x, y: b.y, psi: 0 };
  const psiAB = Math.atan2(b.y - a.y, b.x - a.x);
  const v = b.v !== undefined && b.v !== null && Number.isFinite(b.v) ? Math.max(0, b.v) : Math.hypot(b.x - a.x, b.y - a.y) / dab;
  // 회전율: 두 구간 방향 차이 / 두 구간 가운데 시각 차이
  let omega = 0;
  if (c && v >= MIN_TURN_SPEED) {
    const dca = (a.t - c.t) / 1000;
    if (dca > 0) {
      const psiCA = Math.atan2(a.y - c.y, a.x - c.x);
      omega = Math.max(-MAX_YAW_RATE, Math.min(MAX_YAW_RATE, wrap(psiAB - psiCA) / ((dab + dca) / 2)));
    }
  }
  // b에서의 방향: 마지막 구간 방향에 반 구간만큼 회전을 더한다
  const psiB = psiAB + (omega * dab) / 2;
  const dt = Math.max(0, Math.min(MAX_PREDICT_S, (now - b.t) / 1000));

  if (road && road.line.length > 0) {
    const near = nearestOnPolyline(road.line, b.x, b.y);
    if (near.d <= ROAD_SNAP_M) {
      const here = polylinePoint(road.line, near.s);
      const forward = Math.cos(wrap(here.psi - psiB)) >= 0 ? 1 : -1;
      let s = near.s + forward * v * dt;
      const L = road.line.length;
      s = road.loop ? ((s % L) + L) % L : Math.max(0, Math.min(L, s));
      const p = polylinePoint(road.line, s);
      return { x: p.x, y: p.y, psi: forward > 0 ? p.psi : wrap(p.psi + Math.PI) };
    }
  }
  // 일정 속도·일정 회전으로
  if (Math.abs(omega) < 1e-4) return { x: b.x + v * Math.cos(psiB) * dt, y: b.y + v * Math.sin(psiB) * dt, psi: psiB };
  const psiN = psiB + omega * dt;
  return { x: b.x + (v / omega) * (Math.sin(psiN) - Math.sin(psiB)), y: b.y - (v / omega) * (Math.cos(psiN) - Math.cos(psiB)), psi: psiN };
}

/** 지도에 그릴 앞 친구 아이콘 위치: 예측 위치를 쓰되 새 위치가 와도 튀지 않게 이어 준다 */
export class FriendMarker {
  private trail: TrailPoint[] = [];
  private baseT: number | null = null;
  private off = { x: 0, y: 0 };
  private lastNow: number | null = null;
  private shown: FriendPose | null = null;

  push(p: TrailPoint): void {
    const last = this.trail[this.trail.length - 1];
    if (last && p.t <= last.t) return;
    this.trail.push(p);
    if (this.trail.length > 10) this.trail.splice(0, this.trail.length - 10);
  }

  reset(points: TrailPoint[] = []): void {
    this.trail = [];
    this.baseT = null;
    this.off = { x: 0, y: 0 };
    this.lastNow = null;
    this.shown = null;
    for (const p of points) this.push(p);
  }

  position(now: number, road?: FriendRoad | null): FriendPose | null {
    const raw = predictFriend(this.trail, now, road);
    if (!raw) return null;
    if (this.lastNow !== null) {
      const k = Math.exp(-Math.max(0, now - this.lastNow) / BLEND_MS);
      this.off = { x: this.off.x * k, y: this.off.y * k };
    }
    this.lastNow = now;
    const newest = this.trail[this.trail.length - 1]!.t;
    if (this.baseT !== null && newest !== this.baseT) {
      // 새 위치가 왔다: 같은 시각에 예전 위치들로 예측한 자리(지금 보이는 자리)에서 이어 가도록 차이를 남기고 서서히 줄인다
      const base = this.baseT;
      const old = predictFriend(
        this.trail.filter((p) => p.t <= base),
        now,
        road,
      );
      if (old) {
        const ox = old.x + this.off.x - raw.x;
        const oy = old.y + this.off.y - raw.y;
        this.off = Math.hypot(ox, oy) <= BLEND_MAX_M ? { x: ox, y: oy } : { x: 0, y: 0 };
      }
    }
    this.baseT = newest;
    this.shown = { x: raw.x + this.off.x, y: raw.y + this.off.y, psi: raw.psi };
    return this.shown;
  }
}
