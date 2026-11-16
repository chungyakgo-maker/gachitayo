-- 인기 도로 계산이 기본 코스 행만 빨리 찾게 (검토 지적: 매번 기록 표 전체를 훑었다)
CREATE INDEX courses_builtin ON courses (builtin);
