# heyclaude.md — Claude Code 전용 안내문

> 이 파일은 Claude Code가 읽고 따라하는 안내문입니다. 사람이 직접 보지 않아도 OK.

## 직원 첫 세팅 (자동 진행)

사용자가 처음 goskill을 받아 세팅할 때 Claude Code가 이 단계를 순서대로 진행한다.
각 단계마다 명령어 실행 → 결과 확인 → 다음 단계.

### Step 1. 공용 스킬 레포(`~/goskill_stage/`) 확인 및 클론

goskill 앱이 REMOTE 패널을 표시하려면 이 폴더가 필수.

```bash
if [ ! -d "$HOME/goskill_stage" ]; then
  git clone https://github.com/bnam91/goskill_stage "$HOME/goskill_stage"
  echo "✅ goskill_stage 클론 완료"
else
  echo "✓ 이미 있음 — git pull로 최신화"
  git -C "$HOME/goskill_stage" pull --ff-only
fi
```

### Step 2. 의존성 설치 확인

```bash
cd "$HOME/github/goskill"
if [ ! -d node_modules ] || [ ! -d node_modules/electron ]; then
  npm install
  echo "✅ 의존성 설치 완료"
else
  echo "✓ 의존성 이미 설치됨"
fi
```

### Step 3. 앱 실행 안내

```bash
cd "$HOME/github/goskill" && npm start
```

이때 첫 실행이면 자동업데이트 다이얼로그가 뜰 수 있음. "지금 업데이트" 클릭하면 자동 재시작 후 최신 버전.

### Step 4. 사용자에게 다음 행동 안내

앱이 켜졌으면 사용자에게 안내:
- 우측 **REMOTE 패널**의 **`📦 원격전용 · onboarding`** 그룹에 **chrome-cdp** 보임
- 클릭해서 좌측 **LOCAL**로 다운로드 → `~/.claude/skills/chrome-cdp/`에 설치됨
- 그러면 Claude Code에서 `/chrome-cdp` 사용 가능

## 트리거 조건

- 사용자가 "goskill 세팅", "초기 세팅", "처음 시작" 같은 말 할 때
- `~/goskill_stage/` 폴더 없거나 `node_modules` 없으면 자동 진행 권장

## 운영 흐름 (참고)

| 위치 | 역할 |
|------|------|
| `~/github/goskill/` | 앱 본체 (이 레포) |
| `~/goskill_stage/` | 공용 스킬 카탈로그 (`bnam91/goskill_stage` 클론) |
| `~/.claude/skills/` | 직원의 개인 스킬 (LOCAL) |

직원이 다운로드한 스킬은 `~/.claude/skills/`에 들어가 Claude Code가 자동 인식.
