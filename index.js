import fs from "node:fs"
import path from "node:path"
import { Bh2Plugin } from "./apps/main.js"

const dataDir = path.join(process.cwd(), "data", "bh2")
fs.mkdirSync(dataDir, { recursive: true })

if (globalThis.logger?.info) globalThis.logger.info("崩坏学园2查询插件加载中")

export const apps = { Bh2Plugin }
