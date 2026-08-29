# OpenCode Float

OpenCode 常驻服务（`http://127.0.0.1:8080/api`）的桌宠式悬浮对话窗：选模型、打字、发图、看回复，仅此而已。完整历史与工具调用请回 OpenCode 桌面端。

![平台](https://img.shields.io/badge/platform-macOS%20(arm64)-blue) ![框架](https://img.shields.io/badge/framework-Electron%2038-9feaf9) ![协议](https://img.shields.io/badge/license-MIT-green)

## 功能

- **模型下拉**：按 provider 分组，👁 标记支持视觉；切模型 = 新建会话（旧会话保留在服务端）
- **输入**：Enter 发送，Shift+Enter 换行；多行自动增高
- **图片**：拖拽 / 粘贴 / 点 📎 选择；先拷贝到应用 cache 再以 `file://` 提交，发送成功后自动清理
- **回复展示**：输入框上方蓝色竖线区块；"思考中"三点动画 → 打字机式流式渲染 → 绿色"已完成 ✓"；只保留最近一轮
- **状态机**：工具调用阶段显示"正在处理…"；服务未启动 / 发送失败 / 模型限流（`retry.error`）/ 空回复 / 超时 120s 各有对应提示，错误条带"重试"和"切换模型"按钮
- **窗口**：拖动条任意拖放（位置记忆）、📌 置顶开关、— 折叠（只留输入框）、✕ 退出；始终置顶、全空间可见、不进 Dock；单实例锁，重复启动只聚焦已有窗口；自动暗色模式

## 从源码运行

```bash
git clone https://github.com/Asterracy/opencode-float.git
cd opencode-float
npm install
npm start        # 开发模式
npm run dist     # 打包自包含 .app（产物在 release/mac-arm64/）
```

要求：本机跑着 OpenCode 服务。

## 服务发现与连接

启动时按以下优先级自动探测：

1. **lsof 实测**（macOS）：`lsof -nP -iTCP -sTCP:LISTEN` 里名字含 `opencode` 的进程实际监听的端口——哪怕你跑在任意自定义端口都能被找到
2. **已保存地址**：上次连接成功的地址
3. **常见端口表**：4096（`opencode serve` 默认）→ 8080 → 8081 → 8000 → 3000

**鉴权可选**：本机存在 `~/.config/opencode/service.json` 时自动读取其中 `password` 作为 Basic Auth 凭据；没有则尝试无鉴权连接。

全部落空时不会死在错误页，而是**自动展开设置面板**引导手填：地址、用户名、密码，点"检测并保存"即时验证；也可点"重新探测"再跑一轮自动发现。地址留空保存则恢复自动发现模式。

## 状态持久化

`~/Library/Application Support/OpenCode Float/config.json`：`sessionId`、`model`、窗口位置、折叠态、置顶。

## 关键实现约定（OpenCode v2 API 踩坑记录）

- 模型字段必须是 `{providerID, id}` 形状，传 `modelID` 会被拒
- **空会话 GC**：无消息的会话数秒内 404，所以每次发送前都 `GET /session/{id}` 校验，失效自动重建
- user / assistant 消息形态不对称：user 文本在顶层 `text`，assistant 文本在 `content[].text`，解析需兼容
- 无 SSE（`/event` 404）：600ms 轮询 + 文本长度连续 2 周期不变判定完成，前端打字机制造流式感
- 图片 `file://` 必须真实存在，悬空路径服务端直接 400
- 限流时 prompt 返回 200 但消息进 `retry.error`，UI 要提示切模型而不是死循环

## 环境备注

npm 的 allowScripts 可能拦截 Electron 的 postinstall，且个别情况下 `install.js` 解压只得到 `LICENSES`。手动修复：

```bash
cd node_modules/electron && unzip -q ~/Library/Caches/electron/<hash>/electron-v*-darwin-arm64.zip -d dist \
  && echo -n "Electron.app/Contents/MacOS/Electron" > path.txt
```

## License

[MIT](LICENSE)
