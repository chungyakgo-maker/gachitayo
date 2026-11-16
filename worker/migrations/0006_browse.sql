-- 코스 둘러보기 (설계 docs/superpowers/specs/2026-11-16-course-browse-design.md)
-- 즐겨찾기·분류 (계정마다 JSON 하나)
CREATE TABLE user_prefs (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
-- 실시간 인기: 기본 코스로 주행 중인 계정의 마지막 신호 (위치 없음, 계정마다 하나)
CREATE TABLE driving_now (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  builtin TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX driving_now_at ON driving_now (at);
