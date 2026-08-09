const ALIAS_VALUES = ["崩坏学园2", "崩坏2", "崩2", "bh2", "bb", "b2"]
const ALIAS_PATTERN = `(?:${ALIAS_VALUES.join("|")})`
const PREFIX_PATTERN = `(?:[¥￥]|#\\s*${ALIAS_PATTERN}|${ALIAS_PATTERN})`

export const COMMAND_PREFIX_REG = new RegExp(`^${PREFIX_PATTERN}\\s*`, "i")

export const COMMAND_REG = new RegExp(
  `^${PREFIX_PATTERN}\\s*(?:帮助|菜单|使用|绑定|切换(?:uid)?|解绑|cookie|账号|账户|(?:登录|登陆)天数|展柜|图鉴|角色图鉴|武器图鉴|图鉴详情|图鉴强制更新|强制图鉴更新|图鉴更新|版本|状态|更新日志|强制更新|更新)(?:\\s|$)`,
  "i",
)

export function cleanCommand(message = "") {
  const value = String(message).trim()
  const match = value.match(COMMAND_PREFIX_REG)
  return match ? value.slice(match[0].length).trim() : ""
}

function pageArguments(value = "") {
  const match = String(value).match(/(?:^|\s)第(\d{1,4})页$/u)
  if (!match) return { value: String(value).trim(), page: 1 }
  return {
    value: String(value).slice(0, match.index).trim(),
    page: Math.max(1, Number(match[1]) || 1),
  }
}

export function parseCommand(message = "") {
  if (!COMMAND_REG.test(String(message).trim())) return null
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
  if (/^(?:图鉴强制更新|强制图鉴更新)$/i.test(value)) return { action: "catalogForceUpdate" }
  if (/^图鉴更新$/i.test(value)) return { action: "catalogUpdate" }
  if (/^图鉴详情\s+\S+/i.test(value)) return { action: "detail", query: value.replace(/^图鉴详情\s+/i, "").trim() }
  if (/^(版本|状态)$/i.test(value)) return { action: "status" }
  if (/^更新日志$/i.test(value)) return { action: "changelog" }
  if (/^强制更新$/i.test(value)) return { action: "pluginForceUpdate" }
  if (/^更新$/i.test(value)) return { action: "pluginUpdate" }

  let match = value.match(/^(角色图鉴|武器图鉴)(?:\s+([\s\S]+))?$/i)
  if (match) {
    const args = pageArguments(match[2] || "")
    return {
      action: "catalog",
      type: match[1].startsWith("角色") ? "character" : "weapon",
      keyword: args.value,
      page: args.page,
    }
  }
  match = value.match(/^图鉴(?:\s+([\s\S]+))?$/i)
  if (match) {
    const args = pageArguments(match[1] || "")
    return { action: "catalog", keyword: args.value, page: args.page }
  }
  return null
}

export const ALIASES = ALIAS_PATTERN
export const PREFIXES = ["¥", "#崩坏学园2", "#崩坏2", "#崩2", "#BH2", "#bh2", "#bb", "#b2"]
