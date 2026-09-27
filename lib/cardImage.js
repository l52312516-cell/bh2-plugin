import { normalizeCatalogDetails } from "./catalog.js"
export { normalizeCatalogDetails }
import { prepareCard, publicModel, equipmentLabel } from './ui.js'

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
  const labels = {handbook_count:'装备图鉴',pet_count:'使魔数量',emblem_count:'萌章数量',achieve_count:'成就数量',play_time:'入学时长（秒）',login_days:'登录天数',active_day_number:'活跃天数',nickname:'昵称',level:'等级',region_name:'区服'}
  const allFields = flatten(publicModel(account.fields))
  const fields = allFields.filter(x=>labels[x.label.split('.').at(-1)]).map(x=>({...x,label:labels[x.label.split('.').at(-1)]}))
  const otherFields = allFields.filter(x=>!labels[x.label.split('.').at(-1)]).slice(0,48)
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
  const value = key => recordStats[key]
  const formatPlayTime = seconds => hasMeaningful(seconds) ? `${Math.round(Number(seconds) / 360) / 10} 小时` : null
  const formatRate = rate => hasMeaningful(rate) ? `${Math.round(Number(rate) * 10) / 100}%` : null
  const stats = [
    ["装备图鉴", value("handbook_count")],
    ["看板收集", formatRate(value("post_rate"))],
    ["使魔", value("pet_count")],
    ["萌章", value("emblem_count")],
    ["成就", value("achieve_count") ?? value("achievement_count")],
    ["好感度", value("vip_level")],
    ["入学时长", formatPlayTime(value("play_time"))],
  ].filter(([, itemValue]) => hasMeaningful(itemValue)).map(([label, itemValue]) => ({ label, value: itemValue }))
  if (showcase.characters.length || showcase.weapons.length) {
    stats.unshift({ label: "角色", value: showcase.characters.length }, { label: "武器", value: showcase.weapons.length })
  }
  const profile = showcase.profile || {}
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

function catalogItem(entry) {
  return {
    id: entry.id,
    rarity: entry.rarity,
    category: equipmentLabel(entry),
    name: entry.name,
    tag: `${entry.type === "weapon" ? "武器" : "角色"}${entry.rarity ? ` · ${entry.rarity}` : ""} · #${entry.id}`,
    localImage: entry.image || "",
  }
}

export function catalogListCard({ items = [], keyword = "", type = "", page = 1, pages = 1, total = 0, suggestions = [] } = {}) {
  const kind = 'catalog-list'
  const typeName = type === "weapon" ? "武器" : type === "character" ? "角色" : "角色与武器"
  const suggestionText = suggestions.map(item => item.name).join("、")
  return {
    kind,
    title: `崩坏学园2 ${typeName}图鉴`,
    pagination: '共 '+total+' 条 · 详情：#BH2图鉴详情 <编号或名称>；翻页：#BH2'+(type==='character'?'角色图鉴':type==='weapon'?'武器图鉴':'图鉴')+' '+keyword+' 第'+(page<pages?page+1:1)+'页',
    subtitle: keyword ? `关键词“${keyword}” · 第 ${page}/${pages} 页` : `第 ${page}/${pages} 页`,
    notice: !items.length
      ? suggestionText ? `没有找到直接匹配。你可能想找：${suggestionText}` : "没有找到相关图鉴条目。"
      : "",
    stats: [
      { label: "结果", value: total },
      { label: "当前页", value: `${page}/${pages}` },
    ],
    fields: [],
    sections: items.length ? [{ title: keyword ? "匹配结果" : "图鉴索引", items: items.map(catalogItem) }] : [],
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
  try {
    if(JSON.stringify(model).length>90000)throw Object.assign(new Error('内容超出单张长图的安全渲染范围'), { code: 'BH2_CARD_TOO_LARGE' })
    if(e.runtime?.render){
      const data=prepareCard(model)
      const result=await e.runtime.render('bh2-plugin',template,data,{retType:'base64'})
      if(isImage(result))return await e.reply(result)
      reason='图片未生成，已转为文字。'
    }
  }catch(error){reason=error?.code==='BH2_CARD_TOO_LARGE'?'内容过长，已转为完整文字。':'图片渲染失败，已转为文字。';globalThis.logger?.warn?.('[bh2] '+error.message)}
  return e.reply([reason,fallback(model)].filter(Boolean).join(String.fromCharCode(10)))
}
export function replyCard(e,model) {
  const templates={status:'html/status',account:'html/account',accounts:'html/account',equipment:'html/catalog-detail',character:'html/catalog-detail','catalog-list':'html/catalog-list'}
  return replyVisual(e,model,templates[model.kind] || 'html/card')
}
export function replyHelp(e,model){return replyVisual(e,model,'html/help',helpText)}
export function replyShowcase(e,model){return replyVisual(e,model,'html/showcase')}
