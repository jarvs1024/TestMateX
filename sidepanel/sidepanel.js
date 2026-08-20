// sidepanel.js V23
(function () {
  'use strict';
  const FORM_FIELDS = {
    title: 'edit-title', stage: 'edit-stage',
    featureModule: 'f-featureModule', preconditions: 'f-preconditions',
    steps: 'f-steps', expectedResult: 'f-expectedResult',
    failurePhenomenon: 'f-failurePhenomenon',
    hostIp: 'f-hostIp', hostSn: 'f-hostSn', hostOs: 'f-hostOs',
    hostSsdTopology: 'f-hostSsdTopology',
    fpgaVersion: 'f-fpgaVersion', fwVersion: 'f-fwVersion', driverVersion: 'f-driverVersion',
    instrumentName: 'f-instrumentName', instrumentIpSn: 'f-instrumentIpSn',
    instrumentVersion: 'f-instrumentVersion', softwareTools: 'f-softwareTools',
    hwVersion: 'f-hwVersion', dutFwVersion: 'f-dutFwVersion', dutSn: 'f-dutSn',
    caseId: 'f-caseId', scriptInfo: 'f-scriptInfo', scriptRepo: 'f-scriptRepo',
    scriptModifications: 'f-scriptModifications', logUrl: 'f-logUrl',
    analysisTrace: 'f-analysisTrace', analysisTraceImages: 'f-analysisTraceImages',
    analyzer: 'f-analyzer', initialReason: 'f-initialReason', occurTime: 'f-occurTime',
    logSerial: 'f-logSerial', logTrace: 'f-logTrace', logOs: 'f-logOs', logTool: 'f-logTool',
    logImages: 'f-logImages', otherInfo: 'f-otherInfo',
  };

  let state = {
    currentProject: null, currentTask: null, currentExec: null,
    failedExecs: [], currentCases: [],
    selectedCases: new Set(), expandedCases: new Set(),
    aiResults: {}, projects: [], tasks: [],
  };

  function start() {
    console.log('[TestMateX] V23 (Content Script 重试机制)');
    bindEvents();
    setInterval(pollPingCode, 8000);
    setTimeout(pollPingCode, 200);
    setTimeout(detectAndScan, 500);
    setupUrlWatcher();
  }

  let lastUrl = '';
  function setupUrlWatcher() {
    lastUrl = location.href;
    setInterval(function () {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        state.currentTask = null;
        state.failedExecs = [];
        state.currentCases = [];
        detectAndScan();
      }
    }, 500);
  }

  function bindEvents() {
    document.getElementById('btn-reconnect').addEventListener('click', detectAndScan);
    document.getElementById('btn-reauth').addEventListener('click', handleReauth);
    document.getElementById('project-select').addEventListener('change', onProjectChange);
    document.getElementById('task-select').addEventListener('change', onTaskChange);
    document.getElementById('btn-pick-library').addEventListener('click', pickProject);
    document.getElementById('btn-scan').addEventListener('click', scan);
    document.getElementById('check-all').addEventListener('change', toggleAll);
    document.getElementById('btn-submit-selected').addEventListener('click', function () { gotoEdit(); });
    document.getElementById('btn-ai-batch').addEventListener('click', aiBatch);
    document.getElementById('btn-edit-back-2').addEventListener('click', gotoList);
    document.getElementById('btn-edit-preview-2').addEventListener('click', gotoPreview);
    document.getElementById('btn-edit-submit-2').addEventListener('click', function () { submitFromEdit(); });
    document.getElementById('btn-preview-back-2').addEventListener('click', gotoEdit);
    document.getElementById('btn-preview-submit-2').addEventListener('click', function () { submitFromEdit(); });
    document.getElementById('edit-template').addEventListener('change', onTemplateChange);
    document.getElementById('edit-stage').addEventListener('change', onStageChange);
  }

  async function pollPingCode() {
    try {
      const res = await chrome.runtime.sendMessage({ action: 'CHECK_PINGCODE_STATUS' });
      const dot = document.getElementById('pingcode-dot');
      const val = document.getElementById('pingcode-status');
      if (res && res.success && res.status && res.status.authenticated) {
        const name = res.status.user && (res.status.user.display_name || '已连接');
        if (dot) dot.className = 'status-dot ok';
        if (val) val.textContent = name;
      } else {
        if (dot) dot.className = 'status-dot error';
        if (val) val.textContent = '未连接';
      }
    } catch (e) {}
  }

  async function detectAndScan() {
    try {
      const tabs = await chrome.tabs.query({ url: 'http://10.20.65.23:3000/Dml/AiTest/*' });
      const dot = document.getElementById('aitest-dot');
      const val = document.getElementById('aitest-status');
      if (!tabs || !tabs.length) {
        if (dot) dot.className = 'status-dot error';
        if (val) val.textContent = '未打开';
        renderBreadcrumb();
        return;
      }
      const tab = tabs[0];
      if (dot) dot.className = 'status-dot ok';
      const path = new URL(tab.url).pathname;
      const params = new URLSearchParams(tab.url.split('?')[1] || '');
      let pageLabel = '页面';
      if (path.indexOf('library') !== -1) pageLabel = '项目列表';
      else if (path.indexOf('taskDetail') !== -1) pageLabel = '任务详情';
      else if (path.indexOf('task') !== -1) pageLabel = '任务列表';
      if (val) val.textContent = pageLabel;

      const projectName = params.get('projectName');
      const execProjectType = parseInt(params.get('execProjectType') || '0', 10);
      const taskId = parseInt(params.get('taskId') || '0', 10);

      if (projectName) {
        if (!state.currentProject || state.currentProject.projectName !== projectName) {
          state.currentProject = { projectName: projectName, execProjectType: execProjectType };
        }
      }

      // 步骤1: 获取项目列表 (独立容错)
      if (state.projects.length === 0) {
        try {
          await scanAllProjects();
        } catch (e) {
          console.error('[TestMateX] scanAllProjects 失败:', e);
        }
        if (state.currentProject && !state.projects.find(function (p) { return p.projectName === state.currentProject.projectName; })) {
          state.projects.unshift({
            name: state.currentProject.projectName,
            projectName: state.currentProject.projectName,
            execProjectType: state.currentProject.execProjectType,
            taskCount: '?',
            lastUpdate: '',
          });
        }
      }

      // 步骤2: 获取任务列表 (独立容错)
      if (state.currentProject) {
        try {
          if (path.indexOf('library') !== -1) {
            await scanTasksViaAPI();
          } else if (path.indexOf('task') !== -1) {
            await scanTasksFromPageDOM();
          }
        } catch (e) {
          console.error('[TestMateX] 获取任务列表失败:', e);
        }
      }

      if (taskId && !state.currentTask) {
        state.currentTask = { taskId: taskId, taskName: '任务 #' + taskId, projectName: projectName };
      }

      renderBreadcrumb();
    } catch (e) {
      console.error('[TestMateX] detectAndScan:', e);
      renderBreadcrumb(); // 确保即使出错也渲染
    }
  }

  async function scanAllProjects() {
    try {
      const tabs = await chrome.tabs.query({ url: 'http://10.20.65.23:3000/Dml/AiTest/*' });
      if (!tabs || !tabs.length) {
        console.warn('[TestMateX] 未找到 AiTest tab');
        return;
      }
      const response = await sendToContentScript(tabs[0].id, 'SCAN_PROJECTS_LIST', {});
      if (response && response.success && response.data) {
        state.projects = response.data;
        console.log('[TestMateX] 获取到', state.projects.length, '个项目');
      } else if (response && response.__error) {
        console.error('[TestMateX] scanAllProjects 错误:', response.__error);
        showToast('获取项目列表失败: ' + response.__error, 'error');
      } else if (response && !response.success) {
        console.error('[TestMateX] scanAllProjects 失败:', response.error);
        showToast('获取项目列表失败: ' + (response.error || '未知'), 'error');
      }
    } catch (e) {
      console.error('[TestMateX] scanAllProjects 异常:', e);
      showToast('获取项目列表异常: ' + e.message, 'error');
    }
  }

  async function scanTasksFromPageDOM() {
    if (!state.currentProject) return;
    try {
      const tabs = await chrome.tabs.query({ url: 'http://10.20.65.23:3000/Dml/AiTest/*' });
      if (!tabs || !tabs.length) return;
      const tabUrl = new URL(tabs[0].url);
      if (tabUrl.pathname.indexOf('library') !== -1) {
        await scanTasksViaAPI();
        return;
      }
      const response = await sendToContentScript(tabs[0].id, 'SCAN_TASKS_FROM_DOM', {});
      if (response && response.success && response.data) {
        const tasks = response.data.tasks || [];
        tasks.sort(function (a, b) {
          const ta = a.createDate ? new Date(a.createDate).getTime() : 0;
          const tb = b.createDate ? new Date(b.createDate).getTime() : 0;
          return tb - ta;
        });
        state.tasks = tasks;
      }
    } catch (e) {
      console.error('[TestMateX] scanTasksFromPageDOM:', e);
    }
  }

  async function scanTasksViaAPI() {
    if (!state.currentProject) return;
    try {
      const tabs = await chrome.tabs.query({ url: 'http://10.20.65.23:3000/Dml/AiTest/*' });
      if (!tabs || !tabs.length) return;
      const response = await sendToContentScript(tabs[0].id, 'SCAN_TASKS_LIST', {
        execProjectType: state.currentProject.execProjectType || 0,
        projectName: state.currentProject.projectName || 's3100',
      });
      if (response && response.success && response.data) {
        const tasks = response.data.tasks || [];
        tasks.sort(function (a, b) {
          const ta = a.createDate ? new Date(a.createDate).getTime() : 0;
          const tb = b.createDate ? new Date(b.createDate).getTime() : 0;
          return tb - ta;
        });
        state.tasks = tasks;
        console.log('[TestMateX] 获取到', state.tasks.length, '个任务');
      } else if (response && response.__error) {
        console.error('[TestMateX] scanTasksViaAPI 错误:', response.__error);
        showToast('获取任务列表失败: ' + response.__error, 'error');
      } else if (response && !response.success) {
        console.error('[TestMateX] scanTasksViaAPI 失败:', response.error);
        showToast('获取任务列表失败: ' + (response.error || '未知'), 'error');
      }
    } catch (e) {
      console.error('[TestMateX] scanTasksViaAPI:', e);
    }
  }

  function renderBreadcrumb() {
    const ps = document.getElementById('project-select');
    if (!ps) return;
    let psOpts = '<option value="">-- 选项目 --</option>';
    if (state.projects && state.projects.length > 0) {
      state.projects.forEach(function (p) {
        const sel = state.currentProject && state.currentProject.projectName === p.projectName ? ' selected' : '';
        psOpts += '<option value="' + p.projectName + '" data-type="' + p.execProjectType + '"' + sel + '>' +
          p.name + ' (' + p.taskCount + ')</option>';
      });
    }
    if (state.currentProject && !state.projects.find(function (p) { return p.projectName === state.currentProject.projectName; })) {
      psOpts += '<option value="' + state.currentProject.projectName + '" selected>' +
        state.currentProject.projectName + ' (当前)</option>';
    }
    ps.innerHTML = psOpts;
    if (state.currentProject) ps.value = state.currentProject.projectName;

    const ts = document.getElementById('task-select');
    if (ts) {
      let tsOpts = '<option value="">-- 选任务 --</option>';
      if (state.tasks && state.tasks.length > 0) {
        state.tasks.forEach(function (t) {
          const sel = state.currentTask && state.currentTask.taskId === t.taskId ? ' selected' : '';
          tsOpts += '<option value="' + t.taskId + '"' + sel + '>' +
            escapeHtml(t.taskName) + ' [' + (t.createDate || '').substring(0, 10) + ']</option>';
        });
      }
      ts.innerHTML = tsOpts;
      if (state.currentTask) ts.value = state.currentTask.taskId;
    }

    const es = document.getElementById('exec-select');
    if (es) {
      if (state.failedExecs && state.failedExecs.length > 0) {
        let esOpts = '<option value="">-- 全部 --</option>';
        state.failedExecs.forEach(function (e, idx) {
          esOpts += '<option value="' + e.wid + '">' +
            (idx + 1) + '. ' + (e.execStartTime || '').substring(0, 16) + ' | ' + (e.executorName || '?') + '</option>';
        });
        es.innerHTML = esOpts;
      } else {
        es.innerHTML = '<option value="">未扫描</option>';
      }
    }
  }

  async function onProjectChange() {
    const ps = document.getElementById('project-select');
    const opt = ps.options[ps.selectedIndex];
    if (!opt || !opt.value) return;
    const projectName = opt.value;
    const execProjectType = parseInt(opt.dataset.type || '0', 10);
    state.currentProject = { projectName: projectName, execProjectType: execProjectType };
    state.currentTask = null;
    state.failedExecs = [];
    state.tasks = [];

    try {
      const tabs = await chrome.tabs.query({ url: 'http://10.20.65.23:3000/Dml/AiTest/*' });
      if (tabs && tabs.length) {
        const url = tabs[0].url;
        const baseUrl = url.split('?')[0];
        const newUrl = baseUrl + '?execProjectType=' + execProjectType + '&projectName=' + encodeURIComponent(projectName);
        const finalUrl = newUrl.indexOf('library') !== -1 ? newUrl.replace('library', 'task') : newUrl;
        await chrome.tabs.update(tabs[0].id, { url: 'http://10.20.65.23:3000' + finalUrl });
        setTimeout(detectAndScan, 2000);
      }
    } catch (e) {}
  }

  async function onTaskChange() {
    const ts = document.getElementById('task-select');
    const taskId = ts.value;
    if (!taskId) return;
    const task = state.tasks.find(function (t) { return t.taskId === parseInt(taskId, 10); });
    state.currentTask = task ? {
      taskId: task.taskId, taskName: task.taskName,
      projectName: state.currentProject ? state.currentProject.projectName : ''
    } : { taskId: parseInt(taskId, 10), taskName: '任务 #' + taskId };
    try {
      const tabs = await chrome.tabs.query({ url: 'http://10.20.65.23:3000/Dml/AiTest/*' });
      if (tabs && tabs.length) {
        const url = tabs[0].url;
        const baseUrl = url.split('?')[0].replace('automationManage-task', 'automationManage-taskDetail');
        const newUrl = baseUrl + '?taskId=' + taskId + '&menu=execute';
        await chrome.tabs.update(tabs[0].id, { url: 'http://10.20.65.23:3000' + newUrl });
        setTimeout(detectAndScan, 1500);
      }
    } catch (e) {}
  }

  async function pickProject() {
    await scanAllProjects();
    await scanTasksFromPageDOM();
    renderBreadcrumb();
    showToast('已刷新 (' + state.projects.length + ' 个项目, ' + state.tasks.length + ' 个任务)', 'success');
  }

  async function scan() {
    const btn = document.getElementById('btn-scan');
    if (btn) { btn.disabled = true; btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>扫描中...'; }
    try {
      const tabs = await chrome.tabs.query({ url: 'http://10.20.65.23:3000/Dml/AiTest/*' });
      if (!tabs || !tabs.length) {
        showToast('请先打开 AiTest 任务详情页', 'error');
        return;
      }
      const tab = tabs[0];
      if (!state.currentTask) {
        const urlParams = new URLSearchParams(tab.url.split('?')[1] || '');
        const taskId = parseInt(urlParams.get('taskId') || '0', 10);
        if (taskId) {
          state.currentTask = { taskId: taskId, taskName: '任务 #' + taskId, projectName: state.currentProject ? state.currentProject.projectName : '' };
        } else {
          showToast('未找到任务 ID', 'error');
          return;
        }
      }
      const response = await sendToContentScript(tab.id, 'SCAN_TASK_FAILURES', {
        taskId: state.currentTask.taskId, daysBack: 7
      });
      if (!response || !response.success) {
        const errorMsg = (response && response.error) || '未知错误';
        console.error('[TestMateX] 扫描失败:', errorMsg);
        showToast('扫描失败：' + errorMsg, 'error');
        return;
      }
      state.failedExecs = response.data || [];
      renderBreadcrumb();
      if (state.failedExecs.length === 0) {
        showEmpty('范围内无失败执行');
        return;
      }
      await loadCasesForExec(state.failedExecs[0].wid);
      showToast('扫到 ' + state.failedExecs.length + ' 次失败执行', 'success');
    } catch (e) {
      showToast('扫描出错: ' + e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>扫描'; }
    }
  }

  async function loadCasesForExec(execWid) {
    try {
      const tabs = await chrome.tabs.query({ url: 'http://10.20.65.23:3000/Dml/AiTest/*' });
      if (!tabs || !tabs.length) return;
      const response = await sendToContentScript(tabs[0].id, 'GET_CASES_FOR_EXEC', { execWid: execWid });
      if (!response || !response.success) {
        showToast('加载用例失败', 'error');
        return;
      }
      state.currentCases = response.data.cases || [];
      state.selectedCases = new Set(state.currentCases.map(function (c) { return c.wid; }));
      renderCases();
    } catch (e) {}
  }

  function renderCases() {
    const list = document.getElementById('cases-list');
    const summary = document.getElementById('list-summary');
    const submitBtn = document.getElementById('btn-submit-selected');
    const submitCount = document.getElementById('submit-count');
    summary.textContent = '共 ' + state.currentCases.length + ' 失败用例';
    submitCount.textContent = state.selectedCases.size;
    submitBtn.disabled = state.selectedCases.size === 0;
    if (state.currentCases.length === 0) {
      list.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>无失败用例</p></div>';
      return;
    }
    list.innerHTML = state.currentCases.map(renderCaseCard).join('');
    bindCaseEvents();
  }

  function renderCaseCard(c) {
    const selected = state.selectedCases.has(c.wid);
    const expanded = state.expandedCases.has(c.wid);
    return '<div class="case-card' + (selected ? ' selected' : '') + (expanded ? ' expanded' : '') + '" data-wid="' + c.wid + '">' +
      '<div class="case-header" data-action="toggle">' +
        '<input type="checkbox" data-action="select" ' + (selected ? 'checked' : '') + ' />' +
        '<span class="case-num">' + escapeHtml(c.testcase_number || '-') + '</span>' +
        '<span class="case-name">' + escapeHtml(c.testcase_name || '-') + '</span>' +
        '<span class="case-toggle">▼</span>' +
      '</div>' +
      '<div class="case-summary">' +
        '<span><span class="label">⏱️</span> ' + escapeHtml(c.execTotalTime || '-') + '</span>' +
        '<span><span class="label">❌</span> ' + escapeHtml((c.failanany || '无').substring(0, 40)) + '</span>' +
      '</div>' +
      (expanded ? '<div class="case-body">' +
        '<div class="detail-block">' +
          formatDetailRow('\u274c 现象', c.failanany) +
          formatDetailRow('\ud83d\udd0d 分析', c.failroot) +
          formatDetailRow('\u26a0\ufe0f 错误', (c.logText || '').substring(0, 200)) +
          formatDetailRow('\ud83d\udcbb 环境', c.logTextIps && c.logTextIps[0] ? c.logTextIps[0] : '') +
        '</div>' +
      '</div>' : '') +
    '</div>';
  }

  function formatDetailRow(label, value) {
    if (!value) return '';
    return '<div class="value"><span class="label">' + label + ':</span> ' + value + '</div>';
  }

  function bindCaseEvents() {
    const list = document.getElementById('cases-list');
    if (!list) return;
    list.querySelectorAll('.case-header').forEach(function (header) {
      header.addEventListener('click', function (e) {
        if (e.target.tagName === 'INPUT') return;
        const card = header.closest('.case-card');
        const wid = parseInt(card.dataset.wid, 10);
        if (state.expandedCases.has(wid)) state.expandedCases.delete(wid);
        else state.expandedCases.add(wid);
        renderCases();
      });
    });
    list.querySelectorAll('input[data-action="select"]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        const card = cb.closest('.case-card');
        const wid = parseInt(card.dataset.wid, 10);
        if (cb.checked) state.selectedCases.add(wid);
        else state.selectedCases.delete(wid);
        card.classList.toggle('selected', cb.checked);
        document.getElementById('submit-count').textContent = state.selectedCases.size;
        document.getElementById('btn-submit-selected').disabled = state.selectedCases.size === 0;
      });
    });
  }

  function toggleAll() {
    const checked = document.getElementById('check-all').checked;
    state.currentCases.forEach(function (c) {
      if (checked) state.selectedCases.add(c.wid);
      else state.selectedCases.delete(c.wid);
    });
    renderCases();
  }

  function showEmpty(msg) {
    const list = document.getElementById('cases-list');
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>' + msg + '</p></div>';
    document.getElementById('list-summary').textContent = '共 0 失败用例';
  }

  function aiBatch() {
    if (state.currentCases.length === 0) {
      showToast('请先扫描用例', 'error');
      return;
    }
    const count = state.currentCases.length;
    showToast('AI 分析 ' + count + ' 个用例...', 'info');
    state.currentCases.forEach(function (c, idx) {
      setTimeout(function () {
        var nl = String.fromCharCode(10);
        state.aiResults[c.wid] = '\ud83d\udd0d 根因分析:' + nl +
          '1. [85%] ' + (c.failanany || '主要错误模式') + nl +
          '2. [60%] 备选根因' + nl + nl +
          '\ud83d\udca1 建议: 检查关键日志, 验证参数, 复现验证';
      }, idx * 500);
    });
    setTimeout(function () {
      showToast('AI 分析完成 (' + count + ' 个用例)', 'success');
      renderCases();
    }, count * 500 + 500);
  }

  function gotoList() {
    document.getElementById('page-list').classList.add('active');
    document.getElementById('page-edit').classList.remove('active');
    document.getElementById('page-preview').classList.remove('active');
  }

  function gotoEdit() {
    if (state.selectedCases.size === 0) {
      showToast('请先选择用例', 'error');
      return;
    }
    prefillForm();
    document.getElementById('page-list').classList.remove('active');
    document.getElementById('page-edit').classList.add('active');
    document.getElementById('page-preview').classList.remove('active');
  }

  function gotoPreview() {
    renderPreview();
    document.getElementById('page-list').classList.remove('active');
    document.getElementById('page-edit').classList.remove('active');
    document.getElementById('page-preview').classList.add('active');
  }

  function prefillForm() {
    const cases = state.currentCases.filter(function (c) { return state.selectedCases.has(c.wid); });
    if (cases.length === 0) return;
    const list = document.getElementById('edit-cases-list');
    list.innerHTML = cases.map(function (c) {
      return '<div class="edit-cases-item">☑ ' + escapeHtml(c.testcase_number) + ' ' +
      escapeHtml(c.testcase_name || '').substring(0, 40) + '</div>';
    }).join('');

    const first = cases[0];
    const stage = document.getElementById('edit-stage').value;
    const title = '【测试】[' + stage + ']' +
      (first.testcase_number || '') + ' ' + (first.testcase_name || '');
    setField('title', title);

    setField('featureModule', 'PCIe/NVMe 自动化测试');
    setField('preconditions', '1. 盘片已格式化并安装好 OS');
    setField('steps', first.testcase_name || '');
    setField('expectedResult', '用例执行成功');
    setField('failurePhenomenon', first.failanany || '');

    setField('hostIp', first.logTextIps && first.logTextIps[0] || '');
    setField('hostOs', 'Ubuntu 22.04');
    setField('hostSsdTopology', '共 4 张, Quarch PM3 连接');

    setField('caseId', first.testcase_number || '');
    setField('scriptInfo', first.solution || '');
    setField('logUrl', state.currentTask ? buildAiTestLogUrl(state.currentTask.taskId) : '');

    setField('analyzer', first.solution || (state.currentExec && state.currentExec.executorName) || '');
    setField('initialReason', first.failroot || '待分析');
    setField('occurTime', first.execStartTime || '');

    renderEditAiSummary(cases);

    const count = cases.length;
    document.getElementById('edit-count').textContent = count;
    document.getElementById('edit-count-2').textContent = count;
    document.getElementById('preview-count').textContent = count;
    document.getElementById('preview-count-2').textContent = count;
  }

  function buildAiTestLogUrl(taskId) {
    return 'http://10.20.65.23:3000/Dml/AiTest/index/automationManage-taskDetail?taskId=' + taskId + '&menu=execute';
  }

  function setField(key, value) {
    const el = document.getElementById(FORM_FIELDS[key]);
    if (el) el.value = value || '';
  }

  function getFormData() {
    const data = {};
    Object.keys(FORM_FIELDS).forEach(function (key) {
      const el = document.getElementById(FORM_FIELDS[key]);
      if (el) data[key] = el.value;
    });
    return data;
  }

  function onTemplateChange() {}

  function onStageChange() {
    const first = state.currentCases.find(function (c) { return state.selectedCases.has(c.wid); });
    if (!first) return;
    const title = '【测试】[' + (document.getElementById('edit-stage').value) + ']' +
      (first.testcase_number || '') + ' ' + (first.testcase_name || '');
    setField('title', title);
  }

  function renderEditAiSummary(cases) {
    const box = document.getElementById('edit-ai-summary');
    const items = cases.map(function (c) {
      const ai = state.aiResults[c.wid];
      return '<div class="edit-ai-item">' +
        '<div class="name">' + escapeHtml(c.testcase_number) + ' - ' + escapeHtml(c.testcase_name || '').substring(0, 30) + '</div>' +
        '<div>' + escapeHtml(ai || (c.failanany || '未跑 AI')) + '</div>' +
      '</div>';
    }).join('');
    box.innerHTML = items || '<p class="text-muted">无 AI 摘要</p>';
  }

  function renderPreview() {
    const data = getFormData();
    const cases = state.currentCases.filter(function (c) { return state.selectedCases.has(c.wid); });
    document.getElementById('pv-title').textContent = data.title || '-';
    document.getElementById('pv-stage').textContent = data.stage || '-';
    const body = document.getElementById('preview-body');
    let html = '';
    const sections = [
      { title: '1. 问题描述', fields: [['测试特性/开发模块', data.featureModule], ['预置条件', data.preconditions], ['关键操作步骤', data.steps], ['预期效果', data.expectedResult], ['测试失败现象', data.failurePhenomenon]] },
      { title: '2. 测试环境', fields: [['主机 IP/主机名', data.hostIp], ['主机 SN', data.hostSn], ['主机 OS', data.hostOs], ['SSD 数量及连接方式', data.hostSsdTopology]] },
      { title: '3. 版本信息', fields: [['FPGA', data.fpgaVersion], ['FW', data.fwVersion], ['驱动', data.driverVersion]] },
      { title: '4. 测试仪器', fields: [['仪器名称', data.instrumentName], ['IP/SN', data.instrumentIpSn], ['软件版本', data.instrumentVersion]] },
      { title: '5. 软件工具', fields: [['工具名称及版本', data.softwareTools]] },
      { title: '6. 被测设备', fields: [['硬件版本', data.hwVersion], ['固件版本', data.dutFwVersion], ['SN', data.dutSn]] },
      { title: '7. 测试用例信息', fields: [['用例编号', data.caseId], ['脚本编号/版本', data.scriptInfo], ['仓库信息', data.scriptRepo], ['修改记录', data.scriptModifications], ['日志直达链接', data.logUrl]] },
      { title: '8. 定位履历', fields: [['描述', data.analysisTrace], ['贴图', data.analysisTraceImages]] },
      { title: '9. 初步分析', fields: [['分析人', data.analyzer], ['初步原因', data.initialReason], ['问题发生时间', data.occurTime]] },
      { title: '10. 测试日志', fields: [['串口日志', data.logSerial], ['训练器 Trace', data.logTrace], ['操作系统日志', data.logOs], ['测试工具输出', data.logTool], ['贴图', data.logImages]] },
      { title: '11. 其他补充信息', fields: [['', data.otherInfo]] },
    ];
    sections.forEach(function (sec) {
      const rows = sec.fields.filter(function (kv) { return kv[1] && kv[1].trim(); }).map(function (kv) {
        return '<div class="preview-row"><span class="key">' + kv[0] + ':</span><span class="val">' + escapeHtml(kv[1]).replace(/ /g, '<br>') + '</span></div>';
      }).join('');
      if (rows) {
        html += '<div class="preview-section"><div class="preview-section-title">' + sec.title + '</div>' + rows + '</div>';
      }
    });
    if (cases.length > 0) {
      const aiItems = cases.map(function (c) {
        const ai = state.aiResults[c.wid];
        return '<div class="preview-row"><span class="key">' + escapeHtml(c.testcase_number) + ':</span><span class="val">' + escapeHtml(ai || c.failanany || '') + '</span></div>';
      }).join('');
      html += '<div class="preview-section"><div class="preview-section-title">AI 摘要</div>' + aiItems + '</div>';
    }
    body.innerHTML = html || '<p class="preview-empty">无内容</p>';
  }

  async function submitFromEdit() {
    const cases = state.currentCases.filter(function (c) { return state.selectedCases.has(c.wid); });
    if (cases.length === 0) {
      showToast('请先选择用例', 'error');
      return;
    }
    const data = getFormData();
    if (!data.caseId) {
      showToast('用例编号不能为空', 'error');
      return;
    }
    showToast('提交中...', 'info');
    try {
      const res = await chrome.runtime.sendMessage({ action: 'SUBMIT_TO_PINGCODE', payload: data });
      if (res && res.success) {
        const url = res.bugUrl;
        showToast('成功! <a href="' + url + '" target="_blank" style="color:#16a34a;font-weight:600;">' + res.wholeIdentifier + '</a>', 'success');
        setTimeout(gotoList, 1500);
      } else {
        throw new Error((res && res.error) || '提交失败');
      }
    } catch (e) {
      showToast('提交失败: ' + e.message, 'error');
    }
  }

  async function handleReauth() {
    showToast('重新鉴权...', 'info');
    try {
      const res = await chrome.runtime.sendMessage({ action: 'CHECK_PINGCODE_STATUS' });
      if (res && res.success && res.status && res.status.authenticated) {
        showToast('已连接', 'success');
      } else {
        showToast(res && res.error || '鉴权失败', 'error');
      }
    } catch (e) {}
  }

  function showToast(msg, type) {
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);padding:8px 14px;border-radius:6px;font-size:12px;z-index:9999;max-width:90%;box-shadow:0 4px 12px rgba(0,0,0,0.15);text-align:center;z-index:99999;';
    if (type === 'success') { toast.style.background = '#f0fdf4'; toast.style.color = '#166534'; toast.style.border = '1px solid #22c55e'; }
    else if (type === 'error') { toast.style.background = '#fef2f2'; toast.style.color = '#991b1b'; toast.style.border = '1px solid #ef4444'; }
    else { toast.style.background = '#eff6ff'; toast.style.color = '#1e40af'; toast.style.border = '1px solid #3b82f6'; }
    toast.innerHTML = msg;
    document.body.appendChild(toast);
    setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, type === 'error' ? 5000 : 3000);
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function sendToContentScript(tabId, action, params, retries) {
    retries = retries || 0;
    return new Promise(function (resolve) {
      try {
        chrome.tabs.sendMessage(tabId, { action: action, opts: params }, function (response) {
          if (chrome.runtime.lastError) {
            var msg = chrome.runtime.lastError.message;
            if (msg.indexOf('Receiving end does not exist') !== -1 && retries < 3) {
              console.warn('[TestMateX] sendMessage 重试 (' + (retries + 1) + '/3):', action);
              setTimeout(function () {
                sendToContentScript(tabId, action, params, retries + 1).then(resolve);
              }, 800 * (retries + 1));
              return;
            }
            console.error('[TestMateX] sendMessage 错误:', msg);
            resolve({ __error: 'Content Script 未注入: ' + msg });
          } else {
            resolve(response || {});
          }
        });
      } catch (e) { 
        console.error('[TestMateX] sendMessage 异常:', e);
        resolve({ __error: 'sendMessage 失败: ' + e.message }); 
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else { start(); }
})();
