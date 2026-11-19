-- 기록은 폰에만 (설계 docs/superpowers/specs/2026-11-18-local-records-course-share-design.md "인기 도로"):
-- 주행 기록을 더는 올리지 않으니, 인기 도로 수는 "이 계정이 이 코스를 이날 달렸다" 한 줄로 센다 (위치·시각 없음, 한국 날짜만).
-- course_key: 기본 코스 'b:{key}', 모두의 코스 's:{id}'
CREATE TABLE course_drives (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  course_key TEXT NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY (user_id, course_key, day)
);
CREATE INDEX course_drives_key_day ON course_drives (course_key, day);
