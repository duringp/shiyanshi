#!/bin/zsh
cd -- "${0:A:h}" || exit 1
if curl --silent --fail http://127.0.0.1:4173/ | head -c 100000 | rg -q '芯栈 Lab'; then
  print '预览已在运行：http://127.0.0.1:4173'
  exit 0
fi
print '芯栈 Lab 预览：http://127.0.0.1:4173'
print '请在浏览器中打开上面的地址。按 Ctrl+C 停止服务。'
python3 -m http.server 4173 --bind 127.0.0.1
