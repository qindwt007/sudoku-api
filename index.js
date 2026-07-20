const express = require('express')
const cors = require('cors')
const multer = require('multer')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const core = require('./sudoku-core')
const virtualCatalog = require('./puzzle-catalog-core')
const { recognizeSudokuDigits } = require('./local-ocr')

const PORT = Number(process.env._FAAS_RUNTIME_PORT || process.env.PORT || 8080)
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'records.json')
const SERVER_SALT = process.env.SERVER_SALT || 'CHANGE_THIS_IN_PRODUCTION'
const OCR_DAILY_LIMIT = Math.max(1, Math.min(100, Number(process.env.OCR_DAILY_LIMIT || 20)))
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || '*').split(',').map(item => item.trim()).filter(Boolean)
const PUZZLE_LIBRARY_FILE = process.env.PUZZLE_LIBRARY_FILE || path.join(__dirname, 'data', 'high-frequency-puzzles.json')
const REMOTE_CONFIG_FILE = process.env.REMOTE_CONFIG_FILE || path.join(__dirname, 'data', 'remote-config.json')
const DEFAULT_REMOTE_CONFIG = {
  version: 'v1.7.1-beta.2-default',
  expiresInSeconds: 21600,
  flags: {
    homeV2: { enabled: true, rolloutPercent: 100 },
    onboardingV1: { enabled: true, rolloutPercent: 100 },
    dailyChallenge: { enabled: true, rolloutPercent: 100 },
    resultCardV2: { enabled: true, rolloutPercent: 100 },
    adaptiveDifficulty: { enabled: true, rolloutPercent: 100 },
    ocrRepair: { enabled: false, rolloutPercent: 0 },
    achievements: { enabled: false, rolloutPercent: 0 },
    friendChallenge: { enabled: false, rolloutPercent: 0 },
    analyticsUpload: { enabled: true, rolloutPercent: 100 },
    adFrequencyV2: { enabled: false, rolloutPercent: 0 }
  },
  parameters: { analyticsBatchSize: 20, analyticsFlushSeconds: 30 }
}
const ANALYTICS_FORBIDDEN_KEY = /(nickname|avatar|phone|mobile|email|contact|openid|unionid|content|image|photo|token|secret|password)/i
const PUZZLE_TYPES = {
  common: { label: '常见题型', tags: ['常见', '基础训练'] },
  frequent: { label: '高频题型', tags: ['高频', '热门训练'] },
  classic: { label: '经典题型', tags: ['经典', '逻辑训练'] }
}

const app = express()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024, files: 1 }
})

app.disable('x-powered-by')
app.use(cors({
  origin(origin, callback) {
    if (!origin || ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin)) callback(null, true)
    else callback(new Error('ORIGIN_NOT_ALLOWED'))
  }
}))
app.use(express.json({ limit: '512kb' }))

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function ok(result) { return { ok: true, result } }
function fail(code, message) { return { ok: false, code, message } }
function cleanNickname(value) { return String(value || '数独玩家').trim().slice(0, 16) || '数独玩家' }

function loadPuzzleLibrary() {
  try {
    const list = JSON.parse(fs.readFileSync(PUZZLE_LIBRARY_FILE, 'utf8'))
    return Array.isArray(list) ? list.filter(item => item && core.CONFIG[item.difficulty] && Array.isArray(item.puzzle)) : []
  } catch (error) {
    console.warn('[puzzle-library] 未找到预置题库，将使用 DLX 即时生成')
    return []
  }
}

const puzzleLibrary = loadPuzzleLibrary()

function validPuzzleType(value) { return PUZZLE_TYPES[value] ? value : 'mixed' }
function choosePuzzleType(value) {
  const requested = validPuzzleType(value)
  if (requested !== 'mixed') return requested
  const seed = Math.random()
  return seed < 0.4 ? 'classic' : (seed < 0.75 ? 'frequent' : 'common')
}

function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
    return Object.assign({ records: [], ocrUsage: {}, analyticsEvents: [], dailyChallenges: {}, dailyResults: [], userProgress: {} }, parsed)
  } catch (error) {
    return { records: [], ocrUsage: {}, analyticsEvents: [], dailyChallenges: {}, dailyResults: [], userProgress: {} }
  }
}

function writeStore(store) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true })
  const temp = `${DATA_FILE}.tmp`
  fs.writeFileSync(temp, JSON.stringify(store, null, 2))
  fs.renameSync(temp, DATA_FILE)
}

function playerId(requestData) {
  const raw = `${requestData.platform || 'unknown'}:${requestData.deviceId || 'anonymous'}`
  return hash(`${SERVER_SALT}:${raw}`).slice(0, 32)
}

function mergeRemoteConfig(base, override) {
  const source = override && typeof override === 'object' ? override : {}
  return {
    version: String(source.version || base.version),
    expiresInSeconds: Math.max(60, Math.min(86400, Number(source.expiresInSeconds || base.expiresInSeconds))),
    flags: Object.assign({}, base.flags, source.flags && typeof source.flags === 'object' ? source.flags : {}),
    parameters: Object.assign({}, base.parameters, source.parameters && typeof source.parameters === 'object' ? source.parameters : {})
  }
}

function remoteConfig(platform) {
  let stored = null
  try { stored = JSON.parse(fs.readFileSync(REMOTE_CONFIG_FILE, 'utf8')) } catch (error) {}
  let config = mergeRemoteConfig(DEFAULT_REMOTE_CONFIG, stored)
  const key = String(platform || '')
  if (stored && stored.platformOverrides && stored.platformOverrides[key]) config = mergeRemoteConfig(config, stored.platformOverrides[key])
  return config
}

function cleanAnalyticsProperties(source, depth) {
  if (!source || typeof source !== 'object' || Array.isArray(source) || depth > 2) return {}
  const result = {}
  Object.keys(source).slice(0, 30).forEach(key => {
    const safeKey = String(key).replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 48)
    if (!safeKey || ANALYTICS_FORBIDDEN_KEY.test(safeKey)) return
    const value = source[key]
    if (typeof value === 'string') result[safeKey] = value.slice(0, 160)
    else if (typeof value === 'number' && Number.isFinite(value)) result[safeKey] = value
    else if (typeof value === 'boolean' || value === null) result[safeKey] = value
    else if (Array.isArray(value)) result[safeKey] = value.slice(0, 12).filter(item => ['string', 'number', 'boolean'].includes(typeof item)).map(item => typeof item === 'string' ? item.slice(0, 80) : item)
    else if (value && typeof value === 'object' && depth < 2) result[safeKey] = cleanAnalyticsProperties(value, depth + 1)
  })
  return result
}

function submitAnalyticsBatch(event, identity) {
  const events = Array.isArray(event && event.events) ? event.events.slice(0, 20) : []
  if (!events.length) return ok({ accepted: 0 })
  const store = readStore()
  if (!Array.isArray(store.analyticsEvents)) store.analyticsEvents = []
  let accepted = 0
  events.forEach(item => {
    const eventId = String(item && item.id || '')
    const eventName = String(item && item.event || '')
    if (!/^event_[a-z0-9_]{8,80}$/i.test(eventId) || !/^[a-z][a-z0-9_]{1,47}$/.test(eventName)) return
    const recordId = `ev_${hash(`${identity}:${eventId}`).slice(0, 28)}`
    const existingIndex = store.analyticsEvents.findIndex(record => record.recordId === recordId)
    const safe = {
      recordId,
      eventId,
      event: eventName,
      playerId: identity,
      anonymousId: String(item.anonymousId || '').slice(0, 80),
      sessionId: String(item.sessionId || '').slice(0, 80),
      properties: cleanAnalyticsProperties(item.properties || {}, 0),
      clientCreatedAt: Number(item.createdAt || 0),
      receivedAt: new Date().toISOString()
    }
    if (existingIndex >= 0) store.analyticsEvents[existingIndex] = safe
    else store.analyticsEvents.push(safe)
    accepted += 1
  })
  if (store.analyticsEvents.length > 50000) store.analyticsEvents = store.analyticsEvents.slice(-50000)
  writeStore(store)
  return ok({ accepted })
}

function createPuzzle(difficulty, requestedType) {
  const key = core.CONFIG[difficulty] ? difficulty : 'easy'
  const puzzleType = choosePuzzleType(requestedType)
  return virtualCatalog.getPuzzle(key, puzzleType)
}

function dailyDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10) }
function dailyDay(value) { const parts = String(value || '').split('-').map(Number); return parts.length === 3 ? Math.floor(Date.UTC(parts[0], parts[1] - 1, parts[2]) / 86400000) : 0 }
function dailyScore(record) {
  const base = { beginner: 1000, easy: 1400, medium: 1800, hard: 2300, expert: 3000 }[record.difficulty] || 1800
  const target = { beginner: 360, easy: 540, medium: 720, hard: 960, expert: 1200 }[record.difficulty] || 720
  return Math.max(100, base + Math.max(0, Math.round((target - Math.min(target, record.seconds)) * 1.5)) - record.mistakes * 120 - record.hintsUsed * 180)
}

function getDailyChallenge(event) {
  const date = dailyDate(event && event.date)
  const store = readStore()
  if (!store.dailyChallenges[date]) {
    const generated = createPuzzle('medium', 'classic')
    const solved = core.solveBoard(generated.puzzle)
    store.dailyChallenges[date] = Object.assign({}, generated, { date, puzzleId: `daily_${date}_${hash(JSON.stringify(generated.puzzle)).slice(0, 10)}`, solution: solved.solution, participants: 0, source: 'rest' })
    writeStore(store)
  }
  return ok({ challenge: store.dailyChallenges[date] })
}

function submitDailyResult(event, identity) {
  const source = event.result || {}
  const date = dailyDate(source.date)
  const store = readStore()
  const challenge = store.dailyChallenges[date]
  if (!challenge || String(source.puzzleId || '') !== String(challenge.puzzleId || '')) return fail('DAILY_PUZZLE_MISMATCH', '每日题目标识不一致')
  const seconds = Math.floor(Number(source.seconds || 0))
  const mistakes = Math.max(0, Math.floor(Number(source.mistakes || 0)))
  const hintsUsed = Math.max(0, Math.floor(Number(source.hintsUsed || 0)))
  if (seconds < 1 || seconds > 86400) return fail('INVALID_TIME', '用时数据异常')
  const score = dailyScore({ difficulty: challenge.difficulty, seconds, mistakes, hintsUsed })
  const index = store.dailyResults.findIndex(item => item.playerId === identity && item.date === date)
  const previous = index >= 0 ? store.dailyResults[index] : null
  const best = !previous || score > previous.score || (score === previous.score && seconds < previous.seconds)
  const record = { playerId: identity, date, puzzleId: challenge.puzzleId, difficulty: challenge.difficulty, seconds, mistakes, hintsUsed, score, nickname: cleanNickname(event.profile && event.profile.nickname), updatedAt: new Date().toISOString() }
  if (best && index >= 0) store.dailyResults[index] = record
  else if (best) { store.dailyResults.push(record); challenge.participants = Number(challenge.participants || 0) + 1 }
  const progress = store.userProgress[identity] || { streak: 0, longestStreak: 0, lastDailyDate: '' }
  if (!previous && progress.lastDailyDate !== date) {
    progress.streak = progress.lastDailyDate && dailyDay(date) - dailyDay(progress.lastDailyDate) === 1 ? Number(progress.streak || 0) + 1 : 1
    progress.longestStreak = Math.max(Number(progress.longestStreak || 0), progress.streak)
    progress.lastDailyDate = date
  }
  progress.updatedAt = new Date().toISOString()
  store.userProgress[identity] = progress
  writeStore(store)
  const sorted = store.dailyResults.filter(item => item.date === date).sort((a, b) => b.score - a.score || a.seconds - b.seconds)
  const output = best ? record : previous
  const rank = Math.max(1, sorted.findIndex(item => item.playerId === identity) + 1)
  return ok({ result: Object.assign({}, output, { rank, percentile: Math.max(1, Math.round((1 - (rank - 1) / Math.max(1, sorted.length)) * 100)), streak: progress.streak }), best, duplicate: !!previous && !best })
}

function getDailyRanking(event) {
  const date = dailyDate(event && event.date)
  const limit = Math.max(1, Math.min(50, Number(event && event.limit || 20)))
  const records = readStore().dailyResults.filter(item => item.date === date).sort((a, b) => b.score - a.score || a.seconds - b.seconds).slice(0, limit).map(({ playerId: ignored, ...item }) => item)
  return ok({ date, records })
}

function submitScore(event, identity) {
  const record = event.record || {}
  if (!record.gameId || !core.CONFIG[record.difficulty]) return fail('INVALID_RECORD', '成绩数据不完整')
  const seconds = Math.floor(Number(record.seconds))
  const mistakes = Math.max(0, Math.floor(Number(record.mistakes || 0)))
  const hintsUsed = Math.max(0, Math.floor(Number(record.hintsUsed || 0)))
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 86400) return fail('INVALID_TIME', '用时数据异常')

  const store = readStore()
  const recordId = `r_${hash(`${identity}:${record.gameId}`).slice(0, 28)}`
  const existed = store.records.find(item => item.recordId === recordId)
  if (existed) return ok({ record: existed, duplicate: true })

  const safeRecord = {
    recordId,
    playerId: identity,
    gameId: String(record.gameId).slice(0, 80),
    puzzleId: String(record.puzzleId || '').slice(0, 80),
    difficulty: record.difficulty,
    seconds,
    mistakes,
    hintsUsed,
    score: core.calculateScore({ difficulty: record.difficulty, seconds, mistakes, hintsUsed }),
    nickname: cleanNickname(event.profile && event.profile.nickname),
    createdAt: new Date().toISOString()
  }
  store.records.push(safeRecord)
  if (store.records.length > 50000) store.records = store.records.slice(-50000)
  writeStore(store)
  return ok({ record: safeRecord, duplicate: false })
}

function ranking(event) {
  const mode = event.mode === 'time' ? 'time' : 'score'
  const difficulty = event.difficulty && event.difficulty !== 'all' && core.CONFIG[event.difficulty] ? event.difficulty : ''
  const limit = Math.max(1, Math.min(50, Number(event.limit || 20)))
  const records = readStore().records
    .filter(item => !difficulty || item.difficulty === difficulty)
    .sort((a, b) => mode === 'time'
      ? a.seconds - b.seconds || b.score - a.score
      : b.score - a.score || a.seconds - b.seconds)
    .slice(0, limit)
    .map(({ playerId: ignored, gameId: ignoredGame, puzzleId: ignoredPuzzle, recordId: ignoredRecord, ...safe }) => safe)
  return ok({ records })
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)) }
function polygonBounds(polygon) {
  const points = Array.isArray(polygon) ? polygon : []
  const xs = points.map(point => Number(point.X || point.x || 0))
  const ys = points.map(point => Number(point.Y || point.y || 0))
  return {
    left: xs.length ? Math.min(...xs) : 0,
    right: xs.length ? Math.max(...xs) : 0,
    top: ys.length ? Math.min(...ys) : 0,
    bottom: ys.length ? Math.max(...ys) : 0
  }
}

function mapDetections(detections, width, height) {
  const board = Array.from({ length: 9 }, () => Array(9).fill(0))
  const confidences = Array.from({ length: 9 }, () => Array(9).fill(0))
  const bounds = detections.map(item => polygonBounds(item.Polygon))
  const imageWidth = Number(width) > 0 ? Number(width) : Math.max(...bounds.map(item => item.right), 1)
  const imageHeight = Number(height) > 0 ? Number(height) : Math.max(...bounds.map(item => item.bottom), 1)
  detections.forEach((item, index) => {
    const digits = String(item.DetectedText || '').match(/[1-9]/g) || []
    const confidence = Number(item.Confidence || 0)
    // 本地 OCR 对经过二值化的细字体置信度通常低于云端通用 OCR，
    // 45 以下才丢弃，最终结果仍由客户端要求用户确认后再求解。
    if (!digits.length || confidence && confidence < 45) return
    digits.forEach((digit, digitIndex) => {
      const ratio = (digitIndex + 0.5) / digits.length
      const centerX = bounds[index].left + (bounds[index].right - bounds[index].left) * ratio
      const centerY = (bounds[index].top + bounds[index].bottom) / 2
      const col = clamp(Math.floor(centerX / imageWidth * 9), 0, 8)
      const row = clamp(Math.floor(centerY / imageHeight * 9), 0, 8)
      if (!board[row][col] || confidence > confidences[row][col]) {
        board[row][col] = Number(digit)
        confidences[row][col] = confidence
      }
    })
  })
  const used = confidences.flat().filter(Boolean)
  return {
    board,
    recognizedCount: board.flat().filter(Boolean).length,
    averageConfidence: used.length ? used.reduce((sum, value) => sum + value, 0) / used.length : 0
  }
}

function consumeOcrQuota(identity) {
  const store = readStore()
  const day = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const key = `${identity}:${day}`
  const count = Number(store.ocrUsage[key] || 0)
  if (count >= OCR_DAILY_LIMIT) return false
  store.ocrUsage[key] = count + 1
  Object.keys(store.ocrUsage).forEach(item => {
    if (!item.endsWith(day)) delete store.ocrUsage[item]
  })
  writeStore(store)
  return true
}

app.get('/health', (request, response) => response.json({
  ok: true,
  service: 'magic-number-maze-api',
  ocr: 'douyin-cloud-local',
  solver: 'DLX',
  cachedPuzzles: virtualCatalog.CATALOG_SIZE,
  basePuzzles: virtualCatalog.SEEDS.length,
  catalogVersion: virtualCatalog.CATALOG_VERSION,
  puzzleCatalog: Object.keys(PUZZLE_TYPES).reduce((result, key) => {
    result[key] = puzzleLibrary.filter(item => item.puzzleType === key).length
    return result
  }, {})
}))

app.post('/v1/function', (request, response) => {
  try {
    const body = request.body || {}
    if (body.name !== 'sudokuApi') return response.status(404).json(fail('UNKNOWN_FUNCTION', '未知服务'))
    const event = body.data || {}
    const identity = playerId(body)
    if (event.action === 'solve') return response.json(ok({ result: core.solveBoard(event.board) }))
    if (event.action === 'getClassicPuzzle') return response.json(ok({ puzzle: createPuzzle(event.difficulty, event.puzzleType) }))
    if (event.action === 'getDailyChallenge') return response.json(getDailyChallenge(event))
    if (event.action === 'submitDailyResult') {
      const result = submitDailyResult(event, identity)
      return response.status(result.ok ? 200 : 400).json(result)
    }
    if (event.action === 'getDailyRanking') return response.json(getDailyRanking(event))
    if (event.action === 'submitScore') {
      const result = submitScore(event, identity)
      return response.status(result.ok ? 200 : 400).json(result)
    }
    if (event.action === 'getRanking') return response.json(ranking(event))
    if (event.action === 'getRemoteConfig') return response.json(ok({ config: remoteConfig(event.platform || body.platform) }))
    if (event.action === 'submitAnalyticsBatch') return response.json(submitAnalyticsBatch(event, identity))
    return response.status(400).json(fail('UNKNOWN_ACTION', '未知接口操作'))
  } catch (error) {
    console.error('[function]', error)
    return response.status(500).json(fail('SERVER_ERROR', '服务暂时不可用'))
  }
})

app.post('/v1/ocr', upload.single('image'), async (request, response) => {
  try {
    if (!request.file || !request.file.buffer) return response.status(400).json(fail('NO_IMAGE', '没有收到题盘图片'))
    const identity = playerId(request.body || {})
    if (!consumeOcrQuota(identity)) return response.status(429).json(fail('OCR_DAILY_LIMIT', '今日拍照识别次数已用完'))
    const recognized = await recognizeSudokuDigits({ imageBuffer: request.file.buffer })
    const mapped = mapDetections(recognized.detections, recognized.width, recognized.height)
    return response.json(ok(mapped))
  } catch (error) {
    console.error('[ocr]', error)
    return response.status(500).json(fail('OCR_FAILED', '图片识别失败，请重新拍摄'))
  }
})

app.post('/v1/ocr-cloud', async (request, response) => {
  try {
    const imageUrl = String(request.body && request.body.imageUrl || '')
    if (!/^https:\/\//i.test(imageUrl)) return response.status(400).json(fail('NO_IMAGE_URL', '没有收到有效的云端题盘图片'))
    const identity = playerId(request.body || {})
    if (!consumeOcrQuota(identity)) return response.status(429).json(fail('OCR_DAILY_LIMIT', '今日拍照识别次数已用完'))
    const recognized = await recognizeSudokuDigits({ imageUrl })
    const mapped = mapDetections(recognized.detections, recognized.width, recognized.height)
    return response.json(ok(mapped))
  } catch (error) {
    console.error('[ocr-cloud]', error)
    return response.status(500).json(fail('OCR_FAILED', '图片识别失败，请重新拍摄'))
  }
})

app.use((error, request, response, next) => {
  console.error('[http]', error)
  response.status(400).json(fail('REQUEST_FAILED', error.message || '请求失败'))
})

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Magic Number Maze API listening on http://127.0.0.1:${PORT}`)
    if (SERVER_SALT === 'CHANGE_THIS_IN_PRODUCTION') console.warn('请在生产环境设置随机 SERVER_SALT')
  })
}

module.exports = { app, mapDetections, createPuzzle, puzzleLibrary, remoteConfig, submitAnalyticsBatch, cleanAnalyticsProperties, getDailyChallenge, submitDailyResult, getDailyRanking }
