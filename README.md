# bh2-plugin

面向 TRSS-Yunzai / Yunzai 的崩坏学园2查询插件，提供账号登录天数、公开展柜与本地图鉴。

## 安装

将本目录复制到云崽的 `plugins/bh2-plugin`，安装可选依赖后重启云崽：

```powershell
pnpm add sqlite3
```

`sqlite3` 仅用于读取逍遥/喵喵共享的 `data/db/data.db`。未安装时，插件仍可通过主人配置的 Cookie 工作。

## 命令

- `¥登录天数` / `#bh2登陆天数 [UID]`
- `#崩坏学园2账号 [UID]`
- `#崩坏2展柜 [UID]`
- `#BH2图鉴 <关键词>`
- `#崩坏学园2角色图鉴 <关键词>`
- `#崩坏学园2武器图鉴 <关键词>`
- `#BH2图鉴详情 <编号>`
- `#BH2图鉴更新`，仅 Bot 主人可用，从 GitHub 下载并部署最新图鉴。
- `#BH2绑定 <UID>`、`#BH2切换 <UID>`、`#BH2解绑`
- `#BH2cookie [UID] <完整Cookie>`，仅 Bot 主人私聊可用。

账号查询优先读取共享数据库中 `MysUsers.uids.bh2` 对应的 Cookie，然后读取插件自己的 UID Cookie，最后使用插件默认 Cookie。Cookie、Token、DS 和设备标识不会出现在回复中。

## 接口配置

`config/config.json` 集中管理游戏标识、账号角色接口、战绩接口与登录天数/展柜端点。若米游社调整 BH2 接口，只需要修改此文件或对应环境变量，不需要改命令实现。

## 更新本地图鉴

图鉴已拆分到独立仓库：`l52312516-cell/Honkai-Academy-2-Illustrated-Guide`。主插件包不携带大体积图片，首次部署或需要更新时，由 Bot 主人发送：

```text
#BH2图鉴更新
```

更新器优先下载 GitHub 最新 Release 中名为 `Honkai-Academy-2-Illustrated-Guide.zip` 的资源；没有 Release 时回退到 `main` 分支归档。分支中既可保存展开后的图鉴目录，也可只保存同名 ZIP。下载完成后会校验 `manifest.json`、图鉴 SHA256、条目结构和所有图片路径，再原子替换 `data/catalog.json` 与 `resources/img/`。

仓库、分支和 Release 文件名可在 `config/config.json` 的 `catalogUpdate` 中调整。私有仓库可通过环境变量 `BH2_GITHUB_TOKEN` 提供只读 Token，Token 不会出现在回复或日志中。
