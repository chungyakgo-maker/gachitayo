-- 애플 로그인 연결 끊기용 토큰 (앱 로그인 설계 2026-11-17, 애플 규칙: 계정을 지우면 애플 연결도 끊는다)
CREATE TABLE IF NOT EXISTS apple_tokens (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
