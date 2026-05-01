# goskill

고야 스킬 선택적 배포 GUI. 대표님 개인 스킬과 공용 레포 스킬을 좌우 창으로 비교하고 클릭으로 다운로드/업로드할 수 있는 Electron 앱.

## 빠른 시작

```bash
git clone https://github.com/bnam91/goskill ~/github/goskill
git clone https://github.com/bnam91/goskill_stage ~/goskill_stage
cd ~/github/goskill && npm install && npm start
```

> **직원/신규 사용자**: Claude Code에서 "goskill 세팅 도와줘"라고 말하면 자동으로 위 단계를 진행합니다. (`heyclaude.md` 안내문 기반)

## 무엇을 하나

- **LOCAL** (왼쪽): `~/.claude/skills/` — 본인 Claude Code 스킬
- **REMOTE** (오른쪽): `~/goskill_stage/` — 공용 스킬 카탈로그 (GitHub 클론)
- 좌우 비교, 태그별 그룹, 클릭으로 다운로드/업로드

## 주요 기능

- **자동 git pull**: 새로고침 시 REMOTE 자동 동기화 (GitHub 최신 상태)
- **자동업데이트**: 앱 시작 시 GitHub Releases 체크 → 새 버전이 있으면 자동 적용 + 재시작
- **태그 시스템**: `onboarding`, `browser` 같은 자유 태그로 스킬 분류

## 개발

```bash
npm run dev   # 핫 리로드 (NODE_ENV=development)
npm start     # 일반 실행
```

릴리스:
```bash
git tag vX.Y.Z && git push origin vX.Y.Z
gh release create vX.Y.Z --title "vX.Y.Z" --notes "..." --latest
```

## 관련 레포

- [bnam91/goskill_stage](https://github.com/bnam91/goskill_stage) — 공용 스킬 카탈로그
- [bnam91/module_update_auto](https://github.com/bnam91/module_update_auto) — 자동업데이트 모듈
