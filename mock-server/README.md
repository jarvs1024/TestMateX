# Mock Server - 本地靶场

> 用于在无内网 / 无 PingCode 权限时, 本地开发 / 测试 AiTestX 浏览器插件。

## 启动

```bash
cd /Users/jarvs/AiTestX/mock-server
python3 -m http.server 8000
```

## 入口

| URL | 用途 | 关键 DOM 钩子 |
|---|---|---|
| `http://localhost:8000/` | 首页 + 导航 | — |
| `http://localhost:8000/Dml/AiTest/index/automationManage-library` | 项目 / 任务列表 | `tr.ant-table-row` + `a[href*="automationManage-task"]` |
| `http://localhost:8000/Dml/AiTest/index/automationManage-taskDetail?taskId=9999` | 任务详情 (主流程) | `#task-id` + `.dut-sn` + `.ant-breadcrumb-link` |
| `http://localhost:8000/pingcode.html` | 伪 PingCode 已登录页 | `fetch('/api/typhon/account/access-token')` 返回 mock JWT |
| `http://localhost:8000/static/logs/serial-88001201.log` | 串口日志 | 直接静态文件 |
| `http://localhost:8000/static/logs/trace-88001201.log` | 训练器 Trace | 直接静态文件 |
| `http://localhost:8000/static/logs/os-88001201.log` | OS 日志 | 直接静态文件 |

## ENV 切换

`/Users/jarvs/AiTestX/js/config.js` 第 11 行:

```js
ENV: 'mock',   // 'mock' = 走 mock 数据; 'prod' = 走真实抓取 / fetch
```

- **mock**: 所有数据由 `content/ai-test-extractor.js` 的 `mockAiTestApi` / `mockExtractFailureCase` 返回
- **prod**: 走真实 DOM 抓取 + 真实 fetch (但因为是本地静态页, 会失败 — 仅用于 DOM 抓取流程验证)

## 端到端演示流程

1. `python3 -m http.server 8000` (在 `mock-server/` 目录)
2. 浏览器打开 `http://localhost:8000/Dml/AiTest/index/automationManage-taskDetail?taskId=9999`
3. 点击右下角浮动按钮 🚀 自动化分析与提单
4. 侧边栏弹出, 选中失败用例 → 点击 [提交到 PingCode]
5. Toast 显示 `🧪 S3100V1R1-NNNN` 伪工单号 + 跳转链接到 `http://localhost:8000/mock-pingcode/bug/NNNN`

## 文件清单

```
mock-server/
├── index.html                    # 入口 + 导航
├── library.html                  # 项目 / 任务列表
├── taskDetail.html               # 任务详情 (主入口)
├── pingcode.html                 # 伪 PingCode 已登录
├── README.md
└── static/
    ├── css/mock.css              # 模拟 Ant Design 样式
    └── logs/
        ├── serial-88001201.log
        ├── trace-88001201.log
        └── os-88001201.log
```
