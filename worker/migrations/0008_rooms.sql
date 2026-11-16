-- 그룹 주행 방 (설계 docs/superpowers/specs/2026-11-16-group-drive-design.md): 6자리 코드 → 방 (24시간 유효). 방 안 상태는 Durable Object GroupRoom이 든다
CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  host_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX rooms_code ON rooms (code, created_at);
