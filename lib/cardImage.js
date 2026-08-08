function scalar(value) {
  if (value == null) return "-"
  if (typeof value === "object") return Array.isArray(value) ? `${value.length} 项` : "[对象]"
  return String(value)
}

function flatten(value, prefix = "", out = [], depth = 0) {
  if (depth > 3 || value == null || typeof value !== "object") {
    if (prefix) out.push({ label: prefix, value: scalar(value) })
    return out
  }
  if (Array.isArray(value)) {
    if (prefix) out.push({ label: prefix, value: `${value.length} 项` })
    return out
  }
  for (const [key, child] of Object.entries(value)) {
    const label = prefix ? `${prefix}.${key}` : key
    if (child && typeof child === "object") flatten(child, label, out, depth + 1)
    else out.push({ label, value: scalar(child) })
  }
  return out
}

export function accountCard(account) {
  const fields = flatten(account.fields).slice(0, 48)
  const stats = [
    { label: "UID", value: account.uid || "-" },
    { label: "昵称", value: account.nickname || "-" },
    { label: "等级", value: account.level ?? "-" },
    { label: "登录天数", value: account.loginDays ?? "接口未返回" },
  ]
  return {
    title: "崩坏学园2 账号信息",
    subtitle: `UID ${account.uid || "未识别"}`,
    notice: account.loginDays == null ? "当前接口未返回登录天数，已展示其余可用字段。" : "",
    stats,
    fields,
    sections: [],
    links: [],
  }
}

export function showcaseCard(showcase, lookup) {
  const toItem = item => {
    const catalog = lookup(item.name)
    return {
      name: catalog?.name || item.name,
      tag: [item.level != null ? `Lv.${item.level}` : "", item.rarity ? `稀有度 ${item.rarity}` : ""].filter(Boolean).join(" · "),
      image: item.image || "",
      localImage: catalog?.image || "",
    }
  }
  return {
    title: "崩坏学园2 展柜",
    subtitle: `UID ${showcase.uid}`,
    notice: !showcase.characters.length && !showcase.weapons.length ? "当前账号未返回可展示的角色或武器数据。" : "",
    stats: [
      { label: "角色", value: showcase.characters.length },
      { label: "武器", value: showcase.weapons.length },
    ],
    fields: [],
    sections: [
      { title: "角色", items: showcase.characters.slice(0, 30).map(toItem) },
      { title: "武器", items: showcase.weapons.slice(0, 30).map(toItem) },
    ].filter(section => section.items.length),
    links: [],
  }
}

export function catalogCard(entry) {
  return {
    title: `崩坏学园2 ${entry.type === "weapon" ? "武器" : "角色"}图鉴`,
    subtitle: `条目 #${entry.id}`,
    notice: "",
    stats: [
      { label: "名称", value: entry.name },
      { label: "类型", value: entry.type === "weapon" ? "武器" : "角色" },
      { label: "稀有度", value: entry.rarity || "未知" },
    ],
    fields: [
      { label: "别名", value: (entry.aliases || []).join("、") || "-" },
      { label: "描述", value: entry.description || "-" },
    ],
    sections: [{ title: entry.name, items: [{ name: entry.name, tag: entry.rarity || "", localImage: entry.image || "" }] }],
    links: entry.sourceUrl ? [entry.sourceUrl] : [],
  }
}

function catalogItem(entry) {
  return {
    name: entry.name,
    tag: `${entry.type === "weapon" ? "武器" : "角色"}${entry.rarity ? ` · ${entry.rarity}` : ""} · #${entry.id}`,
    localImage: entry.image || "",
  }
}

export function catalogListCard({ items = [], keyword = "", type = "", page = 1, pages = 1, total = 0, suggestions = [] } = {}) {
  const typeName = type === "weapon" ? "武器" : type === "character" ? "角色" : "角色与武器"
  const suggestionText = suggestions.map(item => item.name).join("、")
  return {
    title: `崩坏学园2 ${typeName}图鉴`,
    subtitle: keyword ? `关键词“${keyword}” · 第 ${page}/${pages} 页` : `第 ${page}/${pages} 页`,
    notice: !items.length
      ? suggestionText ? `没有找到直接匹配。你可能想找：${suggestionText}` : "没有找到相关图鉴条目。"
      : "",
    stats: [
      { label: "结果", value: total },
      { label: "当前页", value: `${page}/${pages}` },
    ],
    fields: [],
    sections: items.length ? [{ title: keyword ? "匹配结果" : "图鉴索引", items: items.map(catalogItem) }] : [],
    links: [],
  }
}

export function statusCard({ version, catalog, stats } = {}) {
  return {
    title: "崩坏学园2 插件状态",
    subtitle: `bh2-plugin v${version || "unknown"}`,
    notice: stats?.total ? "" : "本地图鉴尚未安装，请让 Bot 主人发送 #BH2图鉴更新。",
    stats: [
      { label: "图鉴条目", value: stats?.total || 0 },
      { label: "角色", value: stats?.characters || 0 },
      { label: "武器", value: stats?.weapons || 0 },
      { label: "图片", value: stats?.images || 0 },
    ],
    fields: [
      { label: "图鉴版本", value: catalog?.version || "未安装" },
      { label: "快照时间", value: catalog?.generatedAt || "-" },
      { label: "数据来源", value: catalog?.source || "-" },
    ],
    sections: [],
    links: [],
  }
}

export function helpModel(master = false) {
  const groups = [
    {
      title: "账号查询",
      items: [
        { command: "¥登录天数 [UID]", description: "查询账号等级与累计登录天数" },
        { command: "#BH2账号 [UID]", description: "查看 Cookie 中的崩坏学园2账号" },
        { command: "#BH2展柜 [UID]", description: "查看公开角色与武器展柜" },
      ],
    },
    {
      title: "图鉴功能",
      items: [
        { command: "#BH2图鉴 [关键词] [第N页]", description: "搜索或分页浏览全部图鉴" },
        { command: "#BH2角色图鉴 [关键词]", description: "只查询角色图鉴" },
        { command: "#BH2武器图鉴 [关键词]", description: "只查询武器与装备图鉴" },
        { command: "#BH2图鉴详情 <编号或名称>", description: "查看指定条目的完整图片" },
      ],
    },
    {
      title: "绑定设置",
      items: [
        { command: "#BH2绑定 <UID>", description: "绑定当前使用的游戏 UID" },
        { command: "#BH2切换 <UID>", description: "切换当前游戏 UID" },
        { command: "#BH2解绑", description: "解除当前 UID 绑定" },
        { command: "#BH2版本 / #BH2状态", description: "查看插件与图鉴状态" },
      ],
    },
  ]
  if (master) {
    groups.push({
      title: "插件管理 · 仅主人",
      items: [
        { command: "#BH2图鉴更新", description: "从独立仓库安装或更新图鉴" },
        { command: "#BH2更新", description: "从 GitHub 安全更新主插件并重启" },
        { command: "#BH2更新日志", description: "查看本地版本更新记录" },
        { command: "#BH2cookie [UID] <Cookie>", description: "仅限私聊配置回退 Cookie" },
      ],
    })
  }
  return {
    title: "崩坏学园2 插件帮助",
    subtitle: "支持 ¥ / #崩坏学园2 / #崩坏2 / #崩2 / #BH2 / #bb / #b2",
    groups,
  }
}

export function textFallback(model) {
  const lines = [`=== ${model.title} ===`, model.subtitle]
  if (model.notice) lines.push(model.notice)
  for (const item of model.stats || []) lines.push(`${item.label}: ${item.value}`)
  for (const item of model.fields || []) lines.push(`${item.label}: ${item.value}`)
  for (const section of model.sections || []) {
    lines.push("", `【${section.title}】`)
    for (const item of section.items || []) lines.push(`${item.name}${item.tag ? ` (${item.tag})` : ""}`)
  }
  return lines.filter(Boolean).join("\n")
}

export async function replyCard(e, model) {
  try {
    if (e.runtime?.render) {
      const result = await e.runtime.render("bh2-plugin", "html/card", model, { retType: "msgId" })
      if (result) return result
    }
  } catch (error) {
    globalThis.logger?.warn?.(`[bh2] 卡片渲染失败: ${error.message}`)
  }
  return e.reply(textFallback(model))
}

export function helpText(model) {
  const lines = [`=== ${model.title} ===`, model.subtitle]
  for (const group of model.groups || []) {
    lines.push("", `【${group.title}】`)
    for (const item of group.items || []) lines.push(`${item.command}\n${item.description}`)
  }
  return lines.join("\n")
}

export async function replyHelp(e, model) {
  try {
    if (e.runtime?.render) {
      const result = await e.runtime.render("bh2-plugin", "html/help", model, { retType: "msgId" })
      if (result) return result
    }
  } catch (error) {
    globalThis.logger?.warn?.(`[bh2] 帮助图片渲染失败: ${error.message}`)
  }
  return e.reply(helpText(model))
}
