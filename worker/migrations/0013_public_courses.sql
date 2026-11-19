-- 모두의 코스 (설계 docs/superpowers/specs/2026-11-18-local-records-course-share-design.md 2부):
-- 공개한 코스(줄인 선·출발선·도착선, 기록 없음), 받기·신고(한 사람 한 번), 이 사람 코스 안 보기, 관리자의 공개 막기
CREATE TABLE public_courses (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  region TEXT NOT NULL,
  kind TEXT NOT NULL,
  length_m REAL NOT NULL,
  start_gate TEXT NOT NULL,
  finish_gate TEXT NOT NULL,
  sector_bounds TEXT,
  line TEXT NOT NULL,
  thumb TEXT NOT NULL,
  start_lat REAL NOT NULL,
  start_lon REAL NOT NULL,
  adds INTEGER NOT NULL DEFAULT 0,
  reports INTEGER NOT NULL DEFAULT 0,
  -- open: 공개 중, hidden: 신고 3건·관리자가 숨김
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX public_courses_status_created ON public_courses (status, created_at);
CREATE INDEX public_courses_owner ON public_courses (owner_id);
CREATE TABLE course_adds (
  course_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  at INTEGER NOT NULL,
  PRIMARY KEY (course_id, user_id)
);
CREATE TABLE course_reports (
  course_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  note TEXT,
  at INTEGER NOT NULL,
  -- 관리자가 숨김을 풀면 1 (세지 않지만 줄은 남겨 같은 사람이 다시 신고하지 못하게)
  cleared INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (course_id, user_id)
);
CREATE TABLE user_blocks (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (user_id, blocked_id)
);
CREATE TABLE publish_bans (
  user_id TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);
