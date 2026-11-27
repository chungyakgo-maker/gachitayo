// 기본 코스 목록 (사양서 7.5) — 이름·지역·설명·분류·선 고친 차례. 경로 점은 builtinData.ts.
// 이 파일과 builtinData.ts 가 기본 코스의 하나뿐인 원본이다: 서버(worker/src/builtin.ts)가 이 둘을 그대로 내려주고,
// 웹·앱은 열 때 서버 목록을 받아 쓴다 (2026-11-27 세영 "코스 추가될 때마다 앱 배포 다시 안 하는 방향으로 … 웹 앱 통일").
// 앱에도 같이 묶어 두어 통신이 없을 때(처음 설치 직후 산속 등) 쓴다. 다른 파일을 불러오지 않는다 (서버도 이 파일을 묶는다).
// 코스 추가: 아래 목록에 한 줄 + builtinData.ts 에 점 → main 배포. 선 고침: 점을 바꾸고 rev +1.
// 세영이 직접 올리는 코스는 courses/ 폴더 (GPX + 정보.txt, courses/README.md) → 빌드 때 builtinUser.gen.ts 로 만들어 맨 뒤에 붙는다.
import { USER_BUILTINS } from './builtinUser.gen';

export interface BuiltinCourse {
  key: string;
  name: string;
  /** 어디서 어디로 (목록에 보이는 글) */
  route: string;
  /** 코스 상세에 보이는 설명 (한 줄씩, 서킷 — 2026-11-27 세영이 준 글) */
  desc?: readonly string[];
  /** 예전 기본 이름. 폰에 이 이름으로 들어 있으면 새 이름으로 바꾼다 (사용자가 직접 바꾼 이름은 그대로) */
  oldNames?: readonly string[];
  /** 처음 분류 (없으면 산 길). 사용자가 코스 상세에서 바꾸면 그쪽이 이긴다 */
  tags?: ReadonlyArray<'circuit' | 'coast' | 'mountain'>;
  /** 선 고친 차례 (없으면 1). 올리면 폰에 든 이 코스 선을 한 번 새 선으로 바꾼다 (사용자가 고친 코스는 그대로) */
  rev?: number;
}

/** 목록에 보이는 순서 (코드에 적은 코스) */
export const HAND_BUILTINS: readonly BuiltinCourse[] = [
  { key: 'baehuryeong', name: '배후령', route: '춘천 → 화천' },
  { key: 'misiryeong-old', name: '미시령 옛길', route: '인제 → 고성' },
  { key: 'manhangjae', name: '만항재', route: '태백 → 만항재 쉼터' },
  { key: 'maltijae', name: '말티재', route: '보은 → 말티재 전망대' },
  { key: 'guryongnyeong', name: '구룡령', route: '홍천 → 양양' },
  { key: 'gapyeong-bokjang-sangcheon', name: '로코갤러리', route: '가평읍 → 청평면', oldNames: ['가평 복장리–상천리'] },
  { key: 'haogogae', name: '하오고개', route: '의왕 청계 → 분당 운중' },
  { key: 'bukak-skyway', name: '북악스카이웨이', route: '부암동 → 정릉' },
  { key: 'namhansanseong', name: '남한산성', route: '성남 산성동 → 남한산성' },
  { key: 'jinbu-myeon', name: '진부면', route: '진부 → 숙암' },
  { key: 'pyeonghwa-dam', name: '평화의댐', route: '화천 → 양구' },
  // 사용자가 준 카카오맵 GPX (2026-11-13 두 번째). 이름 셋(팔공산 한티재·신동재·미륵고개전망대)은 사용자가 알려 줌, 둘은 GPX 도착지 이름
  { key: 'gunwi-namsan-chilgok-giseong', name: '팔공산 한티재', route: '군위 부계면 → 칠곡 동명면' },
  { key: 'chilgok-yeonho-deoksan', name: '신동재', route: '칠곡 지천면 연호리 → 덕산리' },
  { key: 'hambaek-mungok', name: '미륵고개전망대', route: '함백역 → 정선 남면 문곡리' },
  { key: 'maebongsan-baramui-eondeok', name: '매봉산 바람의언덕', route: '태백 적각동 → 매봉산 바람의언덕' },
  { key: 'jeoksangsan-observatory', name: '적상산전망대', route: '무주 적상면 북창리 → 적상산전망대' },
  // 사용자가 준 카카오맵 GPX (2026-11-14). 이름은 GPX에 적힌 곳 이름 (사용자가 바꾸면 oldNames로 옮긴다)
  { key: 'sukam-bukpyeong', name: '숙암리–북평리', route: '정선 북평면 숙암리 → 북평리' },
  // 사용자가 준 카카오맵 GPX (2026-11-26). 이름은 사용자가 정함
  { key: 'garakjae-neuratjae', name: '가락재+느랏재', route: '작은도시미 → 춘천 동면 감정리' },
  // 사용자가 준 서킷 GPX (2026-11-27, GPX Hub 로 트랙 가운데를 다시 딴 인제스피디움.gpx — 처음 넣은 OSM 선을 바꿈). 첫 기본 랩 코스: 출발점 = 첫 점, 한 바퀴
  {
    key: 'inje-speedium',
    tags: ['circuit'],
    rev: 2,
    name: '인제 스피디움',
    route: '강원 인제 · 서킷 한 바퀴',
    desc: ['풀코스 3.908 km, 코너 20개', '시계 방향으로 돌고, 고저차가 166 m', '오르막과 내리막이 심한 산악형 테크니컬 코스'],
  },
  // 사용자가 준 서킷 GPX 세 개 (2026-11-27, GPX Hub 트랙 가운데). 설명은 세영이 준 글. 출발선 = 첫 점 (실제 컨트롤 라인과 맞춰 보지 않음)
  {
    key: 'yeongam-kic-full',
    tags: ['circuit'],
    name: '영암 KIC 풀코스',
    route: '전남 영암 · 서킷 한 바퀴',
    desc: [
      '길이 5.615 km, 코너 18개',
      '2011년 F1에서 베텔이 세운 1:39.605가 레이스 랩 기록',
      '직선 구간 1.2 km는 세계 서킷 가운데 가장 긴 편이라 최고속이 많이 나와요',
      '국내에서 하나뿐인 FIA 1등급 서킷, 2010~2013년 F1 코리아 그랑프리',
    ],
  },
  {
    key: 'yeongam-kic-national',
    tags: ['circuit'],
    name: '영암 KIC 상설코스',
    route: '전남 영암 · 서킷 한 바퀴',
    desc: ['길이 3.045 km, 코너 11개, FIA 2등급(National)', '풀코스의 일부를 잘라 쓰는 구조라 긴 백스트레이트가 빠져요', '일반 스포츠주행과 트랙데이는 주로 이 코스에서 열려요'],
  },
  {
    key: 'taebaek-speedway',
    tags: ['circuit'],
    name: '태백 스피드웨이',
    route: '강원 태백 · 서킷 한 바퀴',
    desc: ['길이 2.5 km, 해발 700 m가 넘는 고원지대', '가장 긴 직선은 900 m', '마지막 자이언트 고속코너를 빠져나오면 바로 메인 스트레이트로 이어지는 고속형 서킷, 일부 구간은 오벌 형태'],
  },
];

/** 기본 코스 전체: 코드에 적은 코스 + courses/ 폴더 코스 */
export const BUNDLED_BUILTINS: readonly BuiltinCourse[] = [...HAND_BUILTINS, ...USER_BUILTINS];
