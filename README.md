# 같이타요

와인딩·서킷 주행 기록기 웹앱입니다. 폰 하나로 주행을 기록하고, 내 베스트 랩과 비교한 델타를 실시간으로 보여주고, 주행 후에 분석합니다.

- **앱 주소:** https://chungyakgo-maker.github.io/gachitayo/
- **사양서:** [docs/specs/2026-11-12-gachitayo-phase1-spec.md](docs/specs/2026-11-12-gachitayo-phase1-spec.md)
- **구현 계획:** [docs/plans/](docs/plans/)
- **현재 단계:** 1단계 개발 중 (M1 저장소 뼈대와 자동 배포)

## 처음 한 번 하는 설정

GitHub 저장소 → **Settings** → 왼쪽 **Pages** → **Build and deployment**의 **Source**를 **"GitHub Actions"**로 지정합니다. 이 설정이 없으면 배포 단계가 실패합니다. 설정한 뒤 **Actions** 탭에서 실패한 실행을 열고 **Re-run all jobs**를 누르면 됩니다.

GitHub 무료 플랜에서는 공개 저장소만 Pages를 쓸 수 있습니다.

## 배포

main에 올라가면 GitHub Actions가 자동으로 다음을 실행합니다. 진행 상황은 저장소의 **Actions** 탭에서 볼 수 있습니다.

1. 타입 검사
2. 자동 테스트
3. 빌드
4. GitHub Pages 배포

테스트가 실패하면 배포하지 않습니다.

폰에 설치한 앱은 새 버전이 나오면 홈 화면 위쪽에 **"새 버전이 있습니다 · 업데이트"**가 뜹니다. 눌러야 적용됩니다. 화면 아래쪽의 버전(커밋 번호)으로 어떤 버전인지 확인할 수 있습니다.

## 폴더

| 폴더 | 내용 |
|---|---|
| `src/ui/` | 화면 (React) |
| `src/engine/` | 계산 엔진 (순수 TypeScript, 브라우저 기능 사용 금지). 기준값은 `src/engine/config.ts` |
| `test/` | 자동 테스트 |
| `public/` | 아이콘 |
| `docs/` | 사양서, 구현 계획 |
| `.github/workflows/` | 테스트·배포 자동화 |

## 개발 명령 (참고)

Node 24가 필요합니다.

```bash
npm ci
npm run typecheck
npm test
npm run build
```
