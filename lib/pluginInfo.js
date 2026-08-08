import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const packageFile = path.join(root, "package.json")
const changelogFile = path.join(root, "CHANGELOG.md")

export function pluginVersion() {
  try { return JSON.parse(fs.readFileSync(packageFile, "utf8")).version || "unknown" } catch { return "unknown" }
}

export function changelogText(maxLines = 80) {
  try {
    const lines = fs.readFileSync(changelogFile, "utf8").split(/\r?\n/).slice(0, maxLines)
    return lines.join("\n").trim() || "暂无更新日志。"
  } catch {
    return "暂无更新日志。"
  }
}
