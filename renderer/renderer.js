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

const DEPTH_KEYS = ['depth01', 'depth02', 'depth03', 'depth04'];

let state = {
  local:  { items: [] },
  remote: { items: [] },
  catalog: { depths: {}, skills: {} },
  selected: null, // { side, name }
  stagedLocal:  new Set(), // 업로드 후보 (LOCAL → REMOTE)
  stagedRemote: new Set(), // 다운받기 후보 (REMOTE → LOCAL)
  uploadDepths: new Map(), // name → depth (업로드 시 분류)
  filter:   { local: '',    remote: ''    },
  category: { local: 'all', remote: 'all' },
  groupOverride: new Map(), // groupKey → 'collapsed'|'expanded' (사용자 수동 토글)
};

function setStatus(text) { els.status.textContent = text; }

async function load() {
  setStatus('로딩 중...');
  try {
    const sides = await window.api.sidesInfo();
    els.pathLocal.textContent  = sides.local.path;
    els.pathRemote.textContent = sides.remote.path;

    const [local, remote, catalog] = await Promise.all([
      window.api.listSkills('local'),
      window.api.listSkills('remote'),
      window.api.readCatalog(),
    ]);
    state.local   = local;
    state.remote  = remote;
    state.catalog = catalog;

    render();
    const shared = countShared();
    setStatus(`LOCAL ${local.items.length} · REMOTE ${remote.items.length} · 공유중 ${shared}`);
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

function depthLabel(name) {
  const info = state.catalog?.skills?.[name];
  if (!info || !info.depth) return null;
  return info.depth;
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

  if (side === 'local') {
    const rNames = remoteNames();
    const shared   = items.filter(i =>  rNames.has(i.name));
    const personal = items.filter(i => !rNames.has(i.name));

    const sharedByDepth = { depth01: [], depth02: [], depth03: [], depth04: [], none: [] };
    for (const item of shared) {
      const d = depthLabel(item.name);
      if (d && sharedByDepth[d]) sharedByDepth[d].push(item);
      else sharedByDepth.none.push(item);
    }

    if (cat === 'all' || cat === 'shared') {
      for (const dk of DEPTH_KEYS) {
        const sub = state.catalog.depths?.[dk] || '';
        appendGroup(listEl, side, staged, `★ 공유중 · ${dk}`, sub, sharedByDepth[dk]);
      }
      appendGroup(listEl, side, staged, `★ 공유중 · 분류 없음`, 'depth 미지정', sharedByDepth.none);
    } else if (cat.startsWith('shared_depth')) {
      const dk = cat.replace('shared_', '');
      const sub = state.catalog.depths?.[dk] || '';
      appendGroup(listEl, side, staged, `★ 공유중 · ${dk}`, sub, sharedByDepth[dk] || []);
    } else if (cat === 'shared_nodepth') {
      appendGroup(listEl, side, staged, `★ 공유중 · 분류 없음`, 'depth 미지정', sharedByDepth.none);
    }

    if (cat === 'all' || cat === 'personal') {
      appendGroup(listEl, side, staged, `🔒 개인`, '내 맥에만 있는 스킬', personal);
    }
  } else {
    const lNames = localNames();
    const shared     = items.filter(i =>  lNames.has(i.name));
    const remoteOnly = items.filter(i => !lNames.has(i.name));

    const byDepth = { depth01: [], depth02: [], depth03: [], depth04: [], none: [] };
    for (const item of remoteOnly) {
      const d = depthLabel(item.name);
      if (d && byDepth[d]) byDepth[d].push(item);
      else byDepth.none.push(item);
    }

    if (cat === 'all' || cat === 'shared') {
      appendGroup(listEl, side, staged, `★ 공유중`, '내 맥에도 있음', shared);
    }
    if (cat === 'all') {
      for (const dk of DEPTH_KEYS) {
        const sub = state.catalog.depths?.[dk] || '';
        appendGroup(listEl, side, staged, `📦 원격전용 · ${dk}`, sub, byDepth[dk]);
      }
      appendGroup(listEl, side, staged, `📦 원격전용 · 분류 없음`, 'depth 미지정', byDepth.none);
    } else if (DEPTH_KEYS.includes(cat)) {
      const sub = state.catalog.depths?.[cat] || '';
      appendGroup(listEl, side, staged, `📦 원격전용 · ${cat}`, sub, byDepth[cat]);
    } else if (cat === 'nodepth') {
      appendGroup(listEl, side, staged, `📦 원격전용 · 분류 없음`, 'depth 미지정', byDepth.none);
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

  const depth = depthLabel(item.name);
  if (depth) {
    const d = document.createElement('span');
    d.className = 'skill-badge badge-depth';
    d.textContent = depth;
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
    if (side === 'local') state.uploadDepths.delete(name);
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
      sel.title = '업로드 depth 분류';
      const existing = depthLabel(name); // 이미 원격에 있으면 depth 기본값
      const current  = state.uploadDepths.get(name) ?? existing ?? '';

      const optNone = document.createElement('option');
      optNone.value = ''; optNone.textContent = '분류 없음';
      sel.appendChild(optNone);
      for (const dk of DEPTH_KEYS) {
        const o = document.createElement('option');
        o.value = dk;
        const sub = state.catalog.depths?.[dk];
        o.textContent = sub ? `${dk} — ${sub}` : dk;
        sel.appendChild(o);
      }
      sel.value = current || '';
      sel.addEventListener('change', () => {
        if (sel.value) state.uploadDepths.set(name, sel.value);
        else state.uploadDepths.delete(name);
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
  if (side === 'local') state.uploadDepths.clear();
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
    const depth = depthLabel(name);

    const head = `
      <div class="detail-head">
        <div>
          <div class="detail-name">${escapeHtml(name)}</div>
          <div class="detail-meta">${side === 'local' ? '내 맥' : '공용 레포'} · ${info.files.length}개 파일</div>
        </div>
        <div>
          <span class="skill-badge ${cls}">${label}</span>
          ${depth ? `<span class="skill-badge badge-depth">${depth}</span>` : ''}
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
    const d = state.uploadDepths.get(n) || '(분류 없음)';
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
    `🗑 REMOTE(공용 레포)에서 삭제\n\n${list}\n\n` +
    `대상: ${state.remote.base || '~/claude_skills/'}\n\n` +
    `⚠️ 파일시스템에서 실제로 삭제됩니다.\n` +
    `(git 되돌리기: cd ~/claude_skills && git checkout <이름>)\n\n` +
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
