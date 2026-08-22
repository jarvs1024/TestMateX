// content/ai-test-extractor.js V18 (修复消息参数读取)
(function () {
  if (window.__aitestx_injected) return;
  window.__aitestx_injected = true;
  const AITEST_BASE = 'http://10.20.65.23:3000';

  // ─── ENV 读取 (content script 上下文) ───
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

  // ─── Mock 数据源 ───
  const MOCK_TASK_ID = 9999;
  const MOCK_PROJECT_NAME = 'S3100V1R1 性能回归';
  const MOCK_FULL_CASE = {
    wid: 88481201,
    testcase_number: 'PCIE_GEN4_LINK_TRAIN_001',
    testcase_name: 'PCIe Gen4 x4 链路训练稳定性测试',
    failanany: '执行 PCIe Gen4 x4 链路训练时, 在 5000 次 LTSSM 切换循环中, Polling.Active → Polling.Config 转换失败 3 次, 链路降速到 Gen3',
    failroot: '训练器 LTSSM 状态机在 Polling.Compliance 阶段超时, 推测为 PHY PLL 锁定抖动',
    solution: '复测 3 次, 每次间隔 30s, 抓训练器 Trace + 串口日志',
    execStartTime: '2026-08-19T14:23:11',
    execFinishTime: '2026-08-19T18:47:55',
    execTotalTime: 15884,
    logText: '[14:23:11.234] [BOOT] FW version: S3100V1R1B01\n[14:23:12.001] [PCIE] Link training start, target Gen4 x4\n[14:23:15.887] [PCIE] LTSSM: Detect -> Polling.Active\n[14:23:18.022] [PCIE] Polling.Compliance timeout (>2s)\n[14:23:20.445] [PCIE] Fallback to Gen3 x4\n[14:47:55.000] [TEST] FAIL: Link instability observed (3/5000 events)\n[14:47:55.001] [EXIT] code=3',
    logTextIps: ['10.20.65.23', '192.168.10.55'],
  };
  const AITEST_API = AITEST_BASE + '/api/automation';
  function mockAiTestApi(endpoint, body) {
    console.log('[AiTestX MOCK] aiTestApi', endpoint, body || '');
    const e = endpoint.replace(/^\//, '');
    if (e === 'getExecProjectList') {
      return { code: 200, data: { project_list: [
        { projectName: MOCK_PROJECT_NAME, type: 1, taskCount: 8, latestUpdate: '2026-08-19 18:48:00' },
        { projectName: 'S3100V1R1 兼容性',     type: 2, taskCount: 12, latestUpdate: '2026-08-18 11:20:00' },
      ] } };
    }
    if (e === 'getLibraryTaskPage' || e === 'getTaskListPage') {
      const page = (body && body.page) || 1;
      return { code: 200, data: { rows: [
        { wid: MOCK_TASK_ID, name: 'S3100V1R1 PCIE 回归任务', planName: 'PCIE_GEN4_LINK_TRAIN', executorName: 'mock_user', failNum: 3, createDate: '2026-08-19T14:00:00', status: 3 },
        { wid: 9998,        name: 'NVMe 兼容性回归',          planName: 'NVME_COMPAT',          executorName: 'mock_user', failNum: 1, createDate: '2026-08-18T10:00:00', status: 3 },
      ], total: 2, page: page, pageSize: 20 } };
    }
    // scanTaskFailures 用的 endpoint, body 带 taskId
    // 返回失败 exec 列表 (含 result=3)
    if (e === 'getExecList' || e === '/getExecList') {
      return { code: 200, data: { execList: [
        { wid: 88001201, execName: 'PCIE 链路训练 - 第 1 次', executorName: 'mock_user', result: 3, execStartTime: '2026-08-19T14:23:11', execFinishTime: '2026-08-19T18:47:55', execTotalTime: 15884 },
        { wid: 88001202, execName: 'PCIE 链路训练 - 第 2 次', executorName: 'mock_user', result: 3, execStartTime: '2026-08-18T09:00:00', execFinishTime: '2026-08-18T12:30:00', execTotalTime: 12600 },
      ] } };
    }
    if (e === 'executeLogs' || e === '/executeLogs' || e === 'execLogs') {
      // 同一个 endpoint, 两种响应: scanTaskFailures 要 execList, getCasesForExec 要 logs
      // 用 body.module_id 区分: scanTaskFailures 不带 module_id, getCasesForExec 带
      if (body && body.module_id !== undefined) {
        // ── getCasesForExec: 返回失败用例 logs ──
        return { code: 200, data: { logs: [
          Object.assign({}, MOCK_FULL_CASE, { result: 3, caseExecId: 'CEX-001' }),
          { wid: 88481202, testcase_number: 'PCIE_GEN4_LINK_TRAIN_002', testcase_name: 'PCIe Gen4 x4 ASPM L1 进出', result: 3, failanany: 'L1 进入后唤醒失败, 设备停留在 D3hot', failroot: 'ASPM 协商超时', solution: '复测 5 次, 检查 PM 状态机', execStartTime: '2026-08-19T14:30:00', execFinishTime: '2026-08-19T18:45:00', execTotalTime: 15000 },
        ] } };
      }
      // ── scanTaskFailures: 返回 exec 列表 (含 result=3 的失败项) ──
      return { code: 200, data: { execList: [
        { wid: 88001201, execName: 'PCIE 链路训练 - 第 1 次', executorName: 'mock_user', result: 3, execStartTime: '2026-08-19T14:23:11', execFinishTime: '2026-08-19T18:47:55', execTotalTime: 15884 },
        { wid: 88001202, execName: 'PCIE 链路训练 - 第 2 次', executorName: 'mock_user', result: 3, execStartTime: '2026-08-18T09:00:00', execFinishTime: '2026-08-18T12:30:00', execTotalTime: 12600 },
      ] } };
    }
    if (e === 'getCaseLogText') {
      return { code: 200, data: { logText: MOCK_FULL_CASE.logText } };
    }
    return { code: 200, data: {} };
  }

  function detectPage() {
    const url = window.location.pathname;
    if (url.indexOf('taskDetail') !== -1) return 'TASK_DETAIL';
    if (url.indexOf('task') !== -1) return 'TASK_LIST';
    if (url.indexOf('library') !== -1) return 'LIBRARY';
    return 'OTHER';
  }
  function getTaskIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('taskId');
  }
  function shouldInjectButton() {
    // mock 模式下, localhost:8000 任意路径都注入按钮 (便于本地演示)
    if (isMockMode("AiTest")) {
      return /^http:\/\/localhost:8000\//.test(window.location.href);
    }
    return /Dml\/AiTest\//.test(window.location.href);
  }
  async function aiTestApi(endpoint, body) {
    if (isMockMode("AiTest")) return mockAiTestApi(endpoint, body);
    const token = localStorage.getItem('acess_token');
    if (!token) throw new Error('AiTest 未登录');
    const res = await fetch(AITEST_API + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'aich-acess-token': token, 'Referer': window.location.href },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      if (text.indexOf('<!DOCTYPE html>') !== -1) throw new Error('HTTP ' + res.status + ' 服务端错误');
      throw new Error('HTTP ' + res.status + ': ' + text.substring(0, 200));
    }
    const data = await res.json();
    if (data.code !== 200) throw new Error('AiTest API 错误: ' + (data.msg || data.message || '未知'));
    return data;
  }
  async function scanTasksFromDOM() {
    const pageType = detectPage();
    if (pageType !== 'TASK_LIST' && pageType !== 'TASK_DETAIL') throw new Error('请在任务列表页打开');
    // 任务详情页: 不抓表格行 (那是 executions 不是 tasks), 只从 breadcrumb + URL 拿当前 task
    if (pageType === 'TASK_DETAIL') {
      const urlParams = new URLSearchParams(window.location.search);
      const taskId = parseInt(urlParams.get('taskId') || '0', 10);
      if (!taskId) return { totalCount: 0, tasks: [] };
      return {
        totalCount: 1,
        tasks: [{
          taskId: taskId,
          taskName: getTaskNameFromBreadcrumb() || ('任务 #' + taskId),
          planName: '',
          execfailure: '',
          createrName: '',
          createDate: '',
        }]
      };
    }
    const rows = document.querySelectorAll('tr.ant-table-row[data-row-key]');
    const tasks = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const taskId = parseInt(row.getAttribute('data-row-key'), 10);
      if (!taskId) continue;
      const cells = row.querySelectorAll('td');
      const taskName = ((cells[1] && cells[1].textContent || '').trim())
        .replace(/^执行项目\s*[\/／]\s*/, '').replace(/^执行项目\s+/, '');
      const planName = (cells[2] && cells[2].textContent || '').trim();
      const execfailure = (cells[3] && cells[3].textContent || '').trim();
      const createrName = (cells[4] && cells[4].textContent || '').trim();
      const createDate = (cells[5] && cells[5].textContent || '').trim();
      tasks.push({ taskId: taskId, taskName: taskName, planName: planName, execfailure: execfailure, createrName: createrName, createDate: createDate });
    }
    return { totalCount: tasks.length, tasks: tasks };
  }
  async function scanProjectsList() {
    console.log('[AiTestX] scanProjectsList 开始, 当前页面:', detectPage(), 'mock=' + isMockMode("AiTest"));
    try {
      // 走 aiTestApi (mock 模式下自动短路到 mockAiTestApi, prod 模式下走真实 fetch + token 校验)
      const data = await aiTestApi('/getExecProjectList', {});
      const projects = (data.data && data.data.project_list) || [];
      console.log('[AiTestX] API 返回', projects.length, '个项目');
      return projects.map(function (p) {
        return {
          name: p.projectName,
          projectName: p.projectName,
          execProjectType: p.type,
          taskCount: p.taskCount || 0,
          lastUpdate: p.latestUpdate || '',
        };
      });
    } catch (e) {
      console.error('[AiTestX] getExecProjectList API 失败:', e.message);
      if (detectPage() !== 'LIBRARY') {
        console.error('[AiTestX] 当前不是 library 页, 无法 DOM 回退');
        throw new Error('请在 library 页打开');
      }
      console.log('[AiTestX] 回退到 DOM 爬取...');
      const rows = document.querySelectorAll('tr.ant-table-row');
      console.log('[AiTestX] DOM 找到', rows.length, '行');
      const projects = [];
      for (let i = 0; i < rows.length; i++) {
        const link = rows[i].querySelector('a[href*="automationManage-task"]');
        if (!link) continue;
        const cells = rows[i].querySelectorAll('td');
        const name = link.textContent.trim();
        const href = link.getAttribute('href');
        const params = new URLSearchParams(href.split('?')[1] || '');
        projects.push({
          name: name,
          projectName: params.get('projectName') || name,
          execProjectType: parseInt(params.get('execProjectType') || '0', 10),
          taskCount: cells[1] ? cells[1].textContent.trim() : '?',
          lastUpdate: cells[2] ? cells[2].textContent.trim() : '',
        });
      }
      console.log('[AiTestX] DOM 爬取到', projects.length, '个项目');
      return projects;
    }
  }
  async function scanTasksList(opts) {
    opts = opts || {};
    const daysBack = opts.daysBack || 0;
    const execProjectType = opts.execProjectType || 0;
    const projectName = opts.projectName || 's3100';
    const pageSize = 100;
    let current = 1;
    let allTasks = [];
    let totalCount = 0;
    while (true) {
      const data = await aiTestApi('/getTaskList', {
        search: '',
        pageSize: pageSize,
        current: current,
        quickSelectKey: 'all',
        filters: { planName: [], automationFlag: [], gitProject: [], createrName: [] },
        execProjectType: execProjectType,
      });
      const pageTasks = (data.data && data.data.taskList) || [];
      totalCount = (data.data && data.data.taskCount) || 0;
      allTasks = allTasks.concat(pageTasks);
      if (pageTasks.length < pageSize || allTasks.length >= totalCount) break;
      current++;
    }
    let filtered = allTasks;
    if (daysBack > 0) {
      const cutoff = Date.now() - daysBack * 86400000;
      filtered = allTasks.filter(function (t) {
        const t1 = new Date(t.createDate || t.updateDate || 0).getTime();
        return !isNaN(t1) && t1 >= cutoff;
      });
    }
    return {
      totalCount: totalCount,
      fetchedCount: allTasks.length,
      projectName: projectName,
      execProjectType: execProjectType,
      tasks: filtered.map(function (t) {
        return { taskId: t.wid, taskName: t.taskName, planName: t.planName, createrName: t.createrName, createDate: t.createDate };
      }),
    };
  }
  async function scanTaskFailures(taskId, daysBack) {
    daysBack = daysBack || 7;
    console.log('[AiTestX] scanTaskFailures:', { taskId: taskId, daysBack: daysBack, isMock: isMockMode("AiTest") });
    const data = await aiTestApi('/getExecList', {
      search: '',
      filters: { executorName: [], result: [] },
      taskId: String(taskId),
      pageSize: 100,
      current: 1,
      needUserSelect: true,
      sorters: { execTotalTime: 0 },
    });
    const execList = (data.data && data.data.execList) || [];
    console.log('[AiTestX] scanTaskFailures execList:', execList.length, '条');
    let failedExecs = execList.filter(function (e) { return e.result === 3; });
    if (daysBack > 0) {
      const cutoff = Date.now() - daysBack * 86400000;
      failedExecs = failedExecs.filter(function (e) {
        const t1 = new Date(e.execStartTime).getTime();
        return !isNaN(t1) && t1 >= cutoff;
      });
    }
    failedExecs.sort(function (a, b) { return new Date(b.execStartTime) - new Date(a.execStartTime); });
    return failedExecs;
  }
  async function getCasesForExec(execWid) {
    const data = await aiTestApi('/executeLogs', {
      wid: Number(execWid),
      module_id: -1,
      resultFilter: ['1', '2', '3', '4', '6', '7'],
      search: '',
    });
    const allCases = (data.data && data.data.logs) || [];
    const failedCases = allCases.filter(function (c) { return c.result === 3; });
    const BATCH_SIZE = 5;
    const result = [];
    for (let i = 0; i < failedCases.length; i += BATCH_SIZE) {
      const batch = failedCases.slice(i, i + BATCH_SIZE);
      const logResults = await Promise.allSettled(
        batch.map(function (c) {
          return aiTestApi('/getCaseLogText', { caseId: c.wid });
        })
      );
      for (let j = 0; j < batch.length; j++) {
        const c = batch[j];
        let logText = '';
        if (logResults[j].status === 'fulfilled') {
          logText = (logResults[j].value.data && logResults[j].value.data.logText) || '';
        }
        const ips = extractIps(logText);
        result.push({
          wid: c.wid,
          testcase_number: c.testcase_number,
          testcase_name: c.testcase_name,
          failanany: c.failanany || '',
          failroot: c.failroot || '',
          solution: c.solution || '',
          execStartTime: c.execStartTime,
          execFinishTime: c.execFinishTime,
          execTotalTime: c.execTotalTime,
          logText: logText.substring(0, 8000),
          logTextIps: ips,
        });
      }
    }
    return { execWid: Number(execWid), cases: result, allCases: allCases };
  }
  async function extractFailureCase() {
    if (isMockMode("AiTest")) return mockExtractFailureCase();
    const taskId = getTaskIdFromUrl();
    if (!taskId) throw new Error('URL 缺少 taskId');
    const failedExecs = await scanTaskFailures(taskId, 0);
    if (failedExecs.length === 0) throw new Error('该任务没有失败执行');
    const result = await getCasesForExec(failedExecs[0].wid);
    const first = result.cases[0];
    return {
      source: 'aitest',
      taskId: Number(taskId),
      taskName: getTaskNameFromBreadcrumb(),
      execution: {
        wid: failedExecs[0].wid,
        execName: failedExecs[0].execName,
        executorName: failedExecs[0].executorName,
        execStartTime: failedExecs[0].execStartTime,
        execFinishTime: failedExecs[0].execFinishTime,
        execTotalTime: failedExecs[0].execTotalTime,
      },
      failedCases: result.cases,
      primaryCase: first,
      logText: first ? first.logText : '',
      logTextIps: first ? first.logTextIps : [],
      extractedAt: new Date().toISOString(),
    };
  }
  function mockExtractFailureCase() {
    console.log('[AiTestX MOCK] extractFailureCase');
    return {
      source: 'aitest-mock',
      taskId: MOCK_TASK_ID,
      taskName: MOCK_PROJECT_NAME,
      execution: {
        wid: 88001201,
        execName: 'PCIE 链路训练 - 第 1 次',
        executorName: 'mock_user',
        execStartTime: '2026-08-19T14:23:11',
        execFinishTime: '2026-08-19T18:47:55',
        execTotalTime: 15884,
      },
      failedCases: [MOCK_FULL_CASE],
      primaryCase: MOCK_FULL_CASE,
      logText: MOCK_FULL_CASE.logText,
      logTextIps: MOCK_FULL_CASE.logTextIps,
      extractedAt: new Date().toISOString(),
      mock: true,
    };
  }

  function extractIps(text) {
    if (!text) return [];
    const matches = text.match(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g) || [];
    const seen = {};
    const result = [];
    for (let i = 0; i < matches.length; i++) {
      const ip = matches[i];
      if (seen[ip]) continue;
      seen[ip] = true;
      if (ip.indexOf('127.') === 0 || ip.indexOf('0.') === 0 || ip.indexOf('255.') === 0) continue;
      result.push(ip);
    }
    return result;
  }
  function getTaskNameFromBreadcrumb() {
    const items = document.querySelectorAll('.ant-breadcrumb-link, .ant-breadcrumb-item');
    for (let i = 0; i < items.length; i++) {
      const text = items[i].textContent.trim();
      if (text && text.indexOf('执行项目') === -1 && text.indexOf('home') === -1) {
        return text;
      }
    }
    return document.title || '未知任务';
  }
  function injectButton() {
    if (document.getElementById('aitestx-trigger-btn')) return;
    if (!shouldInjectButton()) return;
    const btn = document.createElement('button');
    btn.id = 'aitestx-trigger-btn';
    btn.className = 'aitestx-floating-btn';
    btn.innerHTML = '<span class="aitestx-icon">🚀</span><span>自动化分析与提单</span>';
    btn.title = 'AiTestX - 自动化分析提单';
    btn.addEventListener('click', async function () {
      const originalText = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="aitestx-icon">⏳</span><span>正在抓取…</span>';
      try {
        const data = await extractFailureCase();
        data.btnRestore = originalText;
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]) await chrome.sidePanel.open({ tabId: tabs[0].id });
        chrome.runtime.sendMessage({ action: 'OPEN_SIDEPANEL_WITH_DATA', data: data });
      } catch (err) {
        console.error('[AiTestX] 提取失败:', err);
        btn.innerHTML = '<span class="aitestx-icon">❌</span><span>' + err.message + '</span>';
        btn.disabled = false;
        setTimeout(function () { btn.innerHTML = originalText; }, 4000);
      }
    });
    document.body.appendChild(btn);
  }
  let lastUrl = window.location.href;
  const observer = new MutationObserver(function () {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      const oldBtn = document.getElementById('aitestx-trigger-btn');
      if (oldBtn) oldBtn.remove();
      setTimeout(injectButton, 500);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  if (document.readyState === 'complete') {
    injectButton();
  } else {
    window.addEventListener('load', injectButton);
  }
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    console.log('[AiTestX] 收到消息:', msg.action, msg.opts || '');
    const handler = (async function () {
      try {
        let data;
        switch (msg.action) {
          case 'RELOAD_AITEST_DATA':
            data = await extractFailureCase();
            break;
          case 'SCAN_TASKS_LIST':
            data = await scanTasksList(msg.opts || {});
            break;
          case 'SCAN_PROJECTS_LIST':
            data = await scanProjectsList();
            break;
          case 'SCAN_TASKS_FROM_DOM':
            data = await scanTasksFromDOM();
            break;
          case 'SCAN_TASK_FAILURES':
            data = await scanTaskFailures(msg.opts?.taskId, msg.opts?.daysBack || 7);
            break;
          case 'GET_CASES_FOR_EXEC':
            data = await getCasesForExec(msg.opts?.execWid);
            break;
          case 'GET_TASK_ALL_FAILURES': {
            const failedExecs = await scanTaskFailures(msg.opts?.taskId, msg.opts?.daysBack || 7);
            // 并行拿每个 failed exec 的 cases (每个 exec 独立, 互不依赖)
            const settled = await Promise.allSettled(failedExecs.map(function (e) {
              return getCasesForExec(e.wid).then(function (casesData) {
                return { exec: e, failedCases: casesData.cases };
              });
            }));
            data = settled.map(function (r, i) {
              if (r.status === 'fulfilled') return r.value;
              return { exec: failedExecs[i], failedCases: [], error: r.reason && r.reason.message || String(r.reason) };
            });
            break;
          }
          case 'GET_PROJECT_INFO':
            data = (function () {
              const params = new URLSearchParams(window.location.search);
              return {
                projectName: params.get('projectName'),
                execProjectType: parseInt(params.get('execProjectType') || '0', 10),
                taskId: parseInt(params.get('taskId') || '0', 10),
              };
            })();
            break;
          case 'RELOAD_AITEST_TASKLIST': {
            const tkParams = new URLSearchParams(window.location.search);
            const tkId = tkParams.get('taskId');
            if (tkId) {
              sendResponse({ success: true, data: { taskId: tkId } });
              return;
            }
            const row = document.querySelector('tr.ant-table-row[data-row-key]');
            if (row) {
              const rowKey = row.getAttribute('data-row-key');
              const cells = row.querySelectorAll('td');
              const taskName = cells[1] && cells[1].textContent ? cells[1].textContent.trim() : '';
              sendResponse({ success: true, data: { taskId: rowKey, taskName: taskName } });
              return;
            }
            sendResponse({ success: true, data: { message: '未找到任务' } });
            return;
          }
          default:
            sendResponse({ success: false, error: 'Unknown action: ' + msg.action });
            return;
        }
        sendResponse({ success: true, data: data });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  });
  console.log('[AiTestX] Content Script V18 loaded');
})();
