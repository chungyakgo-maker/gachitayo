-- 팀·팀 주행·프로필 사진 (설계 docs/superpowers/specs/2026-11-18-team-drive-design.md, 사용자 요청 "팀 만들기 최대 15명, 친구를 넣어", "프사 동그랗게")
-- 배포할 때 GitHub Actions가 자동으로 적용한다.

-- 프로필 사진: 맞힐 수 없는 무작위 id (R2 avatars/{id}.jpg). 없으면 NULL. 새로 올리면 새 id
ALTER TABLE users ADD COLUMN avatar TEXT;

-- 팀: 만든 사람이 팀장. 순서·차 간격은 다음 팀 주행에 그대로 쓰려고 기억한다. drive_room_id = 지금 열린 팀 주행 방
CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  gap_s REAL NOT NULL DEFAULT 2,
  order_json TEXT,
  drive_room_id TEXT
);
CREATE INDEX teams_owner ON teams (owner_id);

-- 팀원 (팀장도 한 줄). 한 사람이 속한 팀은 5개까지
CREATE TABLE team_members (
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX team_members_user ON team_members (user_id);
