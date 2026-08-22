# AiTestX - 自动化分析提单助手

> Chrome MV3 浏览器插件。一键从 AiTest 自动化测试 (`http://10.20.65.23:3000`) 抓取失败用例, 渲染到侧边栏表单, 一键提单到 PingCode / PLM 问题单系统。

## 核心特性

- **失败用例一键抓取**: 注入浮动按钮到 AiTest 任务详情页, 点击后从 DOM 抓取失败用例列表 + 上下文 (用例编号 / 失败现象 / IP / SN / 时间 等)
- **侧边栏提单表单**: 11 大模块 (问题描述 / 测试环境 / 版本信息 / 测试仪器 / 软件工具 / 被测设备 / 测试用例信息 / 定位履历 / 初步分析 / 测试日志 / 其他), 全部可编辑
- **三步走提交流程 + modal 二次确认**: 列表 → 编辑 → 预览 → modal 二次确认 → 成功, 避免误提交
- **多系统支持**: PingCode / PLM / PingCode + PLM (PLM prod API 待接入)
- **本地 Mock 靶场**: 无内网 / 无 PingCode 权限时, 全部走 localhost:8000 静态靶场, 真实 DOM 抓取逻辑不破坏
- **ENV 一键切换**: `js/config.js` 一行切换 mock / prod, UI / 业务代码零分支污染

## 架构

```
┌──────────────────────────────────────────────────────────────────────┐
│                          视图层 (View Layer)                          │
│  sidepanel.html / sidepanel.js  (只负责渲染表单 / 展示数据 / 点击)     │
└───────────────────┬──────────────────────────────────┬───────────────┘
                    │                                  │
        ┌───────────▼──────────┐         ┌─────────────▼────────────┐
        │  AiTest 适配器         │         │  PingCode / PLM 适配器     │
        │  (ai-test-extractor)   │         │  (sw.js: handleSubmit)     │
        └───────────┬──────────┘         └─────────────┬────────────┘
                    │                                  │
              ┌─────▼────── ENV 路由              ┌───▼────── ENV 路由
        ┌─────▼─────┐                         ┌───▼─────┐
        │ Mock DOM   │                         │ Mock    │
        │ (静态页面) │                         │ Promise │
        └────────────┘                         └─────────┘
```

- `js/config.js` 注入 `window.__AITESTX_CONFIG.ENV`
- content_script / SW 各自判断 `TMX.isMock()`, 路由到 mock 或真实路径
- mock 数据保持真实抓取逻辑的执行路径, 不破坏业务代码

## 目录结构

```
AiTestX/
├── manifest.json            # MV3 清单 (name / permissions / content_scripts / side_panel)
├── js/
│   └── config.js            # ENV 全局开关 + TMX 工具
├── background/
│   └── sw.js                # Service Worker: handleSubmit (PingCode) / handleSubmitToPLM / force-inject
├── content/
│   ├── ai-test-extractor.js # AiTest 页面注入浮动按钮 + DOM 抓取 + content API
│   ├── ai-test.css          # 浮动按钮样式
│   └── pingcode-bridge.js   # PingCode 页面: JWT 鉴权桥接
├── sidepanel/
│   ├── sidepanel.html       # 4 个 page: list / edit / preview / success + modal
│   ├── sidepanel.js         # 业务逻辑: 渲染 / 页面切换 / 提交流程
│   └── sidepanel.css        # 样式
├── icons/                   # 16 / 48 / 128 px
├── mock-server/             # 本地静态靶场 (无内网开发用)
│   ├── serve.py             # 启动器 (含 URL rewrite)
│   ├── index.html           # 首页 + 导航
│   ├── library.html         # 项目 / 任务列表
│   ├── taskDetail.html      # 任务详情 (主流程)
│   ├── pingcode.html        # 伪 PingCode 已登录页
│   ├── mock-plm.html        # 伪 PLM 已登录页
│   └── static/              # mock 日志 + css
└── .gitignore
```

## 安装与加载

### 1. 加载插件

打开 `chrome://extensions/` → 打开"开发者模式" → "加载已解压的扩展程序" → 选择本目录。

### 2. 配置 ENV

`js/config.js` 第 11 行:

```js
ENV: 'mock',   // 'mock' = 本地靶场; 'prod' = 真实内网
```

修改后, 在 `chrome://extensions/` 页面点本插件的刷新按钮。

### 3. 启动 Mock 靶场 (mock 模式)

```bash
cd mock-server
python3 serve.py 8000
```

(也可用 `python3 -m http.server 8000`, 但没有 URL rewrite, 深层 URL 会 404)

打开 `http://localhost:8000/Dml/AiTest/index/automationManage-taskDetail?taskId=9999` 看 AiTest 任务详情页 (mock 数据)。

## 提交流程

```
1. AiTest 任务详情页 → 点击右下角浮动按钮 🚀
   → content script 抓取失败用例 → 打开 sidePanel

2. sidePanel 列表页 → 选 1 个用例 → [分析与提单 (1)]
   → switchPage('page-edit')

3. 编辑页 → 填字段 → [下一步: 确认提单 (1)]
   → renderPreview() + switchPage('page-preview')

4. 预览页 (11 sections + AI 摘要 + 系统 pill) → [确认提交]
   → confirmBeforeSubmit() → showConfirmModal()

5. modal 最后确认 (系统 pill + 5 关键字段 + ⚠ 警告)
   → [取消] / [×] / ESC → 留在预览页
   → [确认提交] → doActualSubmit()
     → hideConfirmModal()
     → chrome.runtime.sendMessage(SUBMIT_TO_PINGCODE / PLM)

6. 成功页 → 工单号 + [在 PingCode 中打开]
   → [再提一单] → 清选中 → 回列表页
```

## ENV 路由细节

| 模块 | mock 行为 | prod 行为 |
|---|---|---|
| `ai-test-extractor` 抓取 | 返回静态 mock 任务 (`MOCK-TASK-9999`) | 真实 DOM 抓取 (`#task-id` / `.dut-sn` / `tr.ant-table-row`) |
| `ai-test-extractor` 浮动按钮 | 注入并可点击 | 注入并可点击 |
| `pingcode-bridge` 鉴权 | 返回 mock JWT (短路) | 真实 `fetch('/api/typhon/account/access-token')` |
| `sw.js` `handleSubmit` | 模拟 800ms 延迟 + 返回 `BUG-MOCK-1024` | 真实 fetch 到 PingCode (`http://10.20.24.30/api/work-items`) |
| `sw.js` `handleSubmitToPLM` | 模拟 + 返回 `PLM-XXXX` | 抛 "未实现" 错误 (待接入真实 API) |

mock 模式默认; prod 模式需自行填 PLM API 真实地址 (在 `background/sw.js` `handleSubmitToPLM` 函数内)。

## 开发指南

### 加新提单字段

1. `sidepanel.html` `page-edit` 加 `<input id="edit-<field>">`
2. `sidepanel/sidepanel.js` `FORM_FIELDS` 加映射
3. `getFormData()` 加读取逻辑
4. `renderPreview()` `sections` 数组加渲染项

### 切换 ENV

- **本地无内网开发**: `js/config.js` 改 `ENV: 'mock'`, 跑 mock-server, 用 localhost:8000 测试
- **真实内网调试**: `js/config.js` 改 `ENV: 'prod'`, 改 `PROD` 段地址到目标环境, 刷新插件

### 自愈 force-inject

`sendMessage` 失败时 (通常因为 content script 未注入或被禁用), SW 自动 `chrome.scripting.executeScript` 强制注入 `config.js` + `ai-test-extractor.js`, 然后重试。控制台会看到 `[AiTestX] content script 未注入, 强制注入并重试`。

## 调试

`js/config.js` 顶部 `DEBUG: true` 控制台打印 ENV / AITEST_BASE / PINGCODE_BASE。

```js
// 任意位置查看状态
window.__AITESTX_CONFIG
window.TMX.isMock()
```

Service Worker 调试: `chrome://extensions/` → 本插件 → "Service Worker" 链接。

## License

Internal tool, not for public distribution.
