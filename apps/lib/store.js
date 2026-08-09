import fs from "node:fs"
import path from "node:path"

const dataDir = path.join(process.cwd(), "data", "bh2")
const bindsFile = path.join(dataDir, "binds.json")
const cookiesFile = path.join(dataDir, "cookies.json")
const sharedDb = path.join(process.cwd(), "data", "db", "data.db")

function readJson(file, fallback = {}) {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback
  } catch (error) {
    globalThis.logger?.warn?.(`[bh2] 读取 ${path.basename(file)} 失败: ${error.message}`)
    return fallback
  }
}

function writeJson(file, value) {
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8")
}

export function getBindUid(qq = "") {
  return String(readJson(bindsFile)[String(qq)] || "").trim()
}

export function setBindUid(qq = "", uid = "") {
  const data = readJson(bindsFile)
  data[String(qq)] = String(uid).trim()
  writeJson(bindsFile, data)
}

export function removeBindUid(qq = "") {
  const data = readJson(bindsFile)
  delete data[String(qq)]
  writeJson(bindsFile, data)
}

export function getLocalCookie(uid = "") {
  const data = readJson(cookiesFile)
  return String(data[String(uid)] || data._default || "").trim()
}

export function setCookie(uid = "", cookie = "") {
  const data = readJson(cookiesFile)
  if (uid) data[String(uid)] = String(cookie).trim()
  else data._default = String(cookie).trim()
  writeJson(cookiesFile, data)
}

function parseJson(value, fallback = {}) {
  try {
    return JSON.parse(value) || fallback
  } catch {
    return fallback
  }
}

async function querySharedDb(sql) {
  if (!fs.existsSync(sharedDb)) return []
  try {
    const sqlite = await import("sqlite3")
    return await new Promise((resolve, reject) => {
      const db = new sqlite.default.Database(sharedDb, sqlite.default.OPEN_READONLY, error => {
        if (error) return reject(error)
        db.all(sql, [], (queryError, rows) => {
          db.close()
          queryError ? reject(queryError) : resolve(rows || [])
        })
      })
    })
  } catch (error) {
    globalThis.logger?.debug?.(`[bh2] 共享 CK 不可用: ${error.message}`)
    return []
  }
}

/** 只返回绑定了 BH2 UID 的共享 Cookie，避免跨账号查询。 */
export async function getExternalCk(uid = "") {
  const normalizedUid = String(uid || "")
  const rows = await querySharedDb(
    "SELECT ck, uids FROM MysUsers WHERE ck IS NOT NULL AND ck != ''",
  )
  for (const row of rows) {
    const uids = parseJson(row.uids)
    const list = Array.isArray(uids.bh2) ? uids.bh2.map(String) : []
    if (list.includes(normalizedUid)) return String(row.ck)
  }
  return ""
}

/** 共享库优先，本地 UID Cookie，再回退默认 Cookie。 */
export async function getCookie(uid = "") {
  return (await getExternalCk(uid)) || getLocalCookie(uid)
}
