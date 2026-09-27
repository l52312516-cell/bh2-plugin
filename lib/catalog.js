import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "catalog.json")
const resourceRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "resources")
let catalog

const DAMAGE_TYPES = {
  physic: "物理",
  physical: "物理",
  element: "元素",
  fire: "火焰",
  snow: "冰霜",
  ice: "冰冻",
  thunder: "雷电",
  light: "光能",
  poison: "毒素",
  power: "能量",
  none: "无",
}

function load() {
  if (catalog) return catalog
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"))
    catalog = Array.isArray(value) ? value : value.entries || []
  } catch (error) {
    globalThis.logger?.warn?.(`[bh2] 图鉴加载失败: ${error.message}`)
    catalog = []
  }
  return catalog
}

export function reloadCatalog() {
  catalog = undefined
  return load()
}

export function normalizeCatalogText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s·•・._\-—–~～,，。:：;；!！?？'"“”‘’()（）[\]【】{}《》<>]/gu, "")
}

function matchScore(entry, keyword) {
  const needle = normalizeCatalogText(keyword)
  if (!needle) return { score: 0, exact: false }
  const name = normalizeCatalogText(entry.name)
  const aliases = (entry.aliases || []).map(normalizeCatalogText).filter(Boolean)
  const id = normalizeCatalogText(entry.id)
  if (name === needle) return { score: 1000, exact: true }
  if (aliases.includes(needle)) return { score: 950, exact: true }
  if (id === needle) return { score: 900, exact: true }
  if (name.startsWith(needle)) return { score: 800, exact: false }
  if (aliases.some(value => value.startsWith(needle))) return { score: 750, exact: false }
  if (name.includes(needle)) return { score: 650, exact: false }
  if (aliases.some(value => value.includes(needle))) return { score: 600, exact: false }
  if (id.includes(needle)) return { score: 500, exact: false }
  return { score: 0, exact: false }
}

export function getAllEntries(type = "") {
  return load().filter(entry => !type || entry.type === type)
}

export function searchEntries(entries, keyword, type = "") {
  return entries
    .filter(entry => !type || entry.type === type)
    .map(entry => ({ entry, ...matchScore(entry, keyword) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || String(a.entry.name).localeCompare(String(b.entry.name), "zh-CN"))
    .map(item => item.entry)
}

export function searchCatalog(keyword, type = "") {
  return searchEntries(load(), keyword, type)
}

export function findEntry(keyword, type = "") {
  return searchCatalog(keyword, type)[0] || null
}

export function getEntryById(id) {
  return load().find(entry => String(entry.id) === String(id)) || null
}

export function getEntryExact(query, type = "") {
  return getEntryExactFrom(load(), query, type)
}

export function getEntryExactFrom(entries, query, type = "") {
  const needle = normalizeCatalogText(query)
  if (!needle) return null
  return entries.filter(entry => !type || entry.type === type).find(entry => {
    if (normalizeCatalogText(entry.id) === needle) return true
    return [entry.name, ...(entry.aliases || [])].some(value => normalizeCatalogText(value) === needle)
  }) || null
}

function levenshtein(left, right) {
  if (!left.length) return right.length
  if (!right.length) return left.length
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let i = 1; i <= left.length; i++) {
    let diagonal = previous[0]
    previous[0] = i
    for (let j = 1; j <= right.length; j++) {
      const above = previous[j]
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (left[i - 1] === right[j - 1] ? 0 : 1))
      diagonal = above
    }
  }
  return previous[right.length]
}

export function suggestCatalog(keyword, type = "", limit = 5) {
  return suggestEntries(load(), keyword, type, limit)
}

export function suggestEntries(entries, keyword, type = "", limit = 5) {
  const needle = normalizeCatalogText(keyword)
  if (!needle) return []
  return entries
    .filter(entry => !type || entry.type === type)
    .map(entry => {
      const values = [entry.name, ...(entry.aliases || [])].map(normalizeCatalogText).filter(Boolean)
      const similarity = Math.max(...values.map(value => 1 - levenshtein(needle, value) / Math.max(needle.length, value.length)))
      return { entry, similarity }
    })
    .filter(item => item.similarity >= 0.28)
    .sort((a, b) => b.similarity - a.similarity || String(a.entry.name).localeCompare(String(b.entry.name), "zh-CN"))
    .slice(0, limit)
    .map(item => item.entry)
}

export function catalogPage({ keyword = "", type = "", page = 1, pageSize = 12, entries: sourceEntries } = {}) {
  const source = Array.isArray(sourceEntries) ? sourceEntries : load()
  const exact = keyword ? getEntryExactFrom(source, keyword, type) : null
  const entries = keyword ? searchEntries(source, keyword, type) : source.filter(entry => !type || entry.type === type)
    .slice()
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "zh-CN"))
  const pages = Math.max(1, Math.ceil(entries.length / pageSize))
  const current = Math.min(Math.max(1, Number(page) || 1), pages)
  return {
    exact,
    items: entries.slice((current - 1) * pageSize, current * pageSize),
    total: entries.length,
    page: current,
    requestedPage: Math.max(1, Number(page) || 1),
    pages,
    suggestions: keyword && !entries.length ? suggestEntries(source, keyword, type) : [],
  }
}

export function catalogStats({ entries: sourceEntries, resourceRoot: sourceRoot = resourceRoot } = {}) {
  const entries = Array.isArray(sourceEntries) ? sourceEntries : load()
  const imageRoot = path.join(sourceRoot, "img")
  let installedImages = 0
  const countImages = directory => {
    let children
    try { children = fs.readdirSync(directory, { withFileTypes: true }) } catch { return }
    for (const child of children) {
      const target = path.join(directory, child.name)
      if (child.isDirectory()) countImages(target)
      else if (child.isFile() && /\.(?:png|jpe?g|webp)$/i.test(child.name)) installedImages++
    }
  }
  countImages(imageRoot)
  return {
    total: entries.length,
    characters: entries.filter(entry => entry.type === "character").length,
    weapons: entries.filter(entry => entry.type === "weapon").length,
    images: installedImages,
  }
}

export function catalogMeta() {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"))
    return { version: value.version || "unknown", source: value.source || "", generatedAt: value.generatedAt || value.version || "" }
  } catch {
    return { version: "unknown", source: "", generatedAt: "" }
  }
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== "" && !(typeof value === "number" && value === 0)
}

function rangeValue(base, max, add) {
  if (!hasValue(base) && !hasValue(max)) return ""
  const format = value => {
    if (value == null) return "-"
    const number = Number(value)
    return Number.isFinite(number) && /^-?\d+(?:\.\d+)?$/.test(String(value))
      ? String(Number(number.toFixed(2)))
      : String(value)
  }
  if (hasValue(max) && String(max) !== String(base)) return `${format(base)} → ${format(max)}`
  if (hasValue(add)) return `${format(base)} (+${format(add)}/级)`
  return format(base ?? max)
}

function cleanSkillText(value, limit = 500) {
  const text = String(value || '').replace(new RegExp('#![A-Za-z_]+[(][^)]*[)]','g'),'').replace(/<[/]?color[^>]*>/gi,'').replace(/#[0-9]+/g,'〔参数未解析〕').split(String.fromCharCode(10)).join(' ').split(String.fromCharCode(13)).join(' ').split(String.fromCharCode(9)).join(' ').replace(/ {2,}/g,' ').trim()
  return text.length > limit ? text.slice(0,limit) + '…（内容截断）' : text
}

export function normalizeCatalogDetails(entry = {}) {
  const stats = entry.stats || {}
  const attributes = []
  const push = (label, value) => { if (hasValue(value)) attributes.push({ label, value: String(value) }) }
  const damageType = DAMAGE_TYPES[stats.damageType || entry.damageType]
  if (damageType && damageType !== "无") push("伤害类型", damageType)
  push("攻击力", rangeValue(stats.damageBase ?? entry.damageBase, stats.damageMaxLv ?? entry.damageMaxLv, stats.damageAdd ?? entry.damageAdd))
  push("生命", rangeValue(stats.hpBase ?? entry.hpBase, stats.hpMaxLv ?? entry.hpMaxLv, stats.hpAdd ?? entry.hpAdd))
  push("载弹", rangeValue(stats.ammoBase ?? entry.ammoBase, stats.ammoMaxLv ?? entry.ammoMaxLv, stats.ammoAdd ?? entry.ammoAdd))
  push("攻速", rangeValue(stats.fireRateBase ?? entry.fireRateBase, stats.fireRateMaxLv ?? entry.fireRateMaxLv, stats.fireRateAdd ?? entry.fireRateAdd))
  push("冷却时间", rangeValue(stats.countDownTimeBase ?? entry.countDownTimeBase, stats.countDownTimeMaxLv ?? entry.countDownTimeMaxLv, stats.countDownTimeAdd ?? entry.countDownTimeAdd))
  push("多重射击", stats.multiShootLineNum ?? entry.multiShootLineNum)
  const critical = stats.criticalRate ?? entry.criticalRate
  if (hasValue(critical)) {
    const value = Number(critical) <= 1 ? Number(critical) * 100 : Number(critical)
    push("暴击率", `${Number.isFinite(value) ? Number(value.toFixed(2)) : critical}%`)
  }
  push("负重", entry.cost ?? stats.cost)
  push("等级上限", entry.maxLevel ?? entry.maxlv)
  push("部署上限", stats.limitedNumber ?? entry.limitedNumber)
  const skills = (Array.isArray(entry.skills) ? entry.skills : []).slice(0, 12).map(skill => ({
    group: cleanSkillText(skill.group || "技能", 40),
    title: cleanSkillText(skill.title || skill.name || "未命名技能", 80),
    damageType: DAMAGE_TYPES[skill.damageType] || '',
    description: cleanSkillText(skill.description || skill.desc, 500),
    maxLevelDescription: cleanSkillText(skill.maxLevelDescription || skill.max_desc, 500),
  })).filter(skill => skill.description || skill.maxLevelDescription || skill.title)
  const series = entry.series || (entry.seriesText ? { name: entry.seriesText } : null)
  const warnings = []
  if ((entry.skills || []).length > 12) warnings.push('技能超过展示上限，仅展示前12项。')
  if (skills.some(s => (s.description+s.maxLevelDescription).includes('参数未解析'))) warnings.push('部分技能参数未解析，未填充推测数值。')
  if (skills.some(s => (s.description+s.maxLevelDescription).includes('内容截断'))) warnings.push('超长技能已标注截断位置。')
  return { attributes, skills, series, notice: warnings.join(' '), equipmentType: entry.equipmentTypeName || entry.equipmentType || entry.baseType || '' }
}
