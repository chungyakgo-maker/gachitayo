// 메인 맨 위 목적지 검색 (사용자 요청 "최상단 새코스 없애, 검색창 하나 만들어서 목적지 검색"): 네이버 지역 검색, 결과를 누르면 목적지 화면으로
import { useRef, useState, type FormEvent } from 'react';
import { findPlaces, type Place } from '../../app/routeNav';
import { toLocal } from '../../engine/geo';
import { formatLength } from '../format';

type Search = { status: 'idle' } | { status: 'loading' } | { status: 'done'; places: Place[] } | { status: 'error'; error: string };

const SearchIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-4-4" />
  </svg>
);

export function MainSearch({ from, onPick, onOpenChange }: { from: { lat: number; lon: number } | null; onPick: (p: Place) => void; onOpenChange?: (open: boolean) => void }) {
  const [query, setQuery] = useState('');
  const [search, setSearchState] = useState<Search>({ status: 'idle' });
  const seq = useRef(0);
  const setSearch = (s: Search) => {
    setSearchState(s);
    onOpenChange?.(s.status !== 'idle');
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    const n = ++seq.current;
    setSearch({ status: 'loading' });
    findPlaces(q).then(
      (places) => n === seq.current && setSearch({ status: 'done', places }),
      (err: unknown) => n === seq.current && setSearch({ status: 'error', error: err instanceof Error ? err.message : String(err) }),
    );
  };
  const clear = () => {
    seq.current++;
    setQuery('');
    setSearch({ status: 'idle' });
  };
  const dist = (p: Place) => (from ? formatLength(Math.hypot(toLocal(from, p.lat, p.lon).x, toLocal(from, p.lat, p.lon).y)) : '');
  return (
    <>
      <form className="main-search" role="search" onSubmit={onSubmit}>
        <SearchIcon />
        <input type="search" aria-label="목적지 검색" placeholder="목적지·장소 검색" enterKeyHint="search" maxLength={60} value={query} onChange={(e) => setQuery(e.target.value)} />
        {search.status !== 'idle' && (
          <button type="button" className="link-btn" onClick={clear}>
            닫기
          </button>
        )}
      </form>
      {search.status !== 'idle' && (
        <div className="card card-col main-results">
          {search.status === 'loading' && <span className="sub" role="status">찾는 중…</span>}
          {search.status === 'error' && <span className="notice warn">{search.error}</span>}
          {search.status === 'done' && search.places.length === 0 && <span className="sub">검색 결과가 없어요</span>}
          {search.status === 'done' &&
            search.places.map((p, i) => {
              const detail = [p.category, p.address].filter(Boolean).join(' · ');
              const d = dist(p);
              return (
                <button key={i} type="button" className="sheet-item" aria-label={[p.name, detail, d].filter(Boolean).join(' · ')} onClick={() => onPick(p)}>
                  <span className="card-col dest-name">
                    <strong className="dest-name">{p.name}</strong>
                    {detail && <span className="sub dest-name">{detail}</span>}
                  </span>
                  {d && <span className="sub mono">{d}</span>}
                </button>
              );
            })}
        </div>
      )}
    </>
  );
}
