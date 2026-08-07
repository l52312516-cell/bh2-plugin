import {
  getUserGameRoles,
  normalizeAccount,
  normalizeShowcase,
  recordRequest,
  apiConfig,
} from "../lib/api.js"
import { catalogMeta, findEntry, getAllEntries, getEntryById, searchCatalog } from "../lib/catalog.js"
import { updateCatalogFromGithub } from "../lib/catalogUpdater.js"
import { accountCard, catalogCard, replyCard, showcaseCard, textFallback } from "../lib/cardImage.js"
import {
  getBindUid,
  getCookie,
  getLocalCookie,
  removeBindUid,
  setBindUid,
  setCookie,
} from "../lib/store.js"

const ALIASES = "(?:bh2|崩坏学园2|崩坏2)"
const BasePlugin = globalThis.plugin || class {
  constructor(options = {}) { Object.assign(this, options) }
  reply(message) { return this.e?.reply?.(message) }
}
const COMMAND_REG = new RegExp(
  `^(?:¥|#)?\\s*${ALIASES}?\\s*(?:帮助|菜单|使用|绑定|切换|当前|解绑|cookie|账号|账户|登录|登陆|展柜|图鉴|角色图鉴|武器图鉴|图鉴详情|图鉴更新)(?:\\s|$)`,
  "i",
)

function cleanCommand(message = "") {
  let value = String(message).trim()
  value = value.replace(/^(?:¥|#)\s*/u, "")
  value = value.replace(new RegExp(`^${ALIASES}\\s*`, "i"), "")
  return value.trim()
}

export function parseCommand(message = "") {
  const value = cleanCommand(message)
  if (/^(帮助|菜单|使用)$/i.test(value)) return { action: "help" }
  if (/^绑定\s+\d{5,12}$/i.test(value)) return { action: "bind", uid: value.match(/\d{5,12}/)?.[0] }
  if (/^(切换|切换uid)\s+\d{5,12}$/i.test(value)) return { action: "switch", uid: value.match(/\d{5,12}/)?.[0] }
  if (/^解绑$/i.test(value)) return { action: "unbind" }
  if (/^cookie(?:\s+\d{5,12})?\s+/i.test(value)) {
    const match = value.match(/^cookie(?:\s+(\d{5,12}))?\s+([\s\S]+)$/i)
    return { action: "cookie", uid: match?.[1] || "", cookie: match?.[2]?.trim() || "" }
  }
  if (/^(账号|账户)(?:\s+\d{5,12})?$/i.test(value)) return { action: "account", uid: value.match(/\d{5,12}/)?.[0] || "" }
  if (/^(登录|登陆)天数(?:\s+\d{5,12})?$/i.test(value)) return { action: "loginDays", uid: value.match(/\d{5,12}/)?.[0] || "" }
  if (/^展柜(?:\s+\d{5,12})?$/i.test(value)) return { action: "showcase", uid: value.match(/\d{5,12}/)?.[0] || "" }
  if (/^图鉴更新$/i.test(value)) return { action: "catalogUpdate" }
  if (/^图鉴详情\s+\S+$/i.test(value)) return { action: "detail", id: value.replace(/^图鉴详情\s+/i, "").trim() }
  let match = value.match(/^(角色图鉴|武器图鉴)\s+([\s\S]+)$/i)
  if (match) return { action: "catalog", type: match[1].startsWith("角色") ? "character" : "weapon", keyword: match[2].trim() }
  match = value.match(/^图鉴(?:\s+([\s\S]+))?$/i)
  if (match) return { action: "catalog", keyword: match[1]?.trim() || "" }
  return null
}

function isMaster(e) {
  return e?.isMaster === true
}

function helpText() {
  return [
    "=== 崩坏学园2插件 ===",
    "¥登录天数 / #bh2登陆天数 [UID]",
    "#崩坏学园2账号 [UID]",
    "#崩坏2展柜 [UID]",
    "#BH2图鉴 <关键词>",
    "#崩坏学园2角色图鉴 <关键词>",
    "#崩坏学园2武器图鉴 <关键词>",
    "#崩坏学园2图鉴详情 <编号>",
    "主人可用 #BH2图鉴更新 从 GitHub 下载并部署最新图鉴。",
    "#BH2绑定 <UID>、#BH2切换 <UID>",
    "主人可用 #BH2cookie [UID] <完整 Cookie> 配置回退 Cookie。",
  ].join("\n")
}

export class Bh2Plugin extends BasePlugin {
  constructor() {
    super({
      name: "bh2-plugin",
      dsc: "崩坏学园2账号、展柜和图鉴",
      event: "message",
      priority: -1800,
      rule: [{ reg: COMMAND_REG, fnc: "dispatch" }],
    })
  }

  async dispatch() {
    const command = parseCommand(this.e.msg)
    if (!command) return false
    switch (command.action) {
      case "help": return this.e.reply(helpText())
      case "bind": return this.bindUid(command.uid)
      case "switch": return this.switchUid(command.uid)
      case "unbind": return this.unbindUid()
      case "cookie": return this.setCookie(command.uid, command.cookie)
      case "account": return this.showAccount(command.uid)
      case "loginDays": return this.showLoginDays(command.uid)
      case "showcase": return this.showShowcase(command.uid)
      case "catalogUpdate": return this.updateCatalog()
      case "catalog": return this.showCatalog(command.keyword, command.type)
      case "detail": return this.showDetail(command.id)
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

  async setCookie(uid, cookie) {
    if (!isMaster(this.e)) return this.e.reply("仅 Bot 主人可以配置 Cookie。")
    if (this.e.isGroup) return this.e.reply("请私聊 Bot 配置 Cookie，避免在群聊泄露账号凭据。")
    try {
      const roles = await getUserGameRoles(cookie)
      const bh2Roles = uid ? roles.filter(role => String(role.game_uid) === String(uid)) : roles
      if (!bh2Roles.length) return this.e.reply("Cookie 有效，但没有找到对应的崩坏学园2账号。")
      setCookie(uid, cookie)
      return this.e.reply(`Cookie 已保存，检测到 ${bh2Roles.length} 个崩坏学园2账号。`)
    } catch (error) {
      return this.e.reply(`Cookie 校验失败：${error.message}`)
    }
  }

  async resolveUid(explicitUid = "") {
    let uid = explicitUid || getBindUid(this.e.user_id)
    if (uid) return { uid: String(uid), cookie: await getCookie(uid) }
    const cookie = getLocalCookie("")
    if (!cookie) return { uid: "", cookie: "" }
    const roles = await getUserGameRoles(cookie)
    uid = roles[0]?.game_uid ? String(roles[0].game_uid) : ""
    return { uid, cookie }
  }

  async withUid(explicitUid, callback) {
    try {
      const { uid, cookie } = await this.resolveUid(explicitUid)
      if (!uid) return this.e.reply("请先绑定 UID，或使用 #BH2cookie 配置默认 Cookie。")
      if (!cookie) return this.e.reply(`无法查询 UID ${uid}：没有找到该账号对应的 Cookie。`)
      return await callback(uid, cookie)
    } catch (error) {
      return this.e.reply(`查询失败：${error.message}`)
    }
  }

  async showAccount(explicitUid = "") {
    return this.withUid(explicitUid, async (uid, cookie) => {
      const roles = await getUserGameRoles(cookie)
      const matched = explicitUid ? roles.filter(role => String(role.game_uid) === String(explicitUid)) : roles
      if (!matched.length) return this.e.reply("Cookie 中没有可用的崩坏学园2账号。")
      const fields = matched.map(role => `${role.nickname || "未知"} (${role.game_uid})`).join("\n")
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
      const data = normalizeShowcase(raw, uid)
      return replyCard(this.e, showcaseCard(data, name => findEntry(name)))
    })
  }

  async updateCatalog() {
    if (!isMaster(this.e)) return this.e.reply("仅 Bot 主人可以更新图鉴。")
    await this.e.reply("正在从 GitHub 下载并校验崩坏学园2图鉴，请稍候……")
    try {
      const result = await updateCatalogFromGithub()
      return this.e.reply(`图鉴更新完成：版本 ${result.version}，共 ${result.entries} 条、${result.images} 张图片。`)
    } catch (error) {
      globalThis.logger?.error?.(`[bh2] 图鉴更新失败: ${error.stack || error.message}`)
      return this.e.reply(`图鉴更新失败：${error.message}`)
    }
  }

  async showCatalog(keyword = "", type = "") {
    if (!keyword) {
      const entries = getAllEntries(type)
      if (!entries.length) return this.e.reply("本地图鉴尚未安装，请让 Bot 主人发送 #BH2图鉴更新。")
      return this.e.reply(`本地${type === "weapon" ? "武器" : type === "character" ? "角色" : "角色/武器"}图鉴共 ${entries.length} 条。\n请提供关键词，例如：#BH2图鉴 示例`)
    }
    const results = searchCatalog(keyword, type)
    if (!results.length && !getAllEntries().length) return this.e.reply("本地图鉴尚未安装，请让 Bot 主人发送 #BH2图鉴更新。")
    if (!results.length) return this.e.reply(`未找到与“${keyword}”相关的图鉴条目。`)
    if (results.length > 1) {
      const lines = [`找到 ${results.length} 条匹配结果：`, ...results.slice(0, 10).map(item => `[${item.id}] ${item.name}（${item.type === "weapon" ? "武器" : "角色"}）`), "", "发送 #BH2图鉴详情 <编号> 查看详情。"]
      return this.e.reply(lines.join("\n"))
    }
    return replyCard(this.e, catalogCard(results[0]))
  }

  async showDetail(id) {
    const entry = getEntryById(id)
    if (!entry) return this.e.reply(`未找到图鉴条目：${id}`)
    return replyCard(this.e, catalogCard(entry))
  }
}

export { cleanCommand, helpText, ALIASES, apiConfig, textFallback }
