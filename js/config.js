// js/config.js V1
// AiTestX 全局环境配置
// 设计: IIFE + window 全局变量, 避开 MV3 content_script / classic SW 对 ES module 的兼容性陷阱
// 优先级: 已注入的 __AITESTX_CONFIG > 本文件默认配置

(function (root) {
  'use strict';

  // 默认配置 - mock 环境
  const DEFAULT_CONFIG = {
    // 'mock' - 本地开发 (无内网依赖, 全部走 mock-server)
    // 'prod' - 生产环境 (走真实 AiTest / PingCode)
    ENV: 'mock',

    // 生产环境地址
    PROD: {
      AITEST_BASE: 'http://10.20.65.23:3000',
      PINGCODE_BASE: 'http://10.20.24.30',
    },

    // Mock 靶场地址 (配合 mock-server/ 静态服务)
    MOCK: {
      AITEST_BASE: 'http://localhost:8000',
      PINGCODE_BASE: 'http://localhost:8000',
    },

    // 调试: 打印详细日志
    DEBUG: true,
  };

  // 保护: 若已有配置 (例如 sidepanel 二次打开), 不覆盖
  root.__AITESTX_CONFIG = root.__AITESTX_CONFIG || DEFAULT_CONFIG;

  // 便捷访问器
  root.TMX = root.TMX || {};
  root.TMX.isMock = function () { return root.__AITESTX_CONFIG.ENV === 'mock'; };
  root.TMX.isProd = function () { return root.__AITESTX_CONFIG.ENV === 'prod'; };
  root.TMX.base = function (kind) {
    const cfg = root.__AITESTX_CONFIG;
    return cfg.ENV === 'mock' ? cfg.MOCK[kind + '_BASE'] : cfg.PROD[kind + '_BASE'];
  };

  console.log('[AiTestX CFG] ENV=' + root.__AITESTX_CONFIG.ENV +
    ' AITEST=' + root.TMX.base('AITEST') +
    ' PINGCODE=' + root.TMX.base('PINGCODE'));
})(typeof window !== 'undefined' ? window : self);
