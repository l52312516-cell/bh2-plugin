import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "catalog.json")
let catalog

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

function normalize(value) {
  return String(value || "").trim().toLocaleLowerCase("zh-CN")
}

function score(entry, keyword) {
  const needle = normalize(keyword)
  if (!needle) return 0
  const names = [entry.name, ...(entry.aliases || [])].map(normalize)
  if (names.some(name => name === needle)) return 100
  if (names.some(name => name.startsWith(needle))) return 70
  if (names.some(name => name.includes(needle))) return 40
  return 0
}

export function getAllEntries(type = "") {
  return load().filter(entry => !type || entry.type === type)
}

export function searchCatalog(keyword, type = "") {
  return getAllEntries(type)
    .map(entry => ({ entry, score: score(entry, keyword) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || String(a.entry.name).localeCompare(String(b.entry.name), "zh-CN"))
    .map(item => item.entry)
}

export function findEntry(keyword, type = "") {
  return searchCatalog(keyword, type)[0] || null
}

export function getEntryById(id) {
  return load().find(entry => String(entry.id) === String(id)) || null
}

export function catalogMeta() {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"))
    return { version: value.version || "unknown", source: value.source || "" }
  } catch {
    return { version: "unknown", source: "" }
  }
}
