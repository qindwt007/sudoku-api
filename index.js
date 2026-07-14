const express = require('express')
const cors = require('cors')
const multer = require('multer')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const core = require('./sudoku-core')
const { recognizeSudokuDigits } = require('./local-ocr')

const PORT = Number(process.env._FAAS_RUNTIME_PORT || process.env.PORT || 8080)
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'records.json')
const SERVER_SALT = process.env.SERVER_SALT || 'CHANGE_THIS_IN_PRODUCTION'
const OCR_DAILY_LIMIT = Math.max(1, Math.min(100, Number(process.env.OCR_DAILY_LIMIT || 20)))
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || '*').split(',').map(item => item.trim()).filter(Boolean)

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

function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
    return Object.assign({ records: [], ocrUsage: {} }, parsed)
  } catch (error) {
    return { records: [], ocrUsage: {} }
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

function createPuzzle(difficulty) {
  const key = core.CONFIG[difficulty] ? difficulty : 'easy'
  const generated = core.generatePuzzle(key)
  return {
    puzzleId: `rest_${hash(JSON.stringify(generated.puzzle)).slice(0, 20)}`,
    difficulty: key,
    puzzle: generated.puzzle,
    coverage: generated.coverage
  }
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

app.get('/health', (request, response) => response.json({ ok: true, service: 'magic-number-maze-api', ocr: 'douyin-cloud-local' }))

app.post('/v1/function', (request, response) => {
  try {
    const body = request.body || {}
    if (body.name !== 'sudokuApi') return response.status(404).json(fail('UNKNOWN_FUNCTION', '未知服务'))
    const event = body.data || {}
    const identity = playerId(body)
    if (event.action === 'solve') return response.json(ok({ result: core.solveBoard(event.board) }))
    if (event.action === 'getClassicPuzzle') return response.json(ok({ puzzle: createPuzzle(event.difficulty) }))
    if (event.action === 'submitScore') {
      const result = submitScore(event, identity)
      return response.status(result.ok ? 200 : 400).json(result)
    }
    if (event.action === 'getRanking') return response.json(ranking(event))
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

app.listen(PORT, () => {
  console.log(`Magic Number Maze API listening on http://127.0.0.1:${PORT}`)
  if (SERVER_SALT === 'CHANGE_THIS_IN_PRODUCTION') console.warn('请在生产环境设置随机 SERVER_SALT')
})

module.exports = { app, mapDetections }
