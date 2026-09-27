import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { getCookie } from "./store.js"

const configFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "config", "config.json")
let fileConfig = {}
try {
  fileConfig = JSON.parse(fs.readFileSync(configFile, "utf8"))
} catch {}

const config = {
  roleBase: process.env.BH2_ROLE_BASE || fileConfig.roleBase || "https://api-takumi.mihoyo.com",
  recordBase:
    process.env.BH2_RECORD_BASE ||
    fileConfig.recordBase ||
    "https://api-takumi-record.mihoyo.com/game_record/app/bh2/api",
  gameBiz: process.env.BH2_GAME_BIZ || fileConfig.gameBiz || "bh2_cn",
  defaultServer: process.env.BH2_DEFAULT_SERVER || fileConfig.defaultServer || "prod_gf_cn",
  timeoutMs: Number(process.env.BH2_TIMEOUT_MS || fileConfig.requestTimeoutMs || 15000),
  endpoints: {
    ...fileConfig.endpoints,
    loginDays: process.env.BH2_LOGIN_DAYS_ENDPOINT || fileConfig.endpoints?.loginDays || "/index",
    showcase: (() => {
      const value = process.env.BH2_SHOWCASE_ENDPOINT || fileConfig.endpoints?.showcase || "/index"
      return value === "/characters" ? "/index" : value
    })(),
  },
}

const serverCache = new Map()
const memoryCache = new Map()
const RECORD_SALT = "xV8v4Qu54lUKrEYFZkJhB8cuOh9Asafs"
const WEB_SALT = "yBh10ikxtLPoIhgwgPZSv5dmfaOTSJ6a"

const secretKey = /(cookie|token|sign|device|secret|password|authorization|ds)/i

function md5(value) {
  return crypto.createHash("md5").update(String(value)).digest("hex")
}

function recordDs(query = "", body = "") {
  const t = Math.floor(Date.now() / 1000)
  const r = Math.floor(Math.random() * 900000 + 100000)
  return `${t},${r},${md5(`salt=${RECORD_SALT}&t=${t}&r=${r}&b=${body}&q=${query}`)}`
}

function webDs() {
  const t = Math.floor(Date.now() / 1000)
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
  const r = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("")
  return `${t},${r},${md5(`salt=${WEB_SALT}&t=${t}&r=${r}`)}`
}

export function buildQuery(params = {}) {
  return Object.keys(params)
    .sort()
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key] ?? "")}`)
    .join("&")
}

function headers(cookie, ds) {
  return {
    Cookie: cookie,
    DS: ds,
    "x-rpc-app_version": "2.102.1",
    "x-rpc-client_type": "5",
    "X-Requested-With": "com.mihoyo.hyperion",
    "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36 miHoYoBBS/2.102.1",
    Referer: "https://webstatic.mihoyo.com/",
    Origin: "https://webstatic.mihoyo.com/",
  }
}

function errorMessage(retcode, message = "") {
  const messages = {
    "10001": "Cookie 未配置或已失效，请重新绑定。",
    "-100": "Cookie 已失效，请重新绑定。",
    "1034": "触发米游社风控验证码，请稍后重试或更换 Cookie。",
    "10035": "请求过于频繁，请稍后再试。",
    "-51": "未找到该 UID 的绑定信息。",
  }
  return messages[String(retcode)] || message || `米游社接口错误 (${retcode})`
}

async function requestJson(url, requestHeaders, fetchImpl = globalThis.fetch, timeoutMs = config.timeoutMs) {
  if (typeof fetchImpl !== "function") throw new Error("当前 Node 环境没有可用的 fetch")
  const response = await fetchImpl(url, {
    headers: requestHeaders,
    signal: typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined,
  })
  const text = await response.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    if (response.status === 404) throw new Error("米游社接口地址不存在 (HTTP 404)，请更新插件或检查 endpoints 配置。")
    throw new Error(`接口返回异常 (HTTP ${response.status})`)
  }
  if (!response.ok) throw new Error(`接口请求失败 (HTTP ${response.status})`)
  if (Number(json?.retcode) !== 0) throw new Error(errorMessage(json?.retcode, json?.message))
  return json.data || {}
}

export async function getUserGameRoles(cookie = "", options = {}) {
  if (!cookie) throw new Error("未配置 Cookie，请先绑定米游社 Cookie")
  const query = buildQuery({ game_biz: options.gameBiz || config.gameBiz })
  const url = `${options.roleBase || config.roleBase}/binding/api/getUserGameRolesByCookie?${query}`
  const data = await requestJson(url, headers(cookie, webDs()), options.fetchImpl)
  return Array.isArray(data.list) ? data.list : []
}

async function resolveServer(uid, cookie, options) {
  const key = `${options.gameBiz || config.gameBiz}:${uid}:${md5(cookie)}`
  if (serverCache.has(key)) return serverCache.get(key)
  const roles = await getUserGameRoles(cookie, options)
  const role = roles.find(item => String(item.game_uid) === String(uid))
  if (!role) throw new Error(`拒绝查询 UID ${uid}：当前 Cookie 不属于该崩坏学园2账号。`)
  const server = role.region || role.server || options.defaultServer || config.defaultServer
  serverCache.set(key, server)
  return server
}

export async function recordRequest(endpoint, uid, extraParams = {}, cookie = "", options = {}) {
  const ck = cookie || (await getCookie(uid))
  if (!ck) throw new Error("未配置 Cookie，请先绑定米游社 Cookie")
  const endpointPath = options.endpoints?.[endpoint] || config.endpoints[endpoint] || endpoint
  const server = await resolveServer(uid, ck, options)
  const params = { role_id: String(uid), server, ...extraParams }
  const query = buildQuery(params)
  const cacheKey = `${endpoint}:${query}`
  const now = Date.now()
  const cached = memoryCache.get(cacheKey)
  const ttl = Number(options.cacheTtlSeconds || fileConfig.cacheTtlSeconds || 300) * 1000
  if (cached && now - cached.time < ttl) return cached.value
  const url = `${options.recordBase || config.recordBase}${endpointPath}?${query}`
  const value = await requestJson(url, headers(ck, recordDs(query)), options.fetchImpl)
  memoryCache.set(cacheKey, { time: now, value })
  return value
}

function walk(value, visitor, depth = 0) {
  if (depth > 8 || value == null) return
  if (Array.isArray(value)) return value.forEach(item => walk(item, visitor, depth + 1))
  if (typeof value !== "object") return
  for (const [key, child] of Object.entries(value)) {
    visitor(key, child)
    walk(child, visitor, depth + 1)
  }
}

export function sanitizePublic(value) {
  if (Array.isArray(value)) return value.map(item => sanitizePublic(item))
  if (!value || typeof value !== "object") return value
  const result = {}
  for (const [key, child] of Object.entries(value)) {
    if (secretKey.test(key)) continue
    result[key] = sanitizePublic(child)
  }
  return result
}

function findFirst(value, keys) {
  const wanted = new Set(keys.map(normalizeFieldKey))
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (wanted.has(normalizeFieldKey(key))) return child
    }
  }
  let found
  walk(value, (key, child) => {
    if (found === undefined && wanted.has(normalizeFieldKey(key))) found = child
  })
  return found
}

function normalizeFieldKey(value) {
  return String(value || "")
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z\d\u3400-\u9fff]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
}

function findArray(value, keys) {
  const result = findFirst(value, keys)
  if (Array.isArray(result)) return result
  if (!result || typeof result !== "object") return []
  // Some BH2 responses wrap a collection in { list/items/data }, while
  // older responses use an object keyed by the item id.
  for (const key of ["list", "items", "data", "records", "values"]) {
    if (Array.isArray(result[key])) return result[key]
  }
  const values = Object.values(result).filter(item => item && typeof item === "object")
  return values.length ? values : []
}

function findWithKey(value, keys) {
  let found
  const wanted = new Set(keys.map(normalizeFieldKey))
  walk(value, (key, child) => {
    if (!found && wanted.has(normalizeFieldKey(key))) found = { key, value: child }
  })
  return found
}

function objectValue(value, keys) {
  if (!value || typeof value !== "object") return undefined
  const wanted = new Set(keys.map(normalizeFieldKey))
  for (const [key, child] of Object.entries(value)) {
    if (wanted.has(normalizeFieldKey(key))) return child
  }
  return undefined
}

function scalarValue(value, keys = ["value", "count", "number", "num", "total", "name", "title", "text"]) {
  if (value == null || typeof value !== "object") return value
  for (const key of keys) {
    const child = objectValue(value, [key])
    if (child != null && typeof child !== "object") return child
  }
  return value
}

function httpsImage(value) {
  const url = String(value || "").trim()
  return /^https:\/\//i.test(url) ? url : ""
}

function uniqueItems(items) {
  const seen = new Set()
  return items.filter(item => {
    const key = [item.id, item.name, item.image].map(value => String(value || "")).join("|")
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function normalizeAccount(raw = {}, uid = "") {
  const safe = sanitizePublic(raw)
  const loginDays = findFirst(raw, ["login_days", "login_day_number", "loginDays", "active_day_number", "days"])
  const role = findFirst(raw, ["role", "user", "account", "player"]) || {}
  return {
    uid: String(uid || findFirst(raw, ["game_uid", "uid"]) || ""),
    nickname: findFirst(role, ["nickname", "name", "nick_name"]) || findFirst(raw, ["nickname", "name"]),
    level: findFirst(role, ["level", "lv", "level_number"]) || findFirst(raw, ["level", "lv"]),
    loginDays: loginDays == null ? null : Number(loginDays),
    fields: safe,
  }
}

export function normalizeShowcase(raw = {}, uid = "", role = {}) {
  const characters = findArray(raw, ["characters", "avatars", "roles", "role_list", "character_list", "character_showcase"])
  const weapons = findArray(raw, ["weapons", "equipment", "weapon_list", "equipments", "equip_list", "weapon_showcase"])
  const emblems = findArray(raw, ["emblems", "badges", "badge_list", "medals", "medal_list", "emblem_list"])
  const posters = findArray(raw, ["posters", "figures", "poster_list", "figure_list", "boards", "board_list"])
  const costumes = findArray(raw, ["costumes", "skins", "outfits", "costume_list", "skin_list"])
  const pets = findArray(raw, ["pets", "companions", "萌章", "mengzhang", "pet_list", "pet_showcase"])
  const achievements = findArray(raw, ["achievements", "achieve_list", "achievement_list"])
  const itemSource = item => {
    if (!item || typeof item !== "object") return { id: item }
    const nested = item.item || item.equipment || item.weapon || item.character || item.avatar
    return nested && typeof nested === "object" ? { ...item, ...nested } : item
  }
  const mapItem = item => {
    const source = itemSource(item)
    return {
      id: scalarValue(source.id ?? source.uid ?? source.item_id ?? source.game_id ?? source.gameId
        ?? source.avatar_id ?? source.character_id ?? source.weapon_id ?? source.equipment_id
        ?? source.equip_id ?? source.figure_id ?? source.poster_id ?? source.costume_id
        ?? source.skin_id ?? source.pet_id ?? source.badge_id),
      name: scalarValue(source.name ?? source.nickname ?? source.title ?? source.display_name ?? source.text) || "未知",
      level: scalarValue(source.level ?? source.lv ?? source.level_number),
      rarity: scalarValue(source.rarity ?? source.star ?? source.stars ?? source.rank ?? source.star_level ?? source.max_rarity),
      image: httpsImage(source.icon ?? source.icon_url ?? source.iconUrl ?? source.icon_path
        ?? source.image ?? source.image_url ?? source.imageUrl ?? source.avatar ?? source.avatar_url
        ?? source.portrait ?? source.figure_path ?? source.background_path ?? source.pic ?? source.picture),
      raw: sanitizePublic(item),
    }
  }
  const nestedStats = findFirst(raw, ["stats", "statistics", "record_stats"])
  const stats = nestedStats && typeof nestedStats === "object" && !Array.isArray(nestedStats)
    ? sanitizePublic(nestedStats)
    : {}
  const statAliases = {
    handbook_count: ["handbook_count", "handbook_number", "equipment_count", "equip_count", "equip_number", "weapon_count", "weapon_number", "装备图鉴"],
    post_count: ["post_count", "poster_count", "posters_count", "figure_count", "figure_number", "board_count", "board_number", "skin_count", "拥有看板", "看板数量", "看板"],
    post_rate: ["post_rate", "poster_rate", "figure_rate", "board_rate", "skin_rate"],
    pet_count: ["pet_count", "pets_count", "pet_number", "companion_count", "companion_number"],
    emblem_count: ["emblem_count", "emblems_count", "emblem_number", "badge_count", "badge_number", "medal_count", "medal_number", "萌章数量", "萌章"],
    achieve_count: ["achieve_count", "achievement_count", "achievements_count", "achievement_number", "achieve_number", "成就数量"],
    vip_level: ["vip_level", "vip", "favorability", "favourability", "affection_level"],
    play_time: ["play_time", "playtime", "game_time", "game_duration", "online_time", "total_play_time", "play_time_hours", "game_hours", "游戏时长", "游戏时间", "入学时长"],
    active_day_number: ["active_day_number", "login_days", "login_day_number", "active_days"],
  }
  for (const [key, aliases] of Object.entries(statAliases)) {
    const value = findFirst(raw, aliases)
    if (value != null && stats[key] == null) stats[key] = sanitizePublic(scalarValue(value))
  }
  const achievementObject = findFirst(raw, ["achievement", "achievement_stats", "achieve_stats"])
  const achievementAliases = {
    achievement_gold: ["achievement_gold", "gold_achievement", "gold_count", "gold", "金成就", "成就金"],
    achievement_silver: ["achievement_silver", "silver_achievement", "silver_count", "silver", "银成就", "成就银"],
    achievement_bronze: ["achievement_bronze", "bronze_achievement", "bronze_count", "bronze", "铜成就", "成就铜"],
  }
  for (const [key, aliases] of Object.entries(achievementAliases)) {
    const value = findFirst(raw, aliases) ?? objectValue(achievementObject, aliases)
    if (value != null && stats[key] == null) stats[key] = sanitizePublic(scalarValue(value))
  }
  const playTime = findWithKey(raw, statAliases.play_time)
  if (playTime && Number.isFinite(Number(playTime.value))) {
    const amount = Number(playTime.value)
    const key = String(playTime.key).toLowerCase()
    // Older record responses use play_time in seconds. The player-card
    // response uses game_time/game_hours in hours, so do not reinterpret the
    // legacy field merely because its value is numeric.
    if (/game_time|game_hours|play_time_hours|游戏时长|游戏时间/.test(key)) {
      const hours = /minute|min/.test(key) ? amount / 60 : amount
      if (Number.isFinite(hours)) stats.play_time_hours = Math.round(hours * 100) / 100
    }
  }
  const directStatAliases = ["handbook_count", "post_count", "post_rate", "pet_count", "emblem_count", "achieve_count", "achievement_count", "vip_level", "play_time", "active_day_number"]
  for (const key of directStatAliases) {
    const value = findFirst(raw, [key])
    if (value != null && stats[key] == null) stats[key] = sanitizePublic(value)
  }
  const apiProfile = findFirst(raw, ["profile", "profile_info", "role", "role_info", "game_role", "user", "user_info", "account", "account_info", "player", "player_info"]) || {}
  const preferRole = (roleKeys, apiKeys = roleKeys) => {
    const boundValue = findFirst(role, roleKeys)
    return boundValue !== undefined && boundValue !== null && boundValue !== ""
      ? boundValue
      : findFirst(apiProfile, apiKeys) ?? findFirst(raw, apiKeys)
  }
  const profile = {
    nickname: scalarValue(preferRole(["nickname", "name", "nick_name", "昵称"])) || "",
    level: scalarValue(preferRole(["level", "lv", "level_number", "等级"])) ?? null,
    guild: scalarValue(preferRole(["guild", "guild_name", "clan", "clan_name", "association", "association_name", "group_name", "社团"])) || "",
    vip: scalarValue(preferRole(["vip", "vip_level", "is_vip", "VIP"]) ?? stats.vip_level) ?? null,
    avatar: httpsImage(preferRole(["avatar", "avatar_url", "head_icon", "head_icon_url", "icon", "头像"])),
    region: scalarValue(preferRole(["region_name", "region", "server", "server_name", "area_name", "区服"])) || "",
  }
  return {
    uid: String(uid),
    profile,
    characters: uniqueItems(characters.map(mapItem)),
    weapons: uniqueItems(weapons.map(mapItem)),
    emblems: uniqueItems(emblems.map(mapItem)),
    posters: uniqueItems(posters.map(mapItem)),
    costumes: uniqueItems(costumes.map(mapItem)),
    pets: uniqueItems(pets.map(mapItem)),
    achievements: uniqueItems(achievements.map(mapItem)),
    stats,
    raw: sanitizePublic(raw),
  }
}

export const apiConfig = config
