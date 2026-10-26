window.POST_LIBRARY_V2 = true;

(() => {
  'use strict';

  const STORAGE_KEY = 'post-schedule-desk-v1';
  const DIRECT_FILL_PREFERENCE_KEY = 'post-schedule-direct-fill-v1';
  const AUTOMATION_CONFIG_KEY = 'post-schedule-automation-v1';
  const POSTS_PER_DAY = 10;
  const AUTOMATION_SPEEDS = {
    stable: { openDelay: 2200, fieldDelay: 450 },
    slow: { openDelay: 3500, fieldDelay: 700 },
    fast: { openDelay: 1500, fieldDelay: 300 }
  };
  const defaultState = () => ({ libraries: [], activeLibraryId: null });
  let state = loadState();
  let toastTimer = null;
  let compactMode = false;
  let compactPostOffset = 0;
  let directFillMode = false;
  let directFillPreferred = localStorage.getItem(DIRECT_FILL_PREFERENCE_KEY) !== 'false';
  let automationConfig = loadAutomationConfig();
  let automationRunning = false;
  let automationStopRequested = false;

  const els = {
    emptyView: document.getElementById('emptyView'),
    workspace: document.getElementById('workspace'),
    topActions: document.getElementById('topActions'),
    brandFile: document.getElementById('brandFile'),
    courseSelect: document.getElementById('courseSelect'),
    dropZone: document.getElementById('dropZone'),
    fileInput: document.getElementById('fileInput'),
    pasteButton: document.getElementById('pasteButton'),
    replaceFileButton: document.getElementById('replaceFileButton'),
    deleteCourseButton: document.getElementById('deleteCourseButton'),
    compactModeButton: document.getElementById('compactModeButton'),
    pasteDialog: document.getElementById('pasteDialog'),
    closeDialog: document.getElementById('closeDialog'),
    cancelPaste: document.getElementById('cancelPaste'),
    importPaste: document.getElementById('importPaste'),
    pasteArea: document.getElementById('pasteArea'),
    sidebarTitle: document.getElementById('sidebarTitle'),
    dayList: document.getElementById('dayList'),
    dayEyebrow: document.getElementById('dayEyebrow'),
    currentDayTitle: document.getElementById('currentDayTitle'),
    daySubtitle: document.getElementById('daySubtitle'),
    startDate: document.getElementById('startDate'),
    mobilePrev: document.getElementById('mobilePrev'),
    mobileNext: document.getElementById('mobileNext'),
    mobileDayLabel: document.getElementById('mobileDayLabel'),
    dayDoneCount: document.getElementById('dayDoneCount'),
    totalDoneCount: document.getElementById('totalDoneCount'),
    progressFill: document.getElementById('progressFill'),
    compactToolbar: document.getElementById('compactToolbar'),
    compactPrev: document.getElementById('compactPrev'),
    compactNext: document.getElementById('compactNext'),
    compactPosition: document.getElementById('compactPosition'),
    compactDayToolbar: document.getElementById('compactDayToolbar'),
    compactPrevDay: document.getElementById('compactPrevDay'),
    compactNextDay: document.getElementById('compactNextDay'),
    compactDayPosition: document.getElementById('compactDayPosition'),
    directFillControl: document.getElementById('directFillControl'),
    directFillButton: document.getElementById('directFillButton'),
    directFillTitle: document.getElementById('directFillTitle'),
    directFillHint: document.getElementById('directFillHint'),
    automationLaunch: document.getElementById('automationLaunch'),
    openAutomationButton: document.getElementById('openAutomationButton'),
    automationLaunchHint: document.getElementById('automationLaunchHint'),
    automationDialog: document.getElementById('automationDialog'),
    closeAutomationDialog: document.getElementById('closeAutomationDialog'),
    cancelAutomation: document.getElementById('cancelAutomation'),
    automationDays: document.getElementById('automationDays'),
    automationInterval: document.getElementById('automationInterval'),
    automationSpeed: document.getElementById('automationSpeed'),
    automationReady: document.getElementById('automationReady'),
    testAutomationButton: document.getElementById('testAutomationButton'),
    startAutomationButton: document.getElementById('startAutomationButton'),
    capturePointButtons: Array.from(document.querySelectorAll('.capture-point-button')),
    pointStatuses: Array.from(document.querySelectorAll('[data-point-status]')),
    automationHud: document.getElementById('automationHud'),
    automationHudKicker: document.getElementById('automationHudKicker'),
    automationHudTitle: document.getElementById('automationHudTitle'),
    automationHudDetail: document.getElementById('automationHudDetail'),
    automationHudProgress: document.getElementById('automationHudProgress'),
    stopAutomationButton: document.getElementById('stopAutomationButton'),
    postGrid: document.getElementById('postGrid'),
    finishTitle: document.getElementById('finishTitle'),
    finishHint: document.getElementById('finishHint'),
    nextDayButton: document.getElementById('nextDayButton'),
    toast: document.getElementById('toast')
  };

  function todayISO() {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function normalizeAutomationPoint(point) {
    if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) return null;
    return { x: Math.round(Number(point.x)), y: Math.round(Number(point.y)) };
  }

  function loadAutomationConfig() {
    const defaults = {
      points: { publish: null, title: null, content: null, save: null },
      days: 1,
      intervalSeconds: 5,
      speed: 'stable'
    };
    try {
      const saved = JSON.parse(localStorage.getItem(AUTOMATION_CONFIG_KEY));
      if (!saved || typeof saved !== 'object') return defaults;
      return {
        points: {
          publish: normalizeAutomationPoint(saved.points?.publish),
          title: normalizeAutomationPoint(saved.points?.title),
          content: normalizeAutomationPoint(saved.points?.content),
          save: normalizeAutomationPoint(saved.points?.save)
        },
        days: Math.min(9999, Math.max(1, Number(saved.days) || 1)),
        intervalSeconds: Math.min(3600, Math.max(1, Number(saved.intervalSeconds) || 5)),
        speed: Object.hasOwn(AUTOMATION_SPEEDS, saved.speed) ? saved.speed : 'stable'
      };
    } catch (error) {
      console.warn('无法读取自动发布设置', error);
      return defaults;
    }
  }

  function saveAutomationConfig() {
    localStorage.setItem(AUTOMATION_CONFIG_KEY, JSON.stringify(automationConfig));
  }

  function automationReady() {
    return ['publish', 'title', 'content', 'save'].every(key => normalizeAutomationPoint(automationConfig.points[key]));
  }

  function makeLibraryId(fileName) {
    let hash = 2166136261;
    const key = String(fileName).trim().toLowerCase();
    for (let i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `library-${(hash >>> 0).toString(36)}`;
  }

  function normalizeLibrary(library) {
    return {
      id: library.id || makeLibraryId(library.fileName || library.courseName || String(Date.now())),
      posts: Array.isArray(library.posts) ? library.posts : [],
      fileName: library.fileName || '未命名.md',
      courseName: library.courseName || library.fileName || '未命名课程',
      startDate: library.startDate || todayISO(),
      selectedDay: Math.max(1, Number(library.selectedDay) || 1),
      copied: library.copied && typeof library.copied === 'object' ? library.copied : {}
    };
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && Array.isArray(saved.libraries)) {
        const libraries = saved.libraries.map(normalizeLibrary).filter(item => item.posts.length);
        const activeExists = libraries.some(item => item.id === saved.activeLibraryId);
        return { libraries, activeLibraryId: activeExists ? saved.activeLibraryId : libraries[0]?.id || null };
      }
      if (saved && Array.isArray(saved.posts) && saved.posts.length) {
        const migrated = normalizeLibrary(saved);
        return { libraries: [migrated], activeLibraryId: migrated.id };
      }
    } catch (error) {
      console.warn('无法读取已保存资料', error);
    }
    return defaultState();
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      showToast('浏览器存储空间不足，资料或进度可能无法保存。', true);
    }
  }

  function activeLibrary() {
    return state.libraries.find(item => item.id === state.activeLibraryId) || state.libraries[0] || null;
  }

  function parseMarkdown(markdown, fileName = '粘贴的 Markdown') {
    const normalized = String(markdown || '').replace(/\r\n?/g, '\n');
    const matcher = /^###\s+(\d+)\.\s+(.+?)\s*$/gm;
    const matches = Array.from(normalized.matchAll(matcher));
    if (!matches.length) throw new Error(`${fileName}：没有识别到“### 1. 标题”格式的帖子。`);

    const posts = matches.map((match, index) => {
      const start = match.index + match[0].length;
      const end = index + 1 < matches.length ? matches[index + 1].index : normalized.length;
      const lines = normalized.slice(start, end)
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && line !== '---' && !/^#{1,2}\s/.test(line));
      if (!lines.length) throw new Error(`${fileName}：第 ${index + 1} 条帖子没有正文。`);
      return {
        id: index + 1,
        sourceNumber: Number(match[1]),
        title: match[2].trim(),
        content: lines.join('\n'),
        lines
      };
    });

    const h1 = normalized.match(/^#\s+(.+?)\s*$/m);
    const courseName = h1 ? h1[1].replace(/知识点帖子|帖子/g, '').trim() : fileName.replace(/\.md$/i, '');
    return { posts, courseName };
  }

  function createLibrary(markdown, fileName) {
    const parsed = parseMarkdown(markdown, fileName);
    return normalizeLibrary({
      id: makeLibraryId(fileName),
      posts: parsed.posts,
      fileName,
      courseName: parsed.courseName || fileName,
      startDate: todayISO(),
      selectedDay: 1,
      copied: {}
    });
  }

  async function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error(`${file.name} 读取失败。`));
      reader.readAsText(file, 'utf-8');
    });
  }

  function storeLibraries(newLibraries) {
    const replacements = newLibraries.filter(incoming => state.libraries.some(saved => saved.id === incoming.id));
    if (replacements.length) {
      const names = replacements.map(item => item.courseName).join('、');
      if (!window.confirm(`“${names}”已经保存。重新导入会替换这些课程及其复制进度，确定继续吗？`)) return false;
    }

    for (const incoming of newLibraries) {
      const index = state.libraries.findIndex(saved => saved.id === incoming.id);
      if (index >= 0) state.libraries[index] = incoming;
      else state.libraries.push(incoming);
    }
    state.activeLibraryId = newLibraries[0]?.id || state.activeLibraryId;
    saveState();
    render();
    const postCount = newLibraries.reduce((sum, item) => sum + item.posts.length, 0);
    showToast(`已保存 ${newLibraries.length} 门课程，共 ${postCount} 条帖子。`);
    return true;
  }

  function deleteActiveLibrary() {
    const library = activeLibrary();
    if (!library) return;
    const confirmed = window.confirm(`确定删除“${library.courseName}”吗？\n\n这门课程的帖子、日期和复制进度都会从当前设备删除，其他课程不受影响。`);
    if (!confirmed) return;
    state.libraries = state.libraries.filter(item => item.id !== library.id);
    state.activeLibraryId = state.libraries[0]?.id || null;
    saveState();
    render();
    showToast(`已删除“${library.courseName}”。`);
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []).filter(file => /\.md$/i.test(file.name) || /^text\//.test(file.type || ''));
    if (!files.length) {
      showToast('请选择 Markdown（.md）文件。', true);
      return;
    }
    try {
      const libraries = [];
      for (const file of files) libraries.push(createLibrary(await readFile(file), file.name));
      storeLibraries(libraries);
    } catch (error) {
      showToast(error.message, true);
    }
  }

  function totalDays(library = activeLibrary()) {
    return Math.max(1, Math.ceil((library?.posts.length || 0) / POSTS_PER_DAY));
  }

  function dateForDay(day, library = activeLibrary()) {
    const date = new Date(`${library.startDate}T12:00:00`);
    date.setDate(date.getDate() + day - 1);
    return date;
  }

  function formatDate(day, full = false, library = activeLibrary()) {
    return new Intl.DateTimeFormat('zh-CN', full
      ? { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }
      : { month: 'numeric', day: 'numeric', weekday: 'short' }
    ).format(dateForDay(day, library));
  }

  function completed(postIndex, library = activeLibrary()) {
    const status = library.copied[postIndex];
    return Boolean(status && status.title && status.content);
  }

  function dayStats(day, library = activeLibrary()) {
    const start = (day - 1) * POSTS_PER_DAY;
    const posts = library.posts.slice(start, start + POSTS_PER_DAY);
    return { posts, done: posts.filter((_, offset) => completed(start + offset, library)).length };
  }

  function setDay(day, scroll = true) {
    const library = activeLibrary();
    if (!library) return;
    library.selectedDay = Math.min(Math.max(Number(day) || 1, 1), totalDays(library));
    compactPostOffset = 0;
    saveState();
    renderSchedule(false);
    renderCurrentDay();
    if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function copyText(text, postIndex, field) {
    const library = activeLibrary();
    if (!library) return;
    try {
      let pastedDirectly = false;
      let directFillFailed = false;
      if (directFillMode && window.postDesktop?.fillActive) {
        const result = await window.postDesktop.fillActive(text);
        pastedDirectly = Boolean(result?.pasted);
        directFillFailed = !pastedDirectly;
      } else if (window.postDesktop?.writeClipboard) {
        await window.postDesktop.writeClipboard(text);
      } else if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        if (!ok) throw new Error('copy failed');
      }
      library.copied[postIndex] = { ...(library.copied[postIndex] || {}), [field]: true };
      saveState();
      renderSchedule(false);
      renderCurrentDay();
      if (directFillFailed) {
        showToast('已复制，但自动填入失败，请在网页中按 Ctrl+V。', true);
      } else if (pastedDirectly) {
        showToast(field === 'title' ? '标题已直接填入' : '正文已直接填入');
      } else {
        showToast(field === 'title' ? '标题已复制' : '帖子正文已复制');
      }
    } catch (error) {
      showToast('复制失败，请允许访问剪贴板后重试。', true);
    }
  }

  function renderCourseSelect() {
    els.courseSelect.replaceChildren();
    for (const library of state.libraries) {
      const option = document.createElement('option');
      option.value = library.id;
      option.textContent = `${library.courseName}（${library.posts.length}条）`;
      option.selected = library.id === state.activeLibraryId;
      els.courseSelect.appendChild(option);
    }
  }

  function render() {
    const library = activeLibrary();
    const hasPosts = Boolean(library?.posts.length);
    els.emptyView.hidden = hasPosts;
    els.workspace.hidden = !hasPosts;
    els.topActions.hidden = !hasPosts;
    els.brandFile.textContent = hasPosts
      ? `${state.libraries.length} 门课程已保存 · 当前 ${library.fileName}`
      : '一键复制标题与正文';
    if (!hasPosts) return;
    state.activeLibraryId = library.id;
    library.selectedDay = Math.min(Math.max(library.selectedDay, 1), totalDays(library));
    els.startDate.value = library.startDate;
    els.sidebarTitle.textContent = `${library.courseName} · ${totalDays(library)} 天`;
    renderCourseSelect();
    renderSchedule(true);
    renderCurrentDay();
  }

  function renderSchedule(centerActive = false) {
    const library = activeLibrary();
    if (!library) return;
    const previousScrollTop = els.dayList.scrollTop;
    els.dayList.replaceChildren();
    const fragment = document.createDocumentFragment();
    for (let day = 1; day <= totalDays(library); day++) {
      const stats = dayStats(day, library);
      const start = (day - 1) * POSTS_PER_DAY + 1;
      const end = Math.min(day * POSTS_PER_DAY, library.posts.length);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `day-button${day === library.selectedDay ? ' active' : ''}`;
      button.dataset.day = day;
      button.setAttribute('aria-current', day === library.selectedDay ? 'date' : 'false');
      button.innerHTML = `
        <span class="day-number">${String(day).padStart(2, '0')}</span>
        <span><span class="day-date">${escapeHtml(formatDate(day, false, library))}</span><span class="day-range">第 ${start}–${end} 条</span></span>
        <span class="day-progress${stats.done === stats.posts.length ? ' done' : ''}">${stats.done}/${stats.posts.length}</span>`;
      button.addEventListener('click', () => setDay(day));
      fragment.appendChild(button);
    }
    els.dayList.appendChild(fragment);
    if (centerActive) {
      const active = els.dayList.querySelector('.active');
      if (active) {
        els.dayList.scrollTop = Math.max(0, active.offsetTop - (els.dayList.clientHeight - active.offsetHeight) / 2);
      }
    } else {
      els.dayList.scrollTop = previousScrollTop;
    }
  }

  function renderCurrentDay() {
    const library = activeLibrary();
    if (!library) return;
    const day = library.selectedDay;
    const stats = dayStats(day, library);
    const startIndex = (day - 1) * POSTS_PER_DAY;
    const endNumber = startIndex + stats.posts.length;
    const allDone = stats.posts.length > 0 && stats.done === stats.posts.length;
    const totalDone = library.posts.reduce((sum, _, index) => sum + (completed(index, library) ? 1 : 0), 0);
    compactPostOffset = Math.min(Math.max(compactPostOffset, 0), Math.max(stats.posts.length - 1, 0));

    els.dayEyebrow.textContent = `第 ${day} / ${totalDays(library)} 天`;
    els.currentDayTitle.textContent = formatDate(day, true, library);
    els.daySubtitle.textContent = `${library.courseName} · 第 ${startIndex + 1}–${endNumber} 条`;
    els.mobileDayLabel.textContent = `第 ${day} 天 · ${formatDate(day, false, library)}`;
    els.mobilePrev.disabled = day <= 1;
    els.mobileNext.disabled = day >= totalDays(library);
    els.dayDoneCount.textContent = `${stats.done} / ${stats.posts.length}`;
    els.totalDoneCount.textContent = `${totalDone} / ${library.posts.length}`;
    els.progressFill.style.width = `${library.posts.length ? (totalDone / library.posts.length) * 100 : 0}%`;

    els.postGrid.replaceChildren();
    const fragment = document.createDocumentFragment();
    stats.posts.forEach((post, offset) => {
      const postIndex = startIndex + offset;
      const status = library.copied[postIndex] || {};
      const card = document.createElement('article');
      card.className = `post-card${offset === compactPostOffset ? ' compact-active' : ''}`;
      const indexBox = document.createElement('div');
      indexBox.className = 'post-index';
      indexBox.textContent = String(postIndex + 1).padStart(3, '0');
      const actions = document.createElement('div');
      actions.className = 'post-actions';

      const titleButton = document.createElement('button');
      titleButton.type = 'button';
      titleButton.className = `copy-title${status.title ? ' copied' : ''}`;
      titleButton.setAttribute('aria-label', `复制标题：${post.title}`);
      titleButton.append(document.createTextNode(post.title));
      titleButton.appendChild(copyBadge(status.title, '标题'));
      titleButton.addEventListener('click', () => copyText(post.title, postIndex, 'title'));

      const contentButton = document.createElement('button');
      contentButton.type = 'button';
      contentButton.className = `copy-content${status.content ? ' copied' : ''}`;
      contentButton.setAttribute('aria-label', `复制第 ${postIndex + 1} 条帖子正文`);
      post.lines.forEach(line => {
        const span = document.createElement('span');
        span.textContent = line;
        contentButton.appendChild(span);
      });
      contentButton.appendChild(copyBadge(status.content, '正文'));
      contentButton.addEventListener('click', () => copyText(post.content, postIndex, 'content'));

      actions.append(titleButton, contentButton);
      card.append(indexBox, actions);
      fragment.appendChild(card);
    });
    els.postGrid.appendChild(fragment);

    els.compactPosition.textContent = `${compactPostOffset + 1} / ${stats.posts.length}`;
    els.compactPrev.disabled = day <= 1 && compactPostOffset <= 0;
    els.compactNext.disabled = day >= totalDays(library) && compactPostOffset >= stats.posts.length - 1;
    els.compactDayPosition.textContent = `第 ${day} / ${totalDays(library)} 天`;
    els.compactPrevDay.disabled = day <= 1;
    els.compactNextDay.disabled = day >= totalDays(library);
    els.compactNextDay.classList.toggle('ready', allDone && day < totalDays(library));

    if (day === totalDays(library) && allDone) {
      els.finishTitle.textContent = '这门课的帖子已经全部完成';
      els.finishHint.textContent = `共 ${library.posts.length} 条，所有标题和正文都已复制过。`;
      els.nextDayButton.textContent = '已全部完成 ✓';
      els.nextDayButton.disabled = true;
    } else {
      els.finishTitle.textContent = allDone ? '今天的 10 条已经完成' : '复制完今天 10 条后，可进入下一天';
      els.finishHint.textContent = allDone ? '进度已保存在本机，切换课程或关闭后仍会保留。' : '每条的标题和正文都复制过，才算完成。';
      els.nextDayButton.textContent = '完成，进入下一天 →';
      els.nextDayButton.disabled = !allDone;
    }
  }

  function copyBadge(done, label) {
    const badge = document.createElement('span');
    badge.className = 'copy-label';
    const action = directFillMode ? '填入' : '复制';
    badge.innerHTML = done
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m5 12 4 4L19 6"/></svg>已${action}`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>${action}${label}`;
    return badge;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function showToast(message, isError = false) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.className = `toast show${isError ? ' error' : ''}`;
    toastTimer = setTimeout(() => { els.toast.className = 'toast'; }, 2600);
  }

  function refreshAutomationUI() {
    const pointNames = {
      publish: '发表帖子',
      title: '标题输入框',
      content: '正文编辑框',
      save: '保存按钮'
    };
    for (const status of els.pointStatuses) {
      const key = status.dataset.pointStatus;
      const point = normalizeAutomationPoint(automationConfig.points[key]);
      status.textContent = point ? `${point.x}, ${point.y}` : '未设置';
      status.title = point ? `${pointNames[key]}：X ${point.x}，Y ${point.y}` : `${pointNames[key]}尚未记录`;
    }
    const library = activeLibrary();
    const remainingDays = library ? Math.max(1, totalDays(library) - library.selectedDay + 1) : 1;
    automationConfig.days = Math.min(remainingDays, Math.max(1, Number(automationConfig.days) || 1));
    els.automationDays.max = String(remainingDays);
    els.automationDays.value = String(automationConfig.days);
    els.automationInterval.value = String(automationConfig.intervalSeconds);
    els.automationSpeed.value = automationConfig.speed;
    const configured = automationReady();
    els.automationLaunchHint.textContent = configured
      ? `位置已就绪 · 连续 ${automationConfig.days} 天 · 每条间隔 ${automationConfig.intervalSeconds} 秒`
      : '先定位网页上的4个位置，再设置连续发布天数';
    const canStart = configured && els.automationReady.checked && !automationRunning;
    els.testAutomationButton.disabled = !canStart;
    els.startAutomationButton.disabled = !canStart;
    els.startAutomationButton.textContent = `连续发布 ${automationConfig.days} 天`;
  }

  function openAutomationDialog() {
    if (!window.postDesktop?.captureAutomationPoint) {
      showToast('全自动发布仅支持 Windows 桌面版。', true);
      return;
    }
    els.automationReady.checked = false;
    refreshAutomationUI();
    els.automationDialog.showModal();
  }

  function closeAutomationDialog() {
    if (automationRunning) return;
    els.automationReady.checked = false;
    els.automationDialog.close();
  }

  async function captureAutomationPoint(key, button) {
    if (!window.postDesktop?.captureAutomationPoint || automationRunning) return;
    const status = els.pointStatuses.find(item => item.dataset.pointStatus === key);
    const previousText = button.textContent;
    els.capturePointButtons.forEach(item => { item.disabled = true; });
    button.textContent = '正在记录';
    if (status) status.textContent = '3秒内移动鼠标';
    try {
      const point = normalizeAutomationPoint(await window.postDesktop.captureAutomationPoint(3000));
      if (!point) throw new Error('没有读取到有效位置');
      automationConfig.points[key] = point;
      saveAutomationConfig();
      showToast(`位置已记录：${point.x}, ${point.y}`);
    } catch (error) {
      showToast(`记录位置失败：${error.message || '请重试'}`, true);
    } finally {
      button.textContent = previousText;
      els.capturePointButtons.forEach(item => { item.disabled = false; });
      refreshAutomationUI();
    }
  }

  function pendingAutomationItems(days) {
    const library = activeLibrary();
    if (!library) return [];
    const startDay = library.selectedDay;
    const endDay = Math.min(totalDays(library), startDay + Math.max(1, Number(days) || 1) - 1);
    const items = [];
    for (let day = startDay; day <= endDay; day++) {
      const startIndex = (day - 1) * POSTS_PER_DAY;
      const posts = dayStats(day, library).posts;
      for (let offset = 0; offset < posts.length; offset++) {
        const postIndex = startIndex + offset;
        if (!completed(postIndex, library)) items.push({ day, offset, postIndex, post: posts[offset] });
      }
    }
    return items;
  }

  function updateAutomationHud(title, detail, current, total, completedStages = 0) {
    els.automationHudKicker.textContent = total ? `本轮 ${current} / ${total}` : '全自动发布';
    els.automationHudTitle.textContent = title;
    els.automationHudDetail.textContent = detail;
    const totalStages = Math.max(1, total * 4);
    els.automationHudProgress.style.width = `${Math.min(100, Math.max(0, completedStages / totalStages * 100))}%`;
  }

  function assertAutomationContinues() {
    if (!automationStopRequested) return;
    const error = new Error('用户已停止');
    error.automationStopped = true;
    throw error;
  }

  async function automationDelay(milliseconds) {
    const end = Date.now() + milliseconds;
    while (Date.now() < end) {
      assertAutomationContinues();
      await new Promise(resolve => setTimeout(resolve, Math.min(120, Math.max(20, end - Date.now()))));
    }
    assertAutomationContinues();
  }

  async function waitBetweenPosts(seconds, current, total, completedStages) {
    const duration = Math.max(1, Number(seconds) || 1);
    for (let remaining = duration; remaining > 0; remaining--) {
      updateAutomationHud('等待下一条', `${remaining} 秒后继续，可随时点击停止`, current, total, completedStages);
      await automationDelay(1000);
    }
  }

  async function clickAutomationPoint(point, actionName) {
    let result = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      result = await window.postDesktop.clickAutomationPoint(point);
      if (result?.clicked) return;
      if (attempt < 2) await automationDelay(450);
    }
    throw new Error(`${actionName}点击失败：${result?.reason || 'Windows 未执行点击'}`);
  }

  async function invokeAutomationControl(point, controlName, actionName) {
    let result = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      result = await window.postDesktop.invokeAutomationControl(point, controlName);
      if (result?.invoked) return;
      if (attempt < 2) await automationDelay(700);
    }
    throw new Error(`${actionName}操作失败：${result?.reason || '没有找到网页按钮'}`);
  }

  async function clickPasteAutomationPoint(point, text, actionName) {
    let result = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      result = await window.postDesktop.clickPasteAutomationPoint(point, text);
      if (result?.pasted) return;
      if (attempt < 2) await automationDelay(450);
    }
    throw new Error(`${actionName}填入失败：${result?.reason || 'Windows 未执行输入'}`);
  }

  async function setAutomationHudMode(running) {
    document.body.classList.toggle('automation-running', running);
    els.automationHud.hidden = !running;
    if (window.postDesktop?.setAutomationRunning) await window.postDesktop.setAutomationRunning(running);
  }

  async function runAutomation(requestedDays, testSinglePost = false) {
    if (automationRunning || !automationReady()) return;
    const library = activeLibrary();
    const items = testSinglePost ? pendingAutomationItems(1).slice(0, 1) : pendingAutomationItems(requestedDays);
    if (!library || !items.length) {
      showToast('所选连续天数内没有待发布的帖子。', true);
      return;
    }

    automationRunning = true;
    automationStopRequested = false;
    els.stopAutomationButton.disabled = false;
    let completedCount = 0;
    let failure = null;
    const speed = AUTOMATION_SPEEDS[automationConfig.speed] || AUTOMATION_SPEEDS.stable;
    els.automationDialog.close();
    els.automationReady.checked = false;

    try {
      await setAutomationHudMode(true);
      for (let seconds = 3; seconds >= 1; seconds--) {
        updateAutomationHud(`${seconds} 秒后开始`, '请把手离开鼠标并保持浏览器窗口不动', 0, items.length, 0);
        await automationDelay(1000);
      }

      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        const current = index + 1;
        const stageBase = index * 4;
        library.selectedDay = item.day;
        compactPostOffset = item.offset;

        updateAutomationHud('正在打开发表窗口', `第 ${item.day} 天 · 第 ${item.postIndex + 1} 条 · ${item.post.title}`, current, items.length, stageBase);
        await invokeAutomationControl(automationConfig.points.publish, '发表帖子', '发表帖子按钮');
        await automationDelay(speed.openDelay);

        updateAutomationHud('正在填入标题', item.post.title, current, items.length, stageBase + 1);
        await clickPasteAutomationPoint(automationConfig.points.title, item.post.title, '标题');
        await automationDelay(speed.fieldDelay);

        updateAutomationHud('正在填入正文', `第 ${item.postIndex + 1} 条正文`, current, items.length, stageBase + 2);
        await clickPasteAutomationPoint(automationConfig.points.content, item.post.content, '正文');
        await automationDelay(speed.fieldDelay);

        updateAutomationHud('正在点击保存', `第 ${item.postIndex + 1} 条即将提交`, current, items.length, stageBase + 3);
        await invokeAutomationControl(automationConfig.points.save, '保存', '保存按钮');
        library.copied[item.postIndex] = {
          ...(library.copied[item.postIndex] || {}),
          title: true,
          content: true,
          automatedAt: new Date().toISOString()
        };
        saveState();
        completedCount += 1;
        updateAutomationHud('已点击保存', `已完成 ${completedCount} 条`, current, items.length, stageBase + 4);
        if (index < items.length - 1) {
          await waitBetweenPosts(automationConfig.intervalSeconds, current, items.length, stageBase + 4);
        }
      }
    } catch (error) {
      failure = error;
    } finally {
      automationRunning = false;
      els.stopAutomationButton.disabled = false;
      try { await setAutomationHudMode(false); }
      catch (error) { console.warn('无法恢复自动发布窗口', error); }
      const nextPendingItem = items.find(item => !completed(item.postIndex, library));
      const lastItem = items[Math.max(0, completedCount - 1)] || items[0];
      const resumeItem = nextPendingItem || lastItem;
      if (resumeItem) {
        library.selectedDay = resumeItem.day;
        compactPostOffset = nextPendingItem ? resumeItem.offset : firstPendingOffset();
      }
      saveState();
      renderSchedule(false);
      renderCurrentDay();
      refreshAutomationUI();
    }

    if (failure?.automationStopped) {
      showToast(`已停止，本轮完成 ${completedCount} 条。`);
    } else if (failure) {
      showToast(`自动发布已停止：${failure.message}`, true);
    } else {
      showToast(`本轮已完成 ${completedCount} 条，请核对学校网页结果。`);
    }
  }

  function firstPendingOffset() {
    const library = activeLibrary();
    if (!library) return 0;
    const startIndex = (library.selectedDay - 1) * POSTS_PER_DAY;
    const stats = dayStats(library.selectedDay, library);
    const pending = stats.posts.findIndex((_post, offset) => !completed(startIndex + offset, library));
    return pending >= 0 ? pending : 0;
  }

  function setCompactUI(nextCompact) {
    compactMode = Boolean(nextCompact);
    document.body.classList.toggle('compact-app', compactMode);
    els.compactToolbar.hidden = !compactMode;
    els.compactDayToolbar.hidden = !compactMode;
    els.directFillControl.hidden = !compactMode;
    els.compactModeButton.setAttribute('aria-pressed', String(compactMode));
    if (!compactMode) updateDirectFillUI(false);
    if (compactMode) compactPostOffset = firstPendingOffset();
    if (activeLibrary()) renderCurrentDay();
  }

  function updateDirectFillUI(enabled) {
    directFillMode = Boolean(enabled && compactMode);
    document.body.classList.toggle('direct-fill-active', directFillMode);
    els.directFillButton.classList.toggle('active', directFillMode);
    els.directFillButton.setAttribute('aria-pressed', String(directFillMode));
    els.directFillTitle.textContent = directFillMode ? '直接填入：已开启' : '直接填入：已关闭';
    els.directFillHint.textContent = directFillMode ? '点此切换为只复制' : '点此开启，不占用任何系统快捷键';
    if (activeLibrary()) renderCurrentDay();
  }

  async function setDirectFill(enabled, remember = true) {
    if (!window.postDesktop?.setDirectFill) return;
    if (remember) {
      directFillPreferred = Boolean(enabled);
      localStorage.setItem(DIRECT_FILL_PREFERENCE_KEY, String(directFillPreferred));
    }
    const applied = await window.postDesktop.setDirectFill(Boolean(enabled && compactMode));
    updateDirectFillUI(applied);
  }

  function moveCompactPost(direction) {
    const library = activeLibrary();
    if (!library) return;
    const stats = dayStats(library.selectedDay, library);
    const nextOffset = compactPostOffset + direction;
    if (nextOffset >= 0 && nextOffset < stats.posts.length) {
      compactPostOffset = nextOffset;
      renderCurrentDay();
      return;
    }
    if (direction > 0 && library.selectedDay < totalDays(library)) {
      setDay(library.selectedDay + 1, false);
      return;
    }
    if (direction < 0 && library.selectedDay > 1) {
      library.selectedDay -= 1;
      compactPostOffset = dayStats(library.selectedDay, library).posts.length - 1;
      saveState();
      renderSchedule(false);
      renderCurrentDay();
    }
  }

  els.fileInput.addEventListener('change', event => {
    handleFiles(event.target.files);
    event.target.value = '';
  });
  ['dragenter', 'dragover'].forEach(type => els.dropZone.addEventListener(type, event => {
    event.preventDefault();
    els.dropZone.classList.add('dragging');
  }));
  ['dragleave', 'drop'].forEach(type => els.dropZone.addEventListener(type, event => {
    event.preventDefault();
    els.dropZone.classList.remove('dragging');
  }));
  els.dropZone.addEventListener('drop', event => handleFiles(event.dataTransfer.files));
  els.pasteButton.addEventListener('click', () => els.pasteDialog.showModal());
  els.replaceFileButton.addEventListener('click', () => els.fileInput.click());
  els.deleteCourseButton.addEventListener('click', deleteActiveLibrary);
  els.compactModeButton.addEventListener('click', () => {
    if (!window.postDesktop?.toggleCompact) return;
    window.postDesktop.toggleCompact();
  });
  els.directFillButton.addEventListener('click', () => setDirectFill(!directFillMode));
  els.openAutomationButton.addEventListener('click', openAutomationDialog);
  els.closeAutomationDialog.addEventListener('click', closeAutomationDialog);
  els.cancelAutomation.addEventListener('click', closeAutomationDialog);
  els.automationDialog.addEventListener('cancel', event => {
    if (automationRunning) event.preventDefault();
    else els.automationReady.checked = false;
  });
  els.capturePointButtons.forEach(button => {
    button.addEventListener('click', () => captureAutomationPoint(button.dataset.point, button));
  });
  els.automationDays.addEventListener('change', () => {
    const library = activeLibrary();
    const remainingDays = library ? Math.max(1, totalDays(library) - library.selectedDay + 1) : 1;
    automationConfig.days = Math.min(remainingDays, Math.max(1, Number(els.automationDays.value) || 1));
    saveAutomationConfig();
    refreshAutomationUI();
  });
  els.automationInterval.addEventListener('change', () => {
    automationConfig.intervalSeconds = Math.min(3600, Math.max(1, Number(els.automationInterval.value) || 5));
    saveAutomationConfig();
    refreshAutomationUI();
  });
  els.automationSpeed.addEventListener('change', () => {
    automationConfig.speed = Object.hasOwn(AUTOMATION_SPEEDS, els.automationSpeed.value) ? els.automationSpeed.value : 'stable';
    saveAutomationConfig();
    refreshAutomationUI();
  });
  els.automationReady.addEventListener('change', refreshAutomationUI);
  els.testAutomationButton.addEventListener('click', () => runAutomation(1, true));
  els.startAutomationButton.addEventListener('click', () => runAutomation(automationConfig.days));
  els.stopAutomationButton.addEventListener('click', () => {
    if (!automationRunning) return;
    automationStopRequested = true;
    updateAutomationHud('正在停止', '当前鼠标动作结束后立即停止', 0, 0, 0);
    els.stopAutomationButton.disabled = true;
    setTimeout(() => { els.stopAutomationButton.disabled = false; }, 1200);
  });
  els.courseSelect.addEventListener('change', () => {
    state.activeLibraryId = els.courseSelect.value;
    compactPostOffset = 0;
    saveState();
    render();
  });
  els.closeDialog.addEventListener('click', () => els.pasteDialog.close());
  els.cancelPaste.addEventListener('click', () => els.pasteDialog.close());
  els.importPaste.addEventListener('click', () => {
    try {
      const library = createLibrary(els.pasteArea.value, `粘贴课程-${Date.now()}.md`);
      if (storeLibraries([library])) {
        els.pasteDialog.close();
        els.pasteArea.value = '';
      }
    } catch (error) { showToast(error.message, true); }
  });
  els.startDate.addEventListener('change', () => {
    const library = activeLibrary();
    if (!library || !els.startDate.value) return;
    library.startDate = els.startDate.value;
    saveState();
    renderSchedule(false);
    renderCurrentDay();
  });
  els.mobilePrev.addEventListener('click', () => setDay(activeLibrary().selectedDay - 1));
  els.mobileNext.addEventListener('click', () => setDay(activeLibrary().selectedDay + 1));
  els.nextDayButton.addEventListener('click', () => setDay(activeLibrary().selectedDay + 1));
  els.compactPrev.addEventListener('click', () => moveCompactPost(-1));
  els.compactNext.addEventListener('click', () => moveCompactPost(1));
  els.compactPrevDay.addEventListener('click', () => setDay(activeLibrary().selectedDay - 1, false));
  els.compactNextDay.addEventListener('click', () => setDay(activeLibrary().selectedDay + 1, false));

  if (window.postDesktop) {
    els.compactModeButton.hidden = false;
    window.postDesktop.onCompactState(nextCompact => {
      setCompactUI(nextCompact);
      if (nextCompact) setDirectFill(directFillPreferred, false);
    });
    window.postDesktop.onDirectFillState(updateDirectFillUI);
    window.postDesktop.onAutomationState(running => {
      if (!running && automationRunning) automationStopRequested = true;
    });
  }

  function registerWebMCP() {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const controller = new AbortController();
    Promise.resolve(context.registerTool({
      name: 'get_current_post_batch',
      title: '读取当前帖子批次',
      description: '读取当前课程、日期、进度和当天十条帖子。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute() {
        const library = activeLibrary();
        if (!library) return { courses: 0, posts: [] };
        const stats = dayStats(library.selectedDay, library);
        return {
          course: library.courseName,
          savedCourses: state.libraries.length,
          day: library.selectedDay,
          totalDays: totalDays(library),
          date: formatDate(library.selectedDay, true, library),
          completed: stats.done,
          posts: stats.posts.map(post => ({ title: post.title, content: post.content }))
        };
      }
    }, { signal: controller.signal })).catch(() => {});
    Promise.resolve(context.registerTool({
      name: 'navigate_to_post_day',
      title: '切换帖子日期',
      description: '把当前课程切换到指定的帖子日程天数。',
      inputSchema: {
        type: 'object',
        properties: { day: { type: 'integer', minimum: 1 } },
        required: ['day'],
        additionalProperties: false
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        const library = activeLibrary();
        if (!library || !Number.isInteger(input?.day) || input.day < 1 || input.day > totalDays(library)) throw new Error('天数超出有效范围');
        setDay(input.day);
        return { course: library.courseName, day: library.selectedDay, date: formatDate(library.selectedDay, true, library) };
      }
    }, { signal: controller.signal })).catch(() => {});
  }

  saveState();
  render();
  refreshAutomationUI();
  registerWebMCP();
})();
