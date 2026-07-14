const SIZE = 9
const EMPTY = 0
const CONFIG = {
  beginner: { coverage: [25, 35], scoreRate: 1.0 },
  easy: { coverage: [36, 45], scoreRate: 1.2 },
  medium: { coverage: [46, 60], scoreRate: 1.5 },
  hard: { coverage: [61, 70], scoreRate: 2.0 },
  expert: { coverage: [71, 80], scoreRate: 3.0 }
}

function clone(board) { return board.map(row => row.slice()) }
function emptyBoard() { return Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY)) }
function shuffle(values) {
  const result = values.slice()
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1))
    ;[result[index], result[swap]] = [result[swap], result[index]]
  }
  return result
}
function safe(board, row, col, value) {
  for (let index = 0; index < SIZE; index++) if (board[row][index] === value || board[index][col] === value) return false
  const startRow = Math.floor(row / 3) * 3
  const startCol = Math.floor(col / 3) * 3
  for (let r = startRow; r < startRow + 3; r++) for (let c = startCol; c < startCol + 3; c++) if (board[r][c] === value) return false
  return true
}
function candidates(board, row, col) {
  if (board[row][col]) return []
  const values = []
  for (let value = 1; value <= 9; value++) if (safe(board, row, col, value)) values.push(value)
  return values
}
function findEmpty(board) {
  let best = null
  let bestValues = null
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      if (!board[row][col]) {
        const values = candidates(board, row, col)
        if (!best || values.length < bestValues.length) {
          best = [row, col]
          bestValues = values
          if (values.length <= 1) return best
        }
      }
    }
  }
  return best
}
function validate(board) {
  if (!Array.isArray(board) || board.length !== 9 || board.some(row => !Array.isArray(row) || row.length !== 9)) return { valid: false, conflicts: [], reason: 'format' }
  const copy = board.map(row => row.map(value => Number(value) || 0))
  const conflicts = new Set()
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      const value = copy[row][col]
      if (!Number.isInteger(value) || value < 0 || value > 9) { conflicts.add(`${row}-${col}`); continue }
      if (!value) continue
      copy[row][col] = 0
      if (!safe(copy, row, col, value)) conflicts.add(`${row}-${col}`)
      copy[row][col] = value
    }
  }
  return { valid: conflicts.size === 0, conflicts: Array.from(conflicts), reason: conflicts.size ? 'conflict' : '' }
}
function solveBoard(input) {
  const checked = validate(input)
  if (!checked.valid) return { status: 'invalid', solution: null, count: 0, givenCount: 0, conflicts: checked.conflicts }
  const board = input.map(row => row.map(value => Number(value) || 0))
  const givenCount = board.reduce((sum, row) => sum + row.filter(Boolean).length, 0)
  if (givenCount < 17) return { status: 'insufficient', solution: null, count: 0, givenCount, conflicts: [] }
  let count = 0
  let first = null
  function search() {
    if (count >= 2) return
    const pos = findEmpty(board)
    if (!pos) { count += 1; if (!first) first = clone(board); return }
    const [row, col] = pos
    for (const value of candidates(board, row, col)) {
      board[row][col] = value
      search()
      board[row][col] = 0
      if (count >= 2) return
    }
  }
  search()
  if (!count) return { status: 'none', solution: null, count: 0, givenCount, conflicts: [] }
  if (count > 1) return { status: 'multiple', solution: null, count, givenCount, conflicts: [] }
  return { status: 'unique', solution: first, count: 1, givenCount, conflicts: [] }
}
function countSolutions(input, limit) {
  const board = clone(input)
  let count = 0
  function search() {
    if (count >= limit) return
    const pos = findEmpty(board)
    if (!pos) { count += 1; return }
    const [row, col] = pos
    for (const value of candidates(board, row, col)) {
      board[row][col] = value
      search()
      board[row][col] = 0
      if (count >= limit) return
    }
  }
  search()
  return count
}
function fill(board) {
  const pos = findEmpty(board)
  if (!pos) return true
  const [row, col] = pos
  for (const value of shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9])) {
    if (!safe(board, row, col, value)) continue
    board[row][col] = value
    if (fill(board)) return true
    board[row][col] = 0
  }
  return false
}
function generatePuzzle(difficulty) {
  const key = CONFIG[difficulty] ? difficulty : 'easy'
  const config = CONFIG[key]
  const solution = emptyBoard()
  fill(solution)
  const puzzle = clone(solution)
  const coverage = config.coverage[0] + Math.floor(Math.random() * (config.coverage[1] - config.coverage[0] + 1))
  const targetGivens = Math.max(17, 81 - Math.round(81 * coverage / 100))
  const indexes = shuffle(Array.from({ length: 81 }, (_, index) => index))
  let givens = 81
  for (const index of indexes) {
    if (givens <= targetGivens) break
    const row = Math.floor(index / 9)
    const col = index % 9
    const backup = puzzle[row][col]
    puzzle[row][col] = 0
    if (countSolutions(puzzle, 2) === 1) givens -= 1
    else puzzle[row][col] = backup
  }
  return { difficulty: key, puzzle, solution, coverage: Math.round((81 - givens) * 100 / 81) }
}
function calculateScore(record) {
  const config = CONFIG[record.difficulty] || CONFIG.easy
  const base = 1000 * config.scoreRate
  const timePenalty = Math.min(600, Math.floor(Number(record.seconds || 0) / 5))
  const mistakePenalty = Number(record.mistakes || 0) * 60
  const hintPenalty = Number(record.hintsUsed || 0) * 90
  return Math.max(100, Math.round(base - timePenalty - mistakePenalty - hintPenalty))
}

module.exports = { CONFIG, clone, validate, solveBoard, generatePuzzle, calculateScore }
