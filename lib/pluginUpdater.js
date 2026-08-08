import crypto from "node:crypto"
import { execFile as execFileCallback } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { fileURLToPath, pathToFileURL } from "node:url"
import { extractZip } from "./catalogUpdater.js"

const defaultPluginRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const defaultExecFile = promisify(execFileCallback)
const maxArchiveBytes = 30 * 1024 * 1024
let updating = false

async function readJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, "utf8")) } catch { return fallback }
}

function safeRelative(value) {
  const normalized = String(value || "").replaceAll("\\", "/").replace(/^\.\//, "")
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.includes("\0")) {
    throw new Error(`更新清单路径无效: ${value}`)
  }
  const parts = normalized.split("/")
  if (parts.some(part => !part || part === "." || part === "..")) throw new Error(`更新清单路径越界: ${value}`)
  return parts.join("/")
}

function inside(root, relative) {
  const target = path.resolve(root, ...safeRelative(relative).split("/"))
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error(`更新路径越界: ${relative}`)
  return target
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex")
}

function isProtected(relative) {
  return /^(?:config\/config\.json|data\/catalog\.json|resources\/img(?:\/|$))/i.test(relative)
}

async function updaterConfig(pluginRoot) {
  const config = await readJson(path.join(pluginRoot, "config", "config.json"), {})
  return {
    repository: "l52312516-cell/bh2-plugin",
    branch: "main",
    assetName: "bh2-plugin-server.zip",
    ...(config?.pluginUpdate || {}),
  }
}

async function fetchRemote(url, { fetchImpl = globalThis.fetch, accept = "application/octet-stream", timeoutMs = 60000 } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("当前 Node 环境没有可用的 fetch")
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "bh2-plugin-updater/0.3",
        Accept: accept,
        ...(process.env.BH2_GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.BH2_GITHUB_TOKEN}` } : {}),
      },
    })
  } finally {
    clearTimeout(timer)
  }
}

async function resolveArchive(config, fetchImpl) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.repository)) throw new Error("pluginUpdate.repository 格式无效")
  try {
    const response = await fetchRemote(`https://api.github.com/repos/${config.repository}/releases/latest`, {
      fetchImpl,
      accept: "application/vnd.github+json",
    })
    if (response.ok) {
      const release = await response.json()
      const asset = (release.assets || []).find(item => item.name === config.assetName)
      if (asset?.browser_download_url) return { url: asset.browser_download_url, version: release.tag_name || release.name || "latest" }
    }
  } catch (error) {
    globalThis.logger?.warn?.(`[bh2] 主插件 Release 查询失败，将回退 main 分支: ${error.message}`)
  }
  return {
    url: `https://codeload.github.com/${config.repository}/zip/refs/heads/${encodeURIComponent(config.branch)}`,
    version: config.branch,
  }
}

async function downloadArchive(url, fetchImpl) {
  const parsed = new URL(url)
  if (parsed.protocol !== "https:") throw new Error("只允许通过 HTTPS 下载插件更新")
  const response = await fetchRemote(url, { fetchImpl })
  if (!response.ok) throw new Error(`插件下载失败: HTTP ${response.status}`)
  const declared = Number(response.headers.get("content-length") || 0)
  if (declared > maxArchiveBytes) throw new Error("插件压缩包超过 30 MB 限制")
  const buffer = Buffer.from(await response.arrayBuffer())
  if (!buffer.length || buffer.length > maxArchiveBytes) throw new Error("插件压缩包为空或超过 30 MB 限制")
  return buffer
}

async function findPluginBundle(root) {
  const queue = [root]
  const matches = []
  while (queue.length) {
    const current = queue.shift()
    for (const item of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, item.name)
      if (item.isDirectory()) queue.push(full)
      if (item.isFile() && item.name === "plugin.manifest.json") {
        const manifest = await readJson(full)
        if (manifest?.name === "bh2-plugin") matches.push({ root: current, manifest })
      }
    }
  }
  if (matches.length !== 1) throw new Error(`更新包必须包含且仅包含一个有效 plugin.manifest.json，实际 ${matches.length} 个`)
  return matches[0]
}

export async function validatePluginBundle(extractedRoot) {
  const bundle = await findPluginBundle(extractedRoot)
  const { manifest } = bundle
  if (manifest.schemaVersion !== 1) throw new Error(`不支持的插件更新格式: ${manifest.schemaVersion}`)
  if (!manifest.version || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error("插件更新清单不完整")
  if (manifest.files.length > 500) throw new Error("插件更新文件数量超过限制")
  const paths = new Set()
  for (const item of manifest.files) {
    const relative = safeRelative(item.path)
    if (paths.has(relative)) throw new Error(`插件更新清单路径重复: ${relative}`)
    if (isProtected(relative)) {
      throw new Error(`插件更新清单试图覆盖受保护内容: ${relative}`)
    }
    if (!/^[a-f0-9]{64}$/i.test(item.sha256 || "")) throw new Error(`插件更新文件哈希无效: ${relative}`)
    const source = inside(bundle.root, relative)
    const stat = await fs.stat(source).catch(() => null)
    if (!stat?.isFile()) throw new Error(`插件更新文件不存在: ${relative}`)
    if (sha256(await fs.readFile(source)) !== String(item.sha256).toLowerCase()) throw new Error(`插件更新文件校验失败: ${relative}`)
    paths.add(relative)
  }
  const packageJson = await readJson(path.join(bundle.root, "package.json"))
  if (packageJson?.name !== "bh2-plugin" || packageJson.version !== manifest.version) throw new Error("插件包名称或版本与清单不一致")
  return { ...bundle, files: manifest.files.map(item => ({ ...item, path: safeRelative(item.path) })) }
}

export async function deployPluginBundle(bundle, pluginRoot = defaultPluginRoot) {
  const manifestTarget = path.join(pluginRoot, "plugin.manifest.json")
  const oldManifestBuffer = await fs.readFile(manifestTarget).catch(() => null)
  const installedManifest = oldManifestBuffer ? JSON.parse(oldManifestBuffer.toString("utf8")) : { files: [] }
  const nextPaths = new Set(bundle.files.map(item => item.path))
  const obsolete = (installedManifest.files || [])
    .map(item => safeRelative(item.path))
    .filter(item => !nextPaths.has(item) && !isProtected(item))
  const operations = [...new Set([...bundle.files.map(item => item.path), ...obsolete])]
  const backupRoot = path.join(path.dirname(pluginRoot), `.bh2-update-backup-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`)
  const changed = []
  try {
    await fs.mkdir(backupRoot, { recursive: true })
    for (const relative of operations) {
      const target = inside(pluginRoot, relative)
      const existing = await fs.stat(target).catch(() => null)
      if (existing?.isFile()) {
        const backup = inside(backupRoot, relative)
        await fs.mkdir(path.dirname(backup), { recursive: true })
        await fs.copyFile(target, backup)
      }
      const sourceItem = bundle.files.find(item => item.path === relative)
      if (sourceItem) {
        await fs.mkdir(path.dirname(target), { recursive: true })
        const temporary = `${target}.bh2-update-${crypto.randomBytes(3).toString("hex")}`
        await fs.copyFile(inside(bundle.root, relative), temporary)
        await fs.rename(temporary, target)
      } else if (existing?.isFile()) {
        await fs.rm(target, { force: true })
      }
      changed.push({ relative, existed: Boolean(existing?.isFile()) })
    }
    const manifestTemporary = `${manifestTarget}.bh2-update-${crypto.randomBytes(3).toString("hex")}`
    await fs.writeFile(manifestTemporary, JSON.stringify(bundle.manifest, null, 2) + "\n", "utf8")
    await fs.rename(manifestTemporary, manifestTarget)
  } catch (error) {
    for (const item of changed.reverse()) {
      const target = inside(pluginRoot, item.relative)
      const backup = inside(backupRoot, item.relative)
      if (item.existed) {
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.copyFile(backup, target).catch(() => {})
      } else {
        await fs.rm(target, { force: true }).catch(() => {})
      }
    }
    if (oldManifestBuffer) await fs.writeFile(manifestTarget, oldManifestBuffer).catch(() => {})
    else await fs.rm(manifestTarget, { force: true }).catch(() => {})
    throw error
  } finally {
    await fs.rm(backupRoot, { recursive: true, force: true })
  }
}

async function updateWithGit(pluginRoot, execFileImpl) {
  const before = await execFileImpl("git", ["-C", pluginRoot, "rev-parse", "HEAD"], { windowsHide: true })
  await execFileImpl("git", ["-C", pluginRoot, "pull", "--ff-only"], { windowsHide: true })
  const after = await execFileImpl("git", ["-C", pluginRoot, "rev-parse", "HEAD"], { windowsHide: true })
  return String(before.stdout).trim() !== String(after.stdout).trim()
}

export async function updatePluginFromGithub(options = {}) {
  if (updating) throw new Error("已有插件更新任务正在进行，请勿重复操作。")
  updating = true
  const pluginRoot = options.pluginRoot || defaultPluginRoot
  const execFileImpl = options.execFileImpl || defaultExecFile
  try {
    const hasGit = Boolean(await fs.stat(path.join(pluginRoot, ".git")).catch(() => null))
    if (hasGit && options.preferGit !== false) {
      const updated = await updateWithGit(pluginRoot, execFileImpl)
      const current = await readJson(path.join(pluginRoot, "package.json"), {})
      return { updated, version: current.version || "unknown", channel: "git" }
    }
    const config = await updaterConfig(pluginRoot)
    const archive = await resolveArchive(config, options.fetchImpl)
    const tempRoot = path.join(path.dirname(pluginRoot), `.bh2-update-download-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`)
    try {
      await fs.mkdir(tempRoot, { recursive: true })
      await extractZip(await downloadArchive(archive.url, options.fetchImpl), tempRoot, {
        maxEntries: 1000,
        maxExtractedBytes: 100 * 1024 * 1024,
      })
      const bundle = await validatePluginBundle(tempRoot)
      const current = await readJson(path.join(pluginRoot, "package.json"), {})
      if (String(current.version) === String(bundle.manifest.version)) {
        return { updated: false, version: current.version || bundle.manifest.version, channel: "zip" }
      }
      await deployPluginBundle(bundle, pluginRoot)
      return { updated: true, version: bundle.manifest.version, channel: "zip" }
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true })
    }
  } finally {
    updating = false
  }
}

export async function restartYunzai(e, importer = value => import(value)) {
  const candidates = [
    path.join(process.cwd(), "plugins", "other", "restart.js"),
    path.join(process.cwd(), "plugins", "system", "apps", "restart.ts"),
  ]
  for (const file of candidates) {
    try {
      const module = await importer(pathToFileURL(file).href)
      if (typeof module?.Restart === "function") {
        await new module.Restart(e).restart()
        return true
      }
    } catch {}
  }
  return false
}
