// ============================================================================
//  MigraCRM PRO - Proceso principal (Electron)
//  Base de datos local con escritura atomica + backups automaticos.
//  Objetivo: que NUNCA se pierdan datos, aunque se corte la luz o se cierre mal.
// ============================================================================
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// electron-updater es opcional y 100% defensivo: si falla, la app sigue igual.
let autoUpdater = null;
try { autoUpdater = require('electron-updater').autoUpdater; } catch (e) { autoUpdater = null; }

const USER = app.getPath('userData');
const DATA_FILE = path.join(USER, 'migracrm-data.json');
const BACKUP_DIR = path.join(USER, 'backups');
const ADJ_DIR = path.join(USER, 'adjuntos');

// Crear carpetas necesarias
for (const d of [USER, BACKUP_DIR, ADJ_DIR]) {
  try { fs.mkdirSync(d, { recursive: true }); } catch (e) {}
}

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#0f1420',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });
  win.setMenuBarVisibility(false);
  win.loadFile('index.html');
}

// -------------------- Persistencia robusta --------------------
function loadDB() {
  // 1) intentar archivo principal
  try {
    if (fs.existsSync(DATA_FILE)) {
      const c = fs.readFileSync(DATA_FILE, 'utf8');
      JSON.parse(c); // validar
      return c;
    }
  } catch (e) { /* corrupto: caer a backups */ }

  // 2) intentar backups mas recientes (recuperacion ante desastre)
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('backup-') && f.endsWith('.json'))
      .sort().reverse();
    for (const f of files) {
      try {
        const c = fs.readFileSync(path.join(BACKUP_DIR, f), 'utf8');
        JSON.parse(c);
        return c;
      } catch (e) {}
    }
  } catch (e) {}

  return null; // no hay datos aun -> el front crea la BD vacia
}

function saveDB(content) {
  // Validar que sea JSON valido ANTES de tocar el disco
  JSON.parse(content);

  // Escritura atomica: escribir a .tmp y renombrar (evita archivos a medias)
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, DATA_FILE);

  // Backup con marca de tiempo (dedupe por minuto) + rotacion (max 60)
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
    const bfile = path.join(BACKUP_DIR, `backup-${stamp}.json`);
    if (!fs.existsSync(bfile)) fs.writeFileSync(bfile, content, 'utf8');
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('backup-') && f.endsWith('.json')).sort();
    while (files.length > 60) {
      const rm = files.shift();
      try { fs.unlinkSync(path.join(BACKUP_DIR, rm)); } catch (e) {}
    }
  } catch (e) { /* un fallo de backup no debe tumbar el guardado principal */ }

  return true;
}

// -------------------- IPC --------------------
ipcMain.handle('db:load', () => loadDB());

ipcMain.handle('db:save', (e, content) => {
  try { return { ok: true, result: saveDB(content) }; }
  catch (err) { return { ok: false, error: String(err) }; }
});

// Adjuntar archivo: se copia dentro de userData/adjuntos y se guarda solo el nombre
ipcMain.handle('file:attach', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Seleccionar documento',
    properties: ['openFile'],
    filters: [{ name: 'Documentos', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'docx', 'doc', 'xlsx', 'zip'] }, { name: 'Todos', extensions: ['*'] }]
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const src = r.filePaths[0];
  const base = path.basename(src);
  const dest = path.join(ADJ_DIR, Date.now() + '_' + base.replace(/[^\w.\-]/g, '_'));
  fs.copyFileSync(src, dest);
  return { name: base, stored: path.basename(dest) };
});

ipcMain.handle('file:open', (e, storedName) => {
  const p = path.join(ADJ_DIR, storedName);
  if (fs.existsSync(p)) return shell.openPath(p);
  return 'No encontrado';
});

// Leer un adjunto como dataURL (para incrustar imágenes en el expediente maestro PDF)
ipcMain.handle('file:dataurl', (e, storedName) => {
  try {
    const p = path.join(ADJ_DIR, storedName);
    if (!fs.existsSync(p)) return null;
    const ext = path.extname(p).toLowerCase().replace('.', '');
    const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf' }[ext] || 'application/octet-stream';
    const b64 = fs.readFileSync(p).toString('base64');
    return { mime, dataUrl: 'data:' + mime + ';base64,' + b64, isImage: mime.startsWith('image/') };
  } catch (err) { return null; }
});

// Exportar un documento (HTML) a PDF o PNG real, con diálogo de guardado
const { BrowserWindow: _BW } = require('electron');
ipcMain.handle('doc:export', async (e, { html, format, suggested }) => {
  let bw = null;
  const tmpHtml = path.join(USER, '._docexport.html');
  try {
    fs.writeFileSync(tmpHtml, html, 'utf8');
    bw = new _BW({ show: false, width: 820, height: 1200, x: -3200, y: -3200 });
    await bw.loadFile(tmpHtml);
    await new Promise(r => setTimeout(r, 250));
    if (format === 'pdf') {
      const buf = await bw.webContents.printToPDF({ printBackground: true, pageSize: 'Letter' });
      const r = await dialog.showSaveDialog(win, { title: 'Guardar PDF', defaultPath: suggested || 'documento.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (r.canceled || !r.filePath) return null;
      fs.writeFileSync(r.filePath, buf); shell.showItemInFolder(r.filePath); return r.filePath;
    } else {
      const h = await bw.webContents.executeJavaScript('document.body.scrollHeight');
      bw.setContentSize(820, Math.max(300, Math.ceil(h)));
      bw.showInactive(); // renderiza fuera de pantalla para garantizar la captura
      await new Promise(r => setTimeout(r, 400));
      const img = await bw.webContents.capturePage();
      const png = img.toPNG();
      const r = await dialog.showSaveDialog(win, { title: 'Guardar PNG', defaultPath: suggested || 'documento.png', filters: [{ name: 'Imagen PNG', extensions: ['png'] }] });
      if (r.canceled || !r.filePath) return null;
      fs.writeFileSync(r.filePath, png); shell.showItemInFolder(r.filePath); return r.filePath;
    }
  } catch (err) {
    return { error: String(err) };
  } finally {
    try { if (bw) bw.destroy(); } catch (e) {}
    try { fs.unlinkSync(tmpHtml); } catch (e) {}
  }
});

// Enviar a WhatsApp (abre WhatsApp Desktop/Web con el mensaje precargado)
ipcMain.handle('wa:send', (e, { phone, text }) => {
  const clean = String(phone || '').replace(/[^\d]/g, '');
  const url = 'https://wa.me/' + clean + '?text=' + encodeURIComponent(text || '');
  return shell.openExternal(url);
});

// Exportar (CSV / cualquier texto) a un archivo elegido por el usuario
ipcMain.handle('export:save', async (e, { suggested, content }) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Exportar',
    defaultPath: suggested || 'export.csv',
    filters: [{ name: 'Datos', extensions: ['csv', 'txt', 'json'] }]
  });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, '﻿' + content, 'utf8'); // BOM para Excel/acentos
  shell.showItemInFolder(r.filePath);
  return r.filePath;
});

ipcMain.handle('backup:folder', () => shell.openPath(BACKUP_DIR));
ipcMain.handle('app:paths', () => ({ data: DATA_FILE, backups: BACKUP_DIR, adjuntos: ADJ_DIR }));

// -------------------- Auto-actualización (GitHub Releases) --------------------
function setupAutoUpdate() {
  if (!autoUpdater || !app.isPackaged) return;
  try {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    // Descargar SIEMPRE el instalador completo (evita el bug de ffmpeg.dll de las
    // actualizaciones diferenciales, que a veces deja archivos incompletos).
    autoUpdater.disableDifferentialDownload = true;
    const send = (status, info) => {
      try { if (win && !win.isDestroyed()) win.webContents.send('update-status', { status, info }); } catch (e) {}
    };
    autoUpdater.on('checking-for-update', () => send('checking'));
    autoUpdater.on('update-available',   (i) => send('available', { version: i && i.version }));
    autoUpdater.on('update-not-available', () => send('none'));
    autoUpdater.on('download-progress',  (p) => send('progress', { percent: Math.round(p.percent || 0) }));
    autoUpdater.on('update-downloaded',  (i) => send('ready', { version: i && i.version }));
    autoUpdater.on('error', () => send('error'));
    autoUpdater.checkForUpdates().catch(() => {});
    // Revisar de nuevo cada 3 horas
    setInterval(() => { try { autoUpdater.checkForUpdates().catch(() => {}); } catch (e) {} }, 1000 * 60 * 60 * 3);
  } catch (e) { /* nunca romper la app por el updater */ }
}
ipcMain.handle('update:install', () => { try { if (autoUpdater) autoUpdater.quitAndInstall(); } catch (e) {} });
ipcMain.handle('update:check', () => { try { if (autoUpdater && app.isPackaged) autoUpdater.checkForUpdates().catch(() => {}); } catch (e) {} });
ipcMain.handle('app:version', () => app.getVersion());

// -------------------- Ciclo de vida --------------------
app.whenReady().then(() => { createWindow(); setupAutoUpdate(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
