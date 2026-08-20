// content/ai-test-extractor.js V18 (修复消息参数读取)
(function () {
  if (window.__testmatex_injected) return;
  window.__testmatex_injected = true;
  const AITEST_BASE = 'http://10.20.65.23:3000';
  const AITEST_API = AITEST_BASE + '/api/automation';
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
    return /Dml\/AiTest\//.test(window.location.href);
  }
  async function aiTestApi(endpoint, body) {
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
    const rows = document.querySelectorAll('tr.ant-table-row[data-row-key]');
    const tasks = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const taskId = parseInt(row.getAttribute('data-row-key'), 10);
      if (!taskId) continue;
      const cells = row.querySelectorAll('td');
      const taskName = (cells[1] && cells[1].textContent || '').trim();
      const planName = (cells[2] && cells[2].textContent || '').trim();
      const execfailure = (cells[3] && cells[3].textContent || '').trim();
      const createrName = (cells[4] && cells[4].textContent || '').trim();
      const createDate = (cells[5] && cells[5].textContent || '').trim();
      tasks.push({ taskId: taskId, taskName: taskName, planName: planName, execfailure: execfailure, createrName: createrName, createDate: createDate });
    }
    return { totalCount: tasks.length, tasks: tasks };
  }
  async function scanProjectsList() {
    console.log('[TestMateX] scanProjectsList 开始, 当前页面:', detectPage());
    try {
      const token = localStorage.getItem('acess_token');
      if (!token) throw new Error('AiTest 未登录 (localStorage 无 acess_token)');
      console.log('[TestMateX] 尝试调用 getExecProjectList API...');
      const res = await fetch(AITEST_API + '/getExecProjectList', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'aich-acess-token': token, 'Referer': window.location.href },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (data.code !== 200) throw new Error('API 错误: ' + (data.msg || '未知'));
      const projects = (data.data && data.data.project_list) || [];
      console.log('[TestMateX] API 返回', projects.length, '个项目');
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
      console.error('[TestMateX] getExecProjectList API 失败:', e.message);
      if (detectPage() !== 'LIBRARY') {
        console.error('[TestMateX] 当前不是 library 页, 无法 DOM 回退');
        throw new Error('请在 library 页打开');
      }
      console.log('[TestMateX] 回退到 DOM 爬取...');
      const rows = document.querySelectorAll('tr.ant-table-row');
      console.log('[TestMateX] DOM 找到', rows.length, '行');
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
      console.log('[TestMateX] DOM 爬取到', projects.length, '个项目');
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
    if (document.getElementById('testmatex-trigger-btn')) return;
    if (!shouldInjectButton()) return;
    const btn = document.createElement('button');
    btn.id = 'testmatex-trigger-btn';
    btn.className = 'testmatex-floating-btn';
    btn.innerHTML = '<span class="testmatex-icon">🚀</span><span>一键提单到 PingCode</span>';
    btn.title = 'TestMateX';
    btn.addEventListener('click', async function () {
      const originalText = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="testmatex-icon">⏳</span><span>正在抓取…</span>';
      try {
        const data = await extractFailureCase();
        data.btnRestore = originalText;
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]) await chrome.sidePanel.open({ tabId: tabs[0].id });
        chrome.runtime.sendMessage({ action: 'OPEN_SIDEPANEL_WITH_DATA', data: data });
      } catch (err) {
        console.error('[TestMateX] 提取失败:', err);
        btn.innerHTML = '<span class="testmatex-icon">❌</span><span>' + err.message + '</span>';
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
      const oldBtn = document.getElementById('testmatex-trigger-btn');
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
    console.log('[TestMateX] 收到消息:', msg.action, msg.opts || '');
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
            const result = [];
            for (let i = 0; i < failedExecs.length; i++) {
              try {
                const casesData = await getCasesForExec(failedExecs[i].wid);
                result.push({ exec: failedExecs[i], failedCases: casesData.cases });
              } catch (e) {
                result.push({ exec: failedExecs[i], failedCases: [], error: e.message });
              }
            }
            data = result;
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
  console.log('[TestMateX] Content Script V18 loaded');
})();
