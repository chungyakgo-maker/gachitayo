-- 카카오 로그인 (설계 docs/superpowers/specs/2026-11-13-kakao-login-design.md 5.1)

-- 로그인 연결: 카카오 회원번호(subject) → 계정. 한 계정에 카카오 하나
CREATE TABLE identities (
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE UNIQUE INDEX identities_user_provider ON identities (user_id, provider);

-- 로그인으로 받은 기기별 폰 열쇠 (SHA-256 값만). 첫 익명 열쇠는 users.token_hash에 그대로
CREATE TABLE user_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE INDEX user_tokens_user ON user_tokens (user_id);

-- 로그인 한 번의 상태 (10분). 콜백에서 카카오 회원번호·닉네임·번호(pin)를 적고, 마치기에서 계정을 정한다
CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  verifier_hash TEXT NOT NULL,
  user_id TEXT,
  return_to TEXT NOT NULL,
  ip TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  kakao_id TEXT,
  kakao_nickname TEXT,
  pin_hash TEXT,
  tries INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX oauth_states_ip_at ON oauth_states (ip, created_at);

-- 기본 코스 키 (폰을 바꿔도 같은 기본 코스로 이어 붙이려고)
ALTER TABLE courses ADD COLUMN builtin TEXT;
