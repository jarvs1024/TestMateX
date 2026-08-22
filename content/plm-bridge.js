// content/plm-bridge.js V1
// 在 PLM 页面里跑, 代理 SW 调 transferCommonRest
// 解决 CORS: 跨域请求被拒, 但 PLM 页面 fetch 浏览器自动带全部 cookie (含 httpOnly)
// 镜像 pingcode-bridge.js 的结构

(() => {
  'use strict';

  const PLM_BASE = 'https://plm.twsc.com.cn';

  // ─── ENV 读取 ───
  // Fallback: 与 js/config.js DEFAULT_CONFIG 保持一致
  // 即使 config.js 没注入成功, PingCode/PLM 也默认走 prod, 不会误走 mock
  const __AITESTX_CONFIG = window.__AITESTX_CONFIG || {
    AiTest:   'mock',
    PingCode: 'prod',
    PLM:      'prod',
    ENV: 'mock',
    PROD: { PLM_BASE: 'https://plm.twsc.com.cn' },
    MOCK: { PLM_BASE: 'http://localhost:8000' },
  };
  function isMockMode(system) {
    const cfg = __AITESTX_CONFIG;
    const sys = { AITEST: 'AiTest', PINGCODE: 'PingCode', PLM: 'PLM' }[system] || system;
    if (sys && typeof cfg[sys] === 'string') return cfg[sys] === 'mock';
    // per-system 字段缺失 → 默认 prod (mock 是主动选择, 不该是默认)
    return false;
  }

  // ─── Cookie 工具 ───
  function readCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  // XSRF-TOKEN cookie 形如 "MDF_XXX!<random>", header 只需要前半段
  function getXsrfToken() {
    const c = readCookie('XSRF-TOKEN');
    if (!c) return '';
    const bangIdx = c.indexOf('!');
    return bangIdx > 0 ? c.substring(0, bangIdx) : c;
  }

  // ─── Mock 响应 (开发模式) ───
  const MOCK_USER = {
    id: 'mock-plm-user-id',
    name: 'mock_plm_user',
    display_name: 'Mock PLM 用户',
  };

  function mockSubmitResult() {
    return {
      code: 200,
      message: '操作成功',
      data: {
        code: 'WSD-MOCK-' + Date.now().toString().slice(-6),
        id: 'mock-' + Math.random().toString(36).slice(2, 14),
      },
    };
  }

  // ─── 消息监听 ───
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    console.log('[AiTestX PLM BRIDGE] message:', msg.action);

    switch (msg.action) {
      case 'GET_PLM_USER':
        handleGetUser()
          .then(user => sendResponse({ success: true, user }))
          .catch(err => sendResponse({ success: false, error: err.message }));
        return true;  // 保持异步通道

      case 'SUBMIT_TO_PLM_HTTP':
        handleSubmit(msg.payload)
          .then(result => sendResponse({ success: true, ...result }))
          .catch(err => sendResponse({ success: false, error: err.message }));
        return true;

      case 'PING_PLM_HEALTH':
        handleHealth()
          .then(code => sendResponse({ success: true, code }))
          .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }
  });

  // ─── 处理函数 ───

  async function handleGetUser() {
    if (isMockMode("PLM")) {
      console.log('[AiTestX PLM BRIDGE MOCK] 返回 mock 用户');
      return MOCK_USER;
    }

    const tenantid = readCookie('tenantid');

    // 1. 优先: PLM 首页注入的 window.getUserInfo() (HTML 内联脚本, 见 plm 首页源码)
    //    返回 {userName, userId, userEmail, userCode, ...}
    //    首页冷启动时内联脚本可能晚于 bridge 注入, 重试 3 次 (~1.5s) 等它就绪
    let info = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        if (typeof window.getUserInfo === 'function') {
          const r = window.getUserInfo();
          if (r && r.userName) { info = r; break; }
          console.warn('[AiTestX PLM] window.getUserInfo 已定义但无 userName (尝试 ' + attempt + '/3), page=' + location.pathname);
        } else {
          console.warn('[AiTestX PLM] window.getUserInfo 未定义 (尝试 ' + attempt + '/3), page=' + location.pathname);
        }
      } catch (e) {
        console.warn('[AiTestX PLM] window.getUserInfo 调用失败 (尝试 ' + attempt + '/3):', e && e.message);
      }
      await new Promise(function (r) { setTimeout(r, 500); });
    }

    if (info) {
      console.log('[AiTestX PLM] window.getUserInfo() → ' + info.userName);
      return {
        id: info.userId || null,
        name: info.userName,
        display_name: info.userName,
        email: info.userEmail || null,
        code: info.userCode || null,
        tenantid: tenantid,
      };
    }

    console.warn('[AiTestX PLM] window.getUserInfo 3 次重试后仍不可用, 走 fallback');

    // 2. Fallback: cookie 抽 UUID (at 是 HttpOnly 读不到, 只能兜底)
    const at = readCookie('at');
    const userToken = readCookie('yht_usertoken_diwork') || '';
    const usernameTicket = readCookie('yht_username_diwork') || '';
    // yht_username_diwork 格式: ST-...-online__<UUID>
    const uuidRe = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
    const m1 = usernameTicket.match(uuidRe);
    const m2 = userToken.match(uuidRe);
    const userId = (m1 && m1[1]) || (m2 && m2[1]) || at || 'plm-unknown-user';

    // 3. Fallback: DOM 抓 display_name
    let displayName = null;
    try {
      const candidates = [
        // 首页"消息中心" widget (CSS module 去掉 hash 后)
        document.querySelector('[class*="messageCenterWrapper"] [class*="userName"]'),
        // 顶栏头像首字符 (任意 PLM 页面都有, 仅首字)
        document.querySelector('[class*="avator--"] span'),
        // 旧的兜底选择器 (兼容其他系统)
        document.querySelector('.user-info .user-name'),
        document.querySelector('.user-name'),
        document.querySelector('[data-user-name]'),
        document.querySelector('.topbar-user .name'),
        document.querySelector('.userinfo-name'),
        document.querySelector('.login-user-name'),
        document.querySelector('#userName'),
      ];
      for (const el of candidates) {
        if (el) {
          const t = ((el.dataset && el.dataset.userName) || el.textContent || el.value || '').trim();
          if (t && t.length > 0 && t.length < 50) {
            displayName = t;
            break;
          }
        }
      }
    } catch (e) {
      console.warn('[AiTestX PLM] DOM 抓 username 失败:', e);
    }

    return {
      id: userId,
      name: userId,
      display_name: displayName || ('PLM 已连接 ·' + (userId.slice(0, 8))),
      tenantid: tenantid,
    };
  }

  async function handleHealth() {
    if (isMockMode("PLM")) return 200;
    // 调 transferCommonRest (GET) 看登录态
    const res = await fetch(PLM_BASE + '/yonbip-mm-plmrd/bill/transferCommonRest?serviceCode=plm_base_question_manage&terminalType=1&sbillno=baseQuestionList&locale=zh_CN', {
      method: 'GET',
      credentials: 'include',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error('PLM 未登录或会话过期 (HTTP ' + res.status + ')');
      }
      throw new Error('PLM 健康检查 HTTP ' + res.status);
    }
    const data = await res.json();
    if (data.code === 401 || data.code === 403) {
      throw new Error('PLM 未登录 (' + data.code + ')');
    }
    return data.code || 200;
  }

  async function handleSubmit(payload) {
    if (isMockMode("PLM")) {
      console.log('[AiTestX PLM BRIDGE MOCK] mock 提交, payload keys:', Object.keys(payload || {}).join(','));
      return mockSubmitResult();
    }

    const orgId = readCookie('orgId') || '';
    const xsrf = getXsrfToken();

    const url = PLM_BASE + '/yonbip-mm-plmrd/bill/save'
      + '?cmdname=cmdSave'
      + '&businessActName=' + encodeURIComponent('问题管理-保存')
      + '&terminalType=1'
      + '&serviceCode=plm_base_question_manage'
      + '&sbillno=baseQuestionList'
      + (orgId ? '&orgId=' + encodeURIComponent(orgId) : '');

    const headers = {
      'Content-Type': 'application/json;charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
    };
    if (xsrf) headers['X-Csrf-Token'] = xsrf;

    console.log('[AiTestX PLM] POST save url:', url);

    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error('PLM HTTP ' + res.status + ': ' + text.substring(0, 300));
    }

    const data = await res.json();
    if (data.code !== 200) {
      throw new Error('PLM API ' + data.code + ': ' + (data.message || data.msg || '未知错误'));
    }
    if (!data.data) {
      throw new Error('PLM 响应无 data 字段');
    }

    return {
      code: data.code,
      message: data.message,
      data: data.data,
      traceId: data.traceId,
    };
  }

  console.log('[AiTestX] PLM bridge loaded, isMock=' + isMockMode("PLM"));
})();
