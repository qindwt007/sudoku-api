const sharp = require('sharp')
const { createWorker, PSM } = require('tesseract.js')
const english = require('@tesseract.js-data/eng')

const OCR_SIZE = 900
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
let workerPromise = null
let queue = Promise.resolve()

function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, {
      langPath: english.langPath,
      gzip: english.gzip,
      cachePath: '/tmp/tesseract-cache',
      logger(message) {
        if (message && message.status === 'recognizing text') {
          console.log(`[local-ocr] ${Math.round(Number(message.progress || 0) * 100)}%`)
        }
      }
    }).then(async worker => {
      await worker.setParameters({
        tessedit_char_whitelist: '123456789',
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        preserve_interword_spaces: '1'
      })
      return worker
    }).catch(error => {
      workerPromise = null
      throw error
    })
  }
  return workerPromise
}

async function downloadImage(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`IMAGE_DOWNLOAD_${response.status}`)
    const contentLength = Number(response.headers.get('content-length') || 0)
    if (contentLength > MAX_IMAGE_BYTES) throw new Error('IMAGE_TOO_LARGE')
    const buffer = Buffer.from(await response.arrayBuffer())
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new Error('IMAGE_TOO_LARGE')
    return buffer
  } finally {
    clearTimeout(timer)
  }
}

async function preprocess(input) {
  const normalized = await sharp(input, { limitInputPixels: 25 * 1000 * 1000 })
    .rotate()
    .flatten({ background: '#ffffff' })
    .grayscale()
    .resize(OCR_SIZE, OCR_SIZE, { fit: 'fill' })
    .normalize()
    .sharpen()
    .threshold(180)
    .png()
    .toBuffer()

  // 删除每个格子四周约 14% 的区域，避免横竖网格线干扰数字分割。
  // 识别画布仍保持 900×900，因此返回坐标可直接映射回 9×9 棋盘。
  const cell = OCR_SIZE / 9
  const inset = 14
  const inner = cell - inset * 2
  const pieces = []
  for (let row = 0; row < 9; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      pieces.push(
        sharp(normalized)
          .extract({ left: col * cell + inset, top: row * cell + inset, width: inner, height: inner })
          .png()
          .toBuffer()
          .then(buffer => ({ input: buffer, left: col * cell + inset, top: row * cell + inset }))
      )
    }
  }
  const composites = await Promise.all(pieces)
  return sharp({ create: { width: OCR_SIZE, height: OCR_SIZE, channels: 3, background: '#ffffff' } })
    .composite(composites)
    .png()
    .toBuffer()
}

function collectWords(data) {
  const symbols = []
  const words = []
  const visit = node => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node.symbols)) node.symbols.forEach(symbol => symbols.push(symbol))
    if (Array.isArray(node.words)) node.words.forEach(word => words.push(word))
    ;['blocks', 'paragraphs', 'lines', 'words'].forEach(key => {
      if (Array.isArray(node[key])) node[key].forEach(visit)
    })
  }
  visit(data)
  // symbol 带有单个字符的精确坐标，比整行/整词的等分定位可靠。
  return symbols.length ? symbols : words
}

function wordToDetection(word) {
  const digits = String(word && word.text || '').match(/[1-9]/g)
  const box = word && (word.bbox || word.boundingBox)
  if (!digits || !digits.length || !box) return null
  const left = Number(box.x0 !== undefined ? box.x0 : box.left)
  const top = Number(box.y0 !== undefined ? box.y0 : box.top)
  const right = Number(box.x1 !== undefined ? box.x1 : (box.left + box.width))
  const bottom = Number(box.y1 !== undefined ? box.y1 : (box.top + box.height))
  if (![left, top, right, bottom].every(Number.isFinite)) return null
  return {
    DetectedText: digits.join(''),
    Confidence: Number(word.confidence || word.conf || 0),
    Polygon: [
      { X: left, Y: top },
      { X: right, Y: top },
      { X: right, Y: bottom },
      { X: left, Y: bottom }
    ]
  }
}

async function recognize(input) {
  const source = input.imageBuffer || await downloadImage(input.imageUrl)
  const processed = await preprocess(source)
  const worker = await getWorker()
  const result = await worker.recognize(processed, {}, { blocks: true, text: true })
  return {
    detections: collectWords(result.data).map(wordToDetection).filter(Boolean),
    width: OCR_SIZE,
    height: OCR_SIZE
  }
}

function recognizeSudokuDigits(input) {
  const task = queue.then(() => recognize(input))
  queue = task.catch(() => {})
  return task
}

module.exports = { recognizeSudokuDigits, collectWords, wordToDetection, OCR_SIZE }
