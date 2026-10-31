<div align="center">

<img src="public/logo.svg" width="88" height="88" alt="若道办公" />

# 若道办公 · Ruodao Office

**本地优先的 Windows 办公套件** —— 文档、表格、PDF 工具箱、双链笔记与 AI 助手，装在一台电脑里。

文件不出本机，功能不设围墙，AI 由你指定。

[![Version](https://img.shields.io/badge/version-0.1.0-c8442b)](https://github.com/ruodaoai/ruodao-office/releases)
[![License](https://img.shields.io/badge/license-MIT-c8442b)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%20%2F%2011-c8442b)](#-下载与安装)
[![Electron](https://img.shields.io/badge/Electron-45-c8442b)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18%20%2B%20TypeScript-c8442b)](https://react.dev/)

[⬇️ 下载安装包](https://github.com/ruodaoai/ruodao-office/releases/latest) · [快速开始](#-快速开始) · [使用教程](#-使用教程) · [常见问题](#-常见问题)

</div>

![若道办公工作台](screenshots/01-home.png)

## 这是什么

若道办公是一套**本地优先（local-first）**的桌面办公套件。它把平时散落在七八个网站里的活——写文档、算表格、处理 PDF、记笔记、转格式——收进同一个安静的工作台，并且默认**不联网也能用**。

和在线文档最大的区别是：**没有账号体系，没有上传队列，没有"您的文件已同步到云端"**。内容写入本机的 IndexedDB，随时可以整包导出成 JSON 带走。

| 它的主张 | 具体做法 |
| --- | --- |
| 文件属于你 | 本地数据库 + JSON 整包备份，无云端依赖，断网可用 |
| 开源免费 | 全部功能开放，不收订阅费、授权费，导 PDF 不再二次收费 |
| AI 可控 | 自带 API Key 或本机 Ollama，内容只发往你指定的服务 |

## 功能一览

| 模块 | 能做什么 |
| --- | --- |
| 📄 **文档** | 富文本编辑、自动保存、导入 Word / HTML、导出 DOCX / HTML / PDF、字数统计、全文检索 |
| 📊 **表格** | 常用公式与函数、数字格式、多工作表、单元格样式、图表、XLSX / CSV 双向兼容 |
| 🗂 **PDF 工具箱** | 合并、拆分、水印、页码、电子签章、提取文本与页面、离线 OCR、智能压缩、导出图片 |
| 🧠 **双链笔记** | Markdown 编辑、`[[双向链接]]`、反向链接、分栏阅读、关系图谱 |
| 🔄 **格式转换** | 20 种输入 × 30 种输出，图片 / PDF / 文档 / 表格 / 压缩包批量互转，全程本机 |
| ✨ **AI 助手** | 接 DeepSeek / 任意 OpenAI 兼容接口 / 本机 Ollama；摘要、改写、翻译、续写、提取要点 |
| 👥 **多人协作** | 基于 Yjs 的实时协同，自建 WebSocket 服务即可，不经过第三方服务器 |

## 界面速览

### 工作台：所有文件在一个入口

最近文件、快捷新建、数据留存状态一目了然。右上角常驻命令面板入口与 AI 助手。

![工作台](screenshots/01-home.png)

### 文档：所见即所得，改完即存

富文本工具栏、大纲与字数统计、导出菜单都在一屏之内。输入停顿 550ms 自动落盘。

![文档](screenshots/02-docs.png)

### 表格：公式、格式与图表

支持多工作表、常用函数、数字格式与图表，导入 xlsx 保留结构。

![表格](screenshots/03-sheets.png)

### PDF 工具箱：不上传也能干活

合并拆分、水印页码、签章、OCR、压缩全部在渲染进程本地完成，页数不设上限。

![PDF 工具箱](screenshots/04-pdf.png)

### 双链笔记：让资料互相找到

`[[链接]]` 自动生成反向链接，右侧同时给出关联与图谱。

![双链笔记](screenshots/05-notes.png)

### 格式转换：批量、离线、无水印

拖进来一批文件，选好输出格式即可，转换过程没有上传进度条——因为根本不上传。

![格式转换](screenshots/06-convert.png)

### AI 助手：用你自己的模型

接入自己的 Key 或本机模型；没配模型时，离线摘要依然可用。

![AI 助手](screenshots/07-ai-assistant.png)

## 下载与安装

### 方式一：安装版（推荐）

前往 [Releases](https://github.com/ruodaoai/ruodao-office/releases/latest) 下载 `RuodaoOffice-0.1.0-Setup.exe`：

1. 双击安装包，按向导选择安装目录（默认 `%LOCALAPPDATA%\Programs\若道办公`）；
2. 安装过程会创建桌面快捷方式与开始菜单项；
3. 首次启动若出现「Windows 已保护你的电脑」，点 **更多信息 → 仍要运行**（安装包未做代码签名，属正常提示）。

### 方式二：免安装版

下载 `RuodaoOffice-0.1.0-Portable.exe`，放到任意目录双击即可运行，不写注册表、不建快捷方式，适合放 U 盘或临时试用。

> 两个包的功能完全一致。区别只在于：安装版会注册开始菜单与卸载项，绿色版随文件走。

### 方式三：从源码运行

需要 **Node.js 20+**（推荐 22 LTS）与 npm。

```bash
git clone https://github.com/ruodaoai/ruodao-office.git
cd ruodao-office
npm install

# 桌面端开发模式（Vite + Electron，改代码即热更新）
npm run dev

# 只在浏览器里跑，不开桌面窗口
npm run dev:web
```

首次运行会自动挑选空闲端口启动前端开发服务器，并打开 Electron 窗口；关闭窗口时开发服务器一并退出。

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 桌面端开发模式（推荐日常开发） |
| `npm run dev:web` | 仅启动 Vite 开发服务器，浏览器访问 |
| `npm run desktop` | 用 `dist/` 构建产物启动桌面端 |
| `npm run build` | 类型检查 + 构建前端到 `dist/` |
| `npm run desktop:pack` | 打包出免安装目录（`release-win/win-unpacked`） |
| `npm run desktop:build` | 生成安装版 + 免安装版到 `release-win/` |
| `npm run collab` | 启动协作服务（默认 `ws://127.0.0.1:1234`） |
| `npm run typecheck` | 只做 TypeScript 类型检查 |

## 使用教程

### 1. 写一份文档

1. 左侧导轨点 **文档** → 右上角 **+** 新建；
2. 工具栏支持标题层级、加粗斜体、列表、引用、表格、代码块与图片；
3. 内容停顿片刻即自动保存，右上角会显示「自动保存到本机」；
4. 需要交付时点右上角 **导出**，可选 DOCX / HTML / PDF；
5. 已有 Word 文件可从左下角 **导入 Word / HTML** 直接读入。

### 2. 做一张表格

1. 左侧导轨点 **表格** → **+** 新建工作簿；
2. 单元格支持直接输入，回车下移、Tab 右移、F2 进入编辑；
3. 公式以 `=` 开头，如 `=SUM(B2:E2)`、`=IF(F2>0,"超支","正常")`；
4. 选中区域后用工具栏设置数字格式、背景、边框、对齐，或一键插入图表；
5. 底部标签栏可新增/重命名工作表；导入 Excel 时保留多表结构与样式；
6. 导出支持 XLSX / CSV。

### 3. 处理 PDF

进入 **PDF** 模块，先从「选择 PDF」或「载入示例」把文件放进队列，再选工具：

| 工具 | 说明 |
| --- | --- |
| 合并 / 拆分 | 多个文件按顺序合并；按所选页拆分，未选则整份拆成单页 |
| 水印 / 页码 | 自定义文字与位置，可批量应用到队列内全部文件 |
| 电子签章 | 拖入签名图片，指定页码与位置后盖章 |
| 提取文本 / 提取页面 | 导出纯文本或单独页面为新 PDF |
| OCR | 扫描件本地识别（tesseract.js），可校正后整理成结构化要点 |
| 压缩 | 三档压缩强度，按需平衡体积与清晰度 |
| 导出图片 | 按页导出 PNG / JPG，可指定分辨率 |

处理结果会提示下载位置，原文件不会被修改。

### 4. 用双链笔记攒资料

1. 进入 **笔记** → 新建，正文用 Markdown 书写；
2. 输入 `[[` 会提示已有笔记，选中即插入链接；
3. 右侧 **关联** 面板自动列出反向链接（哪些笔记引用了当前这篇）；
4. 顶部可切换 **编辑 / 分栏 / 阅读** 三种视图；
5. 支持导入 Markdown 文件，`.md` 全文保存在本机。

### 5. 批量转格式

1. 进入 **转换**，把文件拖进「文件队列」（支持多选）；
2. 在「输出格式」里点选目标格式，例如 PNG → PDF、PDF → Word、Word → Markdown、Excel → CSV、ZIP → 解包；
3. 点开始，等待队列跑完，逐个下载或打包下载。

> 图片分辨率、压缩质量可在输出面板调整；扫描版 PDF 转文字请先用 PDF 工具箱的 OCR。

### 6. 配置 AI 助手

点左侧导轨 **AI**，或右上角 **AI 助手** 打开抽屉，然后在 **设置 → AI** 里选接入方式：

| 方式 | 需要准备 | 说明 |
| --- | --- | --- |
| DeepSeek（默认） | `sk-` 开头的 API Key | 填好 Key 即可用，模型默认 `deepseek-chat` |
| 任意 OpenAI 兼容服务 | Base URL + 模型名 + Key | 如自建网关、通义、Moonshot 等 |
| 本机 Ollama | 本机已 `ollama serve` | Base URL 用 `http://127.0.0.1:11434/v1`，无需 Key，内容不出本机 |
| 若道账号 | 登录若道账号 | 直接使用账号下已配置的模型 |

配好后在文档/笔记里选中文字，点浮动工具条的 AI 按钮，就能就地摘要、改写、翻译或续写。**Key 只保存在本机，不会写入导出的备份文件。**

### 7. 多人协作（可选）

协作走自建服务，不经过第三方：

```bash
npm run collab          # 默认监听 ws://127.0.0.1:1234
COLLAB_PORT=9000 npm run collab   # 换端口
```

然后在应用内打开「协作」面板，填入服务地址（如 `ws://127.0.0.1:1234`）与昵称，创建或加入房间即可实时同步；同一房间内可看到彼此光标。

### 8. 备份与换机

**设置 → 数据 → 备份与迁移**：

- **导出完整备份**：生成 `若道办公-备份-YYYY-MM-DD.json`，包含全部文档、表格与笔记（不含 AI 密钥）；
- **导入备份**：选择备份文件，确认后覆盖当前设备数据；
- **清空本机数据**：不可撤销，建议先导出。

换电脑时把 JSON 拷过去导入即可，无需登录任何账号。

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl / ⌘ + K` | 打开命令面板（全局搜索、新建、跳转） |
| `Ctrl / ⌘ + S` | 立即保存到本机 |
| 表格内 `Enter` / `Tab` / `F2` | 下移 / 右移 / 进入编辑 |
| `Shift` + 点选 PDF 页 | 连续多选页面 |
| `Ctrl / ⌘` + 点选 PDF 页 | 追加/取消单页选择 |

## 数据与隐私

- 所有内容默认写入本机 **IndexedDB**，不上传、不埋点、不要求登录；
- 只有在你主动配置 AI 之后，被选中的文本才会发往**你指定的那个接口**；
- AI Key 仅存本地，导出备份时会被剔除；
- PDF、图片、表格、文档的解析与转换全部在前端完成，没有服务端；
- 卸载或清空数据后，本机残留会被一并删除（安装版卸载默认保留用户数据目录，可在设置中先清空再卸载）。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 渲染层 | React 18 · TypeScript · Zustand · Vite 5 |
| 桌面壳 | Electron 45 · 自建本地静态服务 · NSIS / Portable 打包 |
| 文档 | 自研富文本模型 · `docx` 导出 · `mammoth` 导入 · `docx-preview` |
| 表格 | 自研网格与公式引擎 · `xlsx` / `xlsx-js-style` |
| PDF | `pdf-lib` · `pdfjs-dist` · `tesseract.js`（OCR） |
| 笔记 | `marked` · `dompurify` · 双链索引 |
| 协作 | `yjs` + `ws`（自建房间服务） |
| 本地存储 | `idb-keyval` |

## 目录结构

```
ruodao-office/
├── electron/            # Electron 主进程（窗口、本地静态服务、菜单、下载拦截）
├── src/
│   ├── modules/         # 业务模块：home / docs / sheets / pdf / notes / convert / ai
│   ├── components/      # 导轨、顶栏、命令面板、设置、协作等通用组件
│   ├── lib/             # 文档模型、公式引擎、xlsx、pdf、markdown、AI、存储
│   ├── store/           # Zustand 状态（资料库 / UI / 账号 / 协作）
│   └── styles/          # 分模块样式
├── server/collab.mjs    # 协作服务（Yjs + WebSocket）
├── scripts/             # 开发启动器、图标生成、打包、截图脚本
├── screenshots/         # README 截图
└── electron-builder.yml # 安装包配置
```

## 常见问题

**Q：安装时提示"Windows 已保护你的电脑"？**
安装包未申请代码签名证书，属预期行为。点「更多信息 → 仍要运行」即可；也可以改用免安装版。

**Q：数据存在哪里？换机会不会丢？**
存在本机 IndexedDB（Electron 的用户数据目录下）。不会自动同步，请用 **设置 → 数据 → 导出完整备份** 手动迁移。

**Q：需要联网吗？**
文档、表格、PDF、笔记、格式转换全部离线可用。只有使用在线 AI 模型时才需要网络；接本机 Ollama 则全程离线。

**Q：能打开 `.doc` / `.xls` 老格式吗？**
能读取 `.docx` / `.xlsx` / `.csv` / `.md` / `.html`。`.doc`、`.xls` 等二进制老格式以及加密 PDF，请在外部另存为新格式后再导入。

**Q：三端都能用吗？**
目前打包的是 Windows（x64）桌面版；前端本身是标准 Web 应用，`npm run dev:web` 在 macOS / Linux 上也能跑，桌面壳后续补充。

**Q：AI 会不会偷看我的文件？**
不会主动上传。只有你选中文本并点击 AI 操作时，这段文本才会发送到你配置的接口；用 Ollama 时连这一段也不出本机。

**Q：`npm run dev` 起不来 / 只有网页没有窗口？**
确认 Node 版本 ≥ 20，并确保环境里没有 `ELECTRON_RUN_AS_NODE` 变量（它会让 Electron 退化成纯 Node 运行）。启动器已自动剔除该变量；若端口被占用会自动换端口，也可用 `RUODAO_DEV_PORT=5199 npm run dev` 指定。

## 开发计划

- [ ] macOS / Linux 桌面包
- [ ] 文档与表格的协同编辑完整接入
- [ ] 插件化的自定义工具（脚本单元格、模板市场）
- [ ] 移动端只读伴侣

## 参与贡献

欢迎 Issue 与 PR：

1. Fork 并新建分支（`feat/xxx`、`fix/xxx`）；
2. 提交前跑一遍 `npm run typecheck` 与 `npm run build`；
3. PR 里说明动机、改动点与验证方式，涉及 UI 的请附截图。

## 许可证

[MIT](LICENSE) © 2026 Ruodao（若道）

<div align="center">
<sub>把文件，留在自己手里。</sub>
</div>
