# goskill

고야 스킬 선택적 배포 시스템의 GUI 앱 (Electron). 대표님이 만든 스킬 중 직원에게 공유할 것을 선택/관리하고, 직원이 공용 레포에서 스킬을 다운받을 때도 사용한다.

GitHub: https://github.com/bnam91/goskill

> **🚀 신규 세팅이 필요한 사용자 (직원 첫 설치 등)**: `heyclaude.md` 파일을 따라 자동 진행. 사용자가 "세팅 도와줘", "처음 시작", "초기 세팅" 같은 말을 하거나 `~/goskill_stage/` 폴더가 없는 상태이면 그 안내문으로 이동할 것.

## 이 프로젝트의 위치

전체 "스킬 선택적 배포 시스템"의 일부.

- **배포 시스템 설계 문서**: Notion CHARIZARD > [스킬 선택적 배포 시스템 — 설계 제안서](https://www.notion.so/349111a57788811fb89de43bedc41a57)
- **폴더 구조 시각화 문서**: Notion CHARIZARD > [스킬 배포 시스템 — 폴더 구조 한눈에 보기](https://www.notion.so/349111a577888120b03de37b9b517c2c)
- **CLI 도구 (install.sh)**: `~/claude_skills/install.sh`
- **공용 스킬 레포 (로컬)**: `~/claude_skills/`
- **공용 스킬 레포 (원격)**: github.com/bnam91/claude_skills

## 현재 MVP 범위

**View-only**. 두 폴더의 내용을 FileZilla처럼 좌우로 보여주는 것만. 실제 publish/unpublish 같은 동작은 나중에 붙임.

## 화면 구조

```
┌────────────────────────────────┬────────────────────────────────┐
│ LOCAL (내 스킬)                 │ REMOTE (공용 레포)              │
│ ~/.claude/skills/              │ ~/claude_skills/               │
│                                │                                │
│ 📁 cto-cc          [개인]       │ 📁 notion_manager   [depth01]  │
│ 📁 notion_manager  [★ 공유중]   │ 📁 gmail_manager    [depth02]  │
│ ...                            │ ...                            │
└────────────────────────────────┴────────────────────────────────┘
```

## 폴더 의미

| 사이드 | 경로 | 내용 |
|---|---|---|
| LOCAL  | `~/.claude/skills/` | 대표님 개인 작업실. 모든 스킬(개인용 포함) |
| REMOTE | `~/claude_skills/` | 공용 레포 로컬 클론. 직원에게 공개된 것만 |

### 🔒 불변 원칙 (제안): LOCAL 경로는 모든 사용자가 동일

대표님이든 직원이든 **다운로드(install) 받은 스킬은 무조건 `~/.claude/skills/` 에만 들어간다.**
이유:
- Claude Code가 자동 인식하는 표준 스킬 디렉토리
- 경로가 사용자마다 다르면 스킬 내부의 상대 경로 참조가 깨짐
- `install.sh`가 symlink를 거는 기준 경로
- 이 앱의 LOCAL pane은 항상 `~/.claude/skills/`를 보여줌

> ⚠️ 이 경로를 다른 것으로 바꾸거나 커스터마이징 하지 말 것. CLI/앱/MCP 모든 도구가 이 경로를 가정함.

> 🟡 **TODO (대표님 확인 필요)**: 현재 대표님 맥과 직원 맥에서 실제로 이 경로가 어떻게 되어있는지 먼저 확인이 필요함. `install.sh`의 symlink 타겟, Claude Code CLI가 읽는 실제 경로, 직원들이 지금까지 쓰던 경로 — 세 군데를 교차 검증해서 전부 `~/.claude/skills/`로 일치하는지 점검 후에 이 원칙을 확정한다.

## 상태 라벨

- `★ 공유중` — 양쪽에 동일 이름 존재 (이미 publish됨)
- `개인` — LOCAL에만 있음
- `원격전용` — REMOTE에만 있음 (드문 케이스)
- `depth01~04` — REMOTE 쪽 skills-list.json의 등급

## 기술 스택

- Electron (main + preload + renderer)
- 순수 HTML/CSS/JS (빌드 툴 없음)
- 파일시스템만 읽음 (외부 API 호출 없음)

## 실행

```bash
cd ~/github/goskill
npm install      # 최초 1회, electron 다운로드 (~200MB)
npm start        # CDP 포트 9344로 실행
```

## CDP 포트

**9344 고정.** `npm start` 스크립트에 `--remote-debugging-port=9344` 명시.
다른 포트로 띄우지 말 것 — port-status 스킬에 등록되어 있음.

자동화가 필요할 때 MCP 연결:
```
http://localhost:9344/json
```

## 주요 파일

- `main.js` — Electron 메인 프로세스, 파일시스템 IPC 핸들러
- `preload.js` — 렌더러에 안전한 API 노출 (`window.api`)
- `renderer/index.html` — UI 마크업
- `renderer/styles.css` — 스타일
- `renderer/renderer.js` — UI 로직 (스킬 목록 로드, 상태 계산, 상세 표시)

## IPC 계약

| 채널 | 인자 | 반환 |
|---|---|---|
| `skills:list` | `{ side: 'local' \| 'remote' }` | `[{name, mtime, size, hasSkillMd}]` |
| `skills:read` | `{ side, name }` | `{ files: [...], preview: string, depth: string \| null }` |
| `catalog:read` | (없음) | `{ depths, skills }` — remote의 skills-list.json |

## 확장 계획 (나중)

1. **동작 추가**: 우클릭 메뉴로 publish/unpublish/install
2. **드래그 앤 드롭**: 좌→우 드래그로 publish
3. **diff 뷰**: 같은 이름인데 내용이 다를 때 차이 표시
4. **검색/필터**: 이름, depth, 상태별 필터 ✅ (2026-04-22 구현)

## TODO

### 업로드 규칙 검수 시스템 (공용 레포에 올리기 전 안전장치)
업로드 실행 직전에 자동 검수 단계를 넣어서, 규칙에 맞지 않는 스킬은 업로드를 막거나 경고한다.

**검수 항목 아이디어:**
- **필수 파일 존재 여부**: `SKILL.md` 또는 `README.md` 중 하나 필수
- **SKILL.md frontmatter 검증**:
  - `name` 필드 존재
  - `description` 필드 존재 + 비어있지 않음 + 한국어 조사 + 트리거 키워드 포함 형식 권장
- **비밀 값 유출 검사**: 스킬 내 모든 파일에서 `.env`, API 키 패턴(`sk-...`, `AIza...` 등), 이메일, 전화번호, 사내 호스트명(`internal`, `.local`) 스캔
- **크기 제한**: 스킬 폴더 총 용량 (예: 5MB 이하) — 바이너리/대용량 자료 실수 업로드 방지
- **개인 경로 하드코딩 검사**: `/Users/a1/`, `~/Documents/개인/` 같은 대표님 개인 경로가 포함된 파일 감지
- **심볼릭 링크 여부**: symlink 스킬은 copy-based publish 원칙에 어긋나므로 차단 또는 경고
- **이름 규칙**: 레포 네이밍 컨벤션 (소문자 + 언더스코어/하이픈) 준수 여부
- **중복 체크**: 이미 같은 이름이 REMOTE에 있고 내용이 다를 때 "덮어쓰기" 확인

**UX 흐름:**
1. 사용자가 LOCAL에서 스킬들 체크 → depth 지정 → `📤 업로드 실행` 클릭
2. 검수 화면 모달 표시 (체크리스트 형식, 각 항목 pass/fail/warn)
3. fail 있으면 업로드 차단, warn은 사용자 확인 후 진행
4. 모두 통과하면 최종 confirm → 실제 업로드

**구현 단계:**
- [ ] 검수 규칙 엔진 (main process, 순수 JS 함수들)
- [ ] 검수 결과 리포트 UI (모달, 각 규칙별 결과 표시)
- [ ] 규칙 활성/비활성 토글 (규칙이 늘어나면 user preference)
- [ ] 실제 업로드 구현 (copy + git commit + push)

## 관련 메모리

- `project_skill_deploy_system` — 전체 배포 시스템 설계 확정사항
- `user_role` — 사용자는 대표, 직원 2명 규모
