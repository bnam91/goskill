const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileP = promisify(execFile);

// 개발 모드일 때만 핫 리로드 (npm run dev로 실행 시)
if (process.env.NODE_ENV === 'development') {
  try {
    require('electron-reloader')(module, {
      ignore: ['VERSION.txt', '.git', 'node_modules'],
    });
    console.log('🔥 핫 리로드 활성화');
  } catch (e) {
    console.warn('electron-reloader 로드 실패:', e.message);
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
      detail: `현재: ${current ?? '없음'}\n\n업데이트 후 앱을 재시작하세요.`,
      buttons: ['지금 업데이트', '나중에'],
      defaultId: 0,
    });

    if (response === 0) {
      await updater.performUpdate(latest);
      const { response: restartRes } = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: '업데이트 완료',
        message: `${latest.tag_name} 업데이트가 완료됐습니다.`,
        detail: '지금 앱을 재시작할까요?',
        buttons: ['지금 재시작', '나중에'],
        defaultId: 0,
      });
      if (restartRes === 0) {
        app.relaunch();
        app.exit(0);
      }
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

app.whenReady().then(() => {
  ipcMain.handle('skills:list',   (_, args) => listSkills(args.side));
  ipcMain.handle('skills:read',   (_, args) => readSkill(args));
  ipcMain.handle('skills:delete', (_, args) => deleteSkill(args));
  ipcMain.handle('catalog:read',  () => readCatalog());
  ipcMain.handle('git:pull',      () => gitPullRemote());
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
