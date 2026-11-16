-- 장소 검색 하루 사용 횟수 (설계 docs/superpowers/specs/2026-11-16-destination-route-design.md 6)
-- 검색어·좌표는 저장하지 않는다. 계정·한국 날짜·횟수만
CREATE TABLE search_usage (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);
