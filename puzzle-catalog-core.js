/*
 * 三端共用的确定性数独目录核心。
 *
 * 100 道母题均已通过 DLX 唯一解验证。每道母题使用数独等价变换生成
 * 600 个稳定编号题面，总目录容量为 60,000 道。等价变换不会改变唯一解：
 * 数字重映射、宫带/宫列与内部行列重排、转置。
 */
const SEEDS = require('./puzzle-catalog-data')

const DIFFICULTIES = ['beginner', 'easy', 'medium', 'hard', 'expert']
const TYPES = ['common', 'frequent', 'classic']
const TYPE_LABELS = { common: '常见题型', frequent: '高频题型', classic: '经典题型' }
const TYPE_TAGS = { common: ['常见', '基础训练'], frequent: ['高频', '热门训练'], classic: ['经典', '逻辑训练'] }
const VARIANTS_PER_SEED = 600
const CATALOG_SIZE = SEEDS.length * VARIANTS_PER_SEED
const CATALOG_VERSION = 'catalog-60000-v1'

function hashString(value) {
  let hash = 2166136261
  const text = String(value)
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function seededRandom(seed) {
  let state = seed >>> 0
  return function random() {
    state += 0x6D2B79F5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle(values, random) {
  const list = values.slice()
  for (let index = list.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1))
    ;[list[index], list[target]] = [list[target], list[index]]
  }
  return list
}

function parseBoard(value) {
  const text = String(value || '').padEnd(81, '0').slice(0, 81)
  return Array.from({ length: 9 }, (_, row) => text.slice(row * 9, row * 9 + 9).split('').map(Number))
}

function axisOrder(random) {
  const groups = shuffle([0, 1, 2], random)
  const order = []
  groups.forEach(group => shuffle([0, 1, 2], random).forEach(offset => order.push(group * 3 + offset)))
  return order
}

function createTransform(random) {
  return {
    digits: shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], random),
    rows: axisOrder(random),
    columns: axisOrder(random),
    transpose: random() >= 0.5
  }
}

function transform(board, mapping) {
  const result = Array.from({ length: 9 }, () => Array(9).fill(0))
  for (let row = 0; row < 9; row += 1) {
    for (let column = 0; column < 9; column += 1) {
      const sourceRow = mapping.transpose ? mapping.rows[column] : mapping.rows[row]
      const sourceColumn = mapping.transpose ? mapping.columns[row] : mapping.columns[column]
      const value = board[sourceRow][sourceColumn]
      result[row][column] = value ? mapping.digits[value - 1] : 0
    }
  }
  return result
}

function normalizeIndex(value) {
  const number = Math.floor(Number(value) || 0)
  return ((number % CATALOG_SIZE) + CATALOG_SIZE) % CATALOG_SIZE
}

function getPuzzleByIndex(value) {
  const catalogIndex = normalizeIndex(value)
  const seedIndex = catalogIndex % SEEDS.length
  const variantIndex = Math.floor(catalogIndex / SEEDS.length)
  const seed = SEEDS[seedIndex]
  const random = seededRandom(hashString(`${CATALOG_VERSION}:${seed.id}:${variantIndex}`))
  const mapping = createTransform(random)
  return {
    puzzleId: `local_${CATALOG_VERSION}_${catalogIndex}`,
    sourcePuzzleId: seed.id,
    source: 'bundled_virtual_catalog',
    catalogVersion: CATALOG_VERSION,
    catalogIndex,
    difficulty: seed.difficulty,
    puzzleType: seed.type,
    typeLabel: TYPE_LABELS[seed.type],
    tags: TYPE_TAGS[seed.type].slice(),
    puzzle: transform(parseBoard(seed.puzzle), mapping),
    solution: transform(parseBoard(seed.solution), mapping),
    solutionTrusted: true
  }
}

function groupIndexes(difficulty, puzzleType) {
  const level = DIFFICULTIES.includes(difficulty) ? difficulty : 'easy'
  const type = TYPES.includes(puzzleType) ? puzzleType : ''
  const seeds = []
  SEEDS.forEach((seed, index) => {
    if (seed.difficulty === level && (!type || seed.type === type)) seeds.push(index)
  })
  return { level, type, seeds }
}

function getRandomIndex(difficulty, puzzleType, random) {
  const rng = typeof random === 'function' ? random : Math.random
  const group = groupIndexes(difficulty, puzzleType)
  const seedIndex = group.seeds[Math.floor(rng() * group.seeds.length)]
  const fallbackSeed = SEEDS.findIndex(seed => seed.difficulty === group.level)
  const selectedSeed = seedIndex === undefined ? Math.max(0, fallbackSeed) : seedIndex
  const variant = Math.floor(rng() * VARIANTS_PER_SEED)
  return selectedSeed + variant * SEEDS.length
}

function getPuzzle(difficulty, puzzleType, random) {
  return getPuzzleByIndex(getRandomIndex(difficulty, puzzleType, random))
}

module.exports = {
  SEEDS,
  DIFFICULTIES,
  TYPES,
  TYPE_LABELS,
  VARIANTS_PER_SEED,
  CATALOG_SIZE,
  CATALOG_VERSION,
  getPuzzle,
  getPuzzleByIndex,
  getRandomIndex
}
