// background/sw.js V2
// Service Worker - all-in-one 单文件版,避免 ES module import 失败
// 包含: 消息处理 / JWT 鉴权 / AiTest API / PingCode API / 字段映射

const PINGCODE_BASE = 'http://10.20.24.30';
const AITEST_BASE = 'http://10.20.65.23:3000';

// ─── ENV 配置 (镜像 js/config.js, 兼容 classic SW 独立 global) ─────────────
const __TESTMATEX_CONFIG = {
  ENV: 'mock',  // 'mock' | 'prod'
  PROD: { AITEST_BASE: 'http://10.20.65.23:3000', PINGCODE_BASE: 'http://10.20.24.30' },
  MOCK: { AITEST_BASE: 'http://localhost:8000',  PINGCODE_BASE: 'http://localhost:8000' },
};
function isMockMode() { return __TESTMATEX_CONFIG.ENV === 'mock'; }
function tmxBase(kind) { return isMockMode() ? __TESTMATEX_CONFIG.MOCK[kind + '_BASE'] : __TESTMATEX_CONFIG.PROD[kind + '_BASE']; }
console.log('[TestMateX BG] ENV=' + __TESTMATEX_CONFIG.ENV + ' PINGCODE=' + tmxBase('PINGCODE'));

const STORAGE_KEYS = {
  PENDING_DATA: 'pendingData',
  JWT: 'pingcodeJwt',
  JWT_EXPIRES: 'pingcodeJwtExpires',
  USER: 'pingcodeUser',
  CONFIG: 'config',
  FORM_STATE: 'formState',
  FIELD_DICT: 'fieldDict',
};

const S3100_DEFAULTS = {
  projectId: '691d61f1db9093190e94bfaf',
  projectKey: 'S3100V1R1',
  bugTypeId: '662096879f86b6cac7599096',
  defaultAssignee: 'd351677ae26a4704b5fde1e5efd0dbc9',
  defaultPriority: '5cb9466afda1ce4ca0090004',
  defaultSeverity: '5cb7e6e2fda1ce4ca0020003',
  defaultProjectStage: '67ad59baeca31ee2556286d2',
  defaultFeature: ['6686384998ba41b0a3716046'],
  defaultIssueCategory: ['6784e5f775c65f70f13d048f'],
  defaultDevModule: ['6784e75675c65f70f13d04fe'],
  defaultS3100Chip: '693f65ccdb9093190e9aab8d',
  defaultS3100ProductRange: '69afbb77db9093190eaf38bb',
  defaultBenchmarkVersion: '69b3bf6ddb9093190eb03978',
  defaultIfFoundByTester: '673599ff2af553ee7ba6ad8f',
  defaultIfDevSelf: '67a72ac04498bcd87224cbc0',
};

// ─── 状态 ────────────────────────────────────────────────────────────────
let cachedJWT = null;
let jwtExpiresAt = 0;
let cachedUser = null;
let swReady = true;

console.log('[TestMateX BG] Service Worker V2 started, ready=' + swReady);

// ─── 消息处理 ────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log('[TestMateX BG] message:', msg.action);

  switch (msg.action) {
    case 'OPEN_SIDEPANEL_WITH_DATA':
      handleOpenSidePanel(msg.data)
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'GET_PENDING_DATA':
      chrome.storage.session.get(STORAGE_KEYS.PENDING_DATA).then(result => {
        sendResponse({ success: true, data: result[STORAGE_KEYS.PENDING_DATA] });
      });
      return true;

    case 'CHECK_PINGCODE_STATUS':
      checkPingCodeStatus()
        .then(status => sendResponse({ success: true, status }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'CHECK_PLM_STATUS':
      checkPlmStatus()
        .then(status => sendResponse({ success: true, status }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'USER_LOGIN':
      handleUserLogin()
        .then(result => sendResponse({ success: true, ...result }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'SUBMIT_TO_PINGCODE':
      handleSubmit(msg.payload)
        .then(result => sendResponse({ success: true, ...result, system: 'pingcode' }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'SUBMIT_TO_PLM':
      handleSubmitToPLM(msg.payload)
        .then(result => sendResponse({ success: true, ...result, system: 'plm' }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'PREVIEW_HTML':
      getPreviewHtml(msg.payload)
        .then(html => sendResponse({ success: true, html }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'CLEAR_PENDING_DATA':
      chrome.storage.session.remove(STORAGE_KEYS.PENDING_DATA).then(() => {
        sendResponse({ success: true });
      });
      return true;

    case 'PING':
      sendResponse({ success: true, pong: true });
      return true;

    default:
      sendResponse({ success: false, error: 'Unknown: ' + msg.action });
  }
});

// ─── 处理函数 ────────────────────────────────────────────────────────────
async function handleOpenSidePanel(data) {
  await chrome.storage.session.set({ [STORAGE_KEYS.PENDING_DATA]: data });
  try {
    await chrome.runtime.sendMessage({ action: 'NEW_DATA_AVAILABLE' });
  } catch (e) {}
}

async function handleUserLogin() {
  console.log('[TestMateX BG] 开始 PingCode 登录流程...');
  let tabs = await chrome.tabs.query({ url: 'http://10.20.24.30/*' });
  let backgroundTab = null;
  let token = null;
  let user = null;

  if (tabs.length === 0) {
    console.log('[TestMateX BG] 未找到 PingCode tab, 创建后台 tab...');
    try {
      backgroundTab = await chrome.tabs.create({ url: 'http://10.20.24.30/', active: false });
    } catch (e) {
      throw new Error('无法打开 PingCode 后台 tab: ' + e.message);
    }

    // 等待内容脚本加载，最多 15 秒
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 1000));
      try {
        console.log('[TestMateX BG] 尝试获取 JWT (' + (i + 1) + '/15)...');
        const response = await chrome.tabs.sendMessage(backgroundTab.id, { action: 'GET_PINGCODE_JWT' });
        if (response && response.success) {
          token = response.token;
          console.log('[TestMateX BG] JWT 获取成功');
          const meRes = await chrome.tabs.sendMessage(backgroundTab.id, { action: 'GET_PINGCODE_USER' });
          if (meRes && meRes.success) user = meRes.user;
          break;
        } else if (response && !response.success) {
          console.error('[TestMateX BG] JWT 获取失败:', response.error);
          // 如果是登录问题，提前退出
          if (response.error && (response.error.indexOf('未登录') !== -1 || response.error.indexOf('401') !== -1 || response.error.indexOf('403') !== -1)) {
            throw new Error('PingCode 未登录。请先在浏览器打开 http://10.20.24.30/ 并登录');
          }
        }
      } catch (e) {
        // 如果是登录问题，直接抛出
        if (e.message && (e.message.indexOf('未登录') !== -1 || e.message.indexOf('401') !== -1 || e.message.indexOf('403') !== -1)) {
          throw e;
        }
        // 其他错误继续等待
      }
    }

    try { await chrome.tabs.remove(backgroundTab.id); } catch (e) {}

    if (!token) {
      throw new Error('PingCode 自动登录失败。请先在浏览器手动打开 http://10.20.24.30/ 登录一次');
    }
  } else {
    console.log('[TestMateX BG] 找到已有 PingCode tab, 直接获取 JWT...');
    const tab = tabs[0];
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'GET_PINGCODE_JWT' });
    if (!response || !response.success) {
      const errorMsg = (response && response.error) || '未知';
      console.error('[TestMateX BG] JWT 获取失败:', errorMsg);
      if (errorMsg.indexOf('未登录') !== -1 || errorMsg.indexOf('401') !== -1 || errorMsg.indexOf('403') !== -1) {
        throw new Error('PingCode 未登录或会话已过期。请重新登录 http://10.20.24.30/');
      }
      throw new Error('拿 JWT 失败：' + errorMsg);
    }
    token = response.token;
    console.log('[TestMateX BG] JWT 获取成功');
    const meRes = await chrome.tabs.sendMessage(tab.id, { action: 'GET_PINGCODE_USER' });
    if (meRes && meRes.success) user = meRes.user;
  }

  cachedJWT = token;
  jwtExpiresAt = Date.now() + 30 * 60 * 1000;
  cachedUser = user;

  await chrome.storage.local.set({
    [STORAGE_KEYS.JWT]: cachedJWT,
    [STORAGE_KEYS.JWT_EXPIRES]: jwtExpiresAt,
    [STORAGE_KEYS.USER]: cachedUser,
  });

  console.log('[TestMateX BG] 登录完成, 用户:', user ? (user.display_name || user.name || '未知') : '未知');

  return {
    jwt: maskToken(cachedJWT),
    user: cachedUser,
    viaBackgroundTab: !!backgroundTab,
  };
}

async function checkPlmStatus() {
  // ── MOCK: PLM 默认已连接 ──
  if (isMockMode()) {
    return {
      authenticated: true,
      user: { display_name: 'Mock PLM 用户', name: 'mock_plm_user', id: 'mock-plm-user-id' },
      mock: true,
    };
  }
  // ── PROD: stub, 真实 PLM 鉴权后续接入 ──
  throw new Error('PLM prod 鉴权尚未实现, 请联系开发补 PLM 登录流程');
}

async function checkPingCodeStatus() {
  // ── MOCK: 跳过真实 JWT 拉取, 返回伪造身份 ──
  if (isMockMode()) {
    cachedJWT = cachedJWT || 'MOCK_JWT_' + Date.now();
    jwtExpiresAt = Date.now() + 24 * 3600 * 1000;
    cachedUser = cachedUser || {
      display_name: 'Mock 测试员',
      name: 'mock_user',
      id: 'mock-user-id',
    };
    return { authenticated: true, jwt: maskToken(cachedJWT), user: cachedUser, cached: true, mock: true };
  }

  if (cachedJWT && Date.now() < jwtExpiresAt - 60 * 1000) {
    return { authenticated: true, jwt: maskToken(cachedJWT), user: cachedUser, cached: true };
  }

  const stored = await chrome.storage.local.get([STORAGE_KEYS.JWT, STORAGE_KEYS.JWT_EXPIRES, STORAGE_KEYS.USER]);
  if (stored[STORAGE_KEYS.JWT] && stored[STORAGE_KEYS.JWT_EXPIRES] > Date.now() + 60 * 1000) {
    cachedJWT = stored[STORAGE_KEYS.JWT];
    jwtExpiresAt = stored[STORAGE_KEYS.JWT_EXPIRES];
    cachedUser = stored[STORAGE_KEYS.USER];
    return { authenticated: true, jwt: maskToken(cachedJWT), user: cachedUser, cached: true };
  }

  try {
    await handleUserLogin();
    return { authenticated: true, jwt: maskToken(cachedJWT), user: cachedUser, cached: false };
  } catch (err) {
    return { authenticated: false, error: err.message };
  }
}

async function handleSubmit(payload) {
  // ── MOCK: 不走真实 PingCode, 返回伪造提单结果 ──
  if (isMockMode()) {
    console.log('[TestMateX BG MOCK] 拦截提单, payload keys:', Object.keys(payload || {}).join(','));
    await new Promise(r => setTimeout(r, 600));  // 模拟网络延迟
    const mockBugId = 1000 + Math.floor(Math.random() * 9000);
    const projectKey = (await loadConfig()).projectKey;
    return {
      bugId: String(mockBugId),
      wholeIdentifier: 'S3100V1R1-' + mockBugId,
      bugUrl: tmxBase('PINGCODE') + '/mock-pingcode/bug/' + mockBugId,
      raw: { mock: true, payload_keys: Object.keys(payload || {}), _id: 'mock-' + mockBugId, identifier: String(mockBugId), whole_identifier: 'S3100V1R1-' + mockBugId, projectKey: projectKey },
    };
  }

  const status = await checkPingCodeStatus();
  if (!status.authenticated) throw new Error('PingCode 未登录: ' + (status.error || '未知'));

  const config = await loadConfig();
  const pc = new PingCodeClient(cachedJWT, config);
  const propertyValues = pc.buildPropertyValues(payload);
  const result = await pc.createWorkItem(propertyValues);

  return {
    bugId: result.identifier,
    wholeIdentifier: result.whole_identifier,
    bugUrl: 'http://10.20.24.30/pjm/projects/' + config.projectKey + '/work-items/' + result._id,
    raw: result,
  };
}

// ─── PLM 提单 (stub, prod 未实现) ────────────────────────────────────────
async function handleSubmitToPLM(payload) {
  // MOCK: 返回伪造 PLM 工单号
  if (isMockMode()) {
    console.log('[TestMateX BG MOCK PLM] 拦截 PLM 提单, payload keys:', Object.keys(payload || {}).join(','));
    await new Promise(r => setTimeout(r, 600));
    const plmId = 5000 + Math.floor(Math.random() * 9000);
    return {
      bugId: String(plmId),
      wholeIdentifier: 'PLM-' + plmId,
      bugUrl: tmxBase('PLM') + '/mock-plm/bug/' + plmId,
      raw: { mock: true, system: 'plm', payload_keys: Object.keys(payload || {}), _id: 'mock-plm-' + plmId, identifier: 'PLM-' + plmId },
    };
  }
  // PROD: stub, 真实 PLM API 待补
  throw new Error('PLM prod API 尚未实现, 请联系开发补 /api/plm/work-items 路由 (当前 PROD.PLM_BASE=' + __TESTMATEX_CONFIG.PROD.PLM_BASE + ')');
}

async function getPreviewHtml(payload) {
  // ── MOCK: 不需要真实 JWT, 直接用 mock token 渲染 ──
  const jwt = isMockMode() ? 'MOCK_JWT' : cachedJWT;
  const config = await loadConfig();
  const pc = new PingCodeClient(jwt, config);
  return pc.renderHtml(payload);
}

async function loadConfig() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.CONFIG);
  return { ...S3100_DEFAULTS, ...(stored[STORAGE_KEYS.CONFIG] || {}) };
}

function maskToken(t) {
  if (!t) return '';
  return t.substring(0, 20) + '...' + t.substring(t.length - 10);
}

// ─── PingCode Client ──────────────────────────────────────────────────────
class PingCodeClient {
  constructor(jwt, config) {
    this.jwt = jwt;
    this.config = config;
  }

  async request(endpoint, options = {}) {
    const res = await fetch(PINGCODE_BASE + endpoint, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + this.jwt,
        'Referer': 'http://10.20.24.30/pjm/projects/' + this.config.projectKey,
        ...(options.headers || {}),
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error('PingCode ' + endpoint + ' HTTP ' + res.status + ': ' + text.substring(0, 300));
    }
    const data = await res.json();
    if (data.code !== 200 && data.code !== undefined) {
      throw new Error('PingCode API ' + data.code + ': ' + (data.msg || ''));
    }
    return data;
  }

  async createWorkItem(propertyValues) {
    const result = await this.request('/api/agile/work-item', {
      method: 'POST',
      body: JSON.stringify({ property_values: propertyValues }),
    });
    return result.data.value || result.data;
  }

  buildPropertyValues(p) {
    const c = this.config;
    const propertyValues = [
      { key: 'title', value: this.buildTitle(p) },
      { key: 'description', value: this.buildDescriptionHtml(p) },
      { key: 'replay_step', value: this.wrapHtml(p.steps || 'NA') },
      { key: 'project_id', value: c.projectId },
      { key: 'type', value: c.bugTypeId },
      { key: 'type_id', value: c.bugTypeId },
      { key: 'assignee', value: p.assignee || c.defaultAssignee },
      { key: 'priority', value: p.priority || c.defaultPriority },
      { key: 'severity', value: p.severity || c.defaultSeverity },
      { key: 'shifouyonglifaxian', value: c.defaultIfFoundByTester },
      { key: 'shifoukaifaziti', value: c.defaultIfDevSelf },
      { key: 'xiangmujieduan', value: c.defaultProjectStage },
      { key: 'ceshitexing', value: c.defaultFeature },
      { key: 'wentileibie', value: c.defaultIssueCategory },
      { key: 'kaifamokuai', value: c.defaultDevModule },
      { key: 'mokuaiS3100', value: c.defaultS3100Chip },
      { key: '3100chanpinfanwei', value: c.defaultS3100ProductRange },
      { key: 'shifoubipinteshubanben', value: c.defaultBenchmarkVersion },
      { key: 'participants', value: [c.defaultAssignee] },
      { key: 'start', value: { date: this.parseDate(p.startDate), with_time: 0 } },
      { key: 'guanbishijian', value: { date: null, with_time: 0 } },
      { key: 'huiguiceshishuoming', value: this.buildHuiGuiShuoMing(p) },
    ];
    return propertyValues;
  }

  buildTitle(p) {
    const stage = p.testStage || '回片后';
    const desc = p.issueDescription || p.caseName || '执行失败';
    return '【测试】【阶段:' + stage + '】' + (p.caseId || '') + ' ' + desc;
  }

  buildDescriptionHtml(p) {
    return this.renderTemplate('description', p);
  }

  buildHuiGuiShuoMing(p) {
    const html = [
      '<p style="text-align: left;">回归测试版本:</p>',
      '<p style="text-align: left;">回归测试策略:</p>',
      '<p style="text-align: left;">回归测试步骤:</p>',
      '<p style="text-align: left;">回归测试过程日志记录:日志较多的情况可作为附件添加</p>',
    ];
    if (p.caseId) {
      html.unshift('<p style="text-align: left;">用例编号: <strong>' + this.escapeHtml(p.caseId) + '</strong></p>');
    }
    return html.join('');
  }

  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  wrapHtml(text) {
    if (!text) return '<p>-</p>';
    return '<p>' + this.escapeHtml(text) + '</p>';
  }

  parseDate(dateStr) {
    if (!dateStr) return Math.floor(Date.now() / 1000);
    const t = new Date(dateStr.replace(' ', 'T')).getTime();
    if (isNaN(t)) return Math.floor(Date.now() / 1000);
    return Math.floor(t / 1000);
  }

  renderTemplate(name, vars) {
    const escape = (s) => this.escapeHtml(s);
    const nl2p = (s) => {
      if (!s) return '<p style="text-align: left;">-</p>';
      return s.split('\n').filter(l => l.trim()).map(line =>
        '<p style="text-align: left;">' + escape(line) + '</p>'
      ).join('');
    };

    const safe = {
      caseId: escape(vars.caseId || '-'),
      issueDescription: escape(vars.issueDescription || vars.caseName || '-'),
      featureModule: escape(vars.featureModule || '-'),
      preconditions: nl2p(vars.preconditions || '1. 盘片已格式化并安装好 OS'),
      steps: nl2p(vars.steps || vars.caseName || '-'),
      expectedResult: nl2p(vars.expectedResult || '-'),
      failurePhenomenon: nl2p(vars.failurePhenomenon || vars.failanany || '-'),
      hostIp: escape(vars.hostIp || '-'),
      hostSn: escape(vars.hostSn || '-'),
      hostOs: escape(vars.hostOs || '-'),
      hostSsdTopology: escape(vars.hostSsdTopology || '-'),
      fpgaVersion: escape(vars.fpgaVersion || '-'),
      fwVersion: escape(vars.fwVersion || '-'),
      driverVersion: escape(vars.driverVersion || '-'),
      instrumentName: escape(vars.instrumentName || '-'),
      instrumentIpSn: escape(vars.instrumentIpSn || '-'),
      instrumentVersion: escape(vars.instrumentVersion || '-'),
      softwareTools: escape(vars.softwareTools || '-'),
      hwVersion: escape(vars.hwVersion || '-'),
      dutFwVersion: escape(vars.dutFwVersion || '-'),
      dutSn: escape(vars.dutSn || '-'),
      scriptInfo: escape(vars.scriptInfo || '-'),
      scriptRepo: escape(vars.scriptRepo || '-'),
      scriptModifications: escape(vars.scriptModifications || '-'),
      logUrl: vars.logUrl || '#',
      analysisTrace: nl2p(vars.analysisTrace || '-'),
      analyzer: escape(vars.analyzer || '-'),
      initialReason: escape(vars.initialReason || '-'),
      occurTime: escape(vars.occurTime || vars.startTime || '-'),
      logSerial: escape(vars.logSerial || '-'),
      logTrace: escape(vars.logTrace || '-'),
      logOs: escape(vars.logOs || '-'),
      logTool: escape(vars.logTool || '-'),
    };

    return '<p style="text-align: left;"><strong>测试用例:</strong>' + safe.caseId + '</p>' +
      '<p style="text-align: left;"><strong>问题描述:</strong>' + safe.issueDescription + '</p>' +
      '<p style="text-align: left;"><strong>1. 问题描述</strong></p>' +
      '<p style="text-align: left;"><strong>测试特性/开发模块</strong>: ' + safe.featureModule + '</p>' +
      '<p style="text-align: left;"><strong>预置条件</strong>:</p>' + safe.preconditions +
      '<p style="text-align: left;"><strong>关键操作步骤</strong>:</p>' + safe.steps +
      '<p style="text-align: left;"><strong>预期效果</strong>:</p>' + safe.expectedResult +
      '<p style="text-align: left;"><strong>测试失败现象</strong>:</p>' + safe.failurePhenomenon +
      '<p style="text-align: left;"><strong>2. 测试环境</strong></p>' +
      '<p style="text-align: left;"><strong>主机信息-IP/Host</strong>: ' + safe.hostIp + '</p>' +
      '<p style="text-align: left;"><strong>主机信息-SN</strong>: ' + safe.hostSn + '</p>' +
      '<p style="text-align: left;"><strong>主机信息-OS</strong>: ' + safe.hostOs + '</p>' +
      '<p style="text-align: left;"><strong>SSD 数量及连接方式</strong>: ' + safe.hostSsdTopology + '</p>' +
      '<p style="text-align: left;"><strong>3. 版本信息</strong></p>' +
      '<p style="text-align: left;"><strong>FPGA</strong>: ' + safe.fpgaVersion + '</p>' +
      '<p style="text-align: left;"><strong>FW</strong>: ' + safe.fwVersion + '</p>' +
      '<p style="text-align: left;"><strong>驱动</strong>: ' + safe.driverVersion + '</p>' +
      '<p style="text-align: left;"><strong>4. 测试仪器</strong></p>' +
      '<p style="text-align: left;"><strong>仪器名称</strong>: ' + safe.instrumentName + '</p>' +
      '<p style="text-align: left;"><strong>IP/SN</strong>: ' + safe.instrumentIpSn + '</p>' +
      '<p style="text-align: left;"><strong>软件版本</strong>: ' + safe.instrumentVersion + '</p>' +
      '<p style="text-align: left;"><strong>5. 软件工具</strong>: ' + safe.softwareTools + '</p>' +
      '<p style="text-align: left;"><strong>6. 被测设备(盘片)信息</strong></p>' +
      '<p style="text-align: left;"><strong>硬件版本</strong>: ' + safe.hwVersion + '</p>' +
      '<p style="text-align: left;"><strong>固件版本</strong>: ' + safe.dutFwVersion + '</p>' +
      '<p style="text-align: left;"><strong>SN</strong>: ' + safe.dutSn + '</p>' +
      '<p style="text-align: left;"><strong>7. 测试用例信息</strong></p>' +
      '<p style="text-align: left;"><strong>用例编号</strong>: ' + safe.caseId + '</p>' +
      '<p style="text-align: left;"><strong>脚本编号/版本</strong>: ' + safe.scriptInfo + '</p>' +
      '<p style="text-align: left;"><strong>仓库信息</strong>: ' + safe.scriptRepo + '</p>' +
      '<p style="text-align: left;"><strong>修改记录</strong>: ' + safe.scriptModifications + '</p>' +
      '<p style="text-align: left;"><strong>日志直达链接</strong>: <a href="' + safe.logUrl + '" target="_blank">点击打开 AiTest 原始日志</a></p>' +
      '<p style="text-align: left;"><strong>8. 定位履历</strong></p>' + safe.analysisTrace +
      '<p style="text-align: left;"><strong>9. 初步分析结论</strong></p>' +
      '<p style="text-align: left;"><strong>分析人</strong>: ' + safe.analyzer + '</p>' +
      '<p style="text-align: left;"><strong>初步原因</strong>: ' + safe.initialReason + '</p>' +
      '<p style="text-align: left;"><strong>问题发生时间</strong>: ' + safe.occurTime + '</p>' +
      '<p style="text-align: left;"><strong>10. 测试日志</strong></p>' +
      '<p style="text-align: left;"><strong>串口日志</strong>: ' + safe.logSerial + '</p>' +
      '<p style="text-align: left;"><strong>训练器 Trace</strong>: ' + safe.logTrace + '</p>' +
      '<p style="text-align: left;"><strong>操作系统日志</strong>: ' + safe.logOs + '</p>' +
      '<p style="text-align: left;"><strong>测试工具输出</strong>: ' + safe.logTool + '</p>' +
      '<p style="text-align: left;"><a href="' + safe.logUrl + '" target="_blank">点击下载 AiTest 日志</a></p>';
  }
}

// ─── 启动时恢复状态 ────────────────────────────────────────────────────────
(async () => {
  try {
    const stored = await chrome.storage.local.get([STORAGE_KEYS.JWT, STORAGE_KEYS.JWT_EXPIRES, STORAGE_KEYS.USER]);
    if (stored[STORAGE_KEYS.JWT]) {
      cachedJWT = stored[STORAGE_KEYS.JWT];
      jwtExpiresAt = stored[STORAGE_KEYS.JWT_EXPIRES] || 0;
      cachedUser = stored[STORAGE_KEYS.USER];
      console.log('[TestMateX BG] Restored JWT');
    }
  } catch (e) {
    console.error('[TestMateX BG] Restore failed:', e);
  }
})();

// ─── 点击图标打开 SidePanel ────────────────────────────────────────────────
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (e) {
    console.error('[TestMateX BG] sidePanel.open failed:', e);
  }
});

// 保持 SW 活跃: 每 25 秒心跳一次
setInterval(() => {
  console.log('[TestMateX BG] heartbeat', Date.now());
}, 25 * 1000);

console.log('[TestMateX BG] End of script, ready');
