import { normalizeCatalogDetails } from "./catalog.js"
export { normalizeCatalogDetails }

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

export function showcaseCard(showcase, lookup, role = {}) {
  showcase = {
    characters: [], weapons: [], emblems: [], posters: [], costumes: [], pets: [], achievements: [], stats: {}, ...showcase,
  }
  const toItem = item => {
    const catalog = lookup(item.name, item.id)
    return {
      id: item.id || catalog?.id || "",
      name: catalog?.name || item.name,
      tag: [item.level != null ? `Lv.${item.level}` : "", item.rarity ? `稀有度 ${item.rarity}` : ""].filter(Boolean).join(" · "),
      image: /^https:\/\//i.test(String(item.image || "")) ? item.image : "",
      localImage: catalog?.image || "",
      attributes: catalog ? normalizeCatalogDetails(catalog).attributes.slice(0, 3) : [],
    }
  }
  const recordStats = showcase.stats || {}
  const value = (key, fallback = "-") => recordStats[key] ?? fallback
  const formatPlayTime = seconds => Number(seconds) > 0 ? `${Math.floor(Number(seconds) / 360) / 10} 小时` : "-"
  const formatRate = rate => Number(rate) > 0 ? `${Math.floor(Number(rate)) / 10}%` : "-"
  const stats = [
    { label: "装备图鉴", value: value("handbook_count") },
    { label: "看板收集", value: formatRate(value("post_rate", 0)) },
    { label: "使魔", value: value("pet_count") },
    { label: "萌章", value: value("emblem_count") },
    { label: "成就", value: value("achieve_count") },
    { label: "好感度", value: value("vip_level") },
    { label: "入学时长", value: formatPlayTime(value("play_time", 0)) },
  ]
  if (showcase.characters.length || showcase.weapons.length) {
    stats.unshift({ label: "角色", value: showcase.characters.length }, { label: "武器", value: showcase.weapons.length })
  }
  const profile = showcase.profile || {}
  const sections = [
    { title: "角色", items: showcase.characters.slice(0, 30).map(toItem) },
    { title: "武器", items: showcase.weapons.slice(0, 30).map(toItem) },
    { title: "徽章", items: showcase.emblems.slice(0, 30).map(toItem) },
    { title: "看板 / 服装", items: [...(showcase.posters || []), ...(showcase.costumes || [])].slice(0, 30).map(toItem) },
    { title: "萌章 / 宠物", items: showcase.pets.slice(0, 30).map(toItem) },
  ].filter(section => section.items.length)
  return {
    title: "崩坏学园2 玩家资料卡",
    uid: showcase.uid,
    subtitle: `UID ${showcase.uid}`,
    profile,
    notice: !sections.length
      ? "米游社 BH2 官方接口未公开角色或武器明细；公开接口未提供展柜分组明细，以下仅展示真实返回的玩家资料和统计。"
      : "",
    stats,
    fields: [
      { label: "昵称", value: profile.nickname || "未知玩家" },
      { label: "等级", value: profile.level ?? "-" },
      { label: "社团", value: profile.guild || "-" },
      { label: "区服", value: profile.region || "-" },
      ...(profile.vip != null ? [{ label: "VIP", value: profile.vip }] : []),
    ],
    sections,
    links: [],
  }
}

export function catalogCard(entry) {
  const details = normalizeCatalogDetails(entry)
  const fields = [
    { label: "别名", value: (entry.aliases || []).join("、") || "-" },
    { label: "描述", value: entry.description || "-" },
    ...(details.series?.name ? [{ label: "系列", value: details.series.name }] : []),
    ...(details.equipmentType ? [{ label: "装备分类", value: details.equipmentType }] : []),
  ]
  return {
    title: `崩坏学园2 ${entry.type === "weapon" ? "武器" : "角色"}图鉴`,
    subtitle: `条目 #${entry.id}`,
    notice: "",
    stats: [
      { label: "名称", value: entry.name },
      { label: "类型", value: entry.type === "weapon" ? "武器" : "角色" },
      { label: "稀有度", value: entry.rarity || "未知" },
    ],
    fields,
    attributes: details.attributes,
    skills: details.skills,
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
        { command: "#BH2展柜 [UID]", description: "查看官方战绩与看板收集概览" },
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
        { command: "#BH2图鉴强制更新", description: "强制覆盖安装最新图鉴图片和索引" },
        { command: "#BH2更新", description: "从 GitHub 安全更新主插件并重启" },
        { command: "#BH2强制更新", description: "强制覆盖主插件程序文件并重启" },
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
  for (const item of model.attributes || []) lines.push(`${item.label}: ${item.value}`)
  for (const skill of model.skills || []) {
    lines.push("", `【${skill.group || "技能"}】${skill.title || ""}`)
    if (skill.damageType) lines.push(`伤害类型: ${skill.damageType}`)
    if (skill.description) lines.push(`描述: ${skill.description}`)
    if (skill.maxLevelDescription) lines.push(`满级: ${skill.maxLevelDescription}`)
  }
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

export async function replyShowcase(e, model) {
  try {
    if (e.runtime?.render) {
      const result = await e.runtime.render("bh2-plugin", "html/showcase", model, { retType: "msgId" })
      if (result) return result
    }
  } catch (error) {
    globalThis.logger?.warn?.(`[bh2] 展柜卡片渲染失败: ${error.message}`)
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
