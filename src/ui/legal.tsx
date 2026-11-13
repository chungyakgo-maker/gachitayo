// 개인정보처리방침·위치정보 이용약관 (사양서 13.3, 애플 심사·위치정보법): 웹 주소에 둔 페이지.
// 웹은 새 탭, 아이폰 앱은 앱 밖(사파리)으로 연다 (앱 안 화면이 약관 페이지로 바뀌어 돌아올 수 없게 되지 않게).
import type { ReactNode } from 'react';
import { isApp } from '../platform';

export type LegalKind = 'privacy' | 'location';

export const LEGAL_URL: Record<LegalKind, string> = {
  privacy: 'https://chungyakgo-maker.github.io/gachitayo/privacy.html',
  location: 'https://chungyakgo-maker.github.io/gachitayo/location-terms.html',
};

export async function openLegal(kind: LegalKind): Promise<void> {
  const { AppLauncher } = await import('@capacitor/app-launcher');
  await AppLauncher.openUrl({ url: LEGAL_URL[kind] });
}

export function LegalLink({ kind, children }: { kind: LegalKind; children: ReactNode }) {
  return (
    <a
      href={LEGAL_URL[kind]}
      target="_blank"
      rel="noreferrer"
      onClick={
        isApp()
          ? (e) => {
              e.preventDefault();
              void openLegal(kind);
            }
          : undefined
      }
    >
      {children}
    </a>
  );
}
