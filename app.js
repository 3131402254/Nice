/* 发票打印助手 · 交互逻辑 */
(function () {
  'use strict';

  var PDFLib = window.PDFLib;
  var Core = window.InvoicePdfCore;

  if (!PDFLib || !PDFLib.PDFDocument || !Core) {
    var fatal = document.createElement('div');
    fatal.style.cssText = 'position:fixed;inset:0;z-index:999;display:grid;place-items:center;padding:24px;background:#fff7ed;color:#7c2d12;font:14px/1.8 "Microsoft YaHei",sans-serif;text-align:center;';
    fatal.innerHTML = 'PDF 组件加载失败。<br>请确认 <b>libs/pdf-lib.min.js</b>、<b>pdf-core.js</b> 与 <b>index.html</b> 在同一目录下。';
    document.body.appendChild(fatal);
    return;
  }

  var $ = function (selector, root) { return (root || document).querySelector(selector); };
  var $$ = function (selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); };

  var dom = {
    stepper: $('#stepper'),
    stepperFill: $('#stepperFill'),
    stepItems: $$('.step-item'),
    stepPanels: $$('.step-panel'),
    dropzone: $('#dropzone'),
    pickFolderBtn: $('#pickFolderBtn'),
    addFilesBtn: $('#addFilesBtn'),
    folderInput: $('#folderInput'),
    filesInput: $('#filesInput'),
    filesArea: $('#filesArea'),
    fileCountTag: $('#fileCountTag'),
    prefixInput: $('#prefixInput'),
    startInput: $('#startInput'),
    digitsSelect: $('#digitsSelect'),
    sortSegmented: $('#sortSegmented'),
    renameOriginBtn: $('#renameOriginBtn'),
    reselectBtn: $('#reselectBtn'),
    listSummary: $('#listSummary'),
    fileTbody: $('#fileTbody'),
    next1Btn: $('#next1Btn'),
    modeSingleCard: $('#modeSingleCard'),
    modeDoubleCard: $('#modeDoubleCard'),
    modeCountTag: $('#modeCountTag'),
    orderPageEstimate: $('#orderPageEstimate'),
    orderFlow: $('#orderFlow'),
    back2Btn: $('#back2Btn'),
    generateBtn: $('#generateBtn'),
    previewPageTag: $('#previewPageTag'),
    resetLayoutBtn: $('#resetLayoutBtn'),
    orientationGroup: $('#orientationGroup'),
    orientationSegmented: $('#orientationSegmented'),
    marginRange: $('#marginRange'),
    marginValue: $('#marginValue'),
    sumPages: $('#sumPages'),
    sumPaper: $('#sumPaper'),
    sumScale: $('#sumScale'),
    sumSize: $('#sumSize'),
    previewFrame: $('#previewFrame'),
    previewLoading: $('#previewLoading'),
    refreshPreviewBtn: $('#refreshPreviewBtn'),
    openPreviewBtn: $('#openPreviewBtn'),
    pageStrip: $('#pageStrip'),
    back3Btn: $('#back3Btn'),
    next3Btn: $('#next3Btn'),
    exportDetail: $('#exportDetail'),
    exportPages: $('#exportPages'),
    exportSize: $('#exportSize'),
    exportPaper: $('#exportPaper'),
    exportMode: $('#exportMode'),
    outputNameInput: $('#outputNameInput'),
    saveBtn: $('#saveBtn'),
    printBtn: $('#printBtn'),
    restartBtn: $('#restartBtn'),
    back4Btn: $('#back4Btn'),
    busyOverlay: $('#busyOverlay'),
    busyTitle: $('#busyTitle'),
    busyText: $('#busyText'),
    busyBar: $('#busyBar'),
    busyDetail: $('#busyDetail'),
    toastStack: $('#toastStack')
  };

  var state = {
    step: 1,
    files: [],
    prefix: '发票',
    start: 1,
    digits: 3,
    sortDir: 'asc',
    manualOrder: false,
    mode: 'single',
    layout: 'smart',
    orientation: 'auto',
    marginMm: 2,
    docs: new Map(),
    docPromises: new Map(),
    pageCounts: new Map(),
    filesToken: 0,
    buildToken: 0,
    isBuilding: false,
    buildQueued: false,
    buildQueuedOpts: null,
    needsRebuild: true,
    finalBytes: null,
    finalPageCount: 0,
    finalPageMeta: [],
    previewUrl: null,
    outputNameEdited: false,
    renamedOriginal: false
  };

  var idCounter = 0;
  var rebuildTimer = null;
  var previewLoadTimer = null;

  /* ---------------- 基础工具 ---------------- */

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function formatDate(timestamp) {
    var d = new Date(timestamp);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 KB';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  }

  function formatMm(pt) {
    return (pt / Core.PT_PER_MM).toFixed(1);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function defaultOutputName() {
    var d = new Date();
    var prefix = state.mode === 'double' ? '发票合并_双页_' : '发票合并_';
    return prefix + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '_' + pad2(d.getHours()) + pad2(d.getMinutes());
  }

  function sanitizeFilename(name) {
    var clean = String(name || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\.pdf$/i, '').replace(/[. ]+$/g, '').trim();
    return clean || defaultOutputName();
  }

  function toast(message, type, duration) {
    type = type || 'info';
    var el = document.createElement('div');
    el.className = 'toast is-' + type;
    var iconWrap = document.createElement('span');
    iconWrap.className = 'toast-icon';
    var icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'icon');
    var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', type === 'success' ? '#i-check' : type === 'error' ? '#i-info' : '#i-info');
    icon.appendChild(use);
    iconWrap.appendChild(icon);
    var text = document.createElement('div');
    text.textContent = message;
    el.appendChild(iconWrap);
    el.appendChild(text);
    dom.toastStack.appendChild(el);
    while (dom.toastStack.children.length > 4) {
      dom.toastStack.removeChild(dom.toastStack.firstElementChild);
    }
    setTimeout(function () {
      el.classList.add('is-out');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
    }, duration || 4200);
  }

  function setBusy(show, title, text, detail) {
    dom.busyOverlay.hidden = !show;
    document.body.style.overflow = show ? 'hidden' : '';
    if (!show) return;
    dom.busyTitle.textContent = title || '正在处理';
    dom.busyText.textContent = text || '请稍候…';
    dom.busyDetail.textContent = detail || '';
    setBusyProgress(0);
  }

  function setBusyText(text) {
    if (text) dom.busyText.textContent = text;
  }

  function setBusyDetail(text) {
    dom.busyDetail.textContent = text || '';
  }

  function setBusyProgress(percent) {
    var p = Math.max(0, Math.min(100, percent));
    dom.busyBar.style.width = p + '%';
  }

  function setPreviewLoading(show, text) {
    if (show) {
      dom.previewLoading.classList.remove('is-hidden');
      if (text) {
        var p = dom.previewLoading.querySelector('p');
        if (p) p.textContent = text;
      }
    } else {
      dom.previewLoading.classList.add('is-hidden');
    }
  }

  function setPreviewError(message) {
    setPreviewLoading(false);
    dom.previewFrame.removeAttribute('src');
    dom.previewFrame.srcdoc = '<div style="min-height:100%;display:flex;align-items:center;justify-content:center;padding:30px;background:#fff8ef;color:#9a3412;font:13px/1.8 \'Microsoft YaHei\',sans-serif;text-align:center;">' +
      escapeHtml(message) + '</div>';
  }

  /* ---------------- 步骤切换 ---------------- */

  function canGoTo(step) {
    if (step <= 1) return true;
    if (step === 2) return state.files.length > 0;
    if (step === 3) return state.files.length > 0;
    if (step === 4) return !!state.finalBytes && !state.needsRebuild && !state.isBuilding;
    return false;
  }

  function goStep(step, scroll) {
    if (!canGoTo(step)) {
      if (step === 2 && !state.files.length) toast('请先选择包含 PDF 的文件夹', 'info');
      if (step === 3 && !state.files.length) toast('请先选择包含 PDF 的文件夹', 'info');
      if (step === 4 && state.isBuilding) toast('正在应用最新排版，请稍候…', 'info');
      else if (step === 4 && !state.finalBytes) toast('请先生成合并预览', 'info');
      return;
    }

    state.step = step;
    dom.stepPanels.forEach(function (panel, index) {
      var active = index + 1 === step;
      panel.hidden = !active;
      panel.classList.toggle('is-active', active);
    });

    dom.stepItems.forEach(function (item, index) {
      var s = index + 1;
      item.classList.toggle('is-active', s === step);
      item.classList.toggle('is-done', s < step);
      item.setAttribute('aria-current', s === step ? 'step' : 'false');
    });

    dom.stepperFill.style.width = ((step - 1) / 3 * 100) + '%';

    if (step === 2) updateStep2();
    if (step === 3) updateStep3();
    if (step === 4) updateStep4Summary();

    if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------------- 文件读取与列表 ---------------- */

  function uid() {
    idCounter += 1;
    return 'f' + Date.now().toString(36) + '_' + idCounter;
  }

  function entriesFromFileList(fileList) {
    return Array.prototype.map.call(fileList, function (file) {
      return { file: file, path: file.webkitRelativePath || file.name };
    });
  }

  async function readEntryRecursive(entry, prefix, out) {
    if (!entry) return;
    if (entry.isFile) {
      var file = await new Promise(function (resolve, reject) { entry.file(resolve, reject); });
      out.push({ file: file, path: (prefix ? prefix + '/' : '') + file.name });
      return;
    }
    if (entry.isDirectory) {
      var dirPrefix = (prefix ? prefix + '/' : '') + entry.name;
      var reader = entry.createReader();
      while (true) {
        var batch = await new Promise(function (resolve, reject) { reader.readEntries(resolve, reject); });
        if (!batch || !batch.length) break;
        for (var i = 0; i < batch.length; i++) {
          await readEntryRecursive(batch[i], dirPrefix, out);
        }
      }
    }
  }

  async function entriesFromDataTransfer(dataTransfer) {
    var items = dataTransfer.items;
    if (!items || !items.length) return entriesFromFileList(dataTransfer.files);
    var roots = [];
    for (var i = 0; i < items.length; i++) {
      var entry = items[i].webkitGetAsEntry ? items[i].webkitGetAsEntry() : null;
      if (entry) roots.push(entry);
    }
    if (!roots.length) return entriesFromFileList(dataTransfer.files);
    var out = [];
    for (var j = 0; j < roots.length; j++) {
      await readEntryRecursive(roots[j], '', out);
    }
    return out;
  }

  function addFileEntries(entries, replace) {
    var pdfEntries = entries.filter(function (entry) {
      return entry && entry.file && /\.pdf$/i.test(entry.file.name);
    });
    if (!pdfEntries.length) {
      toast('没有找到 PDF 文件', 'info');
      return;
    }

    if (replace) {
      clearFileState();
    }

    var existingKeys = new Set(state.files.map(function (item) {
      return item.originalPath + '|' + item.size + '|' + item.lastModified;
    }));

    var added = 0;
    pdfEntries.forEach(function (entry) {
      var file = entry.file;
      var path = entry.path || file.name;
      var key = path + '|' + file.size + '|' + file.lastModified;
      if (existingKeys.has(key)) return;
      existingKeys.add(key);
      state.files.push({
        id: uid(),
        file: file,
        name: file.name,
        originalPath: path,
        size: file.size,
        lastModified: file.lastModified,
        newName: ''
      });
      added += 1;
    });

    if (!added && !replace) {
      toast('这些 PDF 已经在列表里了', 'info');
      return;
    }

    state.manualOrder = false;
    state.filesToken += 1;
    state.outputNameEdited = false;
    state.renamedOriginal = false;
    dom.outputNameInput.value = '';
    sortFiles(false);
    resetResult(true);
    renderFileList();
    startPageCountScan(state.filesToken);
    updateStep2();
    updateStep3Summary();
    toast('已载入 ' + state.files.length + ' 个 PDF 文件' + (replace ? '' : '（新增 ' + added + ' 个）'), 'success');

    if (!replace && state.files.length > 0) {
      dom.filesArea.hidden = false;
    }
  }

  function clearFileState() {
    state.files = [];
    state.docs.clear();
    state.docPromises.clear();
    state.pageCounts.clear();
    state.filesToken += 1;
    state.manualOrder = false;
    state.outputNameEdited = false;
    state.renamedOriginal = false;
    dom.outputNameInput.value = '';
    resetResult(true);
  }

  function sortFiles(render) {
    state.files.sort(function (a, b) {
      var diff = a.lastModified - b.lastModified;
      if (diff === 0) diff = a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
      return state.sortDir === 'asc' ? diff : -diff;
    });
    renumberFiles();
    if (render !== false) {
      renderFileList();
      updatePageEstimate();
      updateStep2();
    }
  }

  function renumberFiles() {
    var digits = Math.max(1, Math.min(6, Number(state.digits) || 3));
    var prefix = String(state.prefix || '').replace(/[_\-\s]+$/g, '');
    state.files.forEach(function (item, index) {
      var number = String((Number(state.start) || 1) + index).padStart(digits, '0');
      item.newName = prefix ? prefix + '_' + number + '.pdf' : number + '.pdf';
    });
  }

  function renderFileList() {
    var count = state.files.length;
    dom.fileCountTag.hidden = count === 0;
    dom.fileCountTag.textContent = count + ' 个 PDF';
    dom.filesArea.hidden = count === 0;

    if (!count) {
      dom.fileTbody.innerHTML = '';
      dom.next1Btn.disabled = true;
      updateFileCountTag();
      return;
    }

    dom.next1Btn.disabled = false;
    dom.fileTbody.innerHTML = state.files.map(function (item, index) {
      var displayPath = item.originalPath && item.originalPath !== item.name ? item.originalPath : '';
      return '<tr data-id="' + escapeHtml(item.id) + '">' +
        '<td><span class="order-pill">' + (index + 1) + '</span></td>' +
        '<td><span class="new-name" title="' + escapeHtml(item.newName) + '"><span class="badge-pdf">PDF</span><span>' + escapeHtml(item.newName) + '</span></span></td>' +
        '<td><div class="file-name" title="' + escapeHtml(item.originalPath) + '">' + escapeHtml(item.name) + '</div>' +
          (displayPath ? '<div class="file-path" title="' + escapeHtml(displayPath) + '">' + escapeHtml(displayPath) + '</div>' : '') + '</td>' +
        '<td><span class="date-text">' + formatDate(item.lastModified) + '</span></td>' +
        '<td><span class="size-text">' + formatBytes(item.size) + '</span></td>' +
        '<td><div class="row-actions">' +
          '<button class="row-btn" type="button" data-action="up" title="上移" ' + (index === 0 ? 'disabled' : '') + '><svg class="icon"><use href="#i-up"></use></svg></button>' +
          '<button class="row-btn" type="button" data-action="down" title="下移" ' + (index === count - 1 ? 'disabled' : '') + '><svg class="icon"><use href="#i-down"></use></svg></button>' +
          '<button class="row-btn is-danger" type="button" data-action="remove" title="移除"><svg class="icon"><use href="#i-trash"></use></svg></button>' +
        '</div></td>' +
      '</tr>';
    }).join('');

    updateFileCountTag();
    updatePageEstimate();
  }

  function updateFileCountTag() {
    dom.fileCountTag.hidden = state.files.length === 0;
    dom.fileCountTag.textContent = state.files.length + ' 个 PDF';
  }

  function moveFile(id, direction) {
    var index = state.files.findIndex(function (item) { return item.id === id; });
    var target = index + direction;
    if (index < 0 || target < 0 || target >= state.files.length) return;
    var tmp = state.files[index];
    state.files[index] = state.files[target];
    state.files[target] = tmp;
    state.manualOrder = true;
    renumberFiles();
    resetResult(true);
    renderFileList();
    updateStep2();
    updateStep3Summary();
  }

  function removeFile(id) {
    var item = state.files.find(function (f) { return f.id === id; });
    if (!item) return;
    state.files = state.files.filter(function (f) { return f.id !== id; });
    state.docs.delete(id);
    state.docPromises.delete(id);
    state.pageCounts.delete(id);
    state.filesToken += 1;
    state.manualOrder = true;
    renumberFiles();
    resetResult(true);
    renderFileList();
    updateStep2();
    updateStep3Summary();
    if (!state.files.length) {
      toast('列表已清空，请重新选择文件夹', 'info');
    }
  }

  function handleNamingChange() {
    state.prefix = dom.prefixInput.value;
    state.start = Math.max(1, Number(dom.startInput.value) || 1);
    state.digits = Number(dom.digitsSelect.value) || 3;
    renumberFiles();
    resetResult(true);
    renderFileList();
    updateStep2();
    updateStep3Summary();
  }

  /* ---------------- 页数统计 ---------------- */

  function getDoc(item) {
    if (state.docs.has(item.id)) return Promise.resolve(state.docs.get(item.id));
    if (state.docPromises.has(item.id)) return state.docPromises.get(item.id);
    var promise = item.file.arrayBuffer()
      .then(function (buffer) {
        return PDFLib.PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
      })
      .then(function (doc) {
        state.docs.set(item.id, doc);
        state.docPromises.delete(item.id);
        return doc;
      })
      .catch(function (error) {
        state.docPromises.delete(item.id);
        throw error;
      });
    state.docPromises.set(item.id, promise);
    return promise;
  }

  async function startPageCountScan(token) {
    var queue = state.files.slice();
    if (!queue.length) return;

    var worker = async function () {
      while (queue.length) {
        if (token !== state.filesToken) return;
        var item = queue.shift();
        if (state.pageCounts.has(item.id)) {
          updatePageEstimate();
          continue;
        }
        try {
          var doc = await getDoc(item);
          if (token !== state.filesToken) return;
          state.pageCounts.set(item.id, doc.getPageCount());
        } catch (error) {
          if (token !== state.filesToken) return;
          state.pageCounts.set(item.id, null);
          console.warn('无法读取页数：' + item.name, error);
        }
        updatePageEstimate();
        updateStep2();
      }
    };

    await Promise.all([worker(), worker()]);
  }

  function getPageStats() {
    var knownPages = 0;
    var knownCount = 0;
    var pendingCount = 0;
    var failedCount = 0;
    state.files.forEach(function (item) {
      if (!state.pageCounts.has(item.id)) {
        pendingCount += 1;
        return;
      }
      var count = state.pageCounts.get(item.id);
      if (count === null) {
        failedCount += 1;
        return;
      }
      knownPages += count;
      knownCount += 1;
    });
    return {
      knownPages: knownPages,
      knownCount: knownCount,
      pendingCount: pendingCount,
      failedCount: failedCount,
      outputPages: knownPages * (state.mode === 'double' ? 2 : 1)
    };
  }

  function updatePageEstimate() {
    var stats = getPageStats();
    var parts = ['共 ' + state.files.length + ' 个 PDF'];

    if (state.manualOrder) {
      parts.push('已手动调整顺序');
    } else {
      parts.push(state.sortDir === 'asc' ? '按修改时间升序' : '按修改时间降序');
    }

    if (stats.pendingCount > 0) {
      parts.push('正在统计页数…');
    } else if (stats.failedCount > 0) {
      parts.push(stats.failedCount + ' 个文件无法读取');
    } else {
      parts.push('共 ' + stats.knownPages + ' 页');
    }

    dom.listSummary.textContent = parts.join(' · ');

    if (stats.pendingCount > 0 && stats.knownCount === 0) {
      dom.orderPageEstimate.textContent = '正在统计页数…';
    } else if (stats.pendingCount > 0) {
      dom.orderPageEstimate.textContent = '预计 ' + stats.outputPages + ' 页 · 统计中…';
    } else if (stats.failedCount > 0) {
      dom.orderPageEstimate.textContent = '预计 ' + stats.outputPages + ' 页 · ' + stats.failedCount + ' 个读取失败';
    } else {
      dom.orderPageEstimate.textContent = '预计 ' + stats.outputPages + ' 页';
    }
  }

  /* ---------------- 合并方式与顺序预览 ---------------- */

  function updateModeCards() {
    dom.modeSingleCard.classList.toggle('is-checked', state.mode === 'single');
    dom.modeDoubleCard.classList.toggle('is-checked', state.mode === 'double');
    $$('input[name="mergeMode"]').forEach(function (input) {
      input.checked = input.value === state.mode;
    });
  }

  function updateOrderFlow() {
    var chips = [];
    state.files.forEach(function (item, index) {
      var copies = state.mode === 'double' ? 2 : 1;
      for (var c = 0; c < copies; c++) {
        chips.push({ name: item.newName, index: index + 1, copy: c });
      }
    });

    var limit = 12;
    var shown = chips.slice(0, limit);
    var html = shown.map(function (chip, index) {
      var arrow = index > 0 ? '<svg class="flow-arrow"><use href="#i-arrow-right"></use></svg>' : '';
      return arrow + '<span class="flow-chip" title="' + escapeHtml(chip.name) + '"><span>' + escapeHtml(chip.name) + '</span><em>' + chip.index + '</em></span>';
    }).join('');

    if (chips.length > limit) {
      html += '<span class="flow-more">还有 ' + (chips.length - limit) + ' 页</span>';
    }
    if (!chips.length) {
      html = '<span class="flow-more">选择文件后显示合并顺序</span>';
    }
    dom.orderFlow.innerHTML = html;
  }

  function updateStep2() {
    dom.modeCountTag.textContent = '共 ' + state.files.length + ' 个文件';
    updateModeCards();
    updateOrderFlow();
    updatePageEstimate();
  }

  /* ---------------- 结果失效 ---------------- */

  function resetResult(clearPreview) {
    state.buildToken += 1;
    state.needsRebuild = true;
    state.finalBytes = null;
    state.finalPageCount = 0;
    state.finalPageMeta = [];
    dom.next3Btn.disabled = true;
    dom.saveBtn.disabled = true;
    dom.openPreviewBtn.disabled = true;
    dom.printBtn.disabled = true;

    if (clearPreview) {
      if (state.previewUrl) {
        URL.revokeObjectURL(state.previewUrl);
        state.previewUrl = null;
      }
      dom.previewFrame.removeAttribute('src');
      dom.previewFrame.removeAttribute('srcdoc');
      setPreviewLoading(true, '正在排版 PDF…');
      dom.pageStrip.innerHTML = '';
      updateStep3Summary();
      updateStep4Summary();
    }
  }

  function markSettingsDirty() {
    state.buildToken += 1;
    state.needsRebuild = true;
    dom.next3Btn.disabled = true;
    dom.saveBtn.disabled = true;
  }

  /* ---------------- 生成 PDF ---------------- */

  function setPreviewFrame(url) {
    var oldUrl = state.previewUrl;
    state.previewUrl = url;
    dom.previewFrame.removeAttribute('srcdoc');
    dom.previewFrame.src = url + '#toolbar=1&navpanes=0&view=FitH';
    setPreviewLoading(true, '正在载入预览…');
    clearTimeout(previewLoadTimer);
    previewLoadTimer = setTimeout(function () {
      setPreviewLoading(false);
    }, 1200);
    if (oldUrl && oldUrl !== url) {
      setTimeout(function () { URL.revokeObjectURL(oldUrl); }, 5000);
    }
    dom.openPreviewBtn.disabled = false;
    dom.printBtn.disabled = false;
  }

  async function generateAndPreview(options) {
    options = options || {};

    if (state.isBuilding) {
      state.buildQueued = true;
      state.buildQueuedOpts = options;
      return;
    }
    if (!state.files.length) {
      toast('请先选择包含 PDF 的文件夹', 'info');
      return;
    }

    state.isBuilding = true;
    state.buildQueued = false;
    state.buildQueuedOpts = null;
    var token = ++state.buildToken;
    var silent = !!options.silent;

    if (silent) {
      setPreviewLoading(true, '正在应用最新排版…');
    } else {
      setBusy(true, '正在合并发票', '正在读取 PDF 文件…', '文件仅在本机处理');
    }
    dom.next3Btn.disabled = true;
    dom.saveBtn.disabled = true;

    try {
      var sources = [];
      for (var i = 0; i < state.files.length; i++) {
        var item = state.files[i];
        if (token !== state.buildToken) return;
        if (!silent) {
          setBusyText('正在读取 ' + item.name + '（' + (i + 1) + '/' + state.files.length + '）');
          setBusyProgress((i / state.files.length) * 22);
        }
        var doc = await getDoc(item);
        if (token !== state.buildToken) return;
        sources.push({ name: item.newName, originalName: item.name, doc: doc });
      }

      if (token !== state.buildToken) return;
      if (!silent) {
        setBusyText('正在按 A5 排版…');
        setBusyDetail('共 ' + sources.length + ' 个 PDF');
      }

      var result = await Core.buildMergedPdf(PDFLib, sources, {
        mode: state.mode,
        layout: state.layout,
        orientation: state.orientation,
        marginMm: state.marginMm,
        title: '发票合并'
      }, function (done, total) {
        if (token !== state.buildToken) return;
        var percent = 22 + (total ? (done / total) * 78 : 78);
        if (silent) {
          setBusyProgress(percent);
        } else {
          setBusyProgress(percent);
          setBusyText('正在排版第 ' + done + ' / ' + total + ' 页');
        }
      });

      if (token !== state.buildToken) return;

      var blob = new Blob([result.bytes], { type: 'application/pdf' });
      var url = URL.createObjectURL(blob);

      state.finalBytes = result.bytes;
      state.finalPageCount = result.pageCount;
      state.finalPageMeta = result.pageMeta;
      state.needsRebuild = false;

      setPreviewFrame(url);
      renderPageStrip();
      updateStep3Summary();
      updateStep4Summary();

      dom.next3Btn.disabled = false;
      dom.saveBtn.disabled = false;

      if (!silent) {
        setBusyProgress(100);
        toast('合并完成，共 ' + result.pageCount + ' 页', 'success');
      }

      if (options.goToPreview) {
        goStep(3, true);
      }
    } catch (error) {
      console.error(error);
      state.needsRebuild = true;
      setPreviewError('预览生成失败：' + (error && error.message ? error.message : error));
      toast('生成失败：' + (error && error.message ? error.message : error), 'error', 8000);
    } finally {
      state.isBuilding = false;
      if (!silent) setBusy(false);

      if (state.buildQueued) {
        var queuedOpts = state.buildQueuedOpts || {};
        state.buildQueued = false;
        state.buildQueuedOpts = null;
        generateAndPreview(queuedOpts);
      } else {
        if (silent) setPreviewLoading(false);
        dom.next3Btn.disabled = !state.finalBytes || state.needsRebuild;
        dom.saveBtn.disabled = !state.finalBytes || state.needsRebuild;
      }
    }
  }

  function scheduleRegenerate() {
    markSettingsDirty();
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(function () {
      rebuildTimer = null;
      generateAndPreview({ silent: true, goToPreview: false });
    }, 320);
  }

  /* ---------------- 步骤 3 控件 ---------------- */

  function updateLayoutControls() {
    $$('input[name="layoutMode"]').forEach(function (input) {
      input.checked = input.value === state.layout;
      var option = input.closest('.layout-option');
      if (option) option.classList.toggle('is-checked', input.value === state.layout);
    });

    $$('#orientationSegmented button').forEach(function (button) {
      var active = button.getAttribute('data-orientation') === state.orientation;
      button.classList.toggle('is-active', active);
      button.disabled = state.layout === 'actual';
    });
    dom.orientationGroup.classList.toggle('is-disabled', state.layout === 'actual');

    dom.marginRange.value = String(state.marginMm);
    dom.marginValue.textContent = state.marginMm + ' mm';
    dom.marginRange.disabled = false;
  }

  function getPaperLabel() {
    if (state.layout === 'actual') return '原尺寸（页面随发票）';
    var hasPortrait = false;
    var hasLandscape = false;
    state.finalPageMeta.forEach(function (meta) {
      if (meta.pageWidth > meta.pageHeight) hasLandscape = true;
      else hasPortrait = true;
    });
    if (hasPortrait && hasLandscape) return 'A5 纵向 / 横向混排';
    if (hasLandscape) return 'A5 横向 210 × 148 mm';
    return 'A5 纵向 148 × 210 mm';
  }

  function updateStep3Summary() {
    if (!state.finalBytes || !state.finalPageMeta.length) {
      dom.previewPageTag.textContent = '0 页';
      dom.sumPages.textContent = '—';
      dom.sumPaper.textContent = '—';
      dom.sumScale.textContent = '—';
      dom.sumSize.textContent = '—';
      return;
    }
    dom.previewPageTag.textContent = state.finalPageCount + ' 页';
    dom.sumPages.textContent = state.finalPageCount + ' 页';
    dom.sumPaper.textContent = getPaperLabel();

    var minScale = 1;
    var maxScale = 1;
    state.finalPageMeta.forEach(function (meta) {
      minScale = Math.min(minScale, meta.scale);
      maxScale = Math.max(maxScale, meta.scale);
    });
    var minPercent = Math.round(minScale * 100);
    var maxPercent = Math.round(maxScale * 100);
    if (minPercent === 100 && maxPercent === 100) {
      dom.sumScale.textContent = '100%（原尺寸）';
    } else if (minPercent === maxPercent) {
      dom.sumScale.textContent = minPercent + '%';
    } else {
      dom.sumScale.textContent = minPercent + '% – ' + maxPercent + '%';
    }

    dom.sumSize.textContent = formatBytes(state.finalBytes.length);
  }

  function updateStep3() {
    updateLayoutControls();
    updateStep3Summary();
    if (!state.finalBytes && !state.isBuilding) {
      generateAndPreview({ goToPreview: false });
    }
  }

  function renderPageStrip() {
    var metas = state.finalPageMeta;
    dom.pageStrip.innerHTML = '';
    if (!metas.length) return;

    var limit = Math.min(metas.length, 120);
    var fragment = document.createDocumentFragment();

    for (var i = 0; i < limit; i++) {
      var meta = metas[i];
      var ratio = meta.pageWidth / meta.pageHeight;
      var maxW = 66;
      var maxH = 100;
      var width = maxW;
      var height = width / ratio;
      if (height > maxH) {
        height = maxH;
        width = height * ratio;
      }

      var card = document.createElement('div');
      card.className = 'page-card';
      card.style.animationDelay = Math.min(i * 18, 260) + 'ms';

      var thumb = document.createElement('div');
      thumb.className = 'page-thumb';

      var paper = document.createElement('div');
      paper.className = 'page-paper';
      paper.style.width = width.toFixed(1) + 'px';
      paper.style.height = height.toFixed(1) + 'px';

      var inner = document.createElement('div');
      inner.className = 'page-inner';
      if (meta.scale < 0.995) inner.classList.add('is-scaled');
      if (state.layout === 'actual') inner.classList.add('is-actual');
      inner.style.left = (meta.offsetX / meta.pageWidth * 100) + '%';
      inner.style.bottom = (meta.offsetY / meta.pageHeight * 100) + '%';
      inner.style.width = (meta.drawWidth / meta.pageWidth * 100) + '%';
      inner.style.height = (meta.drawHeight / meta.pageHeight * 100) + '%';
      paper.appendChild(inner);

      if (meta.rotation) {
        var badge = document.createElement('span');
        badge.className = 'page-rotate-badge';
        badge.innerHTML = '<svg class="icon"><use href="#i-rotate"></use></svg>';
        badge.title = '已旋转 ' + meta.rotation + '°';
        paper.appendChild(badge);
      }

      thumb.appendChild(paper);

      var metaWrap = document.createElement('div');
      metaWrap.className = 'page-card-meta';
      var title = document.createElement('b');
      title.textContent = '第 ' + meta.pageNumber + ' 页';
      title.title = meta.originalName + ' · 第 ' + meta.sourcePage + ' 页';
      var sub = document.createElement('small');
      sub.textContent = Math.round(meta.scale * 100) + '%' + (meta.rotation ? ' · 旋转' : '');
      sub.title = formatMm(meta.sourceDisplayWidth) + ' × ' + formatMm(meta.sourceDisplayHeight) + ' mm';
      metaWrap.appendChild(title);
      metaWrap.appendChild(sub);

      card.appendChild(thumb);
      card.appendChild(metaWrap);
      fragment.appendChild(card);
    }

    dom.pageStrip.appendChild(fragment);

    if (metas.length > limit) {
      var more = document.createElement('div');
      more.className = 'page-more';
      more.textContent = '还有 ' + (metas.length - limit) + ' 页';
      dom.pageStrip.appendChild(more);
    }
  }

  /* ---------------- 步骤 4 ---------------- */

  function updateStep4Summary() {
    var modeLabel = state.mode === 'double' ? '双页合并' : '单页合并';
    var paperLabel = getPaperLabel();

    if (!state.finalBytes) {
      dom.exportPages.textContent = '—';
      dom.exportSize.textContent = '—';
      dom.exportPaper.textContent = paperLabel;
      dom.exportMode.textContent = modeLabel;
      dom.exportDetail.textContent = '尚未生成合并结果';
      dom.openPreviewBtn.disabled = true;
      dom.printBtn.disabled = true;
      return;
    }

    dom.exportPages.textContent = state.finalPageCount + ' 页';
    dom.exportSize.textContent = formatBytes(state.finalBytes.length);
    dom.exportPaper.textContent = paperLabel;
    dom.exportMode.textContent = modeLabel;
    dom.exportDetail.textContent = state.files.length + ' 个 PDF · ' + modeLabel + ' · ' + paperLabel;

    if (!state.outputNameEdited && !dom.outputNameInput.value) {
      dom.outputNameInput.value = defaultOutputName();
    }

    dom.saveBtn.disabled = !state.finalBytes || state.needsRebuild || state.isBuilding;
    dom.printBtn.disabled = !state.previewUrl;
  }

  async function savePdf() {
    if (!state.finalBytes || state.needsRebuild) {
      toast('请先生成最新的合并预览', 'info');
      return;
    }
    var filename = sanitizeFilename(dom.outputNameInput.value) + '.pdf';
    var blob = new Blob([state.finalBytes], { type: 'application/pdf' });

    if (window.showSaveFilePicker) {
      try {
        var options = {
          suggestedName: filename,
          types: [{ description: 'PDF 文件', accept: { 'application/pdf': ['.pdf'] } }]
        };
        var handle;
        try {
          options.startIn = 'desktop';
          handle = await window.showSaveFilePicker(options);
        } catch (pickerError) {
          if (pickerError && pickerError.name === 'AbortError') {
            toast('已取消保存', 'info');
            return;
          }
          delete options.startIn;
          handle = await window.showSaveFilePicker(options);
        }
        var writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        toast('已保存：' + handle.name, 'success', 5000);
        return;
      } catch (error) {
        if (error && error.name === 'AbortError') {
          toast('已取消保存', 'info');
          return;
        }
        console.warn('showSaveFilePicker 失败，改用下载方式', error);
      }
    }

    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    toast('已开始下载：' + filename, 'success', 5000);
  }

  function openPreview() {
    if (!state.previewUrl) {
      toast('预览尚未生成', 'info');
      return;
    }
    window.open(state.previewUrl, '_blank');
  }

  /* ---------------- 重命名原文件夹 ---------------- */

  function makeNameAt(index) {
    var digits = Math.max(1, Math.min(6, Number(state.digits) || 3));
    var prefix = String(state.prefix || '').replace(/[_\-\s]+$/g, '');
    var number = String((Number(state.start) || 1) + index).padStart(digits, '0');
    return prefix ? prefix + '_' + number + '.pdf' : number + '.pdf';
  }

  async function renameOriginalFolder() {
    if (!window.showDirectoryPicker) {
      toast('当前浏览器不支持直接重命名文件夹，请使用 Chrome 或 Edge', 'info', 6000);
      return;
    }
    if (!state.files.length) return;

    var sampleNames = state.files.slice(0, 3).map(function (item) { return item.newName; }).join('、');
    var confirmed = window.confirm(
      '将按当前排序和命名规则，重命名所选文件夹第一层的所有 PDF。\n\n示例：' + sampleNames + '\n\n' +
      '此操作会直接修改原文件，建议先关闭正在打开这些 PDF 的程序。\n\n' +
      '点击“确定”后，请在弹窗中选择同一个文件夹。'
    );
    if (!confirmed) return;

    setBusy(true, '正在重命名原文件', '请选择发票所在的文件夹…', '仅处理该文件夹第一层的 PDF');
    var dir;
    try {
      dir = await window.showDirectoryPicker({ id: 'invoice-original-folder', mode: 'readwrite', startIn: 'desktop' });
    } catch (error) {
      setBusy(false);
      if (error && error.name !== 'AbortError') {
        toast('无法获取文件夹权限：' + (error.message || error), 'error', 7000);
      }
      return;
    }

    try {
      var entries = [];
      for await (var pair of dir.entries()) {
        var name = pair[0];
        var handle = pair[1];
        if (handle.kind !== 'file' || !/\.pdf$/i.test(name)) continue;
        var file = await handle.getFile();
        entries.push({ name: name, handle: handle, file: file, size: file.size, lastModified: file.lastModified });
      }

      if (!entries.length) {
        setBusy(false);
        toast('所选文件夹第一层没有 PDF 文件', 'info');
        return;
      }

      var used = new Set();
      var ordered = [];

      state.files.forEach(function (item) {
        var matchIndex = entries.findIndex(function (entry, index) {
          if (used.has(index)) return false;
          return entry.name === item.name && entry.size === item.file.size;
        });
        if (matchIndex < 0) {
          matchIndex = entries.findIndex(function (entry, index) {
            return !used.has(index) && entry.name === item.name;
          });
        }
        if (matchIndex >= 0) {
          used.add(matchIndex);
          ordered.push({ entry: entries[matchIndex], newName: item.newName });
        }
      });

      entries.forEach(function (entry, index) {
        if (used.has(index)) return;
        ordered.push({ entry: entry, newName: '' });
      });

      var assignedIndex = state.files.length;
      ordered.forEach(function (row) {
        if (!row.newName) {
          row.newName = makeNameAt(assignedIndex);
          assignedIndex += 1;
        }
      });

      setBusyText('正在读取 PDF 内容…');
      for (var i = 0; i < ordered.length; i++) {
        ordered[i].buffer = await ordered[i].entry.file.arrayBuffer();
        setBusyProgress((i / ordered.length) * 25);
      }

      setBusyText('正在写入新文件名…');
      for (var j = 0; j < ordered.length; j++) {
        var fileHandle = await dir.getFileHandle(ordered[j].newName, { create: true });
        var writable = await fileHandle.createWritable();
        await writable.write(ordered[j].buffer);
        await writable.close();
        setBusyProgress(25 + ((j + 1) / ordered.length) * 70);
        setBusyDetail('已重命名 ' + (j + 1) + ' / ' + ordered.length + ' 个文件');
      }

      setBusyText('正在清理旧文件名…');
      var finalNames = new Set(ordered.map(function (row) { return row.newName; }));
      var oldNames = Array.from(new Set(entries.map(function (entry) { return entry.name; })));
      for (var k = 0; k < oldNames.length; k++) {
        if (!finalNames.has(oldNames[k])) {
          try {
            await dir.removeEntry(oldNames[k]);
          } catch (removeError) {
            console.warn('无法删除旧文件：' + oldNames[k], removeError);
          }
        }
      }

      setBusyProgress(100);
      state.renamedOriginal = true;

      // 原文件被重命名后，之前持有的 File 句柄已失效，用缓冲内容重建，保证后续合并仍可读取
      ordered.forEach(function (row) {
        if (row.stateIndex == null) return;
        var item = state.files[row.stateIndex];
        item.file = new File([row.buffer], row.newName, { type: 'application/pdf', lastModified: Date.now() });
        item.name = row.newName;
        item.originalPath = row.newName;
        item.newName = row.newName;
        item.size = item.file.size;
        item.lastModified = item.file.lastModified;
      });
      state.docs.clear();
      state.docPromises.clear();
      state.pageCounts.clear();
      state.filesToken += 1;
      resetResult(true);
      renderFileList();
      startPageCountScan(state.filesToken);
      updateStep2();

      toast('原文件夹已重命名 ' + ordered.length + ' 个 PDF', 'success', 6000);
    } catch (error) {
      console.error(error);
      toast('重命名失败：' + (error && error.message ? error.message : error) + '。部分文件可能已变更，请检查文件夹。', 'error', 9000);
    } finally {
      setBusy(false);
    }
  }

  /* ---------------- 重置 ---------------- */

  function restart() {
    var confirmed = window.confirm('确定要清空当前任务，处理新一批发票吗？');
    if (!confirmed) return;

    clearTimeout(rebuildTimer);
    rebuildTimer = null;
    state.buildToken += 1;
    state.filesToken += 1;
    state.isBuilding = false;
    state.buildQueued = false;
    state.buildQueuedOpts = null;

    clearFileState();
    state.finalBytes = null;
    state.finalPageCount = 0;
    state.finalPageMeta = [];
    state.needsRebuild = true;
    state.outputNameEdited = false;
    state.renamedOriginal = false;

    dom.outputNameInput.value = '';
    dom.folderInput.value = '';
    dom.filesInput.value = '';
    dom.filesArea.hidden = true;
    dom.fileTbody.innerHTML = '';
    dom.fileCountTag.hidden = true;
    dom.next1Btn.disabled = true;
    dom.pageStrip.innerHTML = '';
    dom.previewFrame.removeAttribute('src');
    dom.previewFrame.removeAttribute('srcdoc');
    setPreviewLoading(true, '正在排版 PDF…');
    dom.exportPages.textContent = '—';
    dom.exportSize.textContent = '—';
    dom.exportPaper.textContent = '—';
    dom.exportMode.textContent = '—';
    dom.exportDetail.textContent = '—';
    dom.saveBtn.disabled = true;
    dom.printBtn.disabled = true;
    dom.next3Btn.disabled = true;
    dom.openPreviewBtn.disabled = true;

    goStep(1, true);
    updateStep3Summary();
    setTimeout(function () { dom.prefixInput.focus(); }, 300);
  }

  /* ---------------- 事件绑定 ---------------- */

  function bindEvents() {
    dom.stepItems.forEach(function (item) {
      item.addEventListener('click', function () {
        var step = Number(item.getAttribute('data-step'));
        if (step === 3 && state.files.length && (!state.finalBytes || state.needsRebuild) && !state.isBuilding) {
          generateAndPreview({ goToPreview: true });
          return;
        }
        if (step > state.step && !canGoTo(step)) {
          if (step === 2) toast('请先选择包含 PDF 的文件夹', 'info');
          else if (step === 3) toast('请先生成合并预览', 'info');
          else if (step === 4) toast('请先完成 A5 排版预览', 'info');
          return;
        }
        goStep(step, true);
      });
    });

    dom.pickFolderBtn.addEventListener('click', function () { dom.folderInput.click(); });
    dom.addFilesBtn.addEventListener('click', function () { dom.filesInput.click(); });
    dom.reselectBtn.addEventListener('click', function () { dom.folderInput.click(); });

    dom.folderInput.addEventListener('change', function () {
      var entries = entriesFromFileList(dom.folderInput.files);
      dom.folderInput.value = '';
      if (entries.length) addFileEntries(entries, true);
    });

    dom.filesInput.addEventListener('change', function () {
      var entries = entriesFromFileList(dom.filesInput.files);
      dom.filesInput.value = '';
      if (entries.length) addFileEntries(entries, false);
    });

    var dragCounter = 0;
    dom.dropzone.addEventListener('dragenter', function (event) {
      event.preventDefault();
      dragCounter += 1;
      dom.dropzone.classList.add('is-dragover');
    });
    dom.dropzone.addEventListener('dragover', function (event) {
      event.preventDefault();
      dom.dropzone.classList.add('is-dragover');
    });
    dom.dropzone.addEventListener('dragleave', function (event) {
      event.preventDefault();
      dragCounter -= 1;
      if (dragCounter <= 0) {
        dragCounter = 0;
        dom.dropzone.classList.remove('is-dragover');
      }
    });
    dom.dropzone.addEventListener('drop', async function (event) {
      event.preventDefault();
      dragCounter = 0;
      dom.dropzone.classList.remove('is-dragover');
      try {
        var entries = await entriesFromDataTransfer(event.dataTransfer);
        addFileEntries(entries, false);
      } catch (error) {
        console.error(error);
        toast('读取拖入的文件失败：' + (error.message || error), 'error');
      }
    });

    dom.prefixInput.addEventListener('input', handleNamingChange);
    dom.startInput.addEventListener('change', handleNamingChange);
    dom.digitsSelect.addEventListener('change', handleNamingChange);

    dom.sortSegmented.addEventListener('click', function (event) {
      var button = event.target.closest('button[data-sort]');
      if (!button) return;
      var dir = button.getAttribute('data-sort');
      if (dir === state.sortDir && !state.manualOrder) return;
      state.sortDir = dir;
      state.manualOrder = false;
      $$('button', dom.sortSegmented).forEach(function (b) {
        b.classList.toggle('is-active', b === button);
      });
      sortFiles(true);
      resetResult(true);
    });

    dom.fileTbody.addEventListener('click', function (event) {
      var button = event.target.closest('button[data-action]');
      if (!button) return;
      var row = button.closest('tr');
      if (!row) return;
      var id = row.getAttribute('data-id');
      var action = button.getAttribute('data-action');
      if (action === 'up') moveFile(id, -1);
      else if (action === 'down') moveFile(id, 1);
      else if (action === 'remove') removeFile(id);
    });

    dom.next1Btn.addEventListener('click', function () {
      if (!state.files.length) return;
      goStep(2, true);
    });

    $$('input[name="mergeMode"]').forEach(function (input) {
      input.addEventListener('change', function () {
        state.mode = input.value;
        state.outputNameEdited = false;
        dom.outputNameInput.value = '';
        updateModeCards();
        updateOrderFlow();
        updatePageEstimate();
        resetResult(true);
        updateStep3Summary();
      });
    });

    dom.back2Btn.addEventListener('click', function () { goStep(1, true); });

    dom.generateBtn.addEventListener('click', function () {
      generateAndPreview({ goToPreview: true });
    });

    dom.back3Btn.addEventListener('click', function () { goStep(2, true); });

    dom.next3Btn.addEventListener('click', function () {
      if (!state.finalBytes || state.needsRebuild || state.isBuilding) {
        toast('正在应用最新排版，请稍候…', 'info');
        return;
      }
      goStep(4, true);
    });

    dom.refreshPreviewBtn.addEventListener('click', function () {
      generateAndPreview({ silent: true, goToPreview: false });
    });

    dom.openPreviewBtn.addEventListener('click', openPreview);
    dom.printBtn.addEventListener('click', openPreview);

    $$('input[name="layoutMode"]').forEach(function (input) {
      input.addEventListener('change', function () {
        state.layout = input.value;
        updateLayoutControls();
        updateStep3Summary();
        scheduleRegenerate();
      });
    });

    dom.orientationSegmented.addEventListener('click', function (event) {
      var button = event.target.closest('button[data-orientation]');
      if (!button || button.disabled) return;
      state.orientation = button.getAttribute('data-orientation');
      updateLayoutControls();
      scheduleRegenerate();
    });

    dom.marginRange.addEventListener('input', function () {
      state.marginMm = Number(dom.marginRange.value) || 0;
      dom.marginValue.textContent = state.marginMm + ' mm';
      scheduleRegenerate();
    });

    dom.resetLayoutBtn.addEventListener('click', function () {
      state.layout = 'smart';
      state.orientation = 'auto';
      state.marginMm = 2;
      updateLayoutControls();
      updateStep3Summary();
      scheduleRegenerate();
      toast('已恢复默认排版设置', 'info', 2500);
    });

    dom.renameOriginBtn.addEventListener('click', renameOriginalFolder);

    dom.next1Btn.addEventListener('mouseenter', function () {
      if (state.files.length) dom.next1Btn.classList.add('is-ready');
    });

    dom.outputNameInput.addEventListener('input', function () {
      state.outputNameEdited = true;
    });

    dom.saveBtn.addEventListener('click', savePdf);
    dom.restartBtn.addEventListener('click', restart);
    dom.back4Btn.addEventListener('click', function () { goStep(3, true); });

    dom.previewFrame.addEventListener('load', function () {
      clearTimeout(previewLoadTimer);
      setPreviewLoading(false);
    });
  }

  /* ---------------- 初始化 ---------------- */

  function init() {
    dom.renameOriginBtn.hidden = !window.showDirectoryPicker;
    dom.openPreviewBtn.disabled = true;
    dom.printBtn.disabled = true;
    dom.next3Btn.disabled = true;
    dom.saveBtn.disabled = true;

    updateModeCards();
    updateLayoutControls();
    updatePageEstimate();
    updateStep3Summary();
    bindEvents();
    goStep(1, false);
  }

  init();
})();
