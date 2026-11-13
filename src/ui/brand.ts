// 앱 이름 (사용자 결정): 아이폰 앱은 디고, 웹(개발자용)은 같이타요. GPX 형식 표시(GPX_CREATOR)는 바꾸지 않는다(왕복 호환)
import { isApp } from '../platform';

export const appName = (): string => (isApp() ? '디고' : '같이타요');
