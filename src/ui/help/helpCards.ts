// 도움말 · 기능 알아보기 (설계 docs/superpowers/specs/2026-11-18-help-design.md, 시안 docs/mock/2026-11-18-help.jpg):
// 처음 깐 사람과 나중에 기능이 궁금한 사람 둘 다 보는 한 페이지 (세영 "둘 다"). 정식 기준 — 친구 위치 공유 설명은 넣지 않는다
// (세영 "정식기준으로 설명서 만들어 친구 위치 공유기능은 빼", 테스트 빌드도 같은 페이지). 움직이는 그림(GIF)은 2개만 (세영 "gif 2개").
// 그림은 public/help/ 에 있고 scripts/help-media.cjs 가 실제 앱 화면에서 찍는다.

export interface HelpCard {
  /** 카드 이름 (그림 파일 이름 = help/<id>.jpg|gif, 페이지 안 자리 = help-<id>) */
  id: string;
  title: string;
  /** 위쪽 칩에 보이는 짧은 이름 */
  chip: string;
  media: { src: string; kind: 'jpg' | 'gif' } | null;
  lines: string[];
  link?: { href: string; label: string };
}

const pic = (id: string, kind: 'jpg' | 'gif' = 'jpg') => ({ src: `help/${id}.${kind}`, kind });

/** 처음이세요? 3단계 */
export const HELP_START: string[] = [
  '폰을 거치대에 단단히 고정하고 메인에서 주행 시작을 눌러요',
  '코스를 고르거나 그냥 출발해요. 코스가 없으면 달린 길로 저절로 만들어요',
  '다 달리면 종료를 2초 길게 눌러 랩·기록을 확인해요',
];

export const HELP_CARDS: HelpCard[] = [
  {
    id: 'lap',
    title: '코스 랩타이머 · 델타',
    chip: '랩타이머',
    media: pic('lap'),
    lines: ['출발선을 지나면 저절로 랩을 재요', '베스트 랩보다 빠르면 초록 −, 느리면 빨강 +로 보여줘요', '구간(섹터) 기록·G미터·속도도 한 화면에 나와요'],
  },
  {
    id: 'pace',
    title: '커브 표지판',
    chip: '커브 표지판',
    media: pic('pace', 'gif'),
    lines: ['다가오는 커브를 방향과 숫자로 미리 알려줘요 (1 가장 급함 ~ 6 완만, H 헤어핀, S 직각)', '남은 거리와 함께, 커브 쪽 화면 가장자리 색으로도 알려줘요'],
  },
  {
    id: 'dest',
    title: '목적지로 주행',
    chip: '목적지',
    media: pic('dest'),
    lines: ['장소를 검색하거나 지도를 길게 눌러 고르면 그 길로 커브 표지판을 띄워요', '길을 벗어나면 저절로 다시 찾아요', '기록 남기기를 끄면 기록 없이 달려요'],
    link: { href: '#/destination', label: '목적지 고르기' },
  },
  {
    id: 'course',
    title: '코스 둘러보기',
    chip: '코스',
    media: pic('course'),
    lines: ['기본 코스·모두의 코스·즐겨찾기·인기 도로를 골라 볼 수 있어요', '내 코스를 모두에게 공개하고, 남이 올린 코스를 받아 같은 출발선으로 달려요', '모의주행으로 코스를 미리 달려 봐요'],
    link: { href: '#/courses', label: '코스 보기' },
  },
  {
    id: 'team',
    title: '팀 주행',
    chip: '팀 주행',
    media: pic('team'),
    lines: ['친구로 팀을 만들어 두고(나 포함 15명) 바로 같이 출발해요', '주행 순서·권장 차 간격, 방장이 정한 목적지나 코스를 모두 함께 받아요', '카카오톡으로 "주행 열었어요"를 알려요'],
  },
  {
    id: 'bike',
    title: '바이크 모드 · 기울기',
    chip: '바이크',
    media: pic('bike', 'gif'),
    lines: ['설정 › 탈것 › 바이크를 고르면 내 위치가 바이크로 보여요 (5종)', '길찾기는 고속도로·자동차전용도로를 피하는 길을 먼저 찾아요', 'G미터 대신 기울기 바늘, 주행 요약에 최대 기울기가 나와요'],
    link: { href: '#/settings', label: '설정에서 탈것 바꾸기' },
  },
  {
    id: 'history',
    title: '기록 · 분석',
    chip: '기록',
    media: pic('history'),
    lines: ['주행이 끝나면 랩 표와 요약을 보여줘요', '지난 주행을 다시 재생하고 랩·구간·G값을 분석해요', '기록은 이 폰에만 저장돼요 · 폰을 바꿀 땐 설정 › 백업 파일로 (GPX·CSV 내보내기도 돼요)'],
    link: { href: '#/history', label: '기록 보기' },
  },
  {
    id: 'screen',
    title: '화면 설정 · 지도',
    chip: '화면 설정',
    media: pic('screen'),
    lines: ['주행 중 두 번 탭하면 지도 → 미니멀 → 대시보드로 바뀌어요', '위쪽 칸을 누르면 다음 값으로 바뀌어요 (설정에서 골라 둘 수도)', '지도는 + / −·두 손가락으로 움직이고 "내 위치로"로 돌아와요'],
  },
];
