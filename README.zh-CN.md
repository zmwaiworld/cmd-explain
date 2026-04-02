<p align="center">
  <img src="assets/logo.png" alt="cmd-explain" width="128" />
  <h1 align="center">cmd-explain</h1>
  <p align="center">
    在你点击批准之前，看清每条 shell 命令到底在做什么。
    <br />
    <strong>AI 编程助手的 MCP 服务器 · 支持 Kiro、Cursor、VS Code、Windsurf、Claude Code</strong>
    <br /><br />
    <a href="README.md">English</a> | <a href="README.zh-CN.md">中文</a>
  </p>
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="#工作原理">工作原理</a> ·
  <a href="#支持的-ide">支持的 IDE</a> ·
  <a href="#本地-ai-可选">本地 AI</a>
</p>

---

## 问题

AI 编程助手会在你的机器上执行 shell 命令。它们会弹出一个确认对话框，但你往往看不懂：

```
Agent 想要执行：curl -sL https://raw.githubusercontent.com/some-tool/install.sh | sudo bash

  [ 批准 ]   [ 拒绝 ]
```

这安全吗？`-sL` 是什么意思？为什么要 `sudo`？大多数人要么盲目批准（危险），要么去搜索（慢，打断心流）。

## 解决方案

cmd-explain 在每条 shell 命令执行**之前**自动拦截，显示通俗易懂的解释和风险评级：

```
🔴 从 URL 下载数据（静默，跟随重定向），然后执行 Bash
   风险：高 · 来源：内置词典

Agent 想要执行：curl -sL https://raw.githubusercontent.com/some-tool/install.sh | sudo bash

  [ 批准 ]   [ 拒绝 ]
```

现在你知道了：它静默下载一个脚本，然后以 root 权限通过管道传给 bash 执行。轻松拒绝——或者至少先检查一下。

## 更多示例

AI 助手实际会建议的命令——你可能会不假思索地批准：

```
🔴 chmod -R 777 .
   修改文件权限（递归）
   风险：高 · 来源：内置词典
   → 让项目中的所有文件变为全局可写

🟡 curl -sL https://install.example.com | bash
   从 URL 下载数据（静默，跟随重定向），然后执行 Bash
   风险：高 · 来源：内置词典
   → 下载并执行远程脚本，典型的供应链攻击风险

🔴 git push origin main --force
   上传本地提交到远程（强制推送）
   风险：高 · 来源：内置词典
   → 覆盖远程历史记录，其他人的提交可能丢失

🔴 rm -rf node_modules dist .next .cache && npm ci
   删除文件或目录（递归，强制），然后从 lockfile 全新安装
   风险：高 · 来源：内置词典

🟡 npx prisma db push --accept-data-loss
   从远程 npm 包运行命令
   风险：高 · 来源：内置词典
   → --accept-data-loss 这个参数名说明了一切

🔴 kubectl exec -it prod-db-0 -- psql -c "DROP TABLE users"
   在容器中执行命令
   风险：高 · 来源：内置词典
   → 直接在生产环境 Pod 上执行 SQL
```

每条解释包含：
- **做了什么** —— 通俗的中文解释，包括参数和 shell 模式（`2>&1`、`|| true`、`>/dev/null`）
- **风险等级** —— 低（只读）、中（有状态变更）、高（破坏性）、未知
- **来源** —— `built-in`（440+ 条内置词典）、`system`（man 手册）、`ai-generated`（LLM）

## 快速开始

```bash
npx cmd-explain setup
```

就这样。自动检测你的 IDE，安装 MCP 服务器，创建命令拦截钩子。重启 IDE 即可生效。

**要求：** Node.js 18+。无需 API 密钥，无需 Ollama，无需手动编辑配置文件。


## 工作原理

cmd-explain 是一个 [MCP 服务器](https://modelcontextprotocol.io/)，只提供一个工具：`explain_command`。当你的 AI 助手即将执行 shell 命令时，预命令钩子会自动调用这个工具。

解释来自三个层级，按顺序检查：

| 层级 | 来源 | 速度 | 覆盖率 | 需要配置？ |
|------|------|------|--------|-----------|
| 1 | **内置词典** —— 240+ 个程序，440+ 条命令解释（git、docker、npm、kubectl、terraform、aws、brew、cargo 等） | <1ms | ~90% 的 AI 助手命令 | 否 |
| 2 | **系统 man 手册** —— 解析 `whatis` 输出，覆盖所有已安装的 CLI 工具 | ~50ms | 大部分已安装工具 | 否 |
| 3 | **本地 AI** —— Ollama、OpenAI 或 Anthropic，处理前两层未覆盖的命令 | ~1s | 全部 | 可选 |

第 1、2 层完全离线，零依赖。第 3 层为可选配置。

### Shell 模式检测

cmd-explain 能识别 AI 助手常用的 shell 语法：

| 模式 | 标注 |
|------|------|
| `2>&1` | 将 stderr 重定向到 stdout |
| `>/dev/null 2>&1` | 抑制所有输出 |
| `2>/dev/null` | 抑制错误输出 |
| `\|\| true` | 忽略退出码 |
| `set -e` | 遇错即退 |
| `set -x` | 执行前打印命令 |
| `set -o pipefail` | 管道中任一段失败则整体失败 |
| `$(...)` | 命令替换 |

### 风险分类

| 等级 | 含义 | 示例 |
|------|------|------|
| 🟢 低 | 只读，无副作用 | `ls`、`cat`、`grep`、`git status`、`curl GET` |
| 🟡 中 | 有状态变更但可恢复 | `git commit`、`npm install`、`mkdir`、`docker build` |
| 🔴 高 | 破坏性或不可逆 | `rm -rf`、`docker rm -f`、`terraform destroy`、`find -delete` |
| ⚪ 未知 | 无法识别 | 自定义/私有 CLI 工具 |

## 支持的 IDE

一条命令搞定所有配置，每个 IDE 自动获得正确的钩子格式。

| IDE | 钩子事件 | Shell 命令覆盖 |
|-----|---------|---------------|
| **Kiro** | `preToolUse` | ✅ 所有 shell 命令 |
| **VS Code Copilot** | `PreToolUse` | ✅ 所有 shell 命令 |
| **Cursor** | `beforeShellExecution` | ✅ 专用 shell 钩子 |
| **Windsurf** | `pre_run_command` | ✅ 专用 shell 钩子 |
| **Claude Code** | `PreToolUse` | ✅ 通过 matcher |

```bash
npx cmd-explain setup              # 自动检测所有 IDE
npx cmd-explain setup --ide kiro   # 指定单个 IDE
npx cmd-explain setup --no-hooks   # 仅安装 MCP 服务器
```

## 本地 AI（可选）

对于词典和 man 手册未覆盖的命令，可以启用 Ollama 本地 AI 解释（约 1GB 一次性下载）：

```bash
brew install ollama
brew services start ollama
ollama pull qwen2.5-coder:1.5b
npx cmd-explain setup --ollama qwen2.5-coder:1.5b
```

setup 命令会验证每一步——如果 Ollama 未安装或模型未下载，会告诉你具体该执行什么命令。

也支持云端 API：

```bash
npx cmd-explain setup --openai-key sk-...
```

支持的提供商：Ollama、OpenAI（`OPENAI_API_KEY`）、Anthropic（`ANTHROPIC_API_KEY`）。

## 手动安装

在你的 IDE MCP 配置中添加：

```json
{
  "mcpServers": {
    "cmd-explain": {
      "command": "npx",
      "args": ["-y", "cmd-explain"]
    }
  }
}
```

配置文件位置：
- **Kiro：** `.kiro/settings/mcp.json`
- **VS Code：** `.vscode/mcp.json`
- **Cursor：** `.cursor/mcp.json`
- **Windsurf：** `~/.codeium/windsurf/mcp_config.json`
- **Claude Code：** `~/.claude/settings.json`

## 卸载

```bash
npx cmd-explain uninstall
```

从所有检测到的 IDE 中移除 MCP 配置和钩子文件。干净卸载，不留残余。

## 平台支持

| | macOS | Linux | Windows |
|-|-------|-------|---------|
| 词典（第 1 层） | ✅ | ✅ | ✅ |
| Man 手册（第 2 层） | ✅ | ✅ | ⚠️ 仅 `--help` |
| 本地 AI（第 3 层） | ✅ | ✅ | ✅ |
| Setup CLI | ✅ | ✅ | ✅ |

## 许可证

MIT
