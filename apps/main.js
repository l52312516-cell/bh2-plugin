import { getUserGameRoles, normalizeAccount, normalizeShowcase, recordRequest, apiConfig } from "../lib/api.js"
import {
  catalogMeta,
  catalogPage,
  catalogStats,
  findEntry,
  getAllEntries,
  getEntryExact,
  searchCatalog,
} from "../lib/catalog.js"
import { updateCatalogFromGithub } from "../lib/catalogUpdater.js"
import {
  accountCard,
  catalogCard,
  catalogListCard,
  helpModel,
  helpText as renderHelpText,
  replyCard,
  replyHelp,
  showcaseCard,
  statusCard,
  textFallback,
} from "../lib/cardImage.js"
import { ALIASES, COMMAND_REG, cleanCommand, parseCommand } from "../lib/commands.js"
import { changelogText, pluginVersion } from "../lib/pluginInfo.js"
import { restartYunzai, updatePluginFromGithub } from "../lib/pluginUpdater.js"
import {
  getBindUid,
  getCookie,
  getLocalCookie,
  removeBindUid,
  setBindUid,
  setCookie,
} from "../lib/store.js"

const BasePlugin = globalThis.plugin || class {
  constructor(options = {}) { Object.assign(this, options) }
  reply(message) { return this.e?.reply?.(message) }
}

function isMaster(e) {
  return e?.isMaster === true
}

function friendlyError(error) {
  const message = String(error?.message || error || "未知错误")
  if (/abort|timeout|timed out/i.test(`${error?.name || ""} ${message}`)) return "请求超时，请稍后重试。"
  if (/fetch failed|ENOTFOUND|ECONNRESET|ECONNREFUSED/i.test(message)) return "网络连接失败，请稍后重试。"
  return message
}

export function helpText(master = false) {
  return renderHelpText(helpModel(master))
}

export class Bh2Plugin extends BasePlugin {
  constructor() {
    super({
      name: "bh2-plugin",
      dsc: "崩坏学园2账号、战绩和图鉴",
      event: "message",
      priority: -1800,
      rule: [{ reg: COMMAND_REG, fnc: "dispatch" }],
    })
  }

  async dispatch() {
    const command = parseCommand(this.e.msg)
    if (!command) return false
    switch (command.action) {
      case "help": return replyHelp(this.e, helpModel(isMaster(this.e)))
      case "bind": return this.bindUid(command.uid)
      case "switch": return this.switchUid(command.uid)
      case "unbind": return this.unbindUid()
      case "cookie": return this.saveCookie(command.uid, command.cookie)
      case "account": return this.showAccount(command.uid)
      case "loginDays": return this.showLoginDays(command.uid)
      case "showcase": return this.showShowcase(command.uid)
      case "catalogUpdate": return this.updateCatalog()
      case "catalogForceUpdate": return this.updateCatalog(true)
      case "catalog": return this.showCatalog(command.keyword, command.type, command.page)
      case "detail": return this.showDetail(command.query)
      case "status": return this.showStatus()
      case "changelog": return this.showChangelog()
      case "pluginUpdate": return this.updatePlugin()
      case "pluginForceUpdate": return this.updatePlugin(true)
      default: return false
    }
  }

  async bindUid(uid) {
    setBindUid(this.e.user_id, uid)
    return this.e.reply(`已绑定崩坏学园2 UID：${uid}`)
  }

  async switchUid(uid) {
    setBindUid(this.e.user_id, uid)
    return this.e.reply(`已切换当前 UID：${uid}`)
  }

  async unbindUid() {
    removeBindUid(this.e.user_id)
    return this.e.reply("已解除当前崩坏学园2 UID绑定。")
  }

  async saveCookie(uid, cookie) {
    if (!isMaster(this.e)) return this.e.reply("仅 Bot 主人可以配置 Cookie。")
    if (this.e.isGroup) return this.e.reply("请私聊 Bot 配置 Cookie，避免在群聊泄露账号凭据。")
    try {
      const roles = await getUserGameRoles(cookie)
      const bh2Roles = uid ? roles.filter(role => String(role.game_uid) === String(uid)) : roles
      if (!bh2Roles.length) return this.e.reply("Cookie 有效，但没有找到对应的崩坏学园2账号。")
      setCookie(uid, cookie)
      return this.e.reply(`Cookie 已保存，检测到 ${bh2Roles.length} 个崩坏学园2账号。`)
    } catch (error) {
      return this.e.reply(`Cookie 校验失败：${friendlyError(error)}`)
    }
  }

  async resolveUid(explicitUid = "") {
    let uid = String(explicitUid || getBindUid(this.e.user_id) || "")
    let cookie = uid ? await getCookie(uid) : getLocalCookie("")
    if (!cookie) return { uid, cookie: "", roles: [] }
    const roles = await getUserGameRoles(cookie)
    if (!uid) uid = String(roles[0]?.game_uid || "")
    if (uid && !roles.some(role => String(role.game_uid) === uid)) {
      throw new Error(`拒绝查询 UID ${uid}：当前 Cookie 不属于该崩坏学园2账号。`)
    }
    return { uid, cookie, roles }
  }

  async withUid(explicitUid, callback) {
    try {
      const { uid, cookie, roles } = await this.resolveUid(explicitUid)
      if (!uid) return this.e.reply("请先绑定 UID，或由 Bot 主人在私聊中配置默认 Cookie。")
      if (!cookie) return this.e.reply(`无法查询 UID ${uid}：没有找到该账号对应的 Cookie。`)
      return await callback(uid, cookie, roles)
    } catch (error) {
      return this.e.reply(`查询失败：${friendlyError(error)}`)
    }
  }

  async showAccount(explicitUid = "") {
    return this.withUid(explicitUid, async (uid, cookie, roles) => {
      const matched = explicitUid ? roles.filter(role => String(role.game_uid) === String(explicitUid)) : roles
      if (!matched.length) return this.e.reply("Cookie 中没有可用的崩坏学园2账号。")
      const fields = matched.map(role => {
        const suffix = [role.level ? `Lv.${role.level}` : "", role.region_name || role.region || ""].filter(Boolean).join(" · ")
        return `${role.nickname || "未知"} (${role.game_uid})${suffix ? `  ${suffix}` : ""}`
      }).join("\n")
      return this.e.reply(`=== 崩坏学园2账号 ===\n${fields}`)
    })
  }

  async showLoginDays(explicitUid = "") {
    return this.withUid(explicitUid, async (uid, cookie) => {
      const raw = await recordRequest("loginDays", uid, {}, cookie)
      return replyCard(this.e, accountCard(normalizeAccount(raw, uid)))
    })
  }

  async showShowcase(explicitUid = "") {
    return this.withUid(explicitUid, async (uid, cookie) => {
      const raw = await recordRequest("showcase", uid, {}, cookie)
      return replyCard(this.e, showcaseCard(normalizeShowcase(raw, uid), name => findEntry(name)))
    })
  }

  async updateCatalog(force = false) {
    if (!isMaster(this.e)) return this.e.reply("仅 Bot 主人可以更新图鉴。")
    await this.e.reply(force
      ? "正在强制覆盖更新崩坏学园2图鉴，现有图鉴图片将被替换，请稍候……"
      : "正在从 GitHub 下载并校验崩坏学园2图鉴，请稍候……")
    try {
      const result = await updateCatalogFromGithub({ force })
      return this.e.reply(`${force ? "图鉴强制更新完成" : "图鉴更新完成"}：版本 ${result.version}，共 ${result.entries} 条、${result.images} 张图片。`)
    } catch (error) {
      globalThis.logger?.error?.(`[bh2] 图鉴更新失败: ${error.stack || error.message}`)
      return this.e.reply(`图鉴更新失败：${friendlyError(error)}`)
    }
  }

  async showCatalog(keyword = "", type = "", page = 1) {
    if (!getAllEntries().length) return this.e.reply("本地图鉴尚未安装，请让 Bot 主人发送 #BH2图鉴更新。")
    const result = catalogPage({ keyword, type, page })
    if (result.exact) return replyCard(this.e, catalogCard(result.exact))
    return replyCard(this.e, catalogListCard({ ...result, keyword, type }))
  }

  async showDetail(query) {
    if (!getAllEntries().length) return this.e.reply("本地图鉴尚未安装，请让 Bot 主人发送 #BH2图鉴更新。")
    const exact = getEntryExact(query)
    if (exact) return replyCard(this.e, catalogCard(exact))
    const matches = searchCatalog(query)
    if (!matches.length) return this.e.reply(`未找到图鉴条目：${query}`)
    return replyCard(this.e, catalogListCard({ items: matches.slice(0, 12), keyword: query, total: matches.length, page: 1, pages: Math.max(1, Math.ceil(matches.length / 12)) }))
  }

  async showStatus() {
    return replyCard(this.e, statusCard({ version: pluginVersion(), catalog: catalogMeta(), stats: catalogStats() }))
  }

  async showChangelog() {
    if (!isMaster(this.e)) return this.e.reply("仅 Bot 主人可以查看插件更新日志。")
    return this.e.reply(changelogText())
  }

  async updatePlugin(force = false) {
    if (!isMaster(this.e)) return this.e.reply("仅 Bot 主人可以更新插件。")
    await this.e.reply(force
      ? "正在强制覆盖更新 bh2-plugin，现有程序文件将被替换，请稍候……"
      : "正在检查并更新 bh2-plugin，请稍候……")
    try {
      const result = await updatePluginFromGithub({ force })
      if (!result.updated) return this.e.reply(`bh2-plugin 已是最新版本（v${result.version}），无需覆盖。`)
      await this.e.reply(`bh2-plugin 已更新至 v${result.version}，即将重启云崽。`)
      setTimeout(async () => {
        const restarted = await restartYunzai(this.e)
        if (!restarted) await this.e.reply("未找到兼容的重启模块，请手动重启云崽使更新生效。")
      }, 1800)
      return true
    } catch (error) {
      globalThis.logger?.error?.(`[bh2] 主插件更新失败: ${error.stack || error.message}`)
      return this.e.reply(`插件更新失败：${friendlyError(error)}`)
    }
  }
}

export { cleanCommand, parseCommand, ALIASES, COMMAND_REG, apiConfig, textFallback }
