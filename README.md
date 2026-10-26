# 帖子日程台

一个面向课程知识帖和日常内容运营的桌面工具。它可以读取 Markdown 内容，按日期和课程分组，记录发布进度，并把标题或正文一键复制到当前输入框。

## 主要能力

- 按日期、课程和发布状态整理帖子
- 标题与正文一键复制
- 紧凑悬浮窗和普通窗口两种使用方式
- 本地保存阅读与发布进度
- Windows 下支持向当前输入框直接填充内容

## 技术栈

- Electron
- 原生 HTML、CSS、JavaScript
- Windows PowerShell / C# 输入辅助

## 本地运行

```bash
npm install
npm start
```

首次使用时，在应用中选择符合格式的 Markdown 帖子文件。直接填充功能仅在 Windows 上可用；普通复制功能可跨平台使用。

## 测试

```bash
npm run test:static
```

## 打包 Windows 免安装版

```bash
npm run pack:win
```

项目内保留了 `desktop/paste-helper.cs` 源码。未提供辅助程序时，应用会自动使用 PowerShell 兼容方案。

## 数据与隐私

帖子文件和使用进度均保存在本机。仓库不包含个人帖子数据、账号凭据或平台登录信息，也不会自动登录或代替用户点击发布。

## License

MIT
