import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import zlib from "node:zlib"
import { fileURLToPath } from "node:url"
import { reloadCatalog } from "./catalog.js"

const pluginRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const configFile = path.join(pluginRoot, "config", "config.json")
const maxArchiveBytes = 160 * 1024 * 1024
const maxExtractedBytes = 500 * 1024 * 1024
const maxEntries = 10000
const DEFAULT_GH_MIRRORS = [
  "https://ghproxy.net/",
  "https://ghfast.top/",
  "https://gh-proxy.com/",
  "https://github.moeyy.xyz/",
  "https://mirror.ghproxy.com/",
]
let updating = false

async function readJson(file, fallback = {}) {
  try { return JSON.parse(await fs.readFile(file, "utf8")) } catch { return fallback }
}

function updaterConfig() {
  return readJson(configFile).then(config => ({
    repository: "l52312516-cell/Honkai-Academy-2-Illustrated-Guide",
    branch: "main",
    assetName: "Honkai-Academy-2-Illustrated-Guide.zip",
    downloadUrls: [],
    mirrors: DEFAULT_GH_MIRRORS,
    connectTimeoutMs: 15000,
    idleTimeoutMs: 120000,
    ...(config.catalogUpdate || {}),
  }))
}

function requireHttps(value, label = "下载地址") {
  let parsed
  try { parsed = new URL(String(value || "")) } catch { throw new Error(`${label}无效: ${value}`) }
  if (parsed.protocol !== "https:") throw new Error(`${label}必须使用 HTTPS: ${value}`)
  return parsed.toString()
}

function normalizeMirrors(value) {
  if (!Array.isArray(value)) return DEFAULT_GH_MIRRORS
  return [...new Set(value.map(item => requireHttps(item, "镜像地址")).map(item => item.endsWith("/") ? item : `${item}/`))]
}

export function buildUrlCandidates(url, mirrors = DEFAULT_GH_MIRRORS) {
  if (!/github\.com|githubusercontent\.com/i.test(url)) return [url]
  return [...new Set([...normalizeMirrors(mirrors).map(mirror => mirror + url), url])]
}

export function buildArchiveSources(config) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.repository)) {
    throw new Error("catalogUpdate.repository 格式无效")
  }
  if (!/^[A-Za-z0-9_. -]+\.zip$/i.test(config.assetName || "")) {
    throw new Error("catalogUpdate.assetName 格式无效")
  }
  const custom = Array.isArray(config.downloadUrls) ? config.downloadUrls : []
  const sources = custom.map((url, index) => ({
    url: requireHttps(url, `catalogUpdate.downloadUrls[${index}]`),
    version: "custom",
    channel: "custom",
  }))
  sources.push({
    url: `https://github.com/${config.repository}/releases/latest/download/${encodeURIComponent(config.assetName)}`,
    version: "latest",
    channel: "release",
  })
  sources.push({
    url: `https://codeload.github.com/${config.repository}/zip/refs/heads/${encodeURIComponent(config.branch)}`,
    version: config.branch,
    channel: "branch",
  })
  return sources
}

function timeoutError(stage, timeoutMs) {
  const error = new Error(`${stage}超时（${Math.ceil(timeoutMs / 1000)} 秒）`)
  error.code = "BH2_DOWNLOAD_TIMEOUT"
  return error
}

function attemptLabel(url) {
  const parsed = new URL(url)
  const nested = parsed.pathname.match(/https?:\/\/([^/]+)/i)?.[1]
  return nested ? `${parsed.hostname} -> ${nested}` : parsed.hostname
}

export async function downloadAttempt(url, destination, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== "function") throw new Error("当前 Node 环境没有可用的 fetch")
  requireHttps(url)
  const previous = await fs.stat(destination).catch(() => null)
  const offset = previous?.isFile() ? previous.size : 0
  if (offset > maxArchiveBytes) {
    await fs.rm(destination, { force: true })
    throw new Error("断点文件超过 160 MB 限制")
  }
  const controller = new AbortController()
  const connectTimeoutMs = Math.max(1000, Number(options.connectTimeoutMs) || 15000)
  const idleTimeoutMs = Math.max(1000, Number(options.idleTimeoutMs) || 120000)
  let timeout = setTimeout(() => controller.abort(timeoutError("连接", connectTimeoutMs)), connectTimeoutMs)
  let response
  try {
    const host = new URL(url).hostname.toLowerCase()
    response = await fetchImpl(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "bh2-plugin-catalog-updater/0.5",
        Accept: "application/octet-stream",
        ...(offset ? { Range: `bytes=${offset}-` } : {}),
        ...(process.env.BH2_GITHUB_TOKEN && host.endsWith("github.com") ? { Authorization: `Bearer ${process.env.BH2_GITHUB_TOKEN}` } : {}),
      },
    })
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason || timeoutError("连接", connectTimeoutMs)
    throw error
  } finally {
    clearTimeout(timeout)
  }
  if (!response.ok && response.status !== 206) throw new Error(`HTTP ${response.status}`)
  const resumed = offset > 0 && response.status === 206
  const contentRange = String(response.headers.get("content-range") || "")
  if (resumed) {
    const start = Number(contentRange.match(/^bytes\s+(\d+)-/i)?.[1])
    if (!Number.isFinite(start) || start !== offset) throw new Error("镜像返回了无效的断点范围")
  }
  const declared = Number(contentRange.match(/\/(\d+)$/)?.[1] || response.headers.get("content-length") || 0)
  if (declared > maxArchiveBytes) throw new Error("图鉴压缩包超过 160 MB 限制")
  const handle = await fs.open(destination, resumed ? "a" : "w")
  let received = resumed ? offset : 0
  let lastLogged = received
  const armIdleTimeout = () => {
    clearTimeout(timeout)
    timeout = setTimeout(() => controller.abort(timeoutError("下载停滞", idleTimeoutMs)), idleTimeoutMs)
  }
  armIdleTimeout()
  try {
    if (!response.body) throw new Error("下载响应没有内容")
    for await (const chunk of response.body) {
      armIdleTimeout()
      received += chunk.byteLength
      if (received > maxArchiveBytes) throw new Error("图鉴压缩包超过 160 MB 限制")
      await handle.write(chunk)
      if (received - lastLogged >= 10 * 1024 * 1024) {
        lastLogged = received
        globalThis.logger?.mark?.(`[bh2] 图鉴已下载 ${Math.floor(received / 1024 / 1024)} MB${declared ? ` / ${Math.ceil(declared / 1024 / 1024)} MB` : ""}`)
      }
    }
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason || timeoutError("下载停滞", idleTimeoutMs)
    throw error
  } finally {
    clearTimeout(timeout)
    await handle.close()
  }
  const contentLength = Number(response.headers.get("content-length") || 0)
  const expected = resumed ? offset + contentLength : contentLength
  if (contentLength && received !== expected) throw new Error(`下载不完整（${received}/${expected} 字节）`)
  if (!received) throw new Error("图鉴压缩包为空")
  return { bytes: received, resumed }
}

export async function downloadArchive(config, tempRoot, fetchImpl) {
  const sources = buildArchiveSources(config)
  const attempts = []
  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
    const source = sources[sourceIndex]
    const destination = path.join(tempRoot, `catalog-${sourceIndex}.zip.part`)
    for (const current of buildUrlCandidates(source.url, config.mirrors)) {
      try {
        const result = await downloadAttempt(current, destination, {
          fetchImpl,
          connectTimeoutMs: config.connectTimeoutMs,
          idleTimeoutMs: config.idleTimeoutMs,
        })
        if (current !== source.url) globalThis.logger?.mark?.(`[bh2] 图鉴通过镜像下载完成: ${attemptLabel(current)}`)
        return { ...source, file: destination, bytes: result.bytes }
      } catch (error) {
        const label = attemptLabel(current)
        const reason = String(error?.message || error)
        attempts.push(`${label}: ${reason}`)
        globalThis.logger?.warn?.(`[bh2] 图鉴下载源失败: ${label} - ${reason}`)
      }
    }
  }
  const error = new Error(`所有图鉴下载源均失败：${attempts.slice(0, 8).join("；")}。可在 config/config.json 的 catalogUpdate.downloadUrls 配置可直连的 HTTPS 图鉴地址。`)
  error.code = "BH2_CATALOG_DOWNLOAD_FAILED"
  error.attempts = attempts
  throw error
}

function safeArchivePath(value) {
  const normalized = String(value || "").replaceAll("\\", "/").replace(/^\.\//, "")
  if (!normalized || normalized.includes("\0") || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`压缩包路径无效: ${value}`)
  }
  const parts = normalized.split("/").filter(Boolean)
  if (parts.some(part => part === "." || part === "..")) throw new Error(`压缩包包含越界路径: ${value}`)
  return parts.join("/")
}

function findEocd(buffer) {
  const minimum = Math.max(0, buffer.length - 65557)
  for (let offset = buffer.length - 22; offset >= minimum; offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset
  }
  throw new Error("ZIP 中央目录不存在")
}

async function extractZip(buffer, destination, options = {}) {
  const eocd = findEocd(buffer)
  const entryCount = buffer.readUInt16LE(eocd + 10)
  const centralOffset = buffer.readUInt32LE(eocd + 16)
  const entryLimit = Number(options.maxEntries || maxEntries)
  const extractedLimit = Number(options.maxExtractedBytes || maxExtractedBytes)
  if (entryCount > entryLimit) throw new Error(`ZIP 文件数量超过 ${entryLimit}`)
  let offset = centralOffset
  let extractedBytes = 0
  for (let index = 0; index < entryCount; index++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("ZIP 中央目录损坏")
    const flags = buffer.readUInt16LE(offset + 8)
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const uncompressedSize = buffer.readUInt32LE(offset + 24)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const externalAttributes = buffer.readUInt32LE(offset + 38)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const rawName = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8")
    const isDirectory = /[\\/]$/.test(rawName)
    const name = safeArchivePath(rawName)
    const unixMode = externalAttributes >>> 16
    if ((unixMode & 0o170000) === 0o120000) throw new Error(`ZIP 不允许符号链接: ${name}`)
    if (flags & 1) throw new Error(`ZIP 不允许加密文件: ${name}`)
    if (![0, 8].includes(method)) throw new Error(`ZIP 压缩方式不受支持: ${method}`)
    extractedBytes += uncompressedSize
    if (extractedBytes > extractedLimit) throw new Error(`ZIP 解压后超过 ${Math.floor(extractedLimit / 1024 / 1024)} MB 限制`)
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`ZIP 本地文件头损坏: ${name}`)
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize)
    const target = path.join(destination, ...name.split("/"))
    if (isDirectory) {
      await fs.mkdir(target, { recursive: true })
    } else {
      const data = method === 0 ? compressed : zlib.inflateRawSync(compressed, { maxOutputLength: uncompressedSize + 1 })
      if (data.length !== uncompressedSize) throw new Error(`ZIP 文件长度校验失败: ${name}`)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, data)
    }
    offset += 46 + nameLength + extraLength + commentLength
  }
}

async function findNamedFiles(root, fileName) {
  const queue = [root]
  const matches = []
  while (queue.length) {
    const current = queue.shift()
    for (const item of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, item.name)
      if (item.isDirectory()) queue.push(full)
      else if (item.isFile() && item.name === fileName) matches.push(full)
    }
  }
  return matches
}

async function findManifest(root) {
  const matches = await findNamedFiles(root, "manifest.json")
  if (matches.length !== 1) throw new Error(`压缩包必须包含且仅包含一个 manifest.json，实际 ${matches.length} 个`)
  return matches[0]
}

function resolveInside(base, relative, label) {
  const target = path.resolve(base, String(relative || ""))
  const prefix = path.resolve(base) + path.sep
  if (!target.startsWith(prefix)) throw new Error(`${label} 路径越界`)
  return target
}

async function validateBundle(extractedRoot) {
  const manifestPath = await findManifest(extractedRoot)
  const base = path.dirname(manifestPath)
  const manifest = await readJson(manifestPath)
  if (manifest.schemaVersion !== 1) throw new Error(`不支持的图鉴格式版本: ${manifest.schemaVersion}`)
  const catalogFile = resolveInside(base, manifest.catalog || "data/catalog.json", "catalog")
  const resourceRoot = resolveInside(base, manifest.resourceRoot || "resources", "resourceRoot")
  const catalog = await readJson(catalogFile)
  if (!Array.isArray(catalog.entries) || !catalog.entries.length) throw new Error("catalog.json 没有有效条目")
  const ids = new Set()
  let imageCount = 0
  for (const entry of catalog.entries) {
    if (!entry?.id || !entry?.name || !["character", "weapon"].includes(entry.type)) {
      throw new Error("catalog.json 包含无效条目")
    }
    if (ids.has(String(entry.id))) throw new Error(`catalog.json 条目 ID 重复: ${entry.id}`)
    ids.add(String(entry.id))
    if (!entry.image) continue
    if (!/^img\/(?:character|weapon)\/[A-Za-z0-9._-]+\.(?:png|jpe?g|webp)$/i.test(entry.image)) {
      throw new Error(`图鉴图片路径无效: ${entry.image}`)
    }
    const imageFile = resolveInside(resourceRoot, entry.image, "image")
    const stat = await fs.stat(imageFile).catch(() => null)
    if (!stat?.isFile()) throw new Error(`图鉴图片不存在: ${entry.image}`)
    imageCount++
  }
  if (manifest.catalogSha256) {
    const hash = crypto.createHash("sha256").update(await fs.readFile(catalogFile)).digest("hex")
    if (hash.toLowerCase() !== String(manifest.catalogSha256).toLowerCase()) throw new Error("catalog.json SHA256 校验失败")
  }
  const imageRoot = path.join(resourceRoot, "img")
  const imageStat = await fs.stat(imageRoot).catch(() => null)
  if (!imageStat?.isDirectory()) throw new Error("图鉴包缺少 resources/img 目录")
  return { manifest, catalog, catalogFile, imageRoot, imageCount }
}

async function removeIfExists(target) {
  await fs.rm(target, { recursive: true, force: true })
}

async function deployBundle(bundle, targetRoot = pluginRoot) {
  const stamp = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`
  const stageRoot = path.join(targetRoot, `.catalog-stage-${stamp}`)
  const stagedCatalog = path.join(stageRoot, "catalog.json")
  const stagedImages = path.join(stageRoot, "img")
  const catalogTarget = path.join(targetRoot, "data", "catalog.json")
  const imagesTarget = path.join(targetRoot, "resources", "img")
  const catalogBackup = path.join(targetRoot, "data", `.catalog.backup-${stamp}.json`)
  const imagesBackup = path.join(targetRoot, "resources", `.img.backup-${stamp}`)
  let catalogBackedUp = false
  let imagesBackedUp = false
  let catalogInstalled = false
  let imagesInstalled = false
  let deployed = false
  try {
    await fs.mkdir(stageRoot, { recursive: true })
    await fs.copyFile(bundle.catalogFile, stagedCatalog)
    await fs.cp(bundle.imageRoot, stagedImages, { recursive: true })
    await fs.mkdir(path.dirname(catalogTarget), { recursive: true })
    await fs.mkdir(path.dirname(imagesTarget), { recursive: true })
    if (await fs.stat(imagesTarget).catch(() => null)) {
      await fs.rename(imagesTarget, imagesBackup)
      imagesBackedUp = true
    }
    await fs.rename(stagedImages, imagesTarget)
    imagesInstalled = true
    if (await fs.stat(catalogTarget).catch(() => null)) {
      await fs.rename(catalogTarget, catalogBackup)
      catalogBackedUp = true
    }
    await fs.rename(stagedCatalog, catalogTarget)
    catalogInstalled = true
    if (path.resolve(targetRoot) === path.resolve(pluginRoot)) reloadCatalog()
    deployed = true
  } catch (error) {
    if (imagesInstalled) await removeIfExists(imagesTarget)
    if (catalogInstalled) await removeIfExists(catalogTarget)
    if (imagesBackedUp) await fs.rename(imagesBackup, imagesTarget).catch(() => {})
    if (catalogBackedUp) await fs.rename(catalogBackup, catalogTarget).catch(() => {})
    if (path.resolve(targetRoot) === path.resolve(pluginRoot)) reloadCatalog()
    throw error
  } finally {
    await removeIfExists(stageRoot)
    if (deployed) {
      await removeIfExists(imagesBackup).catch(error => globalThis.logger?.warn?.(`[bh2] 清理图鉴图片备份失败: ${error.message}`))
      await removeIfExists(catalogBackup).catch(error => globalThis.logger?.warn?.(`[bh2] 清理图鉴索引备份失败: ${error.message}`))
    }
  }
}

export async function updateCatalogFromGithub(options = {}) {
  if (updating) throw new Error("已有图鉴更新任务正在进行，请勿重复操作。")
  updating = true
  try {
    const config = await updaterConfig()
    const tempRoot = path.join(pluginRoot, `.catalog-download-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`)
    try {
      await fs.mkdir(tempRoot, { recursive: true })
      const archive = await downloadArchive(config, tempRoot, options.fetchImpl)
      const buffer = await fs.readFile(archive.file)
      if (!buffer.length || buffer.length > maxArchiveBytes) throw new Error("图鉴压缩包为空或超过 160 MB 限制")
      await extractZip(buffer, tempRoot)
      let bundleRoot = tempRoot
      const manifests = await findNamedFiles(tempRoot, "manifest.json")
      if (!manifests.length) {
        const nestedArchives = await findNamedFiles(tempRoot, config.assetName)
        if (nestedArchives.length !== 1) {
          throw new Error(`分支归档中未找到 manifest.json 或唯一的 ${config.assetName}`)
        }
        const nestedBuffer = await fs.readFile(nestedArchives[0])
        if (nestedBuffer.length > maxArchiveBytes) throw new Error("嵌套图鉴压缩包超过 160 MB 限制")
        bundleRoot = path.join(tempRoot, ".nested-catalog")
        await fs.mkdir(bundleRoot, { recursive: true })
        await extractZip(nestedBuffer, bundleRoot)
      }
      const bundle = await validateBundle(bundleRoot)
      await deployBundle(bundle)
      return {
        version: bundle.manifest.version || archive.version,
        channel: archive.channel,
        entries: bundle.catalog.entries.length,
        images: bundle.imageCount,
        forced: Boolean(options.force),
      }
    } finally {
      await removeIfExists(tempRoot)
    }
  } finally {
    updating = false
  }
}

export { deployBundle, extractZip, validateBundle }
