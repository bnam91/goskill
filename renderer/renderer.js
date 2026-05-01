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
};

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
  filter:   { local: '',    remote: ''    },
  category: { local: 'all', remote: 'all' },
  groupOverride: new Map(), // groupKey → 'collapsed'|'expanded' (사용자 수동 토글)
};

function setStatus(text) { els.status.textContent = text; }

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
    const [local, remote, catalog] = await Promise.all([
      window.api.listSkills('local'),
      window.api.listSkills('remote'),
      window.api.readCatalog(),
    ]);
    state.local   = local;
    state.remote  = remote;
    state.catalog = catalog;

    refreshTagFilters();
    render();
    const shared = countShared();
    setStatus(`LOCAL ${local.items.length} · REMOTE ${remote.items.length} · 공유중 ${shared} · ${pullStatus}`);
  } catch (e) {
    setStatus(`에러: ${e.message}`);
    console.error(e);
  }
}

function localNames()  { return new Set(state.local.items.map(i => i.name)); }
function remoteNames() { return new Set(state.remote.items.map(i => i.name)); }
function countShared() {
  const l = localNames(), r = remoteNames();
  let n = 0;
  for (const name of l) if (r.has(name)) n++;
  return n;
}

function badge(side, name) {
  const inLocal  = localNames().has(name);
  const inRemote = remoteNames().has(name);
  if (inLocal && inRemote) return ['★ 공유중', 'badge-shared'];
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

function renderStagePanel() {
  const u = state.stagedLocal.size;
  const d = state.stagedRemote.size;

  els.scLocal.textContent  = `(${u})`;
  els.scRemote.textContent = `(${d})`;
  els.btnExecUpload.disabled   = u === 0;
  els.btnExecDownload.disabled = d === 0;
  els.btnExecDelete.disabled   = d === 0;
  els.btnClearLocal.disabled   = u === 0;
  els.btnClearRemote.disabled  = d === 0;

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

      // 기존 태그 목록 + 'onboarding' 기본 추천 + 현재값
      const tagOptions = new Set(getTagKeys());
      tagOptions.add('onboarding');
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
      sel.value = current || '';
      sel.addEventListener('change', () => {
        if (sel.value) state.uploadTags.set(name, sel.value);
        else state.uploadTags.delete(name);
      });
      row.appendChild(sel);
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

function handleUpload() {
  const names = [...state.stagedLocal];
  if (!names.length) return;
  const list = names.map(n => {
    const d = state.uploadTags.get(n) || '(분류 없음)';
    return ` • ${n}  →  ${d}`;
  }).join('\n');
  alert(`📤 업로드 예정 (LOCAL → REMOTE)\n\n${list}\n\n⚠️ 실제 업로드 기능은 아직 구현 전입니다. (UI 스테이지 확인용)`);
}

function handleDownload() {
  const names = [...state.stagedRemote];
  if (!names.length) return;
  const list = names.map(n => ` • ${n}`).join('\n');
  alert(`📥 다운받기 예정 (REMOTE → LOCAL)\n\n${list}\n\n⚠️ 실제 다운로드 기능은 아직 구현 전입니다. (UI 스테이지 확인용)`);
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

  const pw = prompt('🔒 삭제 비밀번호를 입력하세요');
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
