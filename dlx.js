/**
 * Sudoku DLX (Dancing Links / Algorithm X)
 *
 * 9x9 数独会被转换为 324 个精确覆盖约束：
 * - 81 个格子约束
 * - 81 个行数字约束
 * - 81 个列数字约束
 * - 81 个宫数字约束
 *
 * 为避免空题盘产生海量结果拖垮终端，调用者必须通过 maxSolutions
 * 设置枚举上限。反查页面使用 11：找到第 11 个解即可确定“超过 10 个”。
 */

function cloneBoard(board) {
  return board.map(row => row.slice())
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const value = list[i]
    list[i] = list[j]
    list[j] = value
  }
  return list
}

function constraintColumns(row, col, digit) {
  const number = digit - 1
  const box = Math.floor(row / 3) * 3 + Math.floor(col / 3)
  return [
    row * 9 + col,
    81 + row * 9 + number,
    162 + col * 9 + number,
    243 + box * 9 + number
  ]
}

function createMatrix(board) {
  const columnCount = 324
  const root = 0
  const L = []
  const R = []
  const U = []
  const D = []
  const C = []
  const S = []
  const rowIds = []
  const assignments = []

  L[root] = columnCount
  R[root] = 1
  U[root] = D[root] = root
  for (let column = 1; column <= columnCount; column++) {
    L[column] = column - 1
    R[column] = column === columnCount ? root : column + 1
    U[column] = D[column] = column
    C[column] = column
    S[column] = 0
  }

  function addAssignment(row, col, digit) {
    const assignmentId = assignments.length
    assignments.push({ row, col, digit })
    const columns = constraintColumns(row, col, digit)
    let first = -1
    let previous = -1
    columns.forEach(zeroBasedColumn => {
      const column = zeroBasedColumn + 1
      const node = L.length
      C[node] = column
      rowIds[node] = assignmentId

      U[node] = U[column]
      D[node] = column
      D[U[column]] = node
      U[column] = node
      S[column] += 1

      if (first < 0) {
        first = node
        L[node] = R[node] = node
      } else {
        L[node] = previous
        R[node] = first
        R[previous] = node
        L[first] = node
      }
      previous = node
    })
  }

  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      const given = Number(board[row][col]) || 0
      if (given) addAssignment(row, col, given)
      else for (let digit = 1; digit <= 9; digit++) addAssignment(row, col, digit)
    }
  }

  return { root, L, R, U, D, C, S, rowIds, assignments }
}

function solveExactCover(inputBoard, options) {
  const settings = options || {}
  const maxSolutions = Math.max(1, Math.floor(Number(settings.maxSolutions) || 1))
  const randomize = !!settings.randomize
  const board = cloneBoard(inputBoard)
  const matrix = createMatrix(board)
  const { root, L, R, U, D, C, S, rowIds, assignments } = matrix
  const chosenRows = []
  const solutions = []
  let nodesVisited = 0
  let stoppedAtLimit = false
  const startedAt = Date.now()

  function cover(column) {
    L[R[column]] = L[column]
    R[L[column]] = R[column]
    for (let row = D[column]; row !== column; row = D[row]) {
      for (let node = R[row]; node !== row; node = R[node]) {
        U[D[node]] = U[node]
        D[U[node]] = D[node]
        S[C[node]] -= 1
      }
    }
  }

  function uncover(column) {
    for (let row = U[column]; row !== column; row = U[row]) {
      for (let node = L[row]; node !== row; node = L[node]) {
        S[C[node]] += 1
        U[D[node]] = node
        D[U[node]] = node
      }
    }
    L[R[column]] = column
    R[L[column]] = column
  }

  function chooseColumn() {
    let best = R[root]
    for (let column = R[root]; column !== root; column = R[column]) {
      if (S[column] < S[best]) best = column
      if (S[best] <= 1) break
    }
    return best
  }

  function materializeSolution() {
    const result = cloneBoard(board)
    chosenRows.forEach(node => {
      const assignment = assignments[rowIds[node]]
      result[assignment.row][assignment.col] = assignment.digit
    })
    return result
  }

  function visit(depth) {
    if (solutions.length >= maxSolutions) {
      stoppedAtLimit = true
      return true
    }
    if (R[root] === root) {
      solutions.push(materializeSolution())
      return solutions.length >= maxSolutions
    }
    const column = chooseColumn()
    if (!column || S[column] === 0) return false
    cover(column)
    const rows = []
    for (let row = D[column]; row !== column; row = D[row]) rows.push(row)
    if (randomize) shuffle(rows)
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]
      nodesVisited += 1
      chosenRows[depth] = row
      for (let node = R[row]; node !== row; node = R[node]) cover(C[node])
      const shouldStop = visit(depth + 1)
      for (let node = L[row]; node !== row; node = L[node]) uncover(C[node])
      if (shouldStop) {
        uncover(column)
        return true
      }
    }
    uncover(column)
    return false
  }

  visit(0)
  return {
    solutions,
    count: solutions.length,
    reachedLimit: stoppedAtLimit || solutions.length >= maxSolutions,
    nodesVisited,
    elapsedMs: Date.now() - startedAt
  }
}

module.exports = { solveExactCover }
