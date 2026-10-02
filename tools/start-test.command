#!/bin/zsh
# Double-click on macOS, or run: zsh tools/start-test.command
cd -- "${0:A:h}/.." || exit 1
if command -v node >/dev/null 2>&1; then
  exec node tools/test-server.cjs
fi
# Reuse Codex's bundled Node when this machine has no system Node installation.
test_node="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
if [[ -x "$test_node" ]]; then
  exec "$test_node" tools/test-server.cjs
fi
print 'Node.js が見つかりません。Node.js を利用できる環境で node tools/test-server.cjs を実行してください。'
exit 1
