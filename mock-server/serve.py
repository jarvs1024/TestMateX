#!/usr/bin/env python3
"""
mock-server 启动器 — 在 python -m http.server 基础上加 URL rewrite。
让深层 URL (如 /Dml/AiTest/index/automationManage-library) 映射到 ./library.html

使用: python3 serve.py [port]
默认端口 8000
"""

import sys
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
ROOT = os.path.dirname(os.path.abspath(__file__))


# URL → 文件路径 映射
PATH_REWRITES = {
    '/Dml/AiTest/index/automationManage-library': 'library.html',
    '/Dml/AiTest/index/automationManage-task': 'taskDetail.html',
    '/Dml/AiTest/index/automationManage-taskDetail': 'taskDetail.html',
    '/pingcode.html': 'pingcode.html',
    '/mock-plm.html': 'mock-plm.html',
    '/': 'index.html',
}

# 前缀匹配 (任何 /mock-plm/bug/<id> 都指向 mock-plm.html, 页面 JS 从 URL 提取 id)
PATH_PREFIX_REWRITES = [
    ('/mock-plm/bug/', 'mock-plm.html'),
]


class MockHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # 1. 先查精确 rewrite 表
        if path in PATH_REWRITES:
            target = PATH_REWRITES[path]
            self.path = '/' + target
            if parsed.query:
                self.path += '?' + parsed.query
            return super().do_GET()

        # 2. 再查 prefix rewrite 表 (按声明顺序, 首个匹配胜出)
        for prefix, target in PATH_PREFIX_REWRITES:
            if path.startswith(prefix):
                self.path = '/' + target
                if parsed.query:
                    self.path += '?' + parsed.query
                return super().do_GET()

        # 2. 否则走默认静态服务
        return super().do_GET()

    def log_message(self, fmt, *args):
        # 自定义日志格式
        sys.stderr.write("[mock] %s - %s\n" % (self.address_string(), fmt % args))


if __name__ == '__main__':
    os.chdir(ROOT)
    server = ThreadingHTTPServer(('127.0.0.1', PORT), MockHandler)
    print(f"[mock] serving {ROOT} at http://localhost:{PORT}")
    print(f"[mock] entry: http://localhost:{PORT}/")
    print(f"[mock] taskDetail: http://localhost:{PORT}/Dml/AiTest/index/automationManage-taskDetail?taskId=9999")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[mock] stopped")
