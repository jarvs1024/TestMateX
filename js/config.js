// js/config.js V1
// AiTestX 全局环境配置
// 设计: IIFE + window 全局变量, 避开 MV3 content_script / classic SW 对 ES module 的兼容性陷阱
// 优先级: 已注入的 __AITESTX_CONFIG > 本文件默认配置

(function (root) {
  'use strict';

  // 默认配置 - 每个系统独立 mock/prod 开关
  const DEFAULT_CONFIG = {
    // ─── 系统级开关 (per-system, 推荐用这个) ───
    // 'mock' - 本地开发 (无内网依赖, 走 mock-server)
    // 'prod' - 生产环境 (走真实 AiTest / PingCode / PLM)
    AiTest:   'mock',
    PingCode: 'prod',
    PLM:      'prod',

    // ─── 老字段 ENV ───
    // 当某系统字段未配置时 (undefined), 退回到这里
    ENV: 'mock',

    // ─── Base URL 配置 ───
    PROD: {
      AITEST_BASE:   'http://10.20.65.23:3000',
      PINGCODE_BASE: 'http://10.20.24.30',
      PLM_BASE:      'https://plm.twsc.com.cn',
    },
    MOCK: {
      AITEST_BASE:   'http://localhost:8000',
      PINGCODE_BASE: 'http://localhost:8000',
      PLM_BASE:      'http://localhost:8000',
    },

    // 调试: 打印详细日志
    DEBUG: true,
  };

  // 保护: 若已有配置 (例如 sidepanel 二次打开), 不覆盖
  root.__AITESTX_CONFIG = root.__AITESTX_CONFIG || DEFAULT_CONFIG;

  // 系统名 → base_key 映射 (兼容老用法 atxBase('PINGCODE'))
  const SYSTEM_TO_BASE_KEY = {
    AiTest: 'AITEST_BASE', PingCode: 'PINGCODE_BASE', PLM: 'PLM_BASE',
    AITEST: 'AITEST_BASE', PINGCODE: 'PINGCODE_BASE', 'AITEST_BASE': 'AITEST_BASE',
    'PINGCODE_BASE': 'PINGCODE_BASE', 'PLM_BASE': 'PLM_BASE',
  };
  const LEGACY_TO_SYSTEM = { AITEST: 'AiTest', PINGCODE: 'PingCode', PLM: 'PLM' };

  function _resolveSystem(system) {
    if (!system) return null;
    return LEGACY_TO_SYSTEM[system] || system;
  }

  // 便捷访问器: per-system mock 判定
  function isMockMode(system) {
    const cfg = root.__AITESTX_CONFIG;
    const sys = _resolveSystem(system);
    if (sys && cfg[sys] !== undefined) return cfg[sys] === 'mock';
    return cfg.ENV === 'mock';
  }
  function isProdMode(system) {
    const cfg = root.__AITESTX_CONFIG;
    const sys = _resolveSystem(system);
    if (sys && cfg[sys] !== undefined) return cfg[sys] === 'prod';
    return cfg.ENV === 'prod';
  }
  function atxBase(system) {
    const cfg = root.__AITESTX_CONFIG;
    const baseKey = SYSTEM_TO_BASE_KEY[system] || (system + '_BASE');
    const sys = _resolveSystem(system);
    return isMockMode(sys) ? cfg.MOCK[baseKey] : cfg.PROD[baseKey];
  }

  root.TMX = root.TMX || {};
  root.TMX.isMock = isMockMode;
  root.TMX.isProd = isProdMode;
  root.TMX.base = atxBase;

  console.log('[AiTestX CFG] AiTest=' + root.__AITESTX_CONFIG.AiTest +
    ' PingCode=' + root.__AITESTX_CONFIG.PingCode +
    ' PLM=' + root.__AITESTX_CONFIG.PLM +
    ' (AITEST_BASE=' + atxBase('AiTest') + ' PINGCODE_BASE=' + atxBase('PingCode') + ' PLM_BASE=' + atxBase('PLM') + ')');
})(typeof window !== 'undefined' ? window : self);
