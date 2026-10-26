#!/bin/zsh
cd -- "${0:A:h}" || exit 1
if curl --silent --fail --max-time 2 http://127.0.0.1:4173/api/health >/dev/null; then
  print '预览已在运行：http://127.0.0.1:4173'
  exit 0
fi
print '芯栈 Lab 预览：http://127.0.0.1:4173'
print '请在浏览器中打开上面的地址。按 Ctrl+C 停止服务。'
if ! command -v node >/dev/null; then
  print '请先安装 Node.js 24.13 或更新版本。'
  exit 1
fi
if [[ ! -f data/lab.sqlite && ! -f .env ]]; then
  npm run init-admin || exit 1
fi
npm start
