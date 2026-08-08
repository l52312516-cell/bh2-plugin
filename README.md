# bh2-plugin

面向 TRSS-Yunzai / Yunzai 3.x 的崩坏学园2查询插件，提供账号登录天数、公开展柜、本地图鉴、图片帮助和在线更新。

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
- `#BH2展柜 [UID]`
- `#BH2图鉴 [关键词] [第N页]`
- `#BH2角色图鉴 [关键词] [第N页]`
- `#BH2武器图鉴 [关键词] [第N页]`
- `#BH2图鉴详情 <编号或名称>`
- `#BH2绑定 <UID>`、`#BH2切换 <UID>`、`#BH2解绑`
- `#BH2版本` / `#BH2状态`
- `#BH2帮助`
- `#BH2图鉴更新`，仅 Bot 主人可用。
- `#BH2更新`，仅 Bot 主人可用，更新成功后自动重启云崽。
- `#BH2更新日志`，仅 Bot 主人可用。
- `#BH2cookie [UID] <完整 Cookie>`，仅 Bot 主人私聊可用。

账号查询优先读取共享数据库中 `MysUsers.uids.bh2` 对应的 Cookie，再读取插件自身的 UID Cookie，最后使用默认 Cookie。发起查询前还会验证 Cookie 的 BH2 账号列表确实包含目标 UID。

## 图鉴仓库

图鉴资源位于独立仓库 `l52312516-cell/Honkai-Academy-2-Illustrated-Guide`。首次部署后由 Bot 主人发送：

```text
#BH2图鉴更新
```

插件会校验 `manifest.json`、图鉴 SHA256、条目结构和图片路径，再替换 `data/catalog.json` 与 `resources/img/`。

## 插件更新

Git 安装使用 `git pull --ff-only`；ZIP 安装优先下载主仓库最新 Release 中的 `bh2-plugin-server.zip`，没有 Release 时回退 `main` 分支。ZIP 更新只替换 `plugin.manifest.json` 中列出的程序文件，保留用户配置和本地图鉴。

私有仓库可通过环境变量 `BH2_GITHUB_TOKEN` 提供只读 Token。

## 发布打包

```powershell
node .\scripts\package-release.mjs
```

也可以在 npm PowerShell 脚本未被系统策略拦截时运行 `npm run package:server`。输出文件为 `release/bh2-plugin-server.zip`，同时刷新 `plugin.manifest.json`。
