-- 같이타요 1단계 서버 표 (사양서 6.5, Cloudflare D1). 배포할 때 GitHub Actions가 자동으로 적용한다.
-- 행은 모두 owner_id로 주인을 기록하고, Worker가 요청마다 본인 행인지 확인한다 (D1에는 RLS가 없다).

-- 익명 계정: 폰 열쇠는 원래 값 대신 SHA-256 값만 저장한다
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 계정 만들기 남용 방지 (같은 IP에서 1시간에 10개까지)
CREATE TABLE signup_log (
  ip TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX signup_log_ip_at ON signup_log (ip, at);

CREATE TABLE courses (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('loop', 'point_to_point')),
  source TEXT NOT NULL CHECK (source IN ('auto', 'map', 'gpx')),
  origin TEXT NOT NULL,
  start_gate TEXT NOT NULL,
  finish_gate TEXT NOT NULL,
  centerline TEXT,
  length_m REAL,
  sector_bounds_m TEXT,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX courses_owner ON courses (owner_id);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  course_id TEXT REFERENCES courses (id) ON DELETE SET NULL,
  course_version INTEGER,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  device TEXT,
  calibration TEXT,
  raw_key TEXT,
  processed_key TEXT,
  format_version INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX sessions_owner ON sessions (owner_id, started_at);
CREATE INDEX sessions_course ON sessions (course_id);

CREATE TABLE laps (
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  lap_no INTEGER NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  lap_time_ms INTEGER NOT NULL,
  sector_times_ms TEXT,
  valid INTEGER NOT NULL,
  invalid_reason TEXT,
  max_speed REAL,
  trace TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (session_id, lap_no)
);
CREATE INDEX laps_owner ON laps (owner_id);
