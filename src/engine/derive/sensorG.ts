// 보정 전 임시 G — 폰 센서 그대로 (사용자 요청 "손으로 흔들어도 G가 움직여야"):
// 거치 보정(7.2)이 끝나기 전에도 가속도 센서 값을 바로 보여준다. 흔들면 바로 움직인다.
//
// - 위 방향: 보정기가 정차로 잡은 위 방향이 있으면 그것, 없으면 가속도의 3초 저역 통과(중력).
//   GPS로 보아 가감속·코너 중일 때는 저역 통과를 멈춘다 (길게 가속하면 중력 추정이 가속 쪽으로 끌려가 값이 작아진다).
// - 앞 방향: 보정기가 앞 방향까지 잡았으면(부호 확인 전) 그것. 아니면 "화면이 운전석 쪽을 보게 거치"로 가정해
//   화면 뒤쪽(기기 −z)의 수평 성분. 폰이 거의 누워 있으면 폰 위쪽(기기 +y)이 앞이라고 본다.
// - 가정한 앞 방향은 거꾸로일 수 있다(거치 방향, 아이폰 가속도 부호). 그래서 GPS로 구한 앞뒤·좌우 가속도와
//   부호가 맞는지 계속 비교해서, 1초 넘게 쌓이면 앞뒤·좌우 부호를 따로 맞춘다.
// 화면에는 "G 추정"으로 표시하고 기록에는 넣지 않는다. 부호까지 확인된 보정이 끝나면 정식 G로 바뀐다.
import { cross, dot, norm, normalize, scale, sub, type Vec3 } from '../linalg';

/** 중력 저역 통과 시간 상수 ms */
const LP_TAU_MS = 3000;
/** GPS 가속도가 이보다 크면 중력 저역 통과를 멈춘다 m/s² */
const LP_HOLD_GPS_MPS2 = 0.5;
/** 화면 뒤쪽의 수평 성분이 이보다 작으면(폰이 누움) 폰 위쪽을 앞으로 본다 */
const MIN_HORIZONTAL = 0.5;
/** 부호 비교에 쓰는 GPS 가속도 크기 m/s² */
const SIGN_MIN_GPS_MPS2 = 0.8;
/** 이만큼(50 Hz면 1초) 쌓이면 부호를 정한다 */
const SIGN_MIN_SAMPLES = 50;

export interface SensorGAxes {
  /** 보정기가 정차로 잡은 위 방향(기기 축)과 중력 크기 */
  up?: Vec3;
  gravity?: number;
  /** 보정기가 잡은 앞·왼쪽 (부호 확인 전이라도 앞 방향 부호는 GPS로 정해져 있다) */
  fwd?: Vec3;
  left?: Vec3;
}

export class SensorGEstimator {
  private lp: Vec3 | null = null;
  private lastT: number | null = null;
  private corrLong = 0;
  private nLong = 0;
  private corrLat = 0;
  private nLat = 0;

  /**
   * t: ms, f: 기기 축 중력 포함 가속도 m/s², gps: 같은 때 GPS로 구한 앞뒤·좌우 가속도(부호 맞추기용)
   * → 앞(+)·왼쪽(+) 가속도 m/s²
   */
  push(t: number, f: Vec3, axes: SensorGAxes = {}, gps: { ax: number; ay: number } | null = null): { ax: number; ay: number } {
    const steady = !gps || (Math.abs(gps.ax) < LP_HOLD_GPS_MPS2 && Math.abs(gps.ay) < LP_HOLD_GPS_MPS2);
    if (this.lp === null || this.lastT === null) this.lp = f;
    else if (steady) {
      const k = 1 - Math.exp(-Math.max(0, t - this.lastT) / LP_TAU_MS);
      this.lp = [this.lp[0] + (f[0] - this.lp[0]) * k, this.lp[1] + (f[1] - this.lp[1]) * k, this.lp[2] + (f[2] - this.lp[2]) * k];
    }
    this.lastT = t;
    if (norm(this.lp) < 1e-6) return { ax: 0, ay: 0 };
    const up = axes.up ?? normalize(this.lp);
    const g = axes.gravity ?? norm(this.lp);
    const a = sub(f, scale(up, g));

    if (axes.fwd && axes.left) return { ax: dot(axes.fwd, a), ay: dot(axes.left, a) };

    const horiz = (v: Vec3) => sub(v, scale(up, dot(v, up)));
    let h = horiz([0, 0, -1]);
    if (norm(h) < MIN_HORIZONTAL) h = horiz([0, 1, 0]);
    const fwd = normalize(h);
    const left = cross(up, fwd);
    const ax = dot(fwd, a);
    const ay = dot(left, a);
    if (gps) {
      if (Math.abs(gps.ax) >= SIGN_MIN_GPS_MPS2) {
        this.corrLong += ax * gps.ax;
        this.nLong += 1;
      }
      if (Math.abs(gps.ay) >= SIGN_MIN_GPS_MPS2) {
        this.corrLat += ay * gps.ay;
        this.nLat += 1;
      }
    }
    const sLong = this.nLong >= SIGN_MIN_SAMPLES && this.corrLong < 0 ? -1 : 1;
    const sLat = this.nLat >= SIGN_MIN_SAMPLES && this.corrLat < 0 ? -1 : 1;
    return { ax: sLong * ax, ay: sLat * ay };
  }
}
