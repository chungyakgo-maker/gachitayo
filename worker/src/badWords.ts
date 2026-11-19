// 공개 코스 이름 거르기 (모두의 코스, 애플 심사 1.2 "불쾌한 콘텐츠 거르기"): 이름에서 띄어쓰기·기호를 뺀 뒤 이 말이 들어 있으면 받지 않는다.
// 앱은 서버가 준 문구만 보인다 (목록을 두 곳에 두지 않게). 더할 땐 여기만 고친다.
// 땅 이름·흔한 낱말에 들어가는 말(대마도·한남대교·새끼줄·살인미소 같은)은 넣지 않는다 — 멀쩡한 코스 이름이 막히지 않게
export const BAD_WORDS: readonly string[] = [
  '씨발', '시발', 'ㅅㅂ', '씨빨', '시바ㄹ', '병신', 'ㅂㅅ', '븅신', '좆', '존나', 'ㅈㄴ', '개새끼', '개새', '쌔끼', '미친놈', '미친년', '지랄', 'ㅈㄹ',
  '닥쳐', '꺼져', '엠창', '느금', '니애미', '창녀', '걸레', '섹스', '야동', '강간',
  '자살', '필로폰', '도박', '카지노', '김치녀', '틀딱', '장애인새끼', '쪽바리', '짱깨', '흑형',
  'fuck', 'shit', 'bitch', 'porn', 'nigger', 'nigga', 'cunt',
];

/** 나쁜 말이 들어 있어도 괜찮은 낱말 (땅 이름 등) — 낱말에서 먼저 지우고 본다 */
const ALLOW: readonly string[] = ['시발점', '시발역'];

/** 이름에 쓸 수 없는 말이 있는지: 보이지 않는 글자를 지우고, 띄어 쓴 낱말마다 본다
 *  (띄어쓰기를 다 지우고 보면 "화성시 발안"이 "시발"로 막혔다, 검토 지적) */
export function hasBadWord(name: string): boolean {
  const clean = name.replace(/[\p{Cf}\p{Cc}]/gu, '').toLowerCase();
  return clean.split(/\s+/).some((token) => {
    let t = token.replace(/[\p{P}\p{S}0-9_]+/gu, '');
    for (const a of ALLOW) t = t.split(a).join('');
    return t.length > 0 && BAD_WORDS.some((w) => t.includes(w));
  });
}
