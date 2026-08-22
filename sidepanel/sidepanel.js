// sidepanel.js V23 + ENV Adapter
(function () {
  'use strict';

  // ─── ENV 读取 (sidepanel 独立 window) ───
  // Fallback: 与 js/config.js DEFAULT_CONFIG 保持一致
  // 即使 config.js 没注入成功, PingCode/PLM 也默认走 prod, 不会误走 mock
  const __AITESTX_CONFIG = window.__AITESTX_CONFIG || {
    AiTest:   'mock',
    PingCode: 'prod',
    PLM:      'prod',
    ENV: 'mock',
    PROD: { AITEST_BASE: 'http://10.20.65.23:3000', PINGCODE_BASE: 'http://10.20.24.30', PLM_BASE: 'https://plm.twsc.com.cn' },
    MOCK: { AITEST_BASE: 'http://localhost:8000',  PINGCODE_BASE: 'http://localhost:8000', PLM_BASE: 'http://localhost:8000' },
  };
  function isMockMode(system) {
    const cfg = __AITESTX_CONFIG;
    const sys = { AITEST: 'AiTest', PINGCODE: 'PingCode', PLM: 'PLM' }[system] || system;
    if (sys && typeof cfg[sys] === 'string') return cfg[sys] === 'mock';
    // per-system 字段缺失 → 默认 prod (mock 是主动选择, 不该是默认)
    return false;
  }
  function atxBase(system) {
    const cfg = __AITESTX_CONFIG;
    const key = { AITEST: 'AITEST_BASE', PINGCODE: 'PINGCODE_BASE', PLM: 'PLM_BASE' }[system] || (system + '_BASE');
    const sys = { AITEST: 'AiTest', PINGCODE: 'PingCode', PLM: 'PLM' }[system] || system;
    return isMockMode(sys) ? cfg.MOCK[key] : cfg.PROD[key];
  }
  console.log('[AiTestX SP] ENV=' + __AITESTX_CONFIG.ENV + ' PINGCODE=' + atxBase('PINGCODE'));

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
    currentProject: null, currentTask: null, currentExecWid: null, executions: [], currentExec: null,
    currentCases: [],
    selectedCases: new Set(), expandedCases: new Set(),
    aiResults: {}, projects: [], tasks: [],
    submitSystem: 'pingcode',  // 'pingcode' | 'plm' | 'both'
  };

  function start() {
    console.log('[AiTestX] V23 + ENV Adapter, ENV=' + __AITESTX_CONFIG.ENV);
    bindEvents();
    setInterval(pollPingCode, 8000);
    setTimeout(pollPingCode, 200);
    setInterval(pollPlm, 8000);
    setTimeout(pollPlm, 250);
    setTimeout(detectAndScan, 500);
    setupUrlWatcher();
    applyEnvBadge();
    switchPage('page-list');  // 确保初始 page-list 上面包屑可见
  }

  function applyEnvBadge() {
    // 在 brand-sub 显示当前环境 (让用户一眼看到这是 mock 还是 prod)
    const sub = document.getElementById('brand-sub');
    if (sub) {
      sub.textContent = isMockMode("AiTest") ? '🧪 MOCK 环境' : 'AiTest 至 PingCode';
      sub.style.color = isMockMode("AiTest") ? '#dc2626' : '';
      sub.style.fontWeight = isMockMode("AiTest") ? '600' : '';
    }
    // 文档 title 也标一下, 方便调试
    document.title = isMockMode("AiTest") ? 'AiTestX [MOCK]' : 'AiTestX';
  }

  let lastUrl = '';
  function setupUrlWatcher() {
    lastUrl = location.href;
    setInterval(function () {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        state.currentTask = null;
        state.currentCases = [];
        detectAndScan();
      }
    }, 500);
  }

  function bindEvents() {
    document.getElementById('btn-reconnect').addEventListener('click', detectAndScan);
    document.getElementById('btn-reauth').addEventListener('click', handleReauth);
    document.getElementById('btn-plm-reauth').addEventListener('click', pollPlm);
    document.getElementById('project-select').addEventListener('change', onProjectChange);
    document.getElementById('exec-select').addEventListener('change', onExecChange);
    document.getElementById('btn-rescan').addEventListener('click', pickProject);
    document.getElementById('btn-scan').addEventListener('click', scan);
    // 'check-all' checkbox 已删 (改单选模式, 不再需要 toggleAll 绑定)
    document.getElementById('btn-submit-selected').addEventListener('click', function () { gotoEdit(); });
    document.getElementById('btn-ai-batch').addEventListener('click', aiBatch);
    document.getElementById('btn-clear-cases').addEventListener('click', clearCases);
    document.getElementById('btn-toggle-all').addEventListener('click', toggleAllCases);
    document.getElementById('btn-edit-back-2').addEventListener('click', gotoList);
    // 编辑页 [下一步: 确认提单] → 渲染预览页 + 跳到 page-preview (用户最后确认后再点 [确认提交] 才真正发)
    document.getElementById('btn-edit-next').addEventListener('click', submitFromEdit);
    // 预览页按钮: 返回编辑 / 确认提交 (后者弹 modal 让用户最后二次确认)
    const pvBack = document.getElementById('btn-preview-back');
    const pvSubmit = document.getElementById('btn-preview-submit');
    if (pvBack) pvBack.addEventListener('click', gotoEdit);
    if (pvSubmit) pvSubmit.addEventListener('click', confirmBeforeSubmit);
    // modal 按钮: 取消/关闭/确认
    const mcCancel = document.getElementById('btn-modal-cancel');
    const mcClose = document.getElementById('btn-modal-close');
    const mcConfirm = document.getElementById('btn-modal-confirm');
    if (mcCancel) mcCancel.addEventListener('click', hideConfirmModal);
    if (mcClose) mcClose.addEventListener('click', hideConfirmModal);
    if (mcConfirm) mcConfirm.addEventListener('click', doActualSubmit);
    document.getElementById('btn-success-back').addEventListener('click', gotoSuccessBack);

    // 系统选择 radio 监听
    const sysGroup = document.getElementById('submit-system-group');
    if (sysGroup) {
      sysGroup.querySelectorAll('input[type="radio"]').forEach(function (rb) {
        rb.addEventListener('change', function () {
          if (rb.checked) {
            state.submitSystem = rb.value;
            console.log('[AiTestX] 切换提单系统:', state.submitSystem);
          }
        });
      });
    }
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
        if (val) val.textContent = (res.status.mock ? '🧪 ' : '') + name;
      } else {
        if (dot) dot.className = 'status-dot error';
        if (val) val.textContent = '未连接';
      }
    } catch (e) {}
  }

  async function pollPlm() {
    try {
      const res = await chrome.runtime.sendMessage({ action: 'CHECK_PLM_STATUS' });
      const dot = document.getElementById('plm-dot');
      const val = document.getElementById('plm-status');
      if (res && res.success && res.status && res.status.authenticated) {
        const name = res.status.user && (res.status.user.display_name || '已连接');
        if (dot) dot.className = 'status-dot ok plm';
        if (val) val.textContent = (res.status.mock ? '🧪 ' : '') + name;
      } else {
        if (dot) dot.className = 'status-dot error';
        if (val) val.textContent = '未连接';
      }
    } catch (e) {}
  }

  async function detectAndScan() {
    try {
      // ENV 自适应: mock 模式查 localhost:8000, prod 模式查内网
      const aitestUrlPattern = isMockMode("AiTest")
        ? 'http://localhost:8000/*'
        : 'http://10.20.65.23:3000/Dml/AiTest/*';
      const tabs = await chrome.tabs.query({ url: aitestUrlPattern });
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
      const labelSuffix = isMockMode("AiTest") ? ' (Mock)' : '';
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
          console.error('[AiTestX] scanAllProjects 失败:', e);
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
          console.error('[AiTestX] 获取任务列表失败:', e);
        }
      }

      if (taskId && !state.currentTask) {
        state.currentTask = { taskId: taskId, taskName: '任务 #' + taskId, projectName: projectName };
      }

      renderBreadcrumb();
    } catch (e) {
      console.error('[AiTestX] detectAndScan:', e);
      renderBreadcrumb(); // 确保即使出错也渲染
    }
  }

  async function scanAllProjects() {
    try {
      // ENV 自适应: mock 模式查 localhost:8000, prod 模式查内网
      const aitestUrlPattern = isMockMode("AiTest")
        ? 'http://localhost:8000/*'
        : 'http://10.20.65.23:3000/Dml/AiTest/*';
      const tabs = await chrome.tabs.query({ url: aitestUrlPattern });
      if (!tabs || !tabs.length) {
        console.warn('[AiTestX] 未找到 AiTest tab');
        return;
      }
      const response = await sendToContentScript(tabs[0].id, 'SCAN_PROJECTS_LIST', {});
      if (response && response.success && response.data) {
        state.projects = response.data;
        console.log('[AiTestX] 获取到', state.projects.length, '个项目');
      } else if (response && response.__error) {
        console.error('[AiTestX] scanAllProjects 错误:', response.__error);
        showToast('获取项目列表失败: ' + response.__error, 'error');
      } else if (response && !response.success) {
        console.error('[AiTestX] scanAllProjects 失败:', response.error);
        showToast('获取项目列表失败: ' + (response.error || '未知'), 'error');
      }
    } catch (e) {
      console.error('[AiTestX] scanAllProjects 异常:', e);
      showToast('获取项目列表异常: ' + e.message, 'error');
    }
  }

  async function scanTasksFromPageDOM() {
    if (!state.currentProject) return;
    try {
      // ENV 自适应: mock 模式查 localhost:8000, prod 模式查内网
      const aitestUrlPattern = isMockMode("AiTest")
        ? 'http://localhost:8000/*'
        : 'http://10.20.65.23:3000/Dml/AiTest/*';
      const tabs = await chrome.tabs.query({ url: aitestUrlPattern });
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
      console.error('[AiTestX] scanTasksFromPageDOM:', e);
    }
  }

  async function scanTasksViaAPI() {
    if (!state.currentProject) return;
    try {
      // ENV 自适应: mock 模式查 localhost:8000, prod 模式查内网
      const aitestUrlPattern = isMockMode("AiTest")
        ? 'http://localhost:8000/*'
        : 'http://10.20.65.23:3000/Dml/AiTest/*';
      const tabs = await chrome.tabs.query({ url: aitestUrlPattern });
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
        console.log('[AiTestX] 获取到', state.tasks.length, '个任务');
      } else if (response && response.__error) {
        console.error('[AiTestX] scanTasksViaAPI 错误:', response.__error);
        showToast('获取任务列表失败: ' + response.__error, 'error');
      } else if (response && !response.success) {
        console.error('[AiTestX] scanTasksViaAPI 失败:', response.error);
        showToast('获取任务列表失败: ' + (response.error || '未知'), 'error');
      }
    } catch (e) {
      console.error('[AiTestX] scanTasksViaAPI:', e);
    }
  }

  function renderBreadcrumb() {
    const ps = document.getElementById('project-select');
    if (!ps) return;
    let psOpts = '<option value="">请选择项目</option>';
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


    const es = document.getElementById('exec-select');
    if (es) {
      if (state.executions && state.executions.length > 0) {
        let esOpts = '<option value="">-- 全部 --</option>';
        state.executions.forEach(function (e, idx) {
          const sel = state.currentExecWid === e.wid ? ' selected' : '';
          esOpts += '<option value="' + e.wid + '"' + sel + '>' +
            (idx + 1) + '. ' + (e.execName || '?') + ' | ' + (e.executorName || '?') + ' | ' + (e.execStartTime || '').substring(0, 16) + '</option>';
        });
        es.innerHTML = esOpts;
        if (state.currentExecWid) es.value = String(state.currentExecWid);
        // 问题2: 同时更新顶部 #list-summary 为首个 exec 名称 (避免“未扫描”占位文)
        const summary = document.getElementById('list-summary');
        if (summary) {
          const e0 = state.executions[0];
          summary.textContent = (e0.execStartTime || '').substring(0, 16) + ' | ' + (e0.executorName || '?');
        }
      } else {
        es.innerHTML = '<option value="">请先进入任务详情后刷新</option>';
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
    state.executions = [];
    state.currentExecWid = null;
    state.tasks = [];

    try {
      // ENV 自适应: mock 模式查 localhost:8000, prod 模式查内网
      const aitestUrlPattern = isMockMode("AiTest")
        ? 'http://localhost:8000/*'
        : 'http://10.20.65.23:3000/Dml/AiTest/*';
      const tabs = await chrome.tabs.query({ url: aitestUrlPattern });
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

  async function onExecChange() {
    const es = document.getElementById('exec-select');
    if (es && es.value) state.currentExecWid = parseInt(es.value, 10);
  }

  async function pickProject() {
    await scanAllProjects();
    await scanTasksFromPageDOM();
    await refreshExecutions();
    renderBreadcrumb();
    showToast('已刷新 (' + state.projects.length + ' 个项目, ' + state.tasks.length + ' 个任务, ' + (state.executions ? state.executions.length : 0) + ' 个执行)', 'success');
  }

  async function refreshExecutions() {
    const aitestUrlPattern = isMockMode("AiTest")
      ? 'http://localhost:8000/*'
      : 'http://10.20.65.23:3000/Dml/AiTest/*';
    const tabs = await chrome.tabs.query({ url: aitestUrlPattern });
    if (!tabs || !tabs.length) return;
    const tab = tabs[0];
    const urlParams = new URLSearchParams(tab.url.split('?')[1] || '');
    const taskId = parseInt(urlParams.get('taskId') || '0', 10);
    if (!taskId) return;
    const r = await sendToContentScript(tab.id, 'SCAN_TASK_FAILURES', { taskId: taskId, daysBack: 30 });
    if (r && r.success && Array.isArray(r.data)) {
      state.executions = r.data;
      if (!state.currentExecWid && state.executions.length > 0) {
        state.currentExecWid = state.executions[0].wid;
      }
    } else {
      state.executions = [];
    }
    renderBreadcrumb();
  }

  async function scan() {
    const btn = document.getElementById('btn-scan');
    if (btn) { btn.disabled = true; btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>扫描中...'; }
    try {
      const aitestUrlPattern = isMockMode("AiTest")
        ? 'http://localhost:8000/*'
        : 'http://10.20.65.23:3000/Dml/AiTest/*';
      const tabs = await chrome.tabs.query({ url: aitestUrlPattern });
      if (!tabs || !tabs.length) {
        showToast('请先打开 AiTest 任务详情页', 'error');
        return;
      }
      const tab = tabs[0];
      const urlParams = new URLSearchParams(tab.url.split('?')[1] || '');
      const urlTaskId = parseInt(urlParams.get('taskId') || '0', 10);
      if (!urlTaskId) {
        showToast('URL 中未找到 taskId', 'error');
        return;
      }
      // 前置检查: 必须在 [刷新] 后才能扫描
      if (!state.currentExecWid) {
        showToast('请先点击 [刷新] 加载执行列表, 再选择执行后扫描', 'error');
        return;
      }
      // 按选中 exec 拿失败 cases
      const response = await sendToContentScript(tab.id, 'GET_CASES_FOR_EXEC', { execWid: state.currentExecWid });
      console.log('[TMX-DBG] response.success=' + (response && response.success) + ' cases=' + ((response && response.data && response.data.cases) || []).length);
      if (!response || !response.success) {
        const errorMsg = (response && response.error) || '未知错误';
        showToast('扫描失败：' + errorMsg, 'error');
        return;
      }
      const allCases = (response && response.data && response.data.cases) || [];
      state.currentCases = allCases;
      state.selectedCases = allCases.length > 0 ? new Set([allCases[0].wid]) : new Set();
      // 同步提单用的 task 上下文
      state.currentTask = {
        taskId: urlTaskId,
        taskName: '任务 #' + urlTaskId,
        projectName: state.currentProject ? state.currentProject.projectName : '',
        currentExec: state.executions.find(function (e) { return e.wid === state.currentExecWid; }) || null
      };
      renderCases();
      showToast('扫到 ' + allCases.length + ' 个失败用例', 'success');
    } catch (e) {
      showToast('扫描出错: ' + e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>扫描'; }
    }
  }

  function renderCases() {
    const list = document.getElementById('cases-list');
    const summary = document.getElementById('list-summary');
    const submitBtn = document.getElementById('btn-submit-selected');
    const submitCount = document.getElementById('submit-count');
    summary.textContent = '共 ' + state.currentCases.length + ' 失败用例';
    submitCount.textContent = state.selectedCases.size;
    updateBtnStates();
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
        if (cb.checked) {
          // 多选模式: 各自切换
          state.selectedCases.add(wid);
          card.classList.add('selected');
        } else {
          state.selectedCases.delete(wid);
          card.classList.remove('selected');
        }
        document.getElementById('submit-count').textContent = state.selectedCases.size;
        updateBtnStates();
      });
    });
  }

  // toggleAll 已废弃: 改单选模式, 顶部"全选" checkbox 也已删除
  // 函数定义保留仅为兼容旧引用, 实际不触发
  function toggleAll() { /* no-op */ }

  function showEmpty(msg) {
    const list = document.getElementById('cases-list');
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>' + msg + '</p></div>';
    document.getElementById('list-summary').textContent = '共 0 失败用例';
  }

  // AI 分析功能开发中, 暂时只提示用户
  function updateBtnStates() {
    const submitBtn = document.getElementById('btn-submit-selected');
    const aiBtn = document.getElementById('btn-ai-batch');
    const submitLabel = document.getElementById('submit-label');
    const submitCount = document.getElementById('submit-count');
    const n = state.selectedCases.size;
    const total = state.currentCases.length;

    // 编辑工单 label 文案 (不重写 button.innerHTML, 否则会销毁 #submit-count 等子节点)
    // N==1: 紫底 enabled; 其他 (0 或 ≥2): 紫底 disabled 不可提交 (跟 N=0 同)
    submitBtn.className = 'btn btn-primary';
    if (n === 1) {
      submitBtn.disabled = false;
      submitBtn.title = '';
    } else {
      submitBtn.disabled = true;
      submitBtn.title = n === 0
        ? '请先勾选用例'
        : '编辑工单只支持单个用例, 请取消多余勾选 (当前 ' + n + ')';
    }
    if (submitLabel) submitLabel.textContent = '下一步: 编辑工单';
    if (submitCount) submitCount.textContent = n;

    // AI 分析: ≥1 启用
    aiBtn.disabled = n === 0;

    // 全选 toggle 文案
    const toggleLabel = document.getElementById('toggle-all-label');
    if (toggleLabel) {
      if (total > 0 && n === total) toggleLabel.textContent = '取消全选';
      else toggleLabel.textContent = '全选';
    }
  }

  function toggleAllCases() {
    const total = state.currentCases.length;
    if (total === 0) return;
    const allWid = state.currentCases.map(function (c) { return c.wid; });
    // 当前已全选 -> 取消全选; 否则全选
    if (state.selectedCases.size === total) {
      state.selectedCases = new Set();
    } else {
      state.selectedCases = new Set(allWid);
    }
    renderCases();
  }

  function clearCases() {
    state.selectedCases = new Set();
    state.currentCases = [];
    renderCases();
    showToast('已清空失败用例列表', 'success');
  }

  function aiBatch() {
    showToast('AI 分析功能开发中, 敬请期待', 'info');
  }

  // 统一页面切换: 先清掉所有 .page 的 active, 再激活目标
  function switchPage(targetId) {
    const ids = ['page-list', 'page-edit', 'page-preview', 'page-success'];
    for (let i = 0; i < ids.length; i++) {
      const el = document.getElementById(ids[i]);
      if (el) el.classList.remove('active');
    }
    const target = document.getElementById(targetId);
    if (target) target.classList.add('active');
    // 面包屑 (项目+执行 选择) 只在 page-list 显示: 选 source 那一步
    const bc = document.getElementById('app').querySelector('.breadcrumb');
    if (bc) {
      if (targetId === 'page-list') bc.classList.add('visible');
      else bc.classList.remove('visible');
    }
  }

  function gotoList() {
    switchPage('page-list');
  }

  function gotoEdit() {
    console.log('[AiTestX] gotoEdit 被调, selectedCases.size=', state.selectedCases.size, 'currentCases.length=', state.currentCases.length);
    try {
      if (state.selectedCases.size === 0) {
        console.warn('[AiTestX] gotoEdit: 未选用例');
        showToast('请先选择用例', 'error');
        return;
      }
      console.log('[AiTestX] gotoEdit: 调 prefillForm');
      prefillForm();
      console.log('[AiTestX] gotoEdit: prefillForm 完成, 切页面');
      const pageList = document.getElementById('page-list');
      const pageEdit = document.getElementById('page-edit');
      console.log('[AiTestX] gotoEdit: 元素存在?', !!pageList, !!pageEdit);
      switchPage('page-edit');
      console.log('[AiTestX] gotoEdit: 完成');
    } catch (err) {
      console.error('[AiTestX] gotoEdit 异常:', err);
      showToast('跳页失败: ' + err.message, 'error');
    }
  }


  function gotoSuccess(results) {
    // 兼容单结果 (旧调用) 和数组 (新调用: pingcode/plm/both)
    const list = Array.isArray(results) ? results : [results];
    try {
      const idEl = document.getElementById('success-identifier');
      const link = document.getElementById('success-link');
      const meta = document.getElementById('success-meta');

      // 找 success-content 容器, 注入多结果列表 (如果有 >1 条结果)
      const successContent = document.querySelector('#page-success .success-content');
      // 移除旧 results 列表
      const oldResults = document.getElementById('success-results');
      if (oldResults) oldResults.remove();

      if (list.length === 1) {
        // 单结果: 沿用原有大号展示, link 文案跟 system 字段适配
        const r = list[0];
        const sysLabel = (r.system || 'pingcode').toUpperCase();
        if (idEl) {
          idEl.textContent = r.wholeIdentifier || ('BUG-' + r.bugId);
          idEl.style.display = '';
        }
        if (link) {
          link.href = r.bugUrl || '#';
          link.style.display = r.bugUrl ? 'inline-flex' : 'none';
          // 动态改 link 文本: "在 PingCode 中打开 ↗" / "在 PLM 中打开 ↗"
          const linkText = link.querySelector('span');
          if (linkText) linkText.textContent = '在 ' + sysLabel + ' 中打开';
        }
        // success-title 也按系统变 (可选, 但更清晰)
        const titleEl = document.querySelector('#page-success .success-title');
        if (titleEl) titleEl.textContent = '提单成功 (' + sysLabel + ')';
      } else {
        // 多结果: 隐藏大号, 用列表展示
        if (idEl) idEl.style.display = 'none';
        if (link) link.style.display = 'none';
        if (successContent) {
          const resultsDiv = document.createElement('div');
          resultsDiv.id = 'success-results';
          resultsDiv.className = 'success-results';
          resultsDiv.innerHTML = list.map(function (r) {
            const failed = r.failed;
            return '<div class="success-result-card' + (failed ? ' failed' : '') + '">' +
              '<div class="success-result-system">' + (r.system || '?').toUpperCase() + (failed ? ' · 失败' : ' · 成功') + '</div>' +
              (failed
                ? '<div class="success-result-id">' + escapeHtml(r.error || '提交失败') + '</div>'
                : '<div class="success-result-id">' + escapeHtml(r.wholeIdentifier || ('BUG-' + r.bugId)) + '</div>' +
                  (r.bugUrl ? '<a class="success-result-link" href="' + escapeHtml(r.bugUrl) + '" target="_blank">在 ' + (r.system || '').toUpperCase() + ' 中打开 ↗</a>' : '')
              ) +
            '</div>';
          }).join('');
          // 插在 id-card 之后, link 之前
          const anchor = document.getElementById('success-link');
          if (anchor) anchor.parentNode.insertBefore(resultsDiv, anchor);
          else successContent.appendChild(resultsDiv);
        }
      }

      if (meta) {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        meta.innerHTML = '提交时间: ' + now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + ' ' +
          pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
      }

      // 切换页面
      switchPage('page-success');
    } catch (err) {
      console.error('[AiTestX] gotoSuccess 异常:', err);
    }
  }

  function gotoSuccessBack() {
    // 再提一单: 清掉当前选中, 回到 page-list (让用户重选)
    state.selectedCases = new Set();
    document.getElementById('page-success').classList.remove('active');
    document.getElementById('page-list').classList.add('active');
    renderCases();
    // 可选: 自动重新扫描失败用例 (mock 模式下数据不变, prod 模式拉新的)
    detectAndScan();
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
    // 防御写法: 任一元素缺失不影响其他, 单点失败不阻塞
    const setText = function (id, value) { const el = document.getElementById(id); if (el) el.textContent = value; };
    setText('edit-count', count);
    setText('edit-count-2', count);
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

  function submitFromEdit() {
    // 校验 → 渲染预览页 → 跳到 page-preview (用户最后确认后再点 [确认提交] 才真正发)
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
    renderPreview();
    gotoPreview();
  }

  function gotoPreview() {
    switchPage('page-preview');
  }

  // 渲染预览页: 提单系统 pill + 标题 + 阶段 + 11 个 sections + AI 摘要
  function renderPreview() {
    const data = getFormData();
    const cases = state.currentCases.filter(function (c) { return state.selectedCases.has(c.wid); });

    // 头部: 系统 + 标题 + 阶段 + 用例数
    const sysLabel = { 'pingcode': 'PingCode', 'plm': 'PLM', 'both': 'PingCode + PLM' }[state.submitSystem] || 'PingCode';
    const sysPill = document.getElementById('pv-system-pill');
    if (sysPill) {
      sysPill.textContent = sysLabel;
      sysPill.className = 'preview-system-pill' + (state.submitSystem === 'both' ? ' multi' : '');
    }
    const setText = function (id, v) { const el = document.getElementById(id); if (el) el.textContent = v || '-'; };
    setText('pv-title', data.title);
    setText('pv-stage', data.stage);
    setText('pv-case-count', cases.length);

    // 11 个 sections 渲染
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
      const rows = sec.fields.filter(function (kv) { return kv[1] && String(kv[1]).trim(); }).map(function (kv) {
        return '<div class="preview-row"><span class="key">' + kv[0] + ':</span><span class="val">' + escapeHtml(kv[1]).replace(/\n/g, '<br>') + '</span></div>';
      }).join('');
      if (rows) {
        html += '<div class="preview-section"><div class="preview-section-title">' + sec.title + '</div>' + rows + '</div>';
      }
    });
    if (cases.length > 0) {
      const aiItems = cases.map(function (c) {
        const ai = state.aiResults[c.wid];
        return '<div class="preview-row"><span class="key">' + escapeHtml(c.testcase_number) + ':</span><span class="val">' + escapeHtml(ai || c.failanany || '无') + '</span></div>';
      }).join('');
      html += '<div class="preview-section"><div class="preview-section-title">AI 摘要</div>' + aiItems + '</div>';
    }
    if (body) body.innerHTML = html || '<p class="preview-empty">无内容</p>';
  }

  // 预览页 [确认提交] → 弹 modal 让用户最后二次确认 (系统 pill + 关键字段 + 警告)
  function confirmBeforeSubmit() {
    const data = getFormData();
    if (!data.caseId) {
      showToast('用例编号不能为空', 'error');
      return;
    }
    showConfirmModal(data);
  }

  function showConfirmModal(data) {
    // 填充 modal 关键信息
    const sysLabel = { 'pingcode': 'PingCode', 'plm': 'PLM', 'both': 'PingCode + PLM' }[state.submitSystem] || 'PingCode';
    const sysPill = document.getElementById('modal-system-pill');
    if (sysPill) {
      sysPill.textContent = sysLabel;
      sysPill.className = 'modal-system-pill' + (state.submitSystem === 'both' ? ' multi' : '');
    }
    const setText = function (id, v) { const el = document.getElementById(id); if (el) el.textContent = v || '-'; };
    setText('modal-title', data.title);
    setText('modal-caseId', data.caseId);
    setText('modal-failure', data.failurePhenomenon);
    setText('modal-hostIp', data.hostIp);
    setText('modal-dutSn', data.dutSn);

    // 显示 modal
    const modal = document.getElementById('confirm-modal');
    if (modal) modal.classList.remove('hidden');
  }

  function hideConfirmModal() {
    const modal = document.getElementById('confirm-modal');
    if (modal) modal.classList.add('hidden');
  }

  // 真正提交 (modal 二次确认后调用)
  async function doActualSubmit() {
    hideConfirmModal();
    const data = getFormData();
    showToast('提交中...', 'info');
    try {
      // 根据 state.submitSystem 路由 (pingcode | plm | both)
      const system = state.submitSystem || 'pingcode';
      const results = [];

      if (system === 'pingcode' || system === 'both') {
        const res = await chrome.runtime.sendMessage({ action: 'SUBMIT_TO_PINGCODE', payload: data });
        if (res && res.success) {
          results.push(Object.assign({ system: 'pingcode' }, res));
        } else {
          throw new Error('PingCode: ' + ((res && res.error) || '失败'));
        }
      }
      if (system === 'plm' || system === 'both') {
        const res = await chrome.runtime.sendMessage({ action: 'SUBMIT_TO_PLM', payload: data });
        if (res && res.success) {
          results.push(Object.assign({ system: 'plm' }, res));
        } else {
          // both 模式下, PLM 失败不阻断 PingCode 成功 (但要展示错误)
          if (system === 'plm') throw new Error('PLM: ' + ((res && res.error) || '失败'));
          results.push({ system: 'plm', failed: true, error: (res && res.error) || 'PLM 提交失败' });
        }
      }

      if (results.length === 0) {
        throw new Error('未选择系统 / 无提交结果');
      }

      // 单系统: 显示简略 toast; 多系统: 列出
      const sysLabel = results.map(function (r) { return r.system.toUpperCase(); }).join(' + ');
      showToast('提单成功 (' + sysLabel + ')', 'success');
      setTimeout(function () { gotoSuccess(results); }, 500);
    } catch (e) {
      showToast('提交失败: ' + e.message, 'error');
    }
  }

  async function handleReauth() {
    showToast('重新鉴权...', 'info');
    try {
      // 强制重连: USER_LOGIN 内部会清污染缓存 (mock JWT/user), 走真实拉 JWT
      const res = await chrome.runtime.sendMessage({ action: 'USER_LOGIN' });
      if (res && res.success) {
        showToast('已连接 (' + (res.user && (res.user.display_name || res.user.name) || '已登录') + ')', 'success');
      } else {
        showToast(res && res.error || '鉴权失败', 'error');
      }
    } catch (e) {
      showToast('鉴权失败: ' + e.message, 'error');
    }
  }

  // 内联消息条 (顶栏 inline, 不再是浮层)
  // 显示在 topbar 底部 status-rows 之后, 不盖住主内容
  let activeToastTimer = null;
  function showToast(msg, type) {
    const el = document.getElementById('status-toast');
    if (!el) return;
    if (activeToastTimer) { clearTimeout(activeToastTimer); activeToastTimer = null; }
    el.className = 'status-toast ' + (type || 'info');
    el.textContent = msg;
    el.classList.remove('hidden');
    // 到时自动隐藏 (error 显示更久)
    activeToastTimer = setTimeout(function () {
      el.classList.add('hidden');
      activeToastTimer = null;
    }, type === 'error' ? 5000 : 3000);
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // 自愈式 sendMessage: 失败时自动 force-inject content script, 然后重试
  // 解决: manifest 改动后没 reload / 页面比扩展先加载 / 多个 content_scripts 互相干扰
  const _injectAttempts = {};  // tabId → attempts, 防止无限循环
  function sendToContentScript(tabId, action, params, retries) {
    retries = retries || 0;
    return new Promise(function (resolve) {
      try {
        chrome.tabs.sendMessage(tabId, { action: action, opts: params }, function (response) {
          if (chrome.runtime.lastError) {
            var msg = chrome.runtime.lastError.message;
            // 'Receiving end does not exist' = content script 没在监听, 尝试强制注入
            if (msg.indexOf('Receiving end does not exist') !== -1) {
              if (!_injectAttempts[tabId]) _injectAttempts[tabId] = 0;
              _injectAttempts[tabId]++;

              // 第一次失败 + 注入配额内 → 强制注入 config + extractor, 然后重试 sendMessage
              if (_injectAttempts[tabId] <= 1) {
                console.warn('[AiTestX] content script 未注入, 强制注入并重试:', action, 'tabId=' + tabId);
                // 显式 ISOLATED world, 确保与 manifest content_scripts 同一个隔离世界 (listener 才能被 sendMessage 触发)
                chrome.scripting.executeScript({
                  target: { tabId: tabId },
                  files: ['js/config.js', 'content/ai-test-extractor.js'],
                  world: 'ISOLATED'
                }, function (execResults) {
                  if (chrome.runtime.lastError) {
                    console.error('[AiTestX] force-inject 失败:', chrome.runtime.lastError.message, '— 不再 retry, 直接报错');
                    resolve({ __error: 'force-inject 失败: ' + chrome.runtime.lastError.message });
                    return;
                  }
                  console.log('[AiTestX] force-inject 成功, execResults=', execResults, '— 等 800ms 让 listener 注册');
                  // 等长一点 (800ms) 让 IIFE + onMessage 注册完成
                  setTimeout(function () {
                    chrome.tabs.sendMessage(tabId, { action: action, opts: params }, function (retryResp) {
                      if (chrome.runtime.lastError) {
                        console.error('[AiTestX] force-inject 后仍失败:', chrome.runtime.lastError.message);
                        resolve({ __error: 'Content Script 注入后仍无响应: ' + chrome.runtime.lastError.message });
                      } else {
                        console.log('[AiTestX] force-inject 后 sendMessage 成功');
                        resolve(retryResp || {});
                      }
                    });
                  }, 800);
                });
                return;
              }

              // 注入后仍失败, 走原 retry 逻辑 (但只 2 次, 避免无限等)
              if (retries < 2) {
                console.warn('[AiTestX] sendMessage 重试 (' + (retries + 1) + '/2):', action);
                setTimeout(function () {
                  sendToContentScript(tabId, action, params, retries + 1).then(resolve);
                }, 800 * (retries + 1));
                return;
              }

              console.error('[AiTestX] sendMessage 最终失败:', msg);
              resolve({ __error: 'Content Script 未注入: ' + msg });
              return;
            }
            // 其他错误 (页面关闭 / 权限等)
            console.error('[AiTestX] sendMessage 错误:', msg);
            resolve({ __error: 'sendMessage 错误: ' + msg });
          } else {
            // 成功: 重置注入计数 (让后续 tab 操作也能 force-inject)
            delete _injectAttempts[tabId];
            resolve(response || {});
          }
        });
      } catch (e) {
        console.error('[AiTestX] sendMessage 异常:', e);
        resolve({ __error: 'sendMessage 异常: ' + e.message });
      }
    });
  }

  // ESC 关闭 modal
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') hideConfirmModal();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else { start(); }
})();
