import { getAllEntries, normalizeCatalogDetails } from "./catalog.js"
export { normalizeCatalogDetails }
import { prepareCardAsync, publicModel, equipmentLabel } from './ui.js'

function scalar(value) {
  if (value == null) return "-"
  if (typeof value === "object") return Array.isArray(value) ? `${value.length} 项` : "[对象]"
  return String(value)
}

function hasMeaningful(value, { allowZero = true } = {}) {
  if (value === undefined || value === null || value === "") return false
  if (typeof value === "string" && value.trim() === "-") return false
  if (!allowZero && Number(value) === 0) return false
  return true
}

function formatDuration(seconds) {
  const value = Number(seconds)
  if (!Number.isFinite(value) || value < 0) return null
  if (value < 60) return `${Math.round(value)} 秒`
  const minutes = Math.floor(value / 60)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时`
  const days = Math.floor(hours / 24)
  const restHours = hours % 24
  return restHours ? `${days} 天 ${restHours} 小时` : `${days} 天`
}

function flatten(value, prefix = "", out = [], depth = 0) {
  if (depth > 3 || value == null || typeof value !== "object") {
    if (prefix) out.push({ label: prefix, value: scalar(value) })
    return out
  }
  if (Array.isArray(value)) {
    if (prefix) out.push({ label: prefix, value: `${value.length} 项` })
    return out
  }
  for (const [key, child] of Object.entries(value)) {
    const label = prefix ? `${prefix}.${key}` : key
    if (child && typeof child === "object") flatten(child, label, out, depth + 1)
    else out.push({ label, value: scalar(child) })
  }
  return out
}

export function accountCard(account) {
  const labels = {handbook_count:'装备图鉴',pet_count:'使魔数量',emblem_count:'萌章数量',achieve_count:'成就数量',achievement_count:'成就数量',play_time:'入学时长',playtime:'入学时长',total_play_time:'累计入学时长',login_days:'登录天数',login_day_number:'登录天数',active_day_number:'活跃天数',nickname:'昵称',level:'等级',region_name:'区服',region:'区服',vip_level:'好感度'}
  const allFields = flatten(publicModel(account.fields))
  const fields = allFields.filter(x=>labels[x.label.split('.').at(-1)]).map(x=>{
    const rawKey = x.label.split('.').at(-1)
    const key = rawKey.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`).toLowerCase()
    return {...x,label:labels[key],value:['play_time','playtime','total_play_time'].includes(key) ? (formatDuration(x.value) || '接口未返回') : x.value}
  })
  const otherFields = allFields.filter(x=>!labels[x.label.split('.').at(-1).replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`).toLowerCase()])
  const stats = [
    { label: "UID", value: account.uid || "-" },
    { label: "昵称", value: account.nickname || "-" },
    { label: "等级", value: account.level ?? "-" },
    { label: "登录天数", value: account.loginDays ?? "接口未返回" },
  ]
  return {
    kind: 'account',
    profile: { nickname: account.nickname || '未知玩家', level: account.level, uid: account.uid, region: account.region || '' },
    otherFields,
    title: "崩坏学园2 账号信息",
    subtitle: `UID ${account.uid || "未识别"}`,
    notice: account.loginDays == null ? "当前接口未返回登录天数，已展示其余可用字段。" : "",
    stats,
    fields,
    sections: [],
    links: [],
  }
}

export function showcaseCard(showcase, lookup, role = {}) {
  showcase = {
    characters: [], weapons: [], emblems: [], posters: [], costumes: [], pets: [], achievements: [], stats: {}, ...showcase,
  }
  const toItem = item => {
    const catalog = lookup(item.name, item.id)
    return {
      id: item.id || catalog?.id || "",
      name: catalog?.name || item.name,
      rarity: item.rarity ?? catalog?.rarity ?? null,
      tag: [item.level != null ? `Lv.${item.level}` : "", item.rarity ?? catalog?.rarity ? `稀有度 ${item.rarity ?? catalog?.rarity}` : ""].filter(Boolean).join(" · "),
      image: /^https:\/\//i.test(String(item.image || "")) ? item.image : "",
      localImage: catalog?.image || "",
      attributes: catalog ? normalizeCatalogDetails(catalog).attributes.slice(0, 3) : [],
    }
  }
  const recordStats = showcase.stats || {}
  const value = (...keys) => keys.map(key => recordStats[key]).find(itemValue => hasMeaningful(itemValue))
  const formatHours = hours => {
    const value = Number(hours)
    if (!Number.isFinite(value) || value < 0) return null
    return `${Number.isInteger(value) ? value : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')} 小时`
  }
  const formatPlayTime = () => {
    if (hasMeaningful(recordStats.play_time_hours)) return formatHours(recordStats.play_time_hours)
    const raw = value("play_time", "playtime", "total_play_time")
    if (!hasMeaningful(raw)) return null
    // Legacy integrations reported seconds; current BH2 index data reports hours.
    return Number(raw) > 1000 ? formatDuration(Number(raw)) : formatHours(raw)
  }
  const playTimeLabel = hasMeaningful(recordStats.play_time_hours) ? "游戏时长" : "入学时长"
  const formatRate = rate => {
    if (!hasMeaningful(rate)) return null
    const value = Number(rate)
    if (!Number.isFinite(value)) return String(rate)
    const percent = value > 1 ? value / 10 : value * 100
    return `${Math.round(percent * 10) / 10}%`
  }
  const stats = [
    ["装备图鉴", value("handbook_count", "handbook_number", "equipment_count", "equip_count", "equip_number", "weapon_count", "weapon_number")],
    [value("post_count", "poster_count", "posters_count", "figure_count", "figure_number", "board_count", "board_number", "skin_count") != null ? "拥有看板" : "看板收集", value("post_count", "poster_count", "posters_count", "figure_count", "figure_number", "board_count", "board_number", "skin_count") ?? formatRate(value("post_rate", "poster_rate", "figure_rate", "board_rate", "skin_rate"))],
    ["使魔", value("pet_count", "pets_count", "pet_number", "companion_count", "companion_number")],
    ["萌章", value("emblem_count", "emblems_count", "emblem_number", "badge_count", "badge_number", "medal_count", "medal_number")],
    [value("achievement_gold") != null || value("achievement_silver") != null || value("achievement_bronze") != null ? "成就(金/银/铜)" : "成就", [value("achievement_gold"), value("achievement_silver"), value("achievement_bronze")].some(itemValue => itemValue != null) ? [value("achievement_gold") ?? 0, value("achievement_silver") ?? 0, value("achievement_bronze") ?? 0].join("/") : value("achieve_count", "achievement_count", "achievements_count", "achievement_number", "achieve_number")],
    ["好感度", value("vip_level", "vip", "favorability", "favourability", "affection_level")],
    [playTimeLabel, formatPlayTime()],
  ].filter(([, itemValue]) => hasMeaningful(itemValue)).map(([label, itemValue]) => ({ label, value: itemValue }))
  if (showcase.weapons.length) stats.unshift({ label: "武器", value: showcase.weapons.length })
  if (showcase.characters.length) stats.unshift({ label: "角色", value: showcase.characters.length })
  const profile = { ...(showcase.profile || {}) }
  const gameTime = formatPlayTime()
  if (gameTime && !profile.gameTime) profile.gameTime = gameTime
  const sectionSources = [
    ["角色", showcase.characters],
    ["武器", showcase.weapons],
    ["徽章", showcase.emblems],
    ["看板 / 服装", [...(showcase.posters || []), ...(showcase.costumes || [])]],
    ["萌章 / 宠物", showcase.pets],
  ]
  const sections = sectionSources.map(([title, items]) => ({ title, items: items.slice(0, 30).map(toItem) })).filter(section => section.items.length)
  const missingGroups = sectionSources.filter(([, items]) => !items.length).map(([title]) => title)
  const notices = []
  if (!sections.length) notices.push("米游社 BH2 官方接口未公开角色或武器明细；公开接口未提供展柜分组明细，以下仅展示真实返回的玩家资料和统计。")
  else if (missingGroups.length) notices.push(`公开接口未提供以下展柜分组：${missingGroups.join("、")}。`)
  return {
    kind: 'showcase',
    title: "崩坏学园2 玩家资料卡",
    uid: showcase.uid,
    subtitle: `UID ${showcase.uid}`,
    profile,
    notice: notices.join(" "),
    stats,
    fields: [
      { label: "昵称", value: profile.nickname || "未知玩家" },
      { label: "等级", value: profile.level ?? "-" },
      { label: "社团", value: profile.guild || "-" },
      { label: "区服", value: profile.region || "-" },
      ...(profile.gameTime ? [{ label: playTimeLabel, value: profile.gameTime }] : []),
      ...(profile.vip != null ? [{ label: "VIP", value: profile.vip }] : []),
    ],
    sections,
    links: [],
  }
}

export function catalogCard(entry) {
  const details = normalizeCatalogDetails(entry)
  const fields = [
    ...(entry.aliases?.length ? [{ label: "别名", value: entry.aliases.join("、") }] : []),
    ...(entry.description ? [{ label: "描述", value: entry.description }] : []),
    ...(details.series?.name ? [{ label: "系列", value: details.series.name }] : []),
    ...(details.equipmentType ? [{ label: "装备分类", value: details.equipmentType }] : []),
  ]
  const category = entry.type === "character" ? "角色" : equipmentLabel(entry)
  return {
    title: `崩坏学园2 ${category}图鉴`,
    subtitle: `条目 #${entry.id}`,
    notice: details.notice || '',
    stats: [
      { label: "名称", value: entry.name },
      { label: "类型", value: equipmentLabel(entry) },
      ...(hasMeaningful(entry.rarity) ? [{ label: "稀有度", value: entry.rarity }] : []),
    ],
    fields,
    kind: entry.type === 'character' ? 'character' : 'equipment',
    hero: { name: entry.name, id: entry.id, type: entry.type, tag: equipmentLabel(entry), rarity: entry.rarity, localImage: entry.image || '' },
    attributes: details.attributes,
    skills: details.skills,
    sections: [{ title: entry.name, items: [{ name: entry.name, tag: entry.rarity || "", localImage: entry.image || "" }] }],
    links: entry.sourceUrl ? [entry.sourceUrl] : [],
  }
}

function displayIds(entries) {
  const records = entries.map(entry => {
    const id = String(entry.id || '')
    const knownPrefix = /^(?:moegirl|hsod2-cn)-/i.test(id)
    const token = (knownPrefix ? id.replace(/^(?:moegirl|hsod2-cn)-/i, '') : id.split(/[-_]/).at(-1)) || id
    return { id, token, width: Math.min(6, token.length), full: false }
  })
  const makeLabel = record => {
    const source = record.full ? record.id.replace(/[^a-z0-9]/gi, '') : record.token
    if (!source) return '未知'
    const width = Math.min(record.width, source.length)
    return /^\d+$/.test(source) ? source.slice(-width) : source.slice(0, width)
  }
  for (;;) {
    const groups = new Map()
    for (const record of records) {
      const label = makeLabel(record)
      groups.set(label, [...(groups.get(label) || []), record])
    }
    const collisions = [...groups.values()].filter(group => group.length > 1)
    if (!collisions.length) return new Map(records.map(record => [record.id, makeLabel(record)]))
    let changed = false
    for (const group of collisions) {
      for (const record of group) {
        const source = record.full ? record.id.replace(/[^a-z0-9]/gi, '') : record.token
        if (record.width < source.length) {
          record.width++
          changed = true
        } else if (!record.full) {
          record.full = true
          record.width = Math.min(6, record.id.length)
          changed = true
        }
      }
    }
    if (!changed) {
      for (const [index, record] of records.entries()) record.id += `~${index + 1}`
      return new Map(records.map(record => [record.id, makeLabel(record)]))
    }
  }
}

function catalogItem(entry, displayId) {
  return {
    id: displayId || String(entry.id || '未知'),
    rarity: entry.rarity,
    category: equipmentLabel(entry),
    name: entry.name,
    tag: `${equipmentLabel(entry)}${entry.rarity ? ` · ${entry.rarity}` : ""}`,
    localImage: entry.image || "",
  }
}

export function catalogListCard({ items = [], allEntries = getAllEntries(), keyword = "", type = "", page = 1, pages = 1, total = 0, suggestions = [] } = {}) {
  const kind = 'catalog-list'
  const typeName = type === "weapon" ? "武器" : type === "character" ? "角色" : "角色与武器"
  const suggestionText = suggestions.map(item => item.name).join("、")
  const universe = allEntries.length && items.every(item => allEntries.some(entry => String(entry.id) === String(item.id))) ? allEntries : items
  const ids = displayIds(universe)
  const pageIds = displayIds(items)
  return {
    kind,
    title: `崩坏学园2 ${typeName}图鉴`,
    pagination: '共 '+total+' 条 · 详情：#BH2图鉴详情 <名称或完整编号>；翻页：#BH2'+(type==='character'?'角色图鉴':type==='weapon'?'武器图鉴':'图鉴')+' '+keyword+' 第'+(page<pages?page+1:1)+'页',
    subtitle: keyword ? `关键词“${keyword}” · 第 ${page}/${pages} 页` : `第 ${page}/${pages} 页`,
    notice: !items.length
      ? suggestionText ? `没有找到直接匹配。你可能想找：${suggestionText}` : "没有找到相关图鉴条目。"
      : "",
    stats: [
      { label: "结果", value: total },
      { label: "当前页", value: `${page}/${pages}` },
    ],
    fields: [],
    sections: items.length ? [{ title: keyword ? "匹配结果" : "图鉴索引", items: items.map((entry, index) => catalogItem(entry, ids.get(String(entry.id)) || pageIds.get(String(entry.id)) || `${index + 1}`)) }] : [],
    links: [],
  }
}

export function statusCard({ version, catalog, stats } = {}) {
  return {
    kind: 'status',
    title: "崩坏学园2 插件状态",
    subtitle: `bh2-plugin v${version || "unknown"}`,
    notice: stats?.total ? "" : "本地图鉴尚未安装，请让 Bot 主人发送 #BH2图鉴更新。",
    stats: [
      { label: "图鉴条目", value: stats?.total || 0 },
      { label: "角色", value: stats?.characters || 0 },
      { label: "武器", value: stats?.weapons || 0 },
      { label: "图片", value: stats?.images || 0 },
    ],
    fields: [
      { label: "图鉴版本", value: catalog?.version || "未安装" },
      { label: "快照时间", value: catalog?.generatedAt || "-" },
      { label: "数据来源", value: catalog?.source || "-" },
    ],
    sections: [],
    links: [],
  }
}

export function helpModel(master = false) {
  const groups = [
    {
      title: "账号查询",
      items: [
        { command: "¥登录天数 [UID]", description: "查询账号等级与累计登录天数" },
        { command: "#BH2账号 [UID]", description: "查看 Cookie 中的崩坏学园2账号" },
        { command: "#BH2展柜 [UID]", description: "查看官方战绩与看板收集概览" },
      ],
    },
    {
      title: "图鉴功能",
      items: [
        { command: "#BH2图鉴 [关键词] [第N页]", description: "搜索或分页浏览全部图鉴" },
        { command: "#BH2角色图鉴 [关键词]", description: "只查询角色图鉴" },
        { command: "#BH2武器图鉴 [关键词]", description: "只查询武器与装备图鉴" },
        { command: "#BH2图鉴详情 <编号或名称>", description: "查看指定条目的完整图片" },
      ],
    },
    {
      title: "绑定设置",
      items: [
        { command: "#BH2绑定 <UID>", description: "绑定当前使用的游戏 UID" },
        { command: "#BH2切换 <UID>", description: "切换当前游戏 UID" },
        { command: "#BH2解绑", description: "解除当前 UID 绑定" },
        { command: "#BH2版本 / #BH2状态", description: "查看插件与图鉴状态" },
      ],
    },
  ]
  if (master) {
    groups.push({
      title: "插件管理 · 仅主人",
      items: [
        { command: "#BH2图鉴更新", description: "从独立仓库安装或更新图鉴" },
        { command: "#BH2图鉴强制更新", description: "强制覆盖安装最新图鉴图片和索引" },
        { command: "#BH2更新", description: "从 GitHub 安全更新主插件并重启" },
        { command: "#BH2强制更新", description: "强制覆盖主插件程序文件并重启" },
        { command: "#BH2更新日志", description: "查看本地版本更新记录" },
        { command: "#BH2cookie [UID] <Cookie>", description: "仅限私聊配置回退 Cookie" },
      ],
    })
  }
  return {
    kind: 'help',
    title: "崩坏学园2 插件帮助",
    subtitle: "支持 ¥ / #崩坏学园2 / #崩坏2 / #崩2 / #BH2 / #bb / #b2",
    groups,
  }
}

export function textFallback(model) {
  model = publicModel(model)
  const lines = [`=== ${model.title} ===`, model.subtitle]
  if (model.notice) lines.push(model.notice)
  for (const item of model.stats || []) lines.push(`${item.label}: ${item.value}`)
  for (const item of model.fields || []) lines.push(`${item.label}: ${item.value}`)
  for (const item of model.attributes || []) lines.push(`${item.label}: ${item.value}`)
  for (const skill of model.skills || []) {
    lines.push("", `【${skill.group || "技能"}】${skill.title || ""}`)
    if (skill.damageType) lines.push(`伤害类型: ${skill.damageType}`)
    if (skill.description) lines.push(`描述: ${skill.description}`)
    if (skill.maxLevelDescription) lines.push(`满级: ${skill.maxLevelDescription}`)
  }
  for (const section of model.sections || []) {
    lines.push("", `【${section.title}】`)
    for (const item of section.items || []) lines.push(`${item.name}${item.tag ? ` (${item.tag})` : ""}`)
  }
  for(const role of model.accounts || []) lines.push(role.nickname+' · UID '+role.uid+' · Lv.'+(role.level ?? '-')+' · '+role.region)
  for(const link of model.links || []) lines.push('来源: '+link)
  for(const x of model.otherFields || []) lines.push(x.label+': '+x.value)
  return lines.filter(Boolean).join("\n")
}

export function accountsCard(roles = []) {
  return {kind:'accounts',title:'崩坏学园2 游戏账号',subtitle:'当前可查询账号 · '+roles.length+' 个',stats:[],fields:[],sections:[],links:[],accounts:roles.map(r=>({nickname:r.nickname || '未知玩家',uid:String(r.game_uid),level:r.level,region:r.region_name || r.region || ''}))}
}
export function helpText(model) {
  const lines=['=== '+model.title+' ===',model.subtitle]
  for(const group of model.groups || []){lines.push('', '【'+group.title+'】');for(const item of group.items || [])lines.push(item.command+String.fromCharCode(10)+item.description)}
  return lines.join(String.fromCharCode(10))
}
function isImage(result) {
  if(Buffer.isBuffer(result))return result.length>0
  if(Array.isArray(result))return result.length>0 && result.every(isImage)
  if(result && typeof result==='object')return result.type==='image' && Boolean(result.data || result.file || result.url)
  return typeof result==='string' && (result.startsWith('base64://') || result.startsWith('data:image/'))
}
export async function replyVisual(e,model,template,fallback=textFallback) {
  let reason=''
  let stage='renderer'
  if (!e.runtime?.render) reason='渲染器不可用，已转为文字。'
  try {
    if (!e.runtime?.render) return e.reply([reason, fallback(model)].filter(Boolean).join(String.fromCharCode(10)))
    if(JSON.stringify(model).length>90000)throw Object.assign(new Error('内容超出单张长图的安全渲染范围'), { code: 'BH2_CARD_TOO_LARGE' })
    stage='prepare'
    const data=await prepareCardAsync(model)
    stage='render'
    const result=await e.runtime.render('bh2-plugin',template,data,{retType:'base64'})
    if(isImage(result)) {
      stage='send'
      const sent=await e.reply(result)
      if(sent !== false)return sent
      reason='图片发送失败，已转为文字。'
    } else {
      reason='截图未生成，已转为文字。'
    }
    globalThis.logger?.warn?.(`[bh2] template=${template} stage=${stage === 'send' ? 'send-empty' : 'screenshot-empty'} result=${result === false ? 'false' : result == null ? String(result) : typeof result}`)
  }catch(error){
    if (error?.code === 'BH2_CARD_TOO_LARGE') reason='内容过长，已转为完整文字。'
    else if (stage === 'prepare') reason='图片素材加载失败，已转为文字。'
    else if (stage === 'send') reason='图片发送失败，已转为文字。'
    else if (/渲染后端.*不可用|renderer.*unavailable|puppeteer chromium.*失败|render is not a function/i.test(String(error?.message || ''))) reason='渲染器不可用，已转为文字。'
    else reason='图片渲染失败，已转为文字。'
    globalThis.logger?.warn?.(`[bh2] template=${template} stage=${stage} ${error?.stack || error?.message || error}`)
  }
  return e.reply([reason,fallback(model)].filter(Boolean).join(String.fromCharCode(10)))
}
export function replyCard(e,model) {
  const templates={status:'html/status',account:'html/account',accounts:'html/account',equipment:'html/catalog-detail',character:'html/catalog-detail','catalog-list':'html/catalog-list'}
  return replyVisual(e,model,templates[model.kind] || 'html/card')
}
export function replyHelp(e,model){return replyVisual(e,model,'html/help',helpText)}
export function replyShowcase(e,model){return replyVisual(e,model,'html/showcase')}
