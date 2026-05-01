const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');

const HOME = os.homedir();
const SIDES = {
  local:  { label: 'LOCAL (내 스킬)',      path: path.join(HOME, '.claude', 'skills') },
  remote: { label: 'REMOTE (공용 레포)',    path: path.join(HOME, 'claude_skills') },
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
  ipcMain.handle('sides:info',    () => ({
    local:  { label: SIDES.local.label,  path: SIDES.local.path },
    remote: { label: SIDES.remote.label, path: SIDES.remote.path },
  }));
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
