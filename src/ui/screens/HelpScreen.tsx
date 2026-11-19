// 설정 › 도움말 › 기능 알아보기 (#/help, 설계 docs/superpowers/specs/2026-11-18-help-design.md, 시안 docs/mock/2026-11-18-help.jpg):
// 처음 3단계 → 기능 칩(누르면 그 카드로) → 카드(실제 앱 화면 + 2~3줄 + 바로 가기). 내용은 help/helpCards.ts 한 곳에만
import { useMemo } from 'react';
import { HELP_CARDS, HELP_START } from '../help/helpCards';
import { IconBack } from '../icons';

/** 움직임 줄이기를 켠 사람에게는 움직이는 그림 대신 같은 이름의 정지 그림 */
function reducedMotion(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function HelpScreen() {
  const still = useMemo(reducedMotion, []);
  const go = (id: string) => document.getElementById(`help-${id}`)?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
  return (
    <main className="page help-page">
      <header className="page-head">
        <a className="back-btn" href="#/settings" aria-label="뒤로">
          <IconBack size={24} />
        </a>
        <h1>기능 알아보기</h1>
      </header>

      <section className="help-card" aria-labelledby="help-start-title">
        <h2 id="help-start-title">처음이세요? 3단계면 돼요</h2>
        <ol className="help-steps">
          {HELP_START.map((t, i) => (
            <li key={i}>
              <span className="n" aria-hidden="true">
                {i + 1}
              </span>
              <span>{t}</span>
            </li>
          ))}
        </ol>
      </section>

      <nav className="help-chips" aria-label="기능 바로 보기">
        {HELP_CARDS.map((c) => (
          <button key={c.id} type="button" onClick={() => go(c.id)}>
            {c.chip}
          </button>
        ))}
      </nav>

      {HELP_CARDS.map((c) => {
        const src = c.media && (c.media.kind === 'gif' && still ? c.media.src.replace(/\.gif$/, '.jpg') : c.media.src);
        return (
          <section key={c.id} id={`help-${c.id}`} className="help-card" aria-labelledby={`help-${c.id}-title`}>
            <h2 id={`help-${c.id}-title`}>{c.title}</h2>
            {src && (
              <div className="help-media">
                <img src={src} alt={c.title} loading="lazy" />
                {c.media!.kind === 'gif' && !still && (
                  <span className="help-gif" aria-hidden="true">
                    움직이는 그림
                  </span>
                )}
              </div>
            )}
            <ul>
              {c.lines.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
            {c.link && (
              <a className="help-go" href={c.link.href}>
                {c.link.label} ›
              </a>
            )}
          </section>
        );
      })}
    </main>
  );
}
