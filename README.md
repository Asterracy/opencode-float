# OpenCode Float — 桌面悬浮对话窗

OpenCode2 常驻服务（`http://127.0.0.1:8080/api`）的桌宠式极简悬浮窗。选模型、打字、发图片、看回复，仅此而已；完整历史请去 OpenCode 桌面端。

## 启动

```bash
cd ~/.../opencode-float
npm start
```

## 功能

- **模型下拉**：按 provider 分组，👁 标记支持视觉；切模型 = 新建会话（旧会话保留在服务端）
- **输入**：Enter 发送，Shift+Enter 换行；多行自动增高
- **图片**：拖拽 / 粘贴 / 点 📎 选择；先拷贝到应用 cache 目录再以 `file://` 提交，发送成功后自动清理
- **回复展示**：输入框上方蓝色竖线区块；"思考中"三点动画 → 打字机式流式渲染；只保留最近一轮
- **错误兜底**：服务未连上 / 发送失败 / 模型限流（`retry.error`）/ 超时 120s → 红色提示条 + 重试 / 切换模型按钮
- **窗口**：顶部拖动条可拖到任意位置（位置记忆）、📌 置顶开关、— 折叠（只留输入框）、✕ 退出；始终置顶、全空间可见、不进 Dock/任务栏

## 状态持久化

`~/Library/Application Support/OpenCode Float/config.json`：`sessionId`、`model`、窗口位置、折叠态、置顶。

## 关键实现约定（与设计稿对应）

- Basic Auth 密码从 `~/.config/opencode/service.json` 读取，只在主进程使用
- 模型字段必须是 `{providerID, id}` 形状
- 每次发送前 `GET /session/{id}` 校验（防空会话 GC 404），失效则自动重建
- user 文本在顶层 `text`，assistant 文本在 `content[].text`，解析已兼容
- 无 SSE，靠 600ms 轮询 + 文本长度连续 2 周期不变判定完成，前端打字机制造流式感
- 图片 `file://` 必须真实存在，悬空路径服务端 400

## 环境备注

本机安装时 Electron 二进制下载解压若只得到 `LICENSES`，手动执行：

```bash
cd node_modules/electron && unzip -q ~/Library/Caches/electron/<hash>/electron-v*-darwin-arm64.zip -d dist \
  && echo -n "Electron.app/Contents/MacOS/Electron" > path.txt
```
