// 아이폰 앱 안 플러그인 DgoAuth (ios/App/App/DgoAuthPlugin.swift, 앱 로그인 설계 2026-11-17):
// 카카오 로그인 창(iOS 로그인 창, 돌아온 주소를 받음)과 애플 로그인 창
import { registerPlugin } from '@capacitor/core';

export interface DgoAuthPlugin {
  webAuth(o: { url: string; scheme: string }): Promise<{ url?: string; cancelled?: boolean }>;
  appleSignIn(o: { nonce: string }): Promise<{ identityToken?: string; authorizationCode?: string; name?: string; cancelled?: boolean }>;
}

export const DgoAuth = registerPlugin<DgoAuthPlugin>('DgoAuth');
