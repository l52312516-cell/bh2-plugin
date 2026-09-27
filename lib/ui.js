import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pluginVersion } from './pluginInfo.js'

export const resourcesRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../resources')
const secret = /cookie|token|authorization|device|secret|password|(?:^|_)sign(?:$|_)|^ds$/i
export function publicModel(value, depth = 0) {
  if (depth > 12) return null
  if (Array.isArray(value)) return value.filter(v => !v?.label || !secret.test(v.label)).map(v => publicModel(v, depth + 1))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => !secret.test(key)).map(([key, v]) => [key, publicModel(v, depth + 1)]))
}
export function stars(value) {
  const n = Number(String(value ?? '').replace('星', ''))
  return Number.isInteger(n) && n > 0 && n <= 10 ? '★'.repeat(n) : ''
}
export function equipmentLabel(entry = {}) {
  if (entry.type === 'character') return '角色'
  const names = { weapon: '武器', costume: '服装', dress: '服装', passiveSkill: '徽章', passive: '徽章', pet: '使魔' }
  return entry.equipmentTypeName || names[entry.equipmentType] || names[entry.baseType] || (entry.baseType && !/^[a-z_]+$/i.test(entry.baseType) ? entry.baseType : '装备')
}
export function numberTokens(value) {
  return String(value || '').split(/([0-9]+(?:[.][0-9]+)?%?)/g).filter(Boolean).map(text => ({ text, number: /^[0-9]/.test(text) }))
}
function safeImageUrl(value) {
  const text = String(value || '')
  if (text.startsWith('data:image/')) return text
  try {
    const url = new URL(text)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''
  } catch {
    return ''
  }
}
const ICON_NAMES = {'装备图鉴':'equipment','武器':'equipment','装备':'equipment','角色':'user','图片':'image','看板收集':'book','使魔':'pet','萌章':'badge','成就':'badge','登录天数':'calendar','UID':'link','等级':'user','入学时长':'calendar','好感度':'user'}
function iconFile(key) { return key + (['equipment','badge','pet'].includes(key) ? '.png' : '.svg') }
function commandIcon(text) {
  if(text.includes('更新'))return 'sync'
  if(text.includes('天数'))return 'calendar'
  if(text.includes('武器'))return 'equipment'
  if(text.includes('角色') || text.includes('账号'))return 'user'
  if(text.includes('图鉴'))return 'book'
  if(text.includes('展柜'))return 'badge'
  if(text.includes('版本'))return 'info'
  if(text.includes('cookie'))return 'settings'
  return 'link'
}
export function imageInfo(relative, root = resourcesRoot) {
  if (!new RegExp('^img/(character|weapon)/[A-Za-z0-9._-]+[.](png|jpe?g|webp)$', 'i').test(String(relative || ''))) return null
  try {
    const base = fs.realpathSync(root)
    const file = fs.realpathSync(path.join(root, relative))
    if (!file.startsWith(base + path.sep)) return null
    const stat = fs.statSync(file)
    if (!stat.isFile() || stat.size < 24 || stat.size > 6 * 1024 * 1024) return null
    const b = fs.readFileSync(file)
    let mime, width = 0, height = 0
    if (b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && b.subarray(-8,-4).toString() === 'IEND') {
      mime = 'image/png'; width = b.readUInt32BE(16); height = b.readUInt32BE(20)
    } else if (b[0] === 255 && b[1] === 216 && b[b.length - 2] === 255 && b[b.length - 1] === 217) {
      mime = 'image/jpeg'
      let p = 2
      while (p + 9 < b.length && b[p] === 255) {
        const marker = b[p + 1], len = b.readUInt16BE(p + 2)
        if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) { height = b.readUInt16BE(p + 5); width = b.readUInt16BE(p + 7); break }
        if (len < 2) break
        p += 2 + len
      }
    } else if (b.toString('ascii',0,4) === 'RIFF' && b.toString('ascii',8,12) === 'WEBP' && b.readUInt32LE(4) + 8 === b.length) mime = 'image/webp'
    if (!mime) return null
    return { src: 'data:' + mime + ';base64,' + b.toString('base64'), width, height }
  } catch { return null }
}
export function prepareCard(model, options = {}) {
  const safe = publicModel(model)
  const root = options.resourceRoot || resourcesRoot
  const imageCache = new Map()
  function item(value) {
    if (!imageCache.has(value.localImage)) imageCache.set(value.localImage, imageInfo(value.localImage, root))
    const local = imageCache.get(value.localImage)
    const remote = safeImageUrl(value.image)
    return { ...value, imageSrc: local?.src || remote, imageWidth: local?.width || 0, imageHeight: local?.height || 0, stars: stars(value.rarity), attributes: value.attributes || [] }
  }
  const kind = safe.kind || (safe.title?.includes('图鉴') ? 'catalog-list' : 'card')
  const background = kind === 'help' ? 'help' : kind === 'status' ? 'status' : ['account','accounts','showcase'].includes(kind) ? 'profile' : 'catalog'
  return {
    title: '', subtitle: '', notice: '', uid: '', preview: false, pagination: '', stats: [], fields: [], otherFields: [], attributes: [], skills: [], sections: [], links: [], groups: [], accounts: [],
    ...safe, kind, title: safe.hero ? '崩坏学园2 ' + safe.hero.tag + '图鉴' : safe.title, ui: { background, version: pluginVersion(), eyebrow: {help:'HOUKAI GAKUEN 2 · COMMAND GUIDE',status:'HOUKAI GAKUEN 2 · SYSTEM',showcase:'HOUKAI GAKUEN 2 · PLAYER RECORD',account:'HOUKAI GAKUEN 2 · PLAYER RECORD',accounts:'HOUKAI GAKUEN 2 · ACCOUNTS'}[kind] || 'HOUKAI GAKUEN 2 · ARCHIVE' },
    hero: safe.hero ? item(safe.hero) : null,
    stats: (safe.stats || []).map(stat => ({...stat,iconFile:iconFile(ICON_NAMES[stat.label] || 'book')})),
    groups: (safe.groups || []).map((group,index)=>({...group,number:String(index+1).padStart(2,'0'),items:group.items.map(entry=>({...entry,iconFile:iconFile(commandIcon(entry.command))}))})),
    profile: { ...safe.profile, avatar: safeImageUrl(safe.profile?.avatar) },
    sections: (safe.sections || []).map(section => ({
      ...section,
      items: (section.items || []).map(item),
    })),
    skills: (safe.skills || []).map(skill => ({ ...skill, descriptionTokens: numberTokens(skill.description), maxTokens: numberTokens(skill.maxLevelDescription) })),
    saveId: kind + '-' + Date.now() + '-' + Math.random().toString(36).slice(2,8),
    imgType: 'jpeg', quality: 90, multiPage: false,
    // Remote avatars are prefetched below. DOMContentLoaded keeps a failed CDN request
    // from holding Yunzai's Chromium renderer in network-idle forever.
    pageGotoParams: { waitUntil: 'domcontentloaded', timeout: 15000 },
  }
}

async function fetchImageData(url, timeoutMs = 2500, fetchImpl = globalThis.fetch) {
  const safe = safeImageUrl(url)
  if (!safe || safe.startsWith('data:') || typeof fetchImpl !== 'function') return ''
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(safe, { signal: controller.signal, headers: { accept: 'image/avif,image/webp,image/*' } })
    if (!response.ok) return ''
    const type = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase()
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(type)) return ''
    const bytes = Buffer.from(await response.arrayBuffer())
    if (!bytes.length || bytes.length > 6 * 1024 * 1024) return ''
    return `data:${type};base64,${bytes.toString('base64')}`
  } catch {
    return ''
  } finally {
    clearTimeout(timer)
  }
}

async function hydrateRemoteImages(value, state, key = '') {
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    await Promise.all(value.map(item => hydrateRemoteImages(item, state, key)))
    return value
  }
  await Promise.all(Object.entries(value).map(async ([childKey, child]) => {
    if ((childKey === 'image' || childKey === 'avatar') && typeof child === 'string' && /^https:\/\//i.test(child)) {
      if (state.remaining <= 0) {
        value[childKey] = ''
        return
      }
      state.remaining--
      const data = await fetchImageData(child, 2500, state.fetchImpl)
      value[childKey] = data || ''
      return
    }
    await hydrateRemoteImages(child, state, childKey)
  }))
  return value
}

/** Resolve external avatars/icons before handing a model to Yunzai's renderer. */
export async function prepareCardAsync(model, options = {}) {
  const safe = publicModel(model)
  await hydrateRemoteImages(safe, { remaining: Number(options.maxRemoteImages || 40), fetchImpl: options.fetchImpl })
  return prepareCard(safe, options)
}
