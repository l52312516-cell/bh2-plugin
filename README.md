# bh2-plugin

面向 TRSS-Yunzai / Yunzai 3.x 的崩坏学园2查询插件，提供账号战绩、展柜概览、本地图鉴、图片帮助和在线更新。v0.5.0 起所有主要回复统一为深蓝背景、半透明面板、金色标题和青色重点数字的长图卡片。

## 安装

将发布包解压到云崽的 `plugins/bh2-plugin`，然后重启云崽。可选安装 `sqlite3`，用于读取逍遥/喵喵共享的 `data/db/data.db`：

```powershell
pnpm add sqlite3
```

未安装 `sqlite3` 时，插件仍可使用主人私聊配置的 Cookie。Cookie、Token、DS 和设备标识不会出现在回复中。

## 前缀

帮助中使用以下正式前缀：

```text
¥
#崩坏学园2
#崩坏2
#崩2
#BH2 / #bh2
#bb
#b2
```

同时兼容全角 `￥` 和 `bh2帮助` 这类不带 `#` 的旧别名写法。

## 命令

- `¥登录天数 [UID]`
- `#BH2账号 [UID]`
- `#BH2展柜 [UID]`，显示官方公开的装备图鉴、看板收集度等战绩统计。
- `#BH2图鉴 [关键词] [第N页]`
- `#BH2角色图鉴 [关键词] [第N页]`
- `#BH2武器图鉴 [关键词] [第N页]`
- `#BH2图鉴详情 <编号或名称>`，富图鉴条目会显示攻击、载弹、攻速、负重、等级上限和技能说明。
- `#BH2绑定 <UID>`、`#BH2切换 <UID>`、`#BH2解绑`
- `#BH2版本` / `#BH2状态`
- `#BH2帮助`
- `#BH2图鉴更新`，仅 Bot 主人可用。
- `#BH2图鉴强制更新`，仅 Bot 主人可用，忽略当前版本并覆盖图鉴索引与图片。
- `#BH2更新`，仅 Bot 主人可用，更新成功后自动重启云崽。
- `#BH2强制更新`，仅 Bot 主人可用，忽略当前版本并覆盖主插件程序文件，成功后自动重启云崽。
- `#BH2更新日志`，仅 Bot 主人可用。
- `#BH2cookie [UID] <完整 Cookie>`，仅 Bot 主人私聊可用。

账号查询优先读取共享数据库中 `MysUsers.uids.bh2` 对应的 Cookie，再读取插件自身的 UID Cookie，最后使用默认 Cookie。发起查询前还会验证 Cookie 的 BH2 账号列表确实包含目标 UID。

米游社当前 BH2 战绩页面只公开 `/bh2/api/index` 与社团档案接口，没有公开角色、武器明细列表。插件会展示官方可用的装备图鉴数、看板收集度、使魔、萌章、成就、好感度和入学时长；如果未来接口增加角色或武器数组，展柜卡片会自动显示。

## 图鉴仓库

图鉴资源位于独立仓库 `l52312516-cell/Honkai-Academy-2-Illustrated-Guide`。首次部署后由 Bot 主人发送：

```text
#BH2图鉴更新
```

插件会校验 `manifest.json`、图鉴 SHA256、条目结构和图片路径，再替换 `data/catalog.json` 与 `resources/img/`。

图鉴更新不依赖 GitHub API：优先下载最新 Release 中固定名称的 ZIP，失败后再尝试分支归档。镜像列表、连接超时和下载停滞超时可在 `config/config.json` 的 `catalogUpdate` 中调整；也可以在 `downloadUrls` 中填写自建 CDN 或对象存储的 HTTPS 直链。大文件使用临时文件流式下载，在同一轮镜像切换时支持断点续传。

## 插件更新

Git 安装使用 `git pull --ff-only`；ZIP 安装优先下载主仓库最新 Release 中的 `bh2-plugin-server.zip`，没有 Release 时回退 `main` 分支。ZIP 更新只替换 `plugin.manifest.json` 中列出的程序文件，保留用户配置和本地图鉴。

私有仓库可通过环境变量 `BH2_GITHUB_TOKEN` 提供只读 Token。

## 发布打包

```powershell
node .\scripts\package-release.mjs
```

也可以在 npm PowerShell 脚本未被系统策略拦截时运行 `npm run package:server`。输出文件为 `release/bh2-plugin-server.zip`，同时刷新 `plugin.manifest.json` 和 `release/SHA256SUMS.txt`。服务器包只包含程序、模板和 `resources/ui` 公共素材，不包含 `config/config.json`、`data/catalog.json` 或完整独立图鉴图片；图鉴请通过 `#BH2图鉴更新` 单独安装。

生成视觉预览：

```powershell
node .\scripts\render-previews.mjs
```

预览输出到 `release/previews`，包括帮助、状态、账号、登录天数、展柜、图鉴列表、装备/角色详情、缺图和长文本样例。
