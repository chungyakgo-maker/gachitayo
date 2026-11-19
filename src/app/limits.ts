// 폰에 두는 한도 (설계 docs/superpowers/specs/2026-11-18-local-records-course-share-design.md 1부): 숫자는 여기 한 곳에서만 바꾼다.
// 기록을 서버에 안 올리니(세영 "서버 비용") 폰이 너무 커지지 않게 원본 센서 자료만 줄인다. 랩·요약·궤적은 한도 없음

/** 원본 센서 자료를 남길 최근 주행 수 (30분 주행 약 3~5 MB) */
export const RAW_KEEP = 30;
/** 내 코스(기본 코스 빼고, 받은 코스 포함) 최대 수 */
export const MY_COURSE_LIMIT = 200;
/** 마지막 백업 뒤 이만큼 지나면 기록 탭에서 한 번 알린다 */
export const BACKUP_REMIND_DAYS = 30;
/** 기록이 이만큼은 있어야 백업 알림을 띄운다 (처음 깐 사람에게 바로 띄우지 않게) */
export const BACKUP_REMIND_MIN = 5;
/** 계정당 모두의 코스 공개 수 (서버 worker/src/shared.ts PUBLISH_LIMIT 와 같게) */
export const PUBLISH_LIMIT = 20;
