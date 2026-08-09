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
const GH_MIRRORS = [
  "https://ghfast.top/",
  "https://gh-proxy.com/",
  "https://ghproxy.net/",
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
    ...(config.catalogUpdate || {}),
  }))
}

async function fetchRemote(url, options = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 60000)
  try {
    const host = new URL(url).hostname.toLowerCase()
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "bh2-plugin-catalog-updater/0.2",
        Accept: options.accept || "application/octet-stream",
        ...(process.env.BH2_GITHUB_TOKEN && host.endsWith("github.com") ? { Authorization: `Bearer ${process.env.BH2_GITHUB_TOKEN}` } : {}),
      },
    })
    return response
  } finally {
    clearTimeout(timer)
  }
}

function buildUrlCandidates(url) {
  if (!/github\.com|githubusercontent\.com/i.test(url)) return [url]
  return [...GH_MIRRORS.map(mirror => mirror + url), url]
}

async function resolveArchive(config) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.repository)) {
    throw new Error("catalogUpdate.repository 格式无效")
  }
  const releaseApi = `https://api.github.com/repos/${config.repository}/releases/latest`
  try {
    const response = await fetchRemote(releaseApi, { accept: "application/vnd.github+json" })
    if (response.ok) {
      const release = await response.json()
      const assets = Array.isArray(release.assets) ? release.assets : []
      const asset = assets.find(item => item.name === config.assetName)
        || assets.find(item => /\.(?:zip)$/i.test(item.name || ""))
      if (asset?.browser_download_url) {
        return { url: asset.browser_download_url, version: release.tag_name || release.name || "latest", channel: "release" }
      }
    }
  } catch (error) {
    globalThis.logger?.warn?.(`[bh2] GitHub Release 查询失败，将回退到分支归档: ${error.message}`)
  }
  return {
    url: `https://codeload.github.com/${config.repository}/zip/refs/heads/${encodeURIComponent(config.branch)}`,
    version: config.branch,
    channel: "branch",
  }
}

async function downloadArchive(url) {
  const parsed = new URL(url)
  if (parsed.protocol !== "https:") throw new Error("只允许通过 HTTPS 下载图鉴")
  const response = await fetchRemote(url)
  if (!response.ok) throw new Error(`图鉴下载失败: HTTP ${response.status}`)
  const declared = Number(response.headers.get("content-length") || 0)
  if (declared > maxArchiveBytes) throw new Error("图鉴压缩包超过 160 MB 限制")
  const buffer = Buffer.from(await response.arrayBuffer())
  if (!buffer.length || buffer.length > maxArchiveBytes) throw new Error("图鉴压缩包为空或超过 160 MB 限制")
  return buffer
}

async function downloadArchiveWithMirrors(url) {
  const candidates = buildUrlCandidates(url)
  let lastError
  for (const current of candidates) {
    try {
      const parsed = new URL(current)
      if (parsed.protocol !== "https:") throw new Error("Only HTTPS catalog downloads are allowed")
      const response = await fetchRemote(current)
      if (!response.ok) throw new Error(`Catalog download failed: HTTP ${response.status}`)
      const declared = Number(response.headers.get("content-length") || 0)
      if (declared > maxArchiveBytes) throw new Error("Catalog archive exceeds 160 MB limit")
      const buffer = Buffer.from(await response.arrayBuffer())
      if (!buffer.length || buffer.length > maxArchiveBytes) throw new Error("Catalog archive is empty or exceeds 160 MB limit")
      if (current !== url) globalThis.logger?.mark?.(`[bh2] Catalog archive downloaded via mirror: ${current}`)
      return buffer
    } catch (error) {
      lastError = error
      if (current !== candidates.at(-1)) globalThis.logger?.warn?.(`[bh2] Catalog download candidate failed: ${current} - ${error.message}`)
    }
  }
  throw lastError || new Error("Catalog download failed")
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
    const archive = await resolveArchive(config)
    const tempRoot = path.join(pluginRoot, `.catalog-download-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`)
    try {
      await fs.mkdir(tempRoot, { recursive: true })
      const buffer = await downloadArchiveWithMirrors(archive.url)
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
