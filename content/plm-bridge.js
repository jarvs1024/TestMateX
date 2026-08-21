// content/plm-bridge.js V1
// 在 PLM 页面里跑, 代理 SW 调 transferCommonRest
// 解决 CORS: 跨域请求被拒, 但 PLM 页面 fetch 浏览器自动带全部 cookie (含 httpOnly)
// 镜像 pingcode-bridge.js 的结构

(() => {
  'use strict';

  const PLM_BASE = 'https://plm.twsc.com.cn';

  // ─── ENV 读取 ───
  const __TESTMATEX_CONFIG = window.__TESTMATEX_CONFIG || {
    ENV: 'mock',
    PROD: { PLM_BASE: 'https://plm.twsc.com.cn' },
    MOCK: { PLM_BASE: 'http://localhost:8000' },
  };
  function isMockMode() { return __TESTMATEX_CONFIG.ENV === 'mock'; }

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
    console.log('[TestMateX PLM BRIDGE] message:', msg.action);

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
    if (isMockMode()) {
      console.log('[TestMateX PLM BRIDGE MOCK] 返回 mock 用户');
      return MOCK_USER;
    }

    // 优先从 cookie 解析 userId / tenantId
    const at = readCookie('at');
    const tenantid = readCookie('tenantid');
    const userToken = readCookie('yht_usertoken_diwork') || '';
    // 从 yht_usertoken_diwork 抽 UUID (用友 ST-xxx-...-<uuid>-online)
    const uuidMatch = userToken.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    const userId = uuidMatch ? uuidMatch[1] : (at || 'plm-unknown-user');

    // 尝试从 PLM 页面 DOM 抓 display_name (右上角用户信息)
    let displayName = null;
    try {
      const candidates = [
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
          const t = (el.dataset.userName || el.textContent || el.value || '').trim();
          if (t && t.length > 0 && t.length < 50) {
            displayName = t;
            break;
          }
        }
      }
    } catch (e) {
      console.warn('[TestMateX PLM] DOM 抓 username 失败:', e);
    }

    return {
      id: userId,
      name: userId,
      display_name: displayName || ('PLM 用户 (' + (userId.slice(0, 8)) + ')'),
      tenantid: tenantid,
    };
  }

  async function handleHealth() {
    if (isMockMode()) return 200;
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
    if (isMockMode()) {
      console.log('[TestMateX PLM BRIDGE MOCK] mock 提交, payload keys:', Object.keys(payload || {}).join(','));
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

    console.log('[TestMateX PLM] POST save url:', url);

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

  console.log('[TestMateX] PLM bridge loaded, isMock=' + isMockMode());
})();