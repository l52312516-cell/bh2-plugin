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
    showcase: process.env.BH2_SHOWCASE_ENDPOINT || fileConfig.endpoints?.showcase || "/characters",
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
  let found
  walk(value, (key, child) => {
    if (found === undefined && keys.some(candidate => key.toLowerCase() === candidate.toLowerCase())) found = child
  })
  return found
}

function findArray(value, keys) {
  const result = findFirst(value, keys)
  return Array.isArray(result) ? result : []
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

export function normalizeShowcase(raw = {}, uid = "") {
  const characters = findArray(raw, ["characters", "avatars", "roles", "role_list"])
  const weapons = findArray(raw, ["weapons", "equipment", "weapon_list"])
  const mapItem = item => ({
    id: item.id ?? item.item_id ?? item.avatar_id ?? item.weapon_id,
    name: item.name ?? item.nickname ?? item.title ?? "未知",
    level: item.level ?? item.lv,
    rarity: item.rarity ?? item.star ?? item.rank,
    image: item.icon ?? item.icon_path ?? item.image ?? item.avatar ?? item.figure_path ?? "",
    raw: sanitizePublic(item),
  })
  return { uid: String(uid), characters: characters.map(mapItem), weapons: weapons.map(mapItem), raw: sanitizePublic(raw) }
}

export const apiConfig = config
