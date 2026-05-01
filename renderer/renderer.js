const els = {
  listLocal:   document.getElementById('list-local'),
  listRemote:  document.getElementById('list-remote'),
  pathLocal:   document.getElementById('path-local'),
  pathRemote:  document.getElementById('path-remote'),
  countLocal:  document.getElementById('count-local'),
  countRemote: document.getElementById('count-remote'),
  detail:      document.getElementById('detail'),
  status:      document.getElementById('status-text'),
  refresh:     document.getElementById('refresh'),
  stagePanel:  document.getElementById('stage-panel'),
  stageItemsLocal:  document.getElementById('stage-items-local'),
  stageItemsRemote: document.getElementById('stage-items-remote'),
  scLocal:     document.getElementById('sc-local'),
  scRemote:    document.getElementById('sc-remote'),
  btnClearLocal:   document.getElementById('btn-clear-local'),
  btnClearRemote:  document.getElementById('btn-clear-remote'),
  btnExecUpload:   document.getElementById('btn-exec-upload'),
  btnExecDownload: document.getElementById('btn-exec-download'),
  btnExecDelete:   document.getElementById('btn-exec-delete'),
  searchLocal:     document.getElementById('search-local'),
  searchRemote:    document.getElementById('search-remote'),
  filterLocal:     document.getElementById('filter-local'),
  filterRemote:    document.getElementById('filter-remote'),
  btnHeyclaudePrompt: document.getElementById('btn-heyclaude-prompt'),
  btnSetupPrompt:  document.getElementById('btn-setup-prompt'),
  appVersion:      document.getElementById('app-version'),
};

// 앱 시작 시 버전 표시
(async () => {
  try {
    const v = await window.api.appVersion();
    if (els.appVersion) els.appVersion.textContent = v;
  } catch {
    if (els.appVersion) els.appVersion.textContent = '';
  }
})();

// catalog에서 사용된 모든 태그를 동적으로 수집 (정렬: onboarding 우선 → 알파벳)
function getTagKeys() {
  const set = new Set();
  for (const info of Object.values(state.catalog?.skills || {})) {
    if (info?.tag) set.add(info.tag);
  }
  const arr = [...set];
  arr.sort((a, b) => {
    if (a === 'onboarding') return -1;
    if (b === 'onboarding') return 1;
    return a.localeCompare(b);
  });
  return arr;
}

let state = {
  local:  { items: [] },
  remote: { items: [] },
  catalog: { skills: {} },
  selected: null, // { side, name }
  stagedLocal:  new Set(), // 업로드 후보 (LOCAL → REMOTE)
  stagedRemote: new Set(), // 다운받기 후보 (REMOTE → LOCAL)
  uploadTags: new Map(),   // name → tag (업로드 시 분류)
  customTags: new Set(),   // 사용자가 이 세션에 추가한 새 태그 (catalog에 아직 없음)
  prepStatus: new Map(),   // name → boolean (goskill_stage에 heyclaude.md 있는지 = 전처리 완료)
  publishStatus: {},       // name → 'published' | 'staged' (origin/main에 push됐는지)
  filter:   { local: '',    remote: ''    },
  category: { local: 'all', remote: 'all' },
  groupOverride: new Map(), // groupKey → 'collapsed'|'expanded' (사용자 수동 토글)
};

function setStatus(text) { els.status.textContent = text; }

// Electron의 window.prompt() 미지원을 우회하는 커스텀 모달.
// 반환: 입력 문자열 / 취소 시 null.
// validate: (val) => null|undefined 통과, string 반환 시 에러 메시지 표시.
function showPrompt({ title = '', message = '', defaultValue = '', placeholder = '', password = false, validate = null } = {}) {
  return new Promise((resolve) => {
    const backdrop = document.getElementById('prompt-modal');
    const titleEl = document.getElementById('prompt-modal-title');
    const msgEl = document.getElementById('prompt-modal-message');
    const input = document.getElementById('prompt-modal-input');
    const errEl = document.getElementById('prompt-modal-error');
    const okBtn = document.getElementById('prompt-modal-ok');
    const cancelBtn = document.getElementById('prompt-modal-cancel');

    titleEl.textContent = title;
    msgEl.textContent = message;
    input.type = password ? 'password' : 'text';
    input.placeholder = placeholder;
    input.value = defaultValue;
    errEl.textContent = '';
    errEl.hidden = true;
    backdrop.hidden = false;

    setTimeout(() => { input.focus(); input.select(); }, 0);

    const cleanup = () => {
      backdrop.hidden = true;
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKey);
      backdrop.removeEventListener('click', onBackdrop);
    };
    const onOk = () => {
      const val = input.value;
      if (validate) {
        const err = validate(val);
        if (err) {
          errEl.textContent = err;
          errEl.hidden = false;
          return;
        }
      }
      cleanup();
      resolve(val);
    };
    const onCancel = () => { cleanup(); resolve(null); };
    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); onOk(); }
      else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };
    const onBackdrop = (e) => { if (e.target === backdrop) onCancel(); };

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);
    backdrop.addEventListener('click', onBackdrop);
  });
}

// 카탈로그에서 발견된 태그를 양쪽 필터 select에 동적 삽입 (catalog 로드 후 호출)
function refreshTagFilters() {
  const tagKeys = getTagKeys();

  // REMOTE 필터: all, shared, [태그들...], notag
  const remoteCurrent = els.filterRemote.value;
  els.filterRemote.innerHTML = '';
  const addOpt = (sel, value, text) => {
    const o = document.createElement('option');
    o.value = value; o.textContent = text;
    sel.appendChild(o);
  };
  addOpt(els.filterRemote, 'all', '전체');
  addOpt(els.filterRemote, 'shared', '★ 공유중');
  for (const tk of tagKeys) addOpt(els.filterRemote, tk, `📦 원격 · ${tk}`);
  addOpt(els.filterRemote, 'notag', '📦 원격 · 분류 없음');
  els.filterRemote.value = [...els.filterRemote.options].some(o => o.value === remoteCurrent) ? remoteCurrent : 'all';

  // LOCAL 필터: all, shared, [shared_태그들...], shared_notag, personal
  const localCurrent = els.filterLocal.value;
  els.filterLocal.innerHTML = '';
  addOpt(els.filterLocal, 'all', '전체');
  addOpt(els.filterLocal, 'shared', '★ 공유중 (모두)');
  for (const tk of tagKeys) addOpt(els.filterLocal, `shared_${tk}`, `★ 공유중 · ${tk}`);
  addOpt(els.filterLocal, 'shared_notag', '★ 공유중 · 분류 없음');
  addOpt(els.filterLocal, 'personal', '🔒 개인');
  els.filterLocal.value = [...els.filterLocal.options].some(o => o.value === localCurrent) ? localCurrent : 'all';
}

async function load() {
  setStatus('REMOTE git pull 중...');
  let pullStatus = '';
  try {
    const sides = await window.api.sidesInfo();
    els.pathLocal.textContent  = sides.local.path;
    els.pathRemote.textContent = sides.remote.path;

    const pull = await window.api.gitPull();
    if (pull.ok) {
      const upToDate = /Already up to date/i.test(pull.output);
      pullStatus = upToDate ? '✓ 최신' : '✓ pull 완료';
    } else if (pull.skipped) {
      pullStatus = '⚠ git 아님';
    } else {
      pullStatus = '⚠ pull 실패';
      console.warn('git pull 실패:', pull.error, pull.output);
    }

    setStatus('스킬 목록 로딩 중...');
    const [local, remote, catalog, publish] = await Promise.all([
      window.api.listSkills('local'),
      window.api.listSkills('remote'),
      window.api.readCatalog(),
      window.api.publishStatus(),
    ]);
    state.local   = local;
    state.remote  = remote;
    state.catalog = catalog;
    state.publishStatus = publish || {};

    refreshTagFilters();
    render();
    renderStagePanel();
    const shared = countShared();
    setStatus(`LOCAL ${local.items.length} · REMOTE ${remote.items.length} · 공유중 ${shared} · ${pullStatus}`);
  } catch (e) {
    setStatus(`에러: ${e.message}`);
    console.error(e);
  }
}

function localNames()  { return new Set(state.local.items.map(i => i.name)); }
function remoteNames() { return new Set(state.remote.items.map(i => i.name)); }
function isPublished(name) {
  return state.publishStatus[name] === 'published';
}

function countShared() {
  const l = localNames(), r = remoteNames();
  let n = 0;
  for (const name of l) {
    if (r.has(name) && isPublished(name)) n++;
  }
  return n;
}

function badge(side, name) {
  const inLocal  = localNames().has(name);
  const inRemote = remoteNames().has(name);
  if (inLocal && inRemote) {
    if (isPublished(name)) return ['★ 공유중', 'badge-shared'];
    return ['🟡 푸시 대기', 'badge-staged'];
  }
  if (side === 'local')    return ['개인',     'badge-personal'];
  return ['원격전용', 'badge-remoteonly'];
}

function tagLabel(name) {
  const info = state.catalog?.skills?.[name];
  if (!info || !info.tag) return null;
  return info.tag;
}

function stagedSet(side) {
  return side === 'local' ? state.stagedLocal : state.stagedRemote;
}

function applyFilter(items, side) {
  const q = state.filter[side].trim().toLowerCase();
  if (!q) return items;
  return items.filter(i => i.name.toLowerCase().includes(q));
}

function renderList(side) {
  const listEl  = side === 'local' ? els.listLocal  : els.listRemote;
  const allItems = (side === 'local' ? state.local : state.remote).items;
  const items = applyFilter(allItems, side);
  const countEl = side === 'local' ? els.countLocal : els.countRemote;
  const staged  = stagedSet(side);
  const total = allItems.length;
  const shown = items.length;
  countEl.textContent = (shown !== total ? `${shown}/${total}개` : `${total}개`)
    + (staged.size ? ` · ☑ ${staged.size}` : '');

  listEl.innerHTML = '';

  if (shown === 0) {
    const empty = document.createElement('li');
    empty.className = 'skill-group-header';
    empty.innerHTML = `<span class="group-sub">${state.filter[side] ? '검색 결과 없음' : '표시할 스킬 없음'}</span>`;
    listEl.appendChild(empty);
    return;
  }

  const cat = state.category[side];

  const tagKeys = getTagKeys();

  if (side === 'local') {
    const rNames = remoteNames();
    const shared   = items.filter(i =>  rNames.has(i.name));
    const personal = items.filter(i => !rNames.has(i.name));

    const sharedByTag = {};
    for (const tk of tagKeys) sharedByTag[tk] = [];
    sharedByTag.none = [];
    for (const item of shared) {
      const t = tagLabel(item.name);
      if (t && sharedByTag[t]) sharedByTag[t].push(item);
      else sharedByTag.none.push(item);
    }

    if (cat === 'all' || cat === 'shared') {
      for (const tk of tagKeys) {
        appendGroup(listEl, side, staged, `★ 공유중 · ${tk}`, '', sharedByTag[tk]);
      }
      appendGroup(listEl, side, staged, `★ 공유중 · 분류 없음`, '태그 미지정', sharedByTag.none);
    } else if (cat.startsWith('shared_')) {
      const tk = cat.replace('shared_', '');
      if (tk === 'notag') {
        appendGroup(listEl, side, staged, `★ 공유중 · 분류 없음`, '태그 미지정', sharedByTag.none);
      } else {
        appendGroup(listEl, side, staged, `★ 공유중 · ${tk}`, '', sharedByTag[tk] || []);
      }
    }

    if (cat === 'all' || cat === 'personal') {
      appendGroup(listEl, side, staged, `🔒 개인`, '내 맥에만 있는 스킬', personal);
    }
  } else {
    const lNames = localNames();
    const shared     = items.filter(i =>  lNames.has(i.name));
    const remoteOnly = items.filter(i => !lNames.has(i.name));

    const byTag = {};
    for (const tk of tagKeys) byTag[tk] = [];
    byTag.none = [];
    for (const item of remoteOnly) {
      const t = tagLabel(item.name);
      if (t && byTag[t]) byTag[t].push(item);
      else byTag.none.push(item);
    }

    if (cat === 'all' || cat === 'shared') {
      appendGroup(listEl, side, staged, `★ 공유중`, '내 맥에도 있음', shared);
    }
    if (cat === 'all') {
      for (const tk of tagKeys) {
        appendGroup(listEl, side, staged, `📦 원격전용 · ${tk}`, '', byTag[tk]);
      }
      appendGroup(listEl, side, staged, `📦 원격전용 · 분류 없음`, '태그 미지정', byTag.none);
    } else if (tagKeys.includes(cat)) {
      appendGroup(listEl, side, staged, `📦 원격전용 · ${cat}`, '', byTag[cat]);
    } else if (cat === 'notag') {
      appendGroup(listEl, side, staged, `📦 원격전용 · 분류 없음`, '태그 미지정', byTag.none);
    }
  }

  if (listEl.children.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'skill-group-header';
    empty.innerHTML = `<span class="group-sub">선택한 카테고리에 해당 스킬이 없습니다</span>`;
    listEl.appendChild(empty);
  }
}

function isGroupCollapsed(side, groupKey) {
  const override = state.groupOverride.get(groupKey);
  if (override) return override === 'collapsed';
  return state.category[side] === 'all';
}

function toggleGroup(side, groupKey) {
  const current = isGroupCollapsed(side, groupKey);
  state.groupOverride.set(groupKey, current ? 'expanded' : 'collapsed');
  renderList(side);
}

function appendGroup(listEl, side, staged, title, subtitle, items) {
  if (items.length === 0) return;

  const groupKey = `${side}|${title}`;
  const collapsed = isGroupCollapsed(side, groupKey);

  const header = document.createElement('li');
  header.className = 'skill-group-header' + (collapsed ? ' collapsed' : '');
  header.innerHTML = `
    <span class="group-chevron">${collapsed ? '▶' : '▼'}</span>
    <span class="group-title">${escapeHtml(title)}</span>
    <span class="group-sub">${escapeHtml(subtitle)}</span>
    <span class="group-count">${items.length}</span>
  `;
  header.addEventListener('click', () => toggleGroup(side, groupKey));
  listEl.appendChild(header);

  if (!collapsed) {
    for (const item of items) {
      listEl.appendChild(renderSkillItem(side, item, staged));
    }
  }
}

function renderSkillItem(side, item, staged) {
  const li = document.createElement('li');
  li.className = 'skill-item';
  if (state.selected && state.selected.side === side && state.selected.name === item.name) {
    li.classList.add('selected');
  }
  if (staged.has(item.name)) {
    li.classList.add('staged');
  }
  li.addEventListener('click', () => selectItem(side, item.name));

  const check = document.createElement('input');
  check.type = 'checkbox';
  check.className = 'skill-check';
  check.checked = staged.has(item.name);
  check.addEventListener('click', (e) => e.stopPropagation());
  check.addEventListener('change', () => toggleStage(side, item.name));

  const icon = document.createElement('span');
  icon.className = 'skill-icon';
  icon.textContent = item.isSymlink ? '🔗' : '📁';

  const name = document.createElement('span');
  name.className = 'skill-name';
  name.textContent = item.name;
  if (item.isSymlink) {
    const s = document.createElement('span');
    s.className = 'symlink'; s.textContent = 'symlink';
    name.appendChild(s);
  }

  const badgeWrap = document.createElement('span');
  const [label, cls] = badge(side, item.name);
  const b = document.createElement('span');
  b.className = `skill-badge ${cls}`;
  b.textContent = label;
  badgeWrap.appendChild(b);

  const tag = tagLabel(item.name);
  if (tag) {
    const d = document.createElement('span');
    d.className = 'skill-badge badge-depth';
    d.textContent = tag;
    badgeWrap.appendChild(d);
  }

  li.appendChild(check);
  li.appendChild(icon);
  li.appendChild(name);
  li.appendChild(badgeWrap);
  return li;
}

function toggleStage(side, name) {
  const s = stagedSet(side);
  if (s.has(name)) {
    s.delete(name);
    if (side === 'local') state.uploadTags.delete(name);
  } else {
    s.add(name);
  }
  renderList(side);
  renderStagePanel();
}

async function renderStagePanel() {
  const u = state.stagedLocal.size;
  const d = state.stagedRemote.size;

  els.scLocal.textContent  = `(${u})`;
  els.scRemote.textContent = `(${d})`;
  els.btnExecUpload.disabled   = u === 0;
  els.btnExecDownload.disabled = d === 0;
  els.btnExecDelete.disabled   = d === 0;
  els.btnClearLocal.disabled   = u === 0;
  els.btnClearRemote.disabled  = d === 0;

  // LOCAL 스테이징 항목들의 전처리 상태 갱신 (goskill_stage에 heyclaude.md 있나)
  for (const name of state.stagedLocal) {
    try {
      const has = await window.api.hasSkillFile('remote', name, 'heyclaude.md');
      state.prepStatus.set(name, has);
    } catch {
      state.prepStatus.set(name, false);
    }
  }

  renderStageRows('local',  els.stageItemsLocal,  state.stagedLocal);
  renderStageRows('remote', els.stageItemsRemote, state.stagedRemote);
}

function renderStageRows(side, container, stagedSet) {
  container.innerHTML = '';
  if (stagedSet.size === 0) {
    const empty = document.createElement('div');
    empty.className = 'stage-empty';
    empty.textContent = side === 'local'
      ? '아직 선택된 스킬 없음 — 오른쪽 LOCAL에서 체크하세요'
      : '아직 선택된 스킬 없음 — 왼쪽 REMOTE에서 체크하세요';
    container.appendChild(empty);
    return;
  }
  for (const name of stagedSet) {
    const row = document.createElement('div');
    row.className = 'stage-row' + (side === 'local' ? ' stage-row-local' : '');

    const label = document.createElement('span');
    label.className = 'row-name';
    label.textContent = name;
    label.title = name;

    row.appendChild(label);

    if (side === 'local') {
      const sel = document.createElement('select');
      sel.className = 'depth-select';
      sel.title = '업로드 태그 분류';
      const existing = tagLabel(name); // 이미 원격에 있으면 기존 태그 기본값
      const current  = state.uploadTags.get(name) ?? existing ?? '';

      const optNone = document.createElement('option');
      optNone.value = ''; optNone.textContent = '분류 없음';
      sel.appendChild(optNone);

      // 기존 태그 목록 + 'onboarding' 기본 추천 + 사용자 추가 태그 + 현재값
      const tagOptions = new Set(getTagKeys());
      tagOptions.add('onboarding');
      for (const t of state.customTags) tagOptions.add(t);
      if (current) tagOptions.add(current);
      const sortedTags = [...tagOptions].sort((a, b) => {
        if (a === 'onboarding') return -1;
        if (b === 'onboarding') return 1;
        return a.localeCompare(b);
      });

      for (const tk of sortedTags) {
        const o = document.createElement('option');
        o.value = tk;
        o.textContent = tk;
        sel.appendChild(o);
      }

      // 마지막에 "+ 새 태그…" 옵션 (선택 시 prompt로 입력받음)
      const optNew = document.createElement('option');
      optNew.value = '__new__';
      optNew.textContent = '+ 새 태그…';
      sel.appendChild(optNew);

      sel.value = current || '';
      sel.addEventListener('change', async () => {
        if (sel.value === '__new__') {
          const input = await showPrompt({
            title: '새 태그 추가',
            message: '예: coupang, notion, figma, dev, pm\n공백·구분자 없이 짧게 (30자 이하)',
            placeholder: '태그 이름',
            validate: (val) => {
              const t = (val || '').trim();
              if (!t) return '태그 이름을 입력하세요.';
              if (t.length > 30) return '30자 이하로 입력하세요.';
              if (/[\s\/\\:,;|]/.test(t)) return '공백/구분자(/ \\ : , ; |) 사용 불가.';
              return null;
            },
          });
          if (input === null) {
            sel.value = current || '';
            return;
          }
          const tag = input.trim();
          state.customTags.add(tag);
          state.uploadTags.set(name, tag);
          // 모든 LOCAL stage 행을 다시 그려서 새 태그가 다른 셀렉트에도 노출되게 함
          renderStageRows('local', els.stageItemsLocal, state.stagedLocal);
          return;
        }
        if (sel.value) state.uploadTags.set(name, sel.value);
        else state.uploadTags.delete(name);
      });
      row.appendChild(sel);

      // 전처리 완료 배지 (goskill_stage에 heyclaude.md 있나)
      const prepBadge = document.createElement('span');
      prepBadge.className = 'skill-badge';
      const isPrepped = state.prepStatus.get(name) === true;
      if (isPrepped) {
        prepBadge.textContent = '✅ 전처리 완료';
        prepBadge.style.background = '#1f6f3a';
        prepBadge.style.color = '#fff';
        prepBadge.title = '~/goskill_stage/' + name + '/heyclaude.md 존재';
      } else {
        prepBadge.textContent = '⚠️ 전처리 필요';
        prepBadge.style.background = '#7a4a00';
        prepBadge.style.color = '#fff';
        prepBadge.title = 'heyclaude.md 누락 — "🔧 직원용 전처리" 버튼 먼저 실행';
      }
      row.appendChild(prepBadge);
    }

    const remove = document.createElement('button');
    remove.textContent = '×';
    remove.title = '제외';
    remove.addEventListener('click', () => toggleStage(side, name));

    row.appendChild(remove);
    container.appendChild(row);
  }
}

function clearStagingSide(side) {
  stagedSet(side).clear();
  if (side === 'local') state.uploadTags.clear();
  renderList(side);
  renderStagePanel();
}

function render() {
  renderList('local');
  renderList('remote');
}

async function selectItem(side, name) {
  state.selected = { side, name };
  renderList('local');
  renderList('remote');

  els.detail.innerHTML = '<div class="detail-placeholder">로드 중...</div>';
  try {
    const info = await window.api.readSkill(side, name);
    const [label, cls] = badge(side, name);
    const tag = tagLabel(name);

    const head = `
      <div class="detail-head">
        <div>
          <div class="detail-name">${escapeHtml(name)}</div>
          <div class="detail-meta">${side === 'local' ? '내 맥' : '공용 레포'} · ${info.files.length}개 파일</div>
        </div>
        <div>
          <span class="skill-badge ${cls}">${label}</span>
          ${tag ? `<span class="skill-badge badge-depth">${tag}</span>` : ''}
        </div>
      </div>`;

    const files = info.files.map(f =>
      `<li class="${f.isDir ? 'dir' : ''}">${f.isDir ? '📁' : '📄'} ${escapeHtml(f.name)}</li>`
    ).join('');

    const columns = `
      <div class="detail-columns">
        <ul class="detail-files">${files}</ul>
        <div class="detail-preview">${escapeHtml(info.preview)}</div>
      </div>`;

    els.detail.innerHTML = head + columns;
  } catch (e) {
    els.detail.innerHTML = `<div class="detail-placeholder">에러: ${escapeHtml(e.message)}</div>`;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

async function handleHeyclaudePrompt() {
  const names = [...state.stagedLocal];
  if (!names.length) {
    alert('업로드 대기 영역에 스킬을 먼저 추가하세요.');
    return;
  }

  const items = names.map(n => {
    const t = state.uploadTags.get(n) || '미지정';
    return ` • ${n}\n` +
           `   - 원본 (read-only): ~/.claude/skills/${n}/\n` +
           `   - 출력: ~/goskill_stage/${n}/\n` +
           `   - 태그: ${t}`;
  }).join('\n\n');

  const promptText =
    `직원 공유 전 스킬을 점검하고 가공본을 만들어줘:\n\n` +
    `${items}\n\n` +
    `/goskill-heyclaude 메타 스킬로 처리:\n` +
    `1. 원본 읽기 (절대 수정 X)\n` +
    `2. 외부 의존성, 개인정보 노출, 변수화 가능 부분 분석 보고\n` +
    `3. 출력 위치에 가공본 생성:\n` +
    `   - 이미 있으면 → LOCAL과 비교해서 변경분 보고 후 갱신 여부 사용자 확인\n` +
    `   - 없으면 → 신규 생성 (SKILL.md 일반화 + heyclaude.md 신규)\n` +
    `4. ~/goskill_stage/skills-list.json 항목 갱신 (description, tag)\n` +
    `5. 결과 보고 (변경/신규 항목, 일반화한 부분, 남은 TODO)\n\n` +
    `※ goskill_stage에 heyclaude.md가 없으면 goskill 앱에서 업로드가 차단됩니다.`;

  try { await window.api.clipboardWrite(promptText); } catch {}

  alert(
    `📋 직원용 전처리 프롬프트가 클립보드에 복사됐습니다.\n` +
    `Claude Code에 붙여넣어 점검을 요청하세요.\n\n` +
    `--- 클립보드 내용 ---\n${promptText}`
  );
}

function buildSetupPromptText(names) {
  const items = names.map(n =>
    ` • ${n}\n` +
    `   - 위치: ~/.claude/skills/${n}/\n` +
    `   - heyclaude.md 따라 진행`
  ).join('\n\n');

  return (
    `방금 다운받은 스킬의 환경 세팅을 진행해줘:\n\n` +
    `${items}\n\n` +
    `## Phase 1. 환경 세팅\n` +
    `각 스킬의 heyclaude.md를 읽고:\n` +
    `1. 사전 요구사항 체크\n` +
    `2. 부족한 의존성 설치 (idempotent — 이미 있으면 skip)\n` +
    `3. 자격증명/외부 다운로드 단계는 사용자에게 안내 후 확인 대기\n` +
    `4. 완료 후 "사전 요구사항 체크" 다시 돌려서 통과 확인\n\n` +
    `## Phase 2. 셀프 테스트 (자동)\n` +
    `세팅이 통과한 스킬마다 가장 단순한 동작을 직접 한 번 실행해서 정상 작동을 확인:\n` +
    ` - heyclaude.md에 "검증" / "테스트" / "예시" 섹션이 있으면 그걸 그대로 실행\n` +
    ` - 없으면 SKILL.md에서 가장 가벼운 read-only 동작 1개를 골라 실행 (목록 조회, 인증 확인 등)\n` +
    ` - 자격증명/외부 자원이 필요해서 자동 검증 불가하면 "수동 확인 필요"로 표시\n\n` +
    `## Phase 3. 보고\n` +
    `마지막에 표로 요약:\n` +
    ` - ✅ 세팅+테스트 통과 / ⚠️ 세팅만 통과 (테스트 미실행) / ❌ 실패 / ⏭️ heyclaude.md 없음(건너뜀)\n` +
    ` - 실패/수동확인 항목은 다음 액션 1줄씩\n`
  );
}

async function handleSetupPrompt() {
  const names = [...state.stagedRemote];
  if (!names.length) {
    alert('원격 작업 대기 영역에 스킬을 먼저 추가하세요.');
    return;
  }

  const promptText = buildSetupPromptText(names);
  try { await window.api.clipboardWrite(promptText); } catch {}

  alert(
    `📋 환경 세팅 프롬프트가 클립보드에 복사됐습니다.\n` +
    `Claude Code에 붙여넣어 세팅을 요청하세요.\n\n` +
    `--- 클립보드 내용 ---\n${promptText}`
  );
}

async function handleUpload() {
  const names = [...state.stagedLocal];
  if (!names.length) return;

  // 흐름 B: 업로드 = goskill_stage에 이미 만들어둔 가공본을 git push.
  // 메타 스킬이 ~/goskill_stage/<name>/에 미리 SKILL.md + heyclaude.md를 생성해뒀어야 함.
  // 여기선 단순히 검증만 (가공본 누락 시 차단).

  // 사전 검증 1: REMOTE(goskill_stage)에 가공본 폴더 존재
  const noRemoteFolder = [];
  for (const n of names) {
    const has = await window.api.hasSkillFile('remote', n, 'SKILL.md');
    if (!has) noRemoteFolder.push(n);
  }
  if (noRemoteFolder.length) {
    alert(
      `⚠️ goskill_stage에 가공본 누락 — 업로드 차단\n\n` +
      `${noRemoteFolder.map(n => ' • ' + n).join('\n')}\n\n` +
      `먼저 "🔧 직원용 전처리" 버튼을 눌러 메타 스킬(goskill-heyclaude)로 가공본을 만들어주세요.`
    );
    return;
  }

  // 사전 검증 2: heyclaude.md 존재 (REMOTE에서)
  const noHeyclaude = [];
  for (const n of names) {
    const has = await window.api.hasSkillFile('remote', n, 'heyclaude.md');
    if (!has) noHeyclaude.push(n);
  }
  if (noHeyclaude.length) {
    alert(
      `⚠️ heyclaude.md 누락 — 업로드 차단\n\n` +
      `${noHeyclaude.map(n => ' • ' + n).join('\n')}\n\n` +
      `직원의 Claude Code가 환경 세팅을 못 하는 상태로 업로드되면 안 됩니다.\n` +
      `먼저 "🔧 직원용 전처리" 버튼을 눌러 가공본 + heyclaude.md를 생성해주세요.`
    );
    return;
  }

  // 흐름 B에선 충돌 검사 불필요 (메타 스킬이 이미 goskill_stage에 만들어둠 = 의도된 덮어쓰기)
  const ready = names;
  const conflicts = [];

  // 충돌 → 알럿 + 클립보드 자동 복사 (해당 스킬은 업로드 안 함)
  if (conflicts.length) {
    const promptText = `${conflicts.join(', ')}을(를) goskill_stage에 업로드하려는데 이미 같은 이름이 있습니다. 충돌이 걱정되는데 문제없게 올려주세요. 확인이 필요하다면 먼저 물어주세요.`;

    try { await window.api.clipboardWrite(promptText); } catch {}

    const conflictList = conflicts.map(n => ` • ${n}`).join('\n');
    alert(
      `⚠️ 충돌 감지\n\n` +
      `${conflictList}\n\n` +
      `이미 REMOTE(goskill_stage)에 같은 이름이 있어 업로드를 건너뜁니다.\n` +
      `Claude Code에 전달할 프롬프트가 클립보드에 복사됐습니다.\n\n` +
      `--- 클립보드 내용 ---\n${promptText}`
    );
  }

  if (ready.length === 0) {
    setStatus('업로드 건너뜀 (모든 항목 충돌)');
    return;
  }

  // 업로드 전 미리보기
  const previewList = ready.map(n => ` • ${n}`).join('\n');
  if (!confirm(`📤 GitHub에 push (goskill_stage의 가공본을 직원에게 공개)\n\n${previewList}\n\n진행할까요?`)) {
    setStatus('업로드 취소됨');
    return;
  }

  // git commit + push만 (메타 스킬이 이미 goskill_stage에 가공본 만들어둠)
  setStatus(`git commit + push 중...`);
  const message = `feat: 스킬 ${ready.length}개 publish (${ready.join(', ')})`;
  const pushResult = await window.api.gitCommitPush(message);
  if (!pushResult.ok) console.warn('push 실패:', pushResult.error, pushResult.output);

  alert(
    `📤 업로드 결과\n\n` +
    `대상 ${ready.length}개: ${ready.join(', ')}\n\n` +
    `${pushResult.ok ? '✅ GitHub push 완료 — 직원이 새로고침하면 받을 수 있어요' : '⚠️ push 실패: ' + (pushResult.error || '알 수 없음')}`
  );

  // 스테이징 비우고 새로고침
  state.stagedLocal.clear();
  state.uploadTags.clear();
  await load();
}

async function handleDownload() {
  const names = [...state.stagedRemote];
  if (!names.length) return;

  // 사전 충돌 검사 (LOCAL에 같은 이름 있는지)
  const lNames = localNames();
  const conflicts = names.filter(n => lNames.has(n));
  const ready     = names.filter(n => !lNames.has(n));

  // 충돌 발견 → 알럿 + 클립보드 자동 복사 (해당 스킬은 다운로드 안 함)
  if (conflicts.length) {
    const promptText = `${conflicts.join(', ')}을(를) 다운받기하려는데 이미 같은 이름이 skills에 있습니다. 충돌이 걱정되는데 문제없게 가져와주세요. 확인이 필요하다면 먼저 물어주세요.`;

    try { await window.api.clipboardWrite(promptText); } catch {}

    const conflictList = conflicts.map(n => ` • ${n}`).join('\n');
    alert(
      `⚠️ 충돌 감지\n\n` +
      `${conflictList}\n\n` +
      `이미 LOCAL에 같은 이름이 있어 다운로드를 건너뜁니다.\n` +
      `Claude Code에 전달할 프롬프트가 클립보드에 복사됐습니다.\n\n` +
      `--- 클립보드 내용 ---\n${promptText}`
    );
  }

  // 충돌 없는 것만 실제 다운로드
  if (ready.length === 0) {
    setStatus('다운로드 건너뜀 (모든 항목 충돌)');
    return;
  }

  setStatus(`다운로드 중... (${ready.length}개)`);
  let success = 0, failed = 0;
  const errors = [];
  for (const name of ready) {
    try {
      const r = await window.api.downloadSkill(name);
      if (r.ok) success++;
      else { failed++; errors.push(`${name}: ${r.conflict ? '충돌' : '실패'}`); }
    } catch (e) {
      failed++;
      errors.push(`${name}: ${e.message}`);
    }
  }

  // 성공한 항목들에 대해 환경 세팅 프롬프트 자동 클립보드 복사
  const succeeded = ready.slice(0, success);
  let setupPromptCopied = false;
  if (succeeded.length) {
    try {
      const promptText = buildSetupPromptText(succeeded);
      await window.api.clipboardWrite(promptText);
      setupPromptCopied = true;
    } catch {}
  }

  alert(
    `📥 다운로드 결과\n\n` +
    `성공 ${success}개 · 실패 ${failed}개${conflicts.length ? ` · 충돌 ${conflicts.length}개(건너뜀)` : ''}\n` +
    (errors.length ? `\n실패 항목:\n${errors.map(e => ` • ${e}`).join('\n')}\n` : '') +
    (setupPromptCopied
      ? `\n📋 환경 세팅 프롬프트가 클립보드에 복사됐습니다.\nClaude Code에 붙여넣으면 heyclaude.md를 따라 세팅 + 셀프 테스트까지 진행합니다.`
      : '')
  );

  // 스테이징 비우고 새로고침
  state.stagedRemote.clear();
  await load();
}

async function handleDelete() {
  const names = [...state.stagedRemote];
  if (!names.length) return;
  const list = names.map(n => ` • ${n}`).join('\n');
  const ok = confirm(
    `🗑 REMOTE(goskill_stage)에서 삭제\n\n${list}\n\n` +
    `대상: ${state.remote.base || '~/goskill_stage/'}\n\n` +
    `⚠️ 파일시스템에서 실제로 삭제됩니다.\n` +
    `(git 되돌리기: cd ~/goskill_stage && git checkout <이름>)\n\n` +
    `진행할까요?`
  );
  if (!ok) return;

  const pw = await showPrompt({
    title: '🔒 삭제 비밀번호',
    message: '비밀번호를 입력하세요',
    password: true,
  });
  if (pw === null) return;
  if (pw !== '0000') {
    alert('❌ 비밀번호가 일치하지 않습니다. 삭제 취소됨.');
    return;
  }

  setStatus('삭제 중...');
  const results = { ok: [], fail: [] };
  for (const name of names) {
    try {
      await window.api.deleteSkill('remote', name);
      results.ok.push(name);
      state.stagedRemote.delete(name);
    } catch (e) {
      results.fail.push(`${name}: ${e.message}`);
    }
  }
  if (results.fail.length) {
    alert(`삭제 완료: ${results.ok.length}개\n실패: ${results.fail.length}개\n\n${results.fail.join('\n')}`);
  } else {
    setStatus(`🗑 ${results.ok.length}개 삭제됨`);
  }
  await load();
}

els.refresh.addEventListener('click', load);
els.btnExecUpload.addEventListener('click', handleUpload);
els.btnHeyclaudePrompt.addEventListener('click', handleHeyclaudePrompt);
els.btnSetupPrompt.addEventListener('click', handleSetupPrompt);
els.btnExecDownload.addEventListener('click', handleDownload);
els.btnExecDelete.addEventListener('click', handleDelete);
els.searchLocal.addEventListener('input',  (e) => { state.filter.local  = e.target.value; renderList('local');  });
els.searchRemote.addEventListener('input', (e) => { state.filter.remote = e.target.value; renderList('remote'); });
els.filterLocal.addEventListener('change',  (e) => { state.category.local  = e.target.value; renderList('local');  });
els.filterRemote.addEventListener('change', (e) => { state.category.remote = e.target.value; renderList('remote'); });
els.btnClearLocal.addEventListener('click',  () => clearStagingSide('local'));
els.btnClearRemote.addEventListener('click', () => clearStagingSide('remote'));
renderStagePanel();
load();
