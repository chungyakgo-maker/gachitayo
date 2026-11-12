-- 친구 위치 공유 (사양서 6.5, M8: 사용자 요청으로 2단계에서 앞당김). 배포할 때 GitHub Actions가 자동으로 적용한다.

-- 내 친구 코드 (8자리, 헷갈리는 글자 0·O·1·I·L 없음). 처음 친구 화면을 열 때 만든다
ALTER TABLE users ADD COLUMN friend_code TEXT;
CREATE UNIQUE INDEX users_friend_code ON users (friend_code);

-- 친구: 코드를 넣으면 바로 서로 친구 (두 방향 행). 삭제하면 두 행 모두 지운다
CREATE TABLE friends (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, friend_id)
);

-- 공유 중인 위치: 사람마다 마지막 위치 하나만 (이동 경로는 저장하지 않는다). 공유를 끄면 지운다
CREATE TABLE presence (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  h_acc REAL,
  heading REAL,
  speed REAL,
  at INTEGER NOT NULL
);

-- 틀린 친구 코드 입력 (코드를 짐작해 맞히는 것 방지: 1시간에 20번까지)
CREATE TABLE friend_code_misses (
  user_id TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX friend_code_misses_user_at ON friend_code_misses (user_id, at);
