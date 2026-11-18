// 아이폰 앱 실행 화면 애니메이션 (사용자 요청 2026-11-18, 디자인 캔버스 '로고' 페이지 DgoSplash 확정 시안 그대로).
// 시간표 (2초):
//   0~0.3초  DGO 도로 글자가 살짝 커지며 나타남
//   0.15~0.85초 주황 차가 왼쪽 밖에서 D로, 0.25~0.95초 남색 차가 아래쪽 밖에서 올라와 G로, 0.35~1.05초 노란 차가 오른쪽 밖에서 O로 (감속하며 정차)
//   0.9~1.4초 핀이 위에서 떨어져 1.175초에 O에 닿고 한 번 살짝 튀었다 꽂힘
//   1.175~1.7초 충격으로 O(차·핀 포함)가 아래쪽을 축으로 흔들리다 제자리
//   1.2~1.6초 "드라이브 갈 땐"이 아래에서 살짝 올라오며 나타남
//   2초 메인 화면으로. 끝 장면은 확정 아이콘과 같은 모습
// 좌표는 아이콘(512×512) 좌표. 화면에 놓는 것은 SplashIntro

export const SPLASH_MS = 2000;

export interface SplashFrame {
  /** 도로 글자 확대 (0.94 → 1) */
  introScale: number;
  roadOpacity: number;
  /** 차 세 대: SVG transform (translate + rotate) */
  carA: string;
  carB: string;
  carC: string;
  /** 핀이 제자리에서 얼마나 위에 있는지 (아이콘 좌표, −가 위) */
  pinDy: number;
  pinOpacity: number;
  /** O 흔들림 transform (없으면 '') */
  oTf: string;
  tagOpacity: number;
  /** 문구가 아래에서 올라오는 거리 (px) */
  tagDy: number;
}

type P = readonly [number, number];
const clamp = (u: number) => Math.max(0, Math.min(1, u));
const easeOut = (u: number) => 1 - Math.pow(1 - u, 3);
const f2 = (v: number) => v.toFixed(2);

/** 3차 베지어 위 점과 진행 방향 (차 그림은 위가 앞이라 +90°) */
function bez(P: readonly [P, P, P, P], p: number) {
  const q = 1 - p;
  const x = q * q * q * P[0][0] + 3 * q * q * p * P[1][0] + 3 * q * p * p * P[2][0] + p * p * p * P[3][0];
  const y = q * q * q * P[0][1] + 3 * q * q * p * P[1][1] + 3 * q * p * p * P[2][1] + p * p * p * P[3][1];
  const dx = 3 * q * q * (P[1][0] - P[0][0]) + 6 * q * p * (P[2][0] - P[1][0]) + 3 * p * p * (P[3][0] - P[2][0]);
  const dy = 3 * q * q * (P[1][1] - P[0][1]) + 6 * q * p * (P[2][1] - P[1][1]) + 3 * p * p * (P[3][1] - P[2][1]);
  return { x, y, deg: (Math.atan2(dy, dx) * 180) / Math.PI + 90 };
}

const PATH_A = [[-80, 140], [20, 110], [96.7, 173], [126.7, 225]] as const;
const PATH_B = [[215, 920], [215, 520], [205.5, 150.2], [174.7, 234.8]] as const;
const PATH_C = [[600, 400], [480, 410], [398.7, 349.3], [349.2, 299.8]] as const;

export function splashFrame(t: number): SplashFrame {
  const car = (P: readonly [P, P, P, P], start: number, dur: number) => {
    const b = bez(P, easeOut(clamp((t - start) / dur)));
    return `translate(${f2(b.x)} ${f2(b.y)}) rotate(${f2(b.deg)})`;
  };
  const ui = clamp(t / 300);
  let pinDy = -110;
  let pinOpacity = 0;
  if (t >= 900) {
    const u = clamp((t - 900) / 500);
    pinOpacity = clamp((t - 900) / 120);
    if (u < 0.55) {
      const q = u / 0.55;
      pinDy = -110 * (1 - q * q);
    } else {
      const v = (u - 0.55) / 0.45;
      pinDy = -16 * Math.sin(Math.PI * v) * (1 - 0.2 * v);
    }
  }
  let oTf = '';
  const s = t - 1175;
  if (s >= 0 && t < SPLASH_MS) {
    const sq = 0.09 * Math.exp(-s / 110) * Math.cos((2 * Math.PI * s) / 230);
    const a = 6 * Math.exp(-s / 160) * Math.sin((2 * Math.PI * s) / 280);
    oTf = `translate(393 326) rotate(${f2(a)}) scale(${(1 + sq * 0.6).toFixed(4)} ${(1 - sq).toFixed(4)}) translate(-393 -326)`;
  }
  const tag = easeOut(clamp((t - 1200) / 400));
  return {
    introScale: 0.94 + 0.06 * easeOut(ui),
    roadOpacity: ui,
    carA: car(PATH_A, 150, 700),
    carB: car(PATH_B, 250, 700),
    carC: car(PATH_C, 350, 700),
    pinDy,
    pinOpacity,
    oTf,
    tagOpacity: tag,
    tagDy: 8 * (1 - tag),
  };
}
