/**
 * CoverSwap — Audio Cover Art Replacer
 * Frontend Application Logic
 */

(function () {
  'use strict';

  // --- State ---
  const state = {
    currentBrowsePath: null,
    scannedFiles: [],
    selectedFiles: new Set(),
    scannedNonAudioFiles: [],
    selectedNonAudioFiles: new Set(),
    coverImageFile: null,
    metadataMode: 'set',
    browseTarget: 'scan', // 'scan' | 'replace_output' | 'convert_output'
    isScanning: false,
    isReplacing: false,
  };

  // --- DOM Refs ---
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const els = {
    folderPathInput: $('#folderPathInput'),
    btnBrowse: $('#btnBrowse'),
    btnScan: $('#btnScan'),
    recursiveCheckbox: $('#recursiveCheckbox'),
    folderBrowser: $('#folderBrowser'),
    browserPath: $('#browserPath'),
    browserList: $('#browserList'),
    btnDrives: $('#btnDrives'),
    btnParent: $('#btnParent'),
    btnSelectFolder: $('#btnSelectFolder'),
    btnCancelBrowse: $('#btnCancelBrowse'),
    stepImage: $('#stepImage'),
    imageDropZone: $('#imageDropZone'),
    dropZoneContent: $('#dropZoneContent'),
    imagePreview: $('#imagePreview'),
    previewImg: $('#previewImg'),
    btnRemoveImage: $('#btnRemoveImage'),
    imageFileInput: $('#imageFileInput'),
    stepMetadata: $('#stepMetadata'),
    btnTabSet: $('#btnTabSet'),
    btnTabReplace: $('#btnTabReplace'),
    metaPaneSet: $('#metaPaneSet'),
    metaPaneReplace: $('#metaPaneReplace'),
    metaCheckTitle: $('#metaCheckTitle'),
    metaInputTitle: $('#metaInputTitle'),
    metaCheckArtist: $('#metaCheckArtist'),
    metaInputArtist: $('#metaInputArtist'),
    metaCheckAlbumArtist: $('#metaCheckAlbumArtist'),
    metaInputAlbumArtist: $('#metaInputAlbumArtist'),
    metaCheckAlbum: $('#metaCheckAlbum'),
    metaInputAlbum: $('#metaInputAlbum'),
    btnClearSet: $('#btnClearSet'),
    metaFindText: $('#metaFindText'),
    metaReplaceText: $('#metaReplaceText'),
    metaTargetTitle: $('#metaTargetTitle'),
    metaTargetArtist: $('#metaTargetArtist'),
    metaTargetAlbumArtist: $('#metaTargetAlbumArtist'),
    metaTargetAlbum: $('#metaTargetAlbum'),
    metaCaseSensitive: $('#metaCaseSensitive'),
    stepFiles: $('#stepFiles'),
    filesSubtitle: $('#filesSubtitle'),
    filesList: $('#filesList'),
    btnSelectAll: $('#btnSelectAll'),
    btnDeselectAll: $('#btnDeselectAll'),
    saveEditedCopiesCheckbox: $('#saveEditedCopiesCheckbox'),
    replaceOutputDirInput: $('#replaceOutputDirInput'),
    btnBrowseReplaceDir: $('#btnBrowseReplaceDir'),
    selectedCount: $('#selectedCount'),
    writableCount: $('#writableCount'),
    btnReplace: $('#btnReplace'),
    stepConvert: $('#stepConvert'),
    convertSubtitle: $('#convertSubtitle'),
    btnSelectAllNonAudio: $('#btnSelectAllNonAudio'),
    btnDeselectAllNonAudio: $('#btnDeselectAllNonAudio'),
    convertOutputDirInput: $('#convertOutputDirInput'),
    btnBrowseConvertDir: $('#btnBrowseConvertDir'),
    convertFormatSelect: $('#convertFormatSelect'),
    convertBitrateSelect: $('#convertBitrateSelect'),
    nonAudioFilesList: $('#nonAudioFilesList'),
    nonAudioSelectedCount: $('#nonAudioSelectedCount'),
    btnStartConvert: $('#btnStartConvert'),
    headerStatus: $('#headerStatus'),
    updateNotification: $('#updateNotification'),
    updateNotificationText: $('#updateNotificationText'),
    progressModal: $('#progressModal'),
    modalTitle: $('#modalTitle'),
    progressBar: $('#progressBar'),
    progressText: $('#progressText'),
    progressStats: $('#progressStats'),
    progressResults: $('#progressResults'),
    statSuccess: $('#statSuccess'),
    statError: $('#statError'),
    statSkipped: $('#statSkipped'),
    modalFooter: $('#modalFooter'),
    btnCloseModal: $('#btnCloseModal'),
  };

  // --- Toast System ---
  let toastContainer = document.createElement('div');
  toastContainer.className = 'toast-container';
  document.body.appendChild(toastContainer);

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'toastOut 0.3s ease forwards';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // --- Status Updates ---
  function setStatus(text, color = 'emerald') {
    const statusEl = els.headerStatus;
    const dot = statusEl.querySelector('.status-dot');
    const textEl = statusEl.querySelector('.status-text');
    textEl.textContent = text;

    const colors = {
      emerald: { bg: '#34d399', shadow: 'rgba(52, 211, 153, 0.5)' },
      violet: { bg: '#a78bfa', shadow: 'rgba(167, 139, 250, 0.5)' },
      amber: { bg: '#fbbf24', shadow: 'rgba(251, 191, 36, 0.5)' },
      red: { bg: '#f87171', shadow: 'rgba(248, 113, 113, 0.5)' },
    };

    const c = colors[color] || colors.emerald;
    dot.style.background = c.bg;
    dot.style.boxShadow = `0 0 8px ${c.shadow}`;
  }

  function renderUpdateStatus(status = { state: 'idle' }) {
    const button = els.updateNotification;
    button.classList.remove('ready', 'error');
    button.disabled = false;
    button.dataset.state = status.state;

    if (status.state === 'idle' || status.state === 'checking') {
      button.hidden = true;
      return;
    }

    button.hidden = false;
    if (status.state === 'available') {
      els.updateNotificationText.textContent = `Downloading CoverSwap ${status.version}...`;
      button.disabled = true;
    } else if (status.state === 'downloading') {
      els.updateNotificationText.textContent = `Downloading update ${status.percent || 0}%`;
      button.disabled = true;
    } else if (status.state === 'downloaded') {
      els.updateNotificationText.textContent = `Version ${status.version} ready — restart`;
      button.classList.add('ready');
      button.title = 'Restart CoverSwap and install the downloaded update';
    } else if (status.state === 'portable-available') {
      els.updateNotificationText.textContent = `Version ${status.version} available`;
      button.title = 'Open the GitHub download page';
    } else {
      els.updateNotificationText.textContent = 'Update failed — retry';
      button.classList.add('error');
      button.title = status.message || 'Retry the update check';
    }
  }

  async function setupUpdateNotifications() {
    const updates = window.coverSwapUpdates;
    if (!updates) return;

    renderUpdateStatus(await updates.getStatus());
    updates.onStatus(renderUpdateStatus);
    els.updateNotification.addEventListener('click', () => {
      const action = els.updateNotification.dataset.state;
      if (action === 'downloaded') updates.install();
      else if (action === 'portable-available') updates.openRelease();
      else if (action === 'error') updates.check();
    });
  }

  // --- API Helpers ---
  async function api(endpoint, options = {}) {
    const { method = 'GET', body, isFormData = false } = options;
    const config = { method };

    if (body) {
      if (isFormData) {
        config.body = body;
      } else {
        config.headers = { 'Content-Type': 'application/json' };
        config.body = JSON.stringify(body);
      }
    }

    const res = await fetch(`/api${endpoint}`, config);
    return res.json();
  }

  // --- Folder Browser ---
  async function openBrowser(targetMode = 'scan') {
    state.browseTarget = targetMode;
    els.folderBrowser.style.display = 'block';
    let startPath = 'C:\\';
    if (targetMode === 'replace_output') {
      startPath = els.replaceOutputDirInput.value.trim() || els.folderPathInput.value.trim() || 'C:\\';
    } else if (targetMode === 'convert_output') {
      startPath = els.convertOutputDirInput.value.trim() || els.folderPathInput.value.trim() || 'C:\\';
    } else {
      startPath = els.folderPathInput.value.trim() || 'C:\\';
    }
    await browseTo(startPath);
  }

  function closeBrowser() {
    els.folderBrowser.style.display = 'none';
  }

  async function browseTo(dirPath) {
    els.browserList.innerHTML = '<div class="browser-item empty"><div class="spinner"></div></div>';
    state.currentBrowsePath = dirPath;

    const data = await api('/browse', { method: 'POST', body: { dirPath } });

    if (data.error) {
      els.browserList.innerHTML = `<div class="browser-item empty">${data.error}</div>`;
      return;
    }

    els.browserPath.textContent = data.currentPath;
    state.currentBrowsePath = data.currentPath;

    if (data.items.length === 0) {
      els.browserList.innerHTML = '<div class="browser-item empty">No subfolders</div>';
      return;
    }

    els.browserList.innerHTML = '';
    for (const item of data.items) {
      const div = document.createElement('div');
      div.className = 'browser-item';
      div.innerHTML = `
        <svg viewBox="0 0 20 20" fill="currentColor"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/></svg>
        <span>${escapeHtml(item.name)}</span>
      `;
      div.addEventListener('click', () => browseTo(item.path));
      els.browserList.appendChild(div);
    }
  }

  async function showDrives() {
    els.browserList.innerHTML = '<div class="browser-item empty"><div class="spinner"></div></div>';
    const data = await api('/drives');

    els.browserPath.textContent = 'Drives';
    els.browserList.innerHTML = '';

    for (const drive of data.drives) {
      const div = document.createElement('div');
      div.className = 'browser-item';
      div.innerHTML = `
        <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3 5a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V5zm14 1H3v6h14V6z" clip-rule="evenodd"/></svg>
        <span>${drive.name}</span>
      `;
      div.addEventListener('click', () => browseTo(drive.path));
      els.browserList.appendChild(div);
    }
  }

  async function goParent() {
    if (!state.currentBrowsePath) return;
    const data = await api('/browse', { method: 'POST', body: { dirPath: state.currentBrowsePath } });
    if (data.parentPath) {
      await browseTo(data.parentPath);
    }
  }

  function selectCurrentFolder() {
    if (state.currentBrowsePath) {
      if (state.browseTarget === 'replace_output') {
        els.replaceOutputDirInput.value = state.currentBrowsePath;
        updateSelectionCount();
      } else if (state.browseTarget === 'convert_output') {
        els.convertOutputDirInput.value = state.currentBrowsePath;
        updateNonAudioSelectionCount();
      } else {
        els.folderPathInput.value = state.currentBrowsePath;
      }
    }
    closeBrowser();
  }

  // --- Scan Files ---
  async function scanFiles() {
    const dirPath = els.folderPathInput.value.trim();
    if (!dirPath) {
      showToast('Please enter a folder path', 'error');
      return;
    }

    state.isScanning = true;
    setStatus('Scanning...', 'violet');

    // Show loading
    els.stepFiles.classList.remove('disabled');
    els.stepFiles.classList.add('active');
    els.filesList.innerHTML = `
      <div class="scan-loading">
        <div class="spinner"></div>
        <p>Scanning for audio files...</p>
      </div>
    `;

    try {
      const data = await api('/scan', {
        method: 'POST',
        body: {
          dirPath,
          recursive: els.recursiveCheckbox.checked,
        },
      });

      if (data.error) {
        showToast(data.error, 'error');
        setStatus('Error', 'red');
        els.filesList.innerHTML = `<div class="empty-state"><p>${escapeHtml(data.error)}</p></div>`;
        state.isScanning = false;
        return;
      }

      state.scannedFiles = data.files;
      state.selectedFiles.clear();

      // Auto-select all files
      for (const file of data.files) {
        state.selectedFiles.add(file.path);
      }

      state.scannedNonAudioFiles = data.nonAudioFiles || [];
      state.selectedNonAudioFiles.clear();
      for (const file of state.scannedNonAudioFiles) {
        state.selectedNonAudioFiles.add(file.path);
      }

      // Enable image, metadata & convert steps
      els.stepImage.classList.remove('disabled');
      els.stepMetadata.classList.remove('disabled');
      els.stepConvert.classList.remove('disabled');
      els.stepConvert.classList.add('active');

      // Default output folder for converted audio
      const defaultOutDir = dirPath + (dirPath.includes('/') ? '/' : '\\') + 'Converted Audio';
      if (!els.convertOutputDirInput.value.trim() || els.convertOutputDirInput.value.endsWith('Converted Audio')) {
        els.convertOutputDirInput.value = defaultOutDir;
      }
      const defaultReplaceDir = dirPath + (dirPath.includes('/') ? '/' : '\\') + 'Replaced Audio';
      if (!els.replaceOutputDirInput.value.trim() || els.replaceOutputDirInput.value.endsWith('Replaced Audio')) {
        els.replaceOutputDirInput.value = defaultReplaceDir;
      }

      renderFilesList();
      updateSelectionCount();
      renderNonAudioFilesList();
      updateNonAudioSelectionCount();

      // Build subtitle with scan summary
      let subtitle = `${data.totalAudioFiles} audio files found`;
      if (data.skippedFiles > 0) {
        subtitle += ` • ${data.skippedFiles} non-audio files found`;
      }
      subtitle += ` • ${data.totalFilesScanned} total files scanned`;
      els.filesSubtitle.textContent = subtitle;
      els.convertSubtitle.textContent = `${state.scannedNonAudioFiles.length} audio and video files available for conversion`;

      // Show skipped extensions as a toast if there are any
      if (data.skippedFiles > 0 && data.skippedExtensions) {
        const extList = Object.entries(data.skippedExtensions)
          .sort((a, b) => b[1] - a[1])
          .map(([ext, count]) => `${ext} (${count})`)
          .join(', ');
        showToast(`Skipped non-audio: ${extList}`, 'info');
      }

      setStatus(`${data.totalAudioFiles} files found`, 'emerald');
      showToast(`Found ${data.totalAudioFiles} audio files`, 'success');
    } catch (err) {
      showToast('Failed to scan: ' + err.message, 'error');
      setStatus('Error', 'red');
    }

    state.isScanning = false;
  }

  // --- Render Files List ---
  function renderFilesList() {
    if (state.scannedFiles.length === 0) {
      els.filesList.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 48 48" fill="none"><path d="M24 4L6 14v20l18 10 18-10V14L24 4z" stroke="currentColor" stroke-width="2"/></svg>
          <p>No audio files found in this folder</p>
        </div>
      `;
      return;
    }

    els.filesList.innerHTML = '';

    for (const file of state.scannedFiles) {
      const item = document.createElement('div');
      const isSelected = state.selectedFiles.has(file.path);
      item.className = `file-item${isSelected ? ' selected' : ''}`;
      item.dataset.path = file.path;

      const ext = file.ext.replace('.', '').toUpperCase();
      const badgeClass = ext === 'MP3' ? 'mp3' : ext === 'FLAC' ? 'flac' : 'other';

      const coverHtml = file.hasCover
        ? `<img src="/api/cover?path=${encodeURIComponent(file.path)}" alt="cover" loading="lazy" />`
        : `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clip-rule="evenodd"/></svg>`;

      const sizeStr = file.size ? formatSize(file.size) : '';

      item.innerHTML = `
        <div class="file-check"></div>
        <div class="file-cover">${coverHtml}</div>
        <div class="file-info">
          <div class="file-title" title="${escapeHtml(file.title)}">${escapeHtml(file.title)}</div>
          <div class="file-meta">
            <span>${escapeHtml(file.artist)}</span>
            ${file.album !== 'Unknown' ? `<span>• ${escapeHtml(file.album)}</span>` : ''}
            ${sizeStr ? `<span>• ${sizeStr}</span>` : ''}
          </div>
        </div>
        <span class="file-badge ${badgeClass}">${ext}</span>
        <span class="file-badge ${file.hasCover ? 'has-cover' : 'no-cover'}">${file.hasCover ? 'Cover' : 'No Cover'}</span>
        <span class="file-badge ${file.coverWritable ? 'has-cover' : 'no-cover'}">${file.coverWritable ? 'Cover editing' : file.metadataWritable ? 'Tags only' : 'Convert only'}</span>
      `;

      item.addEventListener('click', () => toggleFileSelection(file.path, item));
      els.filesList.appendChild(item);
    }
  }

  function toggleFileSelection(filePath, element) {
    if (state.selectedFiles.has(filePath)) {
      state.selectedFiles.delete(filePath);
      element.classList.remove('selected');
    } else {
      state.selectedFiles.add(filePath);
      element.classList.add('selected');
    }
    updateSelectionCount();
  }

  function selectAll() {
    state.selectedFiles.clear();
    for (const file of state.scannedFiles) {
      state.selectedFiles.add(file.path);
    }
    $$('.file-item').forEach((el) => el.classList.add('selected'));
    updateSelectionCount();
  }

  function deselectAll() {
    state.selectedFiles.clear();
    $$('.file-item').forEach((el) => el.classList.remove('selected'));
    updateSelectionCount();
  }

  function hasMetadataChanges() {
    if (state.metadataMode === 'set') {
      return (
        els.metaCheckTitle.checked ||
        els.metaCheckArtist.checked ||
        els.metaCheckAlbumArtist.checked ||
        els.metaCheckAlbum.checked
      );
    } else if (state.metadataMode === 'replace') {
      return els.metaFindText.value.trim() !== '' && (
        els.metaTargetTitle.checked ||
        els.metaTargetArtist.checked ||
        els.metaTargetAlbumArtist.checked ||
        els.metaTargetAlbum.checked
      );
    }
    return false;
  }

  function getMetadataPayload() {
    if (!hasMetadataChanges()) return null;
    if (state.metadataMode === 'set') {
      const set = {};
      if (els.metaCheckTitle.checked) set.title = els.metaInputTitle.value;
      if (els.metaCheckArtist.checked) set.artist = els.metaInputArtist.value;
      if (els.metaCheckAlbumArtist.checked) set.performerInfo = els.metaInputAlbumArtist.value;
      if (els.metaCheckAlbum.checked) set.album = els.metaInputAlbum.value;
      return { mode: 'set', set };
    } else if (state.metadataMode === 'replace') {
      const targets = [];
      if (els.metaTargetTitle.checked) targets.push('title');
      if (els.metaTargetArtist.checked) targets.push('artist');
      if (els.metaTargetAlbumArtist.checked) targets.push('performerInfo');
      if (els.metaTargetAlbum.checked) targets.push('album');
      return {
        mode: 'replace',
        replace: {
          findText: els.metaFindText.value,
          replaceText: els.metaReplaceText.value,
          targets,
          caseSensitive: els.metaCaseSensitive.checked,
        }
      };
    }
    return null;
  }

  function updateSelectionCount() {
    const total = state.selectedFiles.size;
    const hasMeta = hasMetadataChanges();
    const compatible = state.scannedFiles.filter((file) => {
      if (!state.selectedFiles.has(file.path)) return false;
      if (state.coverImageFile && !file.coverWritable) return false;
      if (hasMeta && !file.metadataWritable) return false;
      return true;
    }).length;
    const skipped = total - compatible;

    els.selectedCount.textContent = `${total} file${total !== 1 ? 's' : ''} selected`;
    els.writableCount.textContent = skipped > 0
      ? `${compatible} compatible • ${skipped} will be skipped`
      : `${compatible} compatible`;

    const hasReplaceDestination = !els.saveEditedCopiesCheckbox.checked || els.replaceOutputDirInput.value.trim() !== '';
    const canProceed = compatible > 0 && (state.coverImageFile !== null || hasMeta) && hasReplaceDestination;
    els.btnReplace.disabled = !canProceed;

    if (state.coverImageFile && hasMeta) {
      els.btnReplace.innerHTML = '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd"/></svg> Replace Covers & Metadata';
    } else if (hasMeta) {
      els.btnReplace.innerHTML = '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" clip-rule="evenodd"/></svg> Update Text & Metadata';
    } else {
      els.btnReplace.innerHTML = '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd"/></svg> Replace Covers';
    }
  }

  // --- Image Selection ---
  function setupImageDropZone() {
    const zone = els.imageDropZone;

    zone.addEventListener('click', (e) => {
      if (e.target.closest('.btn-remove-image')) return;
      els.imageFileInput.click();
    });

    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('drag-over');
    });

    zone.addEventListener('dragleave', () => {
      zone.classList.remove('drag-over');
    });

    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        handleImageFile(files[0]);
      }
    });

    els.imageFileInput.addEventListener('change', () => {
      if (els.imageFileInput.files.length > 0) {
        handleImageFile(els.imageFileInput.files[0]);
      }
    });

    els.btnRemoveImage.addEventListener('click', (e) => {
      e.stopPropagation();
      removeImage();
    });
  }

  function handleImageFile(file) {
    if (!file.type.startsWith('image/')) {
      showToast('Please select an image file', 'error');
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      showToast('Image must be under 20MB', 'error');
      return;
    }

    state.coverImageFile = file;

    const reader = new FileReader();
    reader.onload = (e) => {
      els.previewImg.src = e.target.result;
      els.dropZoneContent.style.display = 'none';
      els.imagePreview.style.display = 'flex';
      els.imageDropZone.style.borderStyle = 'solid';
      els.imageDropZone.style.borderColor = 'rgba(167, 139, 250, 0.3)';
    };
    reader.readAsDataURL(file);

    updateSelectionCount();
    showToast('Cover image selected', 'success');
  }

  function removeImage() {
    state.coverImageFile = null;
    els.previewImg.src = '';
    els.dropZoneContent.style.display = 'block';
    els.imagePreview.style.display = 'none';
    els.imageDropZone.style.borderStyle = 'dashed';
    els.imageDropZone.style.borderColor = '';
    els.imageFileInput.value = '';
    updateSelectionCount();
  }

  // --- Replace Covers ---
  async function replaceCovers() {
    const hasMeta = hasMetadataChanges();
    if (!state.coverImageFile && !hasMeta) return;
    if (state.selectedFiles.size === 0) return;

    const hasCover = state.coverImageFile !== null;
    const eligiblePaths = state.scannedFiles
      .filter((file) => state.selectedFiles.has(file.path))
      .filter((file) => (!hasCover || file.coverWritable) && (!hasMeta || file.metadataWritable))
      .map((file) => file.path);
    if (eligiblePaths.length === 0) {
      showToast('None of the selected formats support this edit. Convert them first.', 'error');
      return;
    }
    const saveCopies = els.saveEditedCopiesCheckbox.checked;
    const replacementOutputDir = els.replaceOutputDirInput.value.trim();
    if (saveCopies && !replacementOutputDir) {
      showToast('Select a separate folder for the replaced copies', 'error');
      return;
    }
    const skippedCount = state.selectedFiles.size - eligiblePaths.length;
    if (skippedCount > 0) {
      showToast(`${skippedCount} incompatible file${skippedCount === 1 ? '' : 's'} skipped`, 'info');
    }

    state.isReplacing = true;
    setStatus('Replacing...', 'amber');

    // Reset modal state
    els.progressModal.style.display = 'flex';
    els.modalTitle.textContent = (state.coverImageFile && hasMeta) ? 'Replacing Covers & Metadata...' : hasMeta ? 'Updating Text & Metadata...' : 'Replacing Cover Art...';
    els.progressBar.style.width = '0%';
    els.progressBar.classList.remove('indeterminate');
    els.progressText.textContent = `Preparing ${eligiblePaths.length} files...`;
    els.progressStats.style.display = 'flex';
    els.statSuccess.textContent = '0';
    els.statError.textContent = '0';
    els.statSkipped.textContent = '0';
    els.progressResults.style.display = 'block';
    els.progressResults.innerHTML = '';
    els.modalFooter.style.display = 'none';

    try {
      const formData = new FormData();
      if (state.coverImageFile) {
        formData.append('coverImage', state.coverImageFile);
      }
      formData.append('files', JSON.stringify(eligiblePaths));
      if (saveCopies) formData.append('outputDir', replacementOutputDir);
      const metaPayload = getMetadataPayload();
      if (metaPayload) {
        formData.append('metadataOptions', JSON.stringify(metaPayload));
      }

      const jobRes = await api('/create-job', {
        method: 'POST',
        body: formData,
        isFormData: true,
      });

      if (jobRes.error) {
        els.progressText.textContent = 'Error: ' + jobRes.error;
        setStatus('Error', 'red');
        showToast(jobRes.error, 'error');
        els.modalFooter.style.display = 'flex';
        state.isReplacing = false;
        return;
      }

      // Connect to EventSource SSE stream
      const evtSource = new EventSource(`/api/job-stream/${jobRes.jobId}`);

      evtSource.addEventListener('progress', (e) => {
        const data = JSON.parse(e.data);
        els.progressBar.style.width = `${data.percent}%`;
        els.progressText.textContent = `Processing file ${data.processed} of ${data.total} (${data.percent}%)`;

        els.statSuccess.textContent = data.summary.success;
        els.statError.textContent = data.summary.error;
        els.statSkipped.textContent = data.summary.skipped;

        if (data.item) {
          const div = document.createElement('div');
          div.className = `result-item ${data.item.status}`;
          const displayPath = data.item.outputPath || data.item.path;
          const name = displayPath.split(/[/\\]/).pop();
          const icon =
            data.item.status === 'success'
              ? '<svg class="result-icon" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>'
              : '<svg class="result-icon" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>';

          div.innerHTML = `${icon}<span class="result-name" title="${escapeHtml(displayPath)}">${escapeHtml(name)}</span>`;
          if (data.item.message) div.title = data.item.message;

          els.progressResults.prepend(div);
        }
      });

      evtSource.addEventListener('complete', (e) => {
        const data = JSON.parse(e.data);
        evtSource.close();

        els.progressBar.style.width = '100%';
        els.modalTitle.textContent = 'Complete!';
        els.progressText.textContent = `Processed ${data.total} files!`;

        els.statSuccess.textContent = data.summary.success;
        els.statError.textContent = data.summary.error;
        els.statSkipped.textContent = data.summary.skipped;

        setStatus('Done', 'emerald');
        showToast(`Successfully updated ${data.summary.success} files!`, 'success');
        els.modalFooter.style.display = 'flex';
        state.isReplacing = false;
      });

      evtSource.onerror = (err) => {
        evtSource.close();
        els.progressText.textContent = 'Connection closed or lost.';
        els.modalFooter.style.display = 'flex';
        state.isReplacing = false;
      };

    } catch (err) {
      els.progressBar.style.width = '100%';
      els.progressText.textContent = 'Error: ' + err.message;
      setStatus('Error', 'red');
      showToast('Failed: ' + err.message, 'error');
      els.modalFooter.style.display = 'flex';
      state.isReplacing = false;
    }
  }

  function closeModal() {
    els.progressModal.style.display = 'none';
    // Re-scan to update covers
    if (els.folderPathInput.value.trim()) {
      scanFiles();
    }
  }

  // --- Utility ---
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  // --- Metadata Section Setup ---
  function setupMetadataSection() {
    // Tabs switching
    els.btnTabSet.addEventListener('click', () => {
      state.metadataMode = 'set';
      els.btnTabSet.classList.add('active');
      els.btnTabReplace.classList.remove('active');
      els.metaPaneSet.style.display = 'block';
      els.metaPaneReplace.style.display = 'none';
      updateSelectionCount();
    });

    els.btnTabReplace.addEventListener('click', () => {
      state.metadataMode = 'replace';
      els.btnTabReplace.classList.add('active');
      els.btnTabSet.classList.remove('active');
      els.metaPaneReplace.style.display = 'block';
      els.metaPaneSet.style.display = 'none';
      updateSelectionCount();
    });

    // Set/overwrite fields interactions
    const fields = [
      { check: els.metaCheckTitle, input: els.metaInputTitle, item: $('#fieldTitle') },
      { check: els.metaCheckArtist, input: els.metaInputArtist, item: $('#fieldArtist') },
      { check: els.metaCheckAlbumArtist, input: els.metaInputAlbumArtist, item: $('#fieldAlbumArtist') },
      { check: els.metaCheckAlbum, input: els.metaInputAlbum, item: $('#fieldAlbum') },
    ];

    fields.forEach(({ check, input, item }) => {
      check.addEventListener('change', () => {
        if (check.checked) {
          item.classList.add('active-field');
          input.focus();
        } else {
          item.classList.remove('active-field');
        }
        updateSelectionCount();
      });

      input.addEventListener('input', () => {
        if (!check.checked && input.value.trim() !== '') {
          check.checked = true;
          item.classList.add('active-field');
        }
        updateSelectionCount();
      });
    });

    els.btnClearSet.addEventListener('click', () => {
      fields.forEach(({ check, input, item }) => {
        check.checked = false;
        input.value = '';
        item.classList.remove('active-field');
      });
      updateSelectionCount();
    });

    // Find & replace inputs changes
    [
      els.metaFindText, els.metaReplaceText,
      els.metaTargetTitle, els.metaTargetArtist, els.metaTargetAlbumArtist, els.metaTargetAlbum,
      els.metaCaseSensitive
    ].forEach((element) => {
      element.addEventListener('input', updateSelectionCount);
      element.addEventListener('change', updateSelectionCount);
    });
  }

  // --- Non-Audio Files & Conversion ---
  function renderNonAudioFilesList() {
    if (state.scannedNonAudioFiles.length === 0) {
      els.nonAudioFilesList.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 48 48" fill="none"><path d="M24 4L6 14v20l18 10 18-10V14L24 4z" stroke="currentColor" stroke-width="2"/></svg>
          <p>No convertible audio or video files found in this folder</p>
        </div>
      `;
      return;
    }

    els.nonAudioFilesList.innerHTML = '';

    for (const file of state.scannedNonAudioFiles) {
      const item = document.createElement('div');
      const isSelected = state.selectedNonAudioFiles.has(file.path);
      item.className = `file-item${isSelected ? ' selected' : ''}`;
      item.dataset.path = file.path;

      const ext = file.ext.replace('.', '').toUpperCase() || 'FILE';
      const badgeClass = file.isMedia ? 'video' : 'other';

      const iconSvg = file.isMedia
        ? `<svg viewBox="0 0 20 20" fill="currentColor" style="width:18px;height:18px;color:var(--text-accent);"><path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z"/></svg>`
        : `<svg viewBox="0 0 20 20" fill="currentColor" style="width:18px;height:18px;color:var(--text-muted);"><path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clip-rule="evenodd"/></svg>`;

      const sizeStr = file.size ? formatSize(file.size) : '';

      item.innerHTML = `
        <div class="file-check"></div>
        <div class="file-cover" style="display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.03);">${iconSvg}</div>
        <div class="file-info">
          <div class="file-title" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
          <div class="file-meta">
            <span>${escapeHtml(file.path)}</span>
            ${sizeStr ? `<span>• ${sizeStr}</span>` : ''}
          </div>
        </div>
        <span class="file-badge ${badgeClass}">${ext}</span>
      `;

      item.addEventListener('click', () => toggleNonAudioFileSelection(file.path, item));
      els.nonAudioFilesList.appendChild(item);
    }
  }

  function toggleNonAudioFileSelection(filePath, element) {
    if (state.selectedNonAudioFiles.has(filePath)) {
      state.selectedNonAudioFiles.delete(filePath);
      element.classList.remove('selected');
    } else {
      state.selectedNonAudioFiles.add(filePath);
      element.classList.add('selected');
    }
    updateNonAudioSelectionCount();
  }

  function selectAllNonAudio() {
    state.selectedNonAudioFiles.clear();
    for (const file of state.scannedNonAudioFiles) {
      state.selectedNonAudioFiles.add(file.path);
    }
    els.nonAudioFilesList.querySelectorAll('.file-item').forEach((el) => el.classList.add('selected'));
    updateNonAudioSelectionCount();
  }

  function deselectAllNonAudio() {
    state.selectedNonAudioFiles.clear();
    els.nonAudioFilesList.querySelectorAll('.file-item').forEach((el) => el.classList.remove('selected'));
    updateNonAudioSelectionCount();
  }

  function updateNonAudioSelectionCount() {
    const count = state.selectedNonAudioFiles.size;
    const hasOutDir = els.convertOutputDirInput.value.trim() !== '';

    els.nonAudioSelectedCount.textContent = `${count} media file${count !== 1 ? 's' : ''} selected`;
    els.btnStartConvert.disabled = count === 0 || !hasOutDir;
  }

  async function startNonAudioConversion() {
    const count = state.selectedNonAudioFiles.size;
    const outputDir = els.convertOutputDirInput.value.trim();

    if (count === 0) {
      showToast('No media files selected for conversion', 'error');
      return;
    }
    if (!outputDir) {
      showToast('Please select or enter a target output folder', 'error');
      return;
    }

    state.isReplacing = true;
    setStatus('Converting...', 'violet');

    els.progressModal.style.display = 'flex';
    els.modalTitle.textContent = `Converting ${count} Files to Audio...`;
    els.progressBar.style.width = '0%';
    els.progressBar.classList.remove('indeterminate');
    els.progressText.textContent = `Preparing files for conversion to ${els.convertFormatSelect.value.toUpperCase()}...`;
    els.progressStats.style.display = 'flex';
    els.statSuccess.textContent = '0';
    els.statError.textContent = '0';
    els.statSkipped.textContent = '0';
    els.progressResults.style.display = 'block';
    els.progressResults.innerHTML = '';
    els.modalFooter.style.display = 'none';

    try {
      const formData = new FormData();
      if (state.coverImageFile) {
        formData.append('coverImage', state.coverImageFile);
      }
      formData.append('files', JSON.stringify([...state.selectedNonAudioFiles]));
      formData.append('outputDir', outputDir);
      formData.append('format', els.convertFormatSelect.value);
      formData.append('bitrate', els.convertBitrateSelect.value);

      const metaPayload = getMetadataPayload();
      if (metaPayload) {
        formData.append('metadataOptions', JSON.stringify(metaPayload));
      }

      const jobRes = await api('/create-convert-job', {
        method: 'POST',
        body: formData,
        isFormData: true,
      });

      if (jobRes.error) {
        els.progressText.textContent = 'Error: ' + jobRes.error;
        setStatus('Error', 'red');
        showToast(jobRes.error, 'error');
        els.modalFooter.style.display = 'flex';
        state.isReplacing = false;
        return;
      }

      const evtSource = new EventSource(`/api/job-stream/${jobRes.jobId}`);

      evtSource.addEventListener('progress', (e) => {
        const data = JSON.parse(e.data);
        els.progressBar.style.width = `${data.percent}%`;
        els.progressText.textContent = `Converting file ${data.processed} of ${data.total} (${data.percent}%)`;

        els.statSuccess.textContent = data.summary.success;
        els.statError.textContent = data.summary.error;
        els.statSkipped.textContent = data.summary.skipped;

        if (data.item) {
          const div = document.createElement('div');
          div.className = `result-item ${data.item.status}`;
          const name = data.item.path.split(/[/\\]/).pop();
          const icon =
            data.item.status === 'success'
              ? '<svg class="result-icon" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>'
              : '<svg class="result-icon" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>';

          div.innerHTML = `${icon}<span class="result-name" title="${escapeHtml(data.item.path)}">${escapeHtml(name)} → ${els.convertFormatSelect.value.toUpperCase()}</span>`;
          if (data.item.message) div.title = data.item.message;

          els.progressResults.prepend(div);
        }
      });

      evtSource.addEventListener('complete', (e) => {
        const data = JSON.parse(e.data);
        evtSource.close();

        els.progressBar.style.width = '100%';
        els.modalTitle.textContent = 'Conversion Complete!';
        els.progressText.textContent = `Successfully converted ${data.summary.success} files into ${outputDir}`;

        els.statSuccess.textContent = data.summary.success;
        els.statError.textContent = data.summary.error;
        els.statSkipped.textContent = data.summary.skipped;

        setStatus('Converted', 'emerald');
        showToast(`Successfully converted ${data.summary.success} files into target folder!`, 'success');
        els.modalFooter.style.display = 'flex';
        state.isReplacing = false;
      });

      evtSource.onerror = () => {
        evtSource.close();
        els.progressText.textContent = 'Connection closed or lost.';
        els.modalFooter.style.display = 'flex';
        state.isReplacing = false;
      };

    } catch (err) {
      els.progressBar.style.width = '100%';
      els.progressText.textContent = 'Error: ' + err.message;
      setStatus('Error', 'red');
      showToast('Failed: ' + err.message, 'error');
      els.modalFooter.style.display = 'flex';
      state.isReplacing = false;
    }
  }

  // --- Event Bindings ---
  function init() {
    els.btnBrowse.addEventListener('click', () => openBrowser('scan'));
    els.btnCancelBrowse.addEventListener('click', closeBrowser);
    els.btnDrives.addEventListener('click', showDrives);
    els.btnParent.addEventListener('click', goParent);
    els.btnSelectFolder.addEventListener('click', selectCurrentFolder);
    els.btnScan.addEventListener('click', scanFiles);
    els.btnSelectAll.addEventListener('click', selectAll);
    els.btnDeselectAll.addEventListener('click', deselectAll);
    els.btnReplace.addEventListener('click', replaceCovers);
    els.btnCloseModal.addEventListener('click', closeModal);

    els.btnBrowseConvertDir.addEventListener('click', () => openBrowser('convert_output'));
    els.btnSelectAllNonAudio.addEventListener('click', selectAllNonAudio);
    els.btnDeselectAllNonAudio.addEventListener('click', deselectAllNonAudio);
    els.convertOutputDirInput.addEventListener('input', updateNonAudioSelectionCount);
    els.convertFormatSelect.addEventListener('change', updateNonAudioSelectionCount);
    els.convertBitrateSelect.addEventListener('change', updateNonAudioSelectionCount);
    els.btnStartConvert.addEventListener('click', startNonAudioConversion);

    els.saveEditedCopiesCheckbox.addEventListener('change', () => {
      const enabled = els.saveEditedCopiesCheckbox.checked;
      els.replaceOutputDirInput.disabled = !enabled;
      els.btnBrowseReplaceDir.disabled = !enabled;
      updateSelectionCount();
    });
    els.replaceOutputDirInput.addEventListener('input', updateSelectionCount);
    els.btnBrowseReplaceDir.addEventListener('click', () => openBrowser('replace_output'));

    // Enter key on path input triggers scan
    els.folderPathInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') scanFiles();
    });

    setupImageDropZone();
    setupMetadataSection();
    setupUpdateNotifications().catch(() => {});
  }

  // Boot
  init();
})();
