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
