// content/pingcode-bridge.js V2
// 在 PingCode 页面里跑,专门用于获取 JWT access-token
// 解决 s-{teamId} Cookie 是 httpOnly 的问题:
//   - chrome.cookies.getAll 拿不到 httpOnly 值
//   - 但 Content Script 在 PingCode 页面里 fetch,浏览器自动带完整 Cookie

(() => {
  const PINGCODE_BASE = 'http://10.20.24.30';

  // ─── ENV 读取 ───
  const __AITESTX_CONFIG = window.__AITESTX_CONFIG || {
    ENV: 'mock',
    PROD: { PINGCODE_BASE: 'http://10.20.24.30' },
    MOCK: { PINGCODE_BASE: 'http://localhost:8000' },
  };
  function isMockMode() { return __AITESTX_CONFIG.ENV === 'mock'; }

  // ─── Mock 响应 ───
  const MOCK_JWT = 'eyJhbGciOiJIUzI1NiJ9.MOCK_TOKEN_' + Date.now() + '.mock_signature';
  const MOCK_USER = {
    id: 'mock-user-id',
    name: 'mock_user',
    display_name: 'Mock 测试员',
    email: 'mock@aitestx.local',
  };

  // 监听来自 Background / SidePanel 的请求
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'GET_PINGCODE_JWT') {
      if (isMockMode()) {
        console.log('[AiTestX BRIDGE MOCK] 返回伪造 JWT');
        sendResponse({ success: true, token: MOCK_JWT });
        return true;
      }
      fetchAccessToken()
        .then(token => sendResponse({ success: true, token }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;  // 保持异步通道
    }

    if (msg.action === 'GET_PINGCODE_USER') {
      if (isMockMode()) {
        sendResponse({ success: true, user: MOCK_USER });
        return true;
      }
      fetchMe()
        .then(user => sendResponse({ success: true, user }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (msg.action === 'PING_PINGCODE_HEALTH') {
      if (isMockMode()) {
        sendResponse({ success: true, code: 200 });
        return true;
      }
      // 健康检查:fetch 一个公开/已知的 API 看是否 200
      fetch('/api/typhon/account/me', { credentials: 'include' })
        .then(r => r.json())
        .then(data => sendResponse({ success: true, code: data.code }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }
  });

  async function fetchAccessToken() {
    console.log('[AiTestX] 尝试获取 PingCode JWT...');
    const res = await fetch('/api/typhon/account/access-token', {
      credentials: 'include',
      headers: { 'Referer': window.location.href },
    });
    console.log('[AiTestX] access-token 响应:', res.status, res.statusText);
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error('PingCode 未登录或会话已过期 (HTTP ' + res.status + ')');
      }
      throw new Error('HTTP ' + res.status + ' ' + res.statusText);
    }
    const data = await res.json();
    console.log('[AiTestX] access-token 返回:', data.code, data.msg || '');
    if (data.code !== 200) {
      throw new Error('access-token API 返回 ' + data.code + ': ' + (data.msg || ''));
    }
    if (!data.data?.value) {
      throw new Error('access-token 响应中无 value 字段');
    }
    console.log('[AiTestX] JWT 获取成功');
    return data.data.value;
  }

  async function fetchMe() {
    const res = await fetch('/api/typhon/account/me', {
      credentials: 'include',
      headers: { 'Referer': window.location.href },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.code !== 200) throw new Error(`me API 返回 ${data.code}`);
    return data.data.me;
  }

  console.log('[AiTestX] PingCode bridge V2 loaded');
})();
