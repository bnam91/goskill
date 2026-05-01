const { app, BrowserWindow, ipcMain, dialog, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileP = promisify(execFile);

// 개발 모드일 때만 핫 리로드 (npm run dev로 실행 시)
if (process.env.NODE_ENV === 'development') {
  // main/preload 파일 변경 → 앱 자동 재시작
  try {
    require('electron-reloader')(module, {
      ignore: ['VERSION.txt', '.git', 'node_modules', 'renderer'],
    });
    console.log('🔥 main 핫 리로드 활성화');
  } catch (e) {
    console.warn('electron-reloader 로드 실패:', e.message);
  }

  // renderer/* 변경 → BrowserWindow 자동 reload (electron-reloader는 main이 require한 파일만 봄)
  try {
    const chokidar = require('chokidar');
    const watcher = chokidar.watch(path.join(__dirname, 'renderer'), {
      ignoreInitial: true,
    });
    let reloadTimer = null;
    watcher.on('all', (event, filepath) => {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        console.log('🔄 renderer 변경 감지:', path.basename(filepath));
        BrowserWindow.getAllWindows().forEach(w => {
          if (!w.isDestroyed()) w.webContents.reloadIgnoringCache();
        });
      }, 80); // 다중 저장 디바운스
    });
    console.log('🔥 renderer 핫 리로드 활성화 (chokidar)');
  } catch (e) {
    console.warn('chokidar 로드 실패:', e.message);
  }
}

const HOME = os.homedir();
const SIDES = {
  local:  { label: 'LOCAL (내 스킬)',      path: path.join(HOME, '.claude', 'skills') },
  remote: { label: 'REMOTE (goskill_stage)', path: path.join(HOME, 'goskill_stage') },
};

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'goskill',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  return win;
}

async function checkForUpdates(mainWindow) {
  try {
    // ESM 모듈을 CommonJS에서 동적 로드
    const updaterModule = await import('./submodules/module_update_auto/release_updater.js');
    const configModule  = await import('./submodules/module_update_auto/config.js');
    const ReleaseUpdater = updaterModule.default;
    const updateConfig   = configModule.default;

    const updater = new ReleaseUpdater('bnam91', 'goskill', updateConfig.versionFile);
    const current = updater.getCurrentVersion();
    const latest  = await updater.getLatestRelease();
    if (!latest || current === latest.tag_name) return;

    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'goskill 업데이트 알림',
      message: `새 버전이 있습니다: ${latest.tag_name}`,
      detail: `현재: ${current ?? '없음'}\n\n업데이트 시 앱이 자동으로 재시작됩니다.`,
      buttons: ['지금 업데이트', '나중에'],
      defaultId: 0,
    });

    if (response === 0) {
      await updater.performUpdate(latest);
      // 업데이트 완료 → 자동 재시작 (다이얼로그 불필요)
      app.relaunch();
      app.exit(0);
    }
  } catch (e) {
    console.error('업데이트 체크 오류:', e.message);
  }
}

async function listSkills(side) {
  const base = SIDES[side]?.path;
  if (!base) throw new Error(`unknown side: ${side}`);

  let entries;
  try {
    entries = await fs.readdir(base, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return { base, items: [] };
    throw e;
  }

  const items = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (ent.name.startsWith('.')) continue;

    const full = path.join(base, ent.name);
    let stat;
    try { stat = await fs.stat(full); } catch { continue; }

    const isSymlink = (await fs.lstat(full)).isSymbolicLink();
    const hasSkillMd = await fileExists(path.join(full, 'SKILL.md'));

    items.push({
      name: ent.name,
      mtime: stat.mtimeMs,
      isSymlink,
      hasSkillMd,
    });
  }

  items.sort((a, b) => a.name.localeCompare(b.name));
  return { base, items };
}

async function fileExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function readSkill({ side, name }) {
  const base = SIDES[side]?.path;
  if (!base) throw new Error(`unknown side: ${side}`);
  const dir = path.join(base, name);

  let files = [];
  try {
    files = (await fs.readdir(dir, { withFileTypes: true }))
      .filter(e => !e.name.startsWith('.'))
      .map(e => ({ name: e.name, isDir: e.isDirectory() }));
  } catch (e) {
    if (e.code === 'ENOENT') return { files: [], preview: '(폴더 없음)' };
    throw e;
  }

  // preview: SKILL.md → README.md → 첫 파일 이름
  let preview = '';
  for (const cand of ['SKILL.md', 'README.md']) {
    const p = path.join(dir, cand);
    if (await fileExists(p)) {
      try {
        const buf = await fs.readFile(p, 'utf8');
        preview = buf.slice(0, 1200);
      } catch {}
      break;
    }
  }
  if (!preview) preview = `(설명 파일 없음)\n\n파일 ${files.length}개: ${files.slice(0, 5).map(f => f.name).join(', ')}`;

  return { files, preview };
}

async function deleteSkill({ side, name }) {
  if (side !== 'remote') {
    throw new Error('삭제는 REMOTE(공용 레포)에서만 허용됩니다');
  }
  if (!name || typeof name !== 'string' || name.includes('/') || name.includes('..') || name.startsWith('.')) {
    throw new Error(`잘못된 스킬 이름: ${name}`);
  }
  const base = SIDES.remote.path;
  const target = path.join(base, name);
  const resolved = path.resolve(target);
  if (!resolved.startsWith(path.resolve(base) + path.sep)) {
    throw new Error('REMOTE 폴더 밖 경로는 삭제 불가');
  }
  const stat = await fs.lstat(resolved).catch(() => null);
  if (!stat) throw new Error(`없는 스킬: ${name}`);
  await fs.rm(resolved, { recursive: true, force: true });
  return { deleted: name, path: resolved };
}

async function getAppVersion() {
  // VERSION.txt 우선 (자동업데이트가 갱신)
  try {
    const buf = await fs.readFile(path.join(__dirname, 'VERSION.txt'), 'utf8');
    const info = JSON.parse(buf);
    if (info.tag_name) return info.tag_name;
  } catch {}
  // fallback: package.json
  try {
    const buf = await fs.readFile(path.join(__dirname, 'package.json'), 'utf8');
    const pkg = JSON.parse(buf);
    return 'v' + pkg.version;
  } catch {
    return 'unknown';
  }
}

async function hasSkillFile({ side, name, file }) {
  const base = SIDES[side]?.path;
  if (!base) throw new Error(`unknown side: ${side}`);
  const p = path.join(base, name, file);
  try { await fs.access(p); return true; } catch { return false; }
}

async function uploadSkill({ name, tag }) {
  if (!name || typeof name !== 'string' || name.includes('/') || name.includes('..') || name.startsWith('.')) {
    throw new Error(`잘못된 스킬 이름: ${name}`);
  }
  const src = path.join(SIDES.local.path, name);
  const dst = path.join(SIDES.remote.path, name);

  const srcStat = await fs.stat(src).catch(() => null);
  if (!srcStat || !srcStat.isDirectory()) {
    throw new Error(`LOCAL에 ${name} 폴더 없음`);
  }

  const dstStat = await fs.lstat(dst).catch(() => null);
  if (dstStat) {
    return { ok: false, conflict: true, name };
  }

  // 1) 폴더 복사
  await fs.cp(src, dst, { recursive: true });

  // 2) skills-list.json 업데이트 (있으면 갱신, 없으면 생성)
  const catalogPath = path.join(SIDES.remote.path, 'skills-list.json');
  let catalog;
  try {
    const buf = await fs.readFile(catalogPath, 'utf8');
    catalog = JSON.parse(buf);
  } catch {
    catalog = { version: 2, _comment: '공용 스킬 카탈로그. 한 스킬당 tag 1개.', skills: {} };
  }
  catalog.skills = catalog.skills || {};

  // SKILL.md frontmatter에서 description 추출 시도
  let description = '';
  try {
    const skillMd = await fs.readFile(path.join(src, 'SKILL.md'), 'utf8');
    const m = skillMd.match(/^---[\s\S]*?\ndescription:\s*(.+?)(?:\n|$)/);
    if (m) description = m[1].trim().replace(/^["']|["']$/g, '');
  } catch {}

  catalog.skills[name] = {
    description,
    ...(tag ? { tag } : {}),
  };
  await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2) + '\n', 'utf8');

  return { ok: true, name, path: dst, tag: tag || null };
}

async function gitCommitAndPushRemote(message) {
  const cwd = SIDES.remote.path;
  try {
    await execFileP('git', ['-C', cwd, 'add', '-A'], { timeout: 15000 });
    await execFileP('git', ['-C', cwd, 'commit', '-m', message], { timeout: 15000 });
    const { stdout, stderr } = await execFileP('git', ['-C', cwd, 'push'], { timeout: 30000 });
    return { ok: true, output: (stdout + stderr).trim() };
  } catch (e) {
    const msg = e.message || '';
    // commit "nothing to commit"은 에러 아님
    if (/nothing to commit|작업할 사항 없음/i.test(msg) || /nothing to commit/i.test(e.stdout || '') || /nothing to commit/i.test(e.stderr || '')) {
      return { ok: true, output: '변경사항 없음 (skip)' };
    }
    return { ok: false, error: msg, output: ((e.stdout || '') + (e.stderr || '')).trim() };
  }
}

async function downloadSkill({ name }) {
  if (!name || typeof name !== 'string' || name.includes('/') || name.includes('..') || name.startsWith('.')) {
    throw new Error(`잘못된 스킬 이름: ${name}`);
  }
  const src = path.join(SIDES.remote.path, name);
  const dst = path.join(SIDES.local.path, name);

  // src 존재 확인
  const srcStat = await fs.stat(src).catch(() => null);
  if (!srcStat || !srcStat.isDirectory()) {
    throw new Error(`REMOTE에 ${name} 폴더 없음`);
  }

  // dst 이미 있으면 충돌 (renderer가 사전 검사하지만 안전망)
  const dstStat = await fs.lstat(dst).catch(() => null);
  if (dstStat) {
    return { ok: false, conflict: true, name };
  }

  // 복사 (recursive)
  await fs.cp(src, dst, { recursive: true });
  return { ok: true, name, path: dst };
}

async function gitPullRemote() {
  const cwd = SIDES.remote.path;
  const gitDir = path.join(cwd, '.git');
  try {
    await fs.access(gitDir);
  } catch {
    return { ok: false, skipped: true, message: 'REMOTE 폴더가 git 레포가 아님 (.git 없음)' };
  }
  try {
    const { stdout, stderr } = await execFileP('git', ['-C', cwd, 'pull', '--ff-only'], { timeout: 15000 });
    return { ok: true, output: (stdout + stderr).trim() };
  } catch (e) {
    return { ok: false, error: e.message, output: ((e.stdout || '') + (e.stderr || '')).trim() };
  }
}

async function readCatalog() {
  const p = path.join(SIDES.remote.path, 'skills-list.json');
  try {
    const buf = await fs.readFile(p, 'utf8');
    return JSON.parse(buf);
  } catch (e) {
    return { depths: {}, skills: {}, _error: e.message };
  }
}

// REMOTE의 각 스킬 폴더가 origin/main에 publish됐는지 판정.
// 반환: { name: 'published' | 'staged' }
//   - 'published': origin/main 트리에 폴더가 있고, 워킹트리에 변경 없음
//   - 'staged'   : 새로 추가/수정/untracked 상태 (직원이 받을 수 없음)
async function getPublishStatusMap() {
  const cwd = SIDES.remote.path;
  const gitDir = path.join(cwd, '.git');
  const result = {};
  try {
    await fs.access(gitDir);
  } catch {
    // git repo 아님 → 모두 published 취급 (구분 의미 없음)
    return result;
  }

  // origin/main 트리에 존재하는 최상위 디렉터리 목록
  let originDirs = new Set();
  try {
    const { stdout } = await execFileP('git', ['-C', cwd, 'ls-tree', '-d', '--name-only', 'origin/main'], { timeout: 5000 });
    for (const line of stdout.split('\n')) {
      const t = line.trim();
      if (t) originDirs.add(t);
    }
  } catch (e) {
    // origin/main 없거나 fetch 안 된 상태 등
  }

  // 워킹트리 변경 상태 — 변경된 최상위 디렉터리 목록
  let dirtyDirs = new Set();
  try {
    const { stdout } = await execFileP('git', ['-C', cwd, 'status', '--porcelain'], { timeout: 5000 });
    for (const line of stdout.split('\n')) {
      const m = line.match(/^.{2}\s+"?([^/"]+)/);
      if (m) dirtyDirs.add(m[1]);
    }
  } catch (e) {}

  // 모든 REMOTE 디렉터리 순회 (skills-list.json 같은 파일 제외)
  let entries = [];
  try {
    entries = await fs.readdir(cwd, { withFileTypes: true });
  } catch (e) {
    return result;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith('.')) continue;
    const inOrigin = originDirs.has(e.name);
    const dirty = dirtyDirs.has(e.name);
    result[e.name] = (inOrigin && !dirty) ? 'published' : 'staged';
  }
  return result;
}

app.whenReady().then(() => {
  ipcMain.handle('skills:list',   (_, args) => listSkills(args.side));
  ipcMain.handle('skills:read',   (_, args) => readSkill(args));
  ipcMain.handle('skills:delete', (_, args) => deleteSkill(args));
  ipcMain.handle('catalog:read',  () => readCatalog());
  ipcMain.handle('publish:status', () => getPublishStatusMap());
  ipcMain.handle('git:pull',      () => gitPullRemote());
  ipcMain.handle('skills:download', (_, args) => downloadSkill(args));
  ipcMain.handle('skills:upload',   (_, args) => uploadSkill(args));
  ipcMain.handle('skills:hasFile',  (_, args) => hasSkillFile(args));
  ipcMain.handle('app:version',     () => getAppVersion());
  ipcMain.handle('git:commit-push', (_, message) => gitCommitAndPushRemote(String(message || 'feat: goskill 업로드')));
  ipcMain.handle('clipboard:write', (_, text) => clipboard.writeText(String(text || '')));
  ipcMain.handle('sides:info',    () => ({
    local:  { label: SIDES.local.label,  path: SIDES.local.path },
    remote: { label: SIDES.remote.label, path: SIDES.remote.path },
  }));
  const mainWindow = createWindow();
  checkForUpdates(mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
