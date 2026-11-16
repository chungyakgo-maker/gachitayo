-- 그룹 주행 방 코드 틀린 횟수 (검토 지적: 6자리 코드를 계속 넣어 남의 방에 들어가는 것 막기). 친구 코드 friend_code_misses와 같은 방식
CREATE TABLE IF NOT EXISTS room_code_misses (
  user_id TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS room_code_misses_user_at ON room_code_misses (user_id, at);
