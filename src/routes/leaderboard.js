'use strict';
const Router = require('koa-router');
const { get } = require('../db/kv');
const { authMiddleware } = require('../middleware/auth');

const router = new Router({ prefix: '/api/leaderboard' });
router.use(authMiddleware);

/**
 * GET /api/leaderboard?difficulty=1&page=1&pageSize=20
 * 获取排行榜（分难度分页）
 */
router.get('/', async (ctx) => {
  const { openId } = ctx.state.user;
  const difficulty = parseInt(ctx.query.difficulty) || 1;
  const page = Math.max(1, parseInt(ctx.query.page) || 1);
  const pageSize = Math.min(50, parseInt(ctx.query.pageSize) || 20);

  const diffMap = { 1: 'easy', 2: 'medium', 3: 'hard' };
  const diffKey = diffMap[difficulty] || 'easy';
  const rankKey = `rank:${diffKey}`;

  const leaderboard = await get(rankKey) || [];

  const offset = (page - 1) * pageSize;
  const list = leaderboard.slice(offset, offset + pageSize).map((r, i) => ({
    rank: offset + i + 1,
    userId: r.userId,
    nickname: r.nickname || '匿名玩家',
    avatarUrl: r.avatarUrl || '',
    bestScore: r.bestScore,
    bestTime: r.bestTime
  }));

  // 当前用户排名
  const myIdx = leaderboard.findIndex(r => r.openId === openId);
  const myRank = myIdx >= 0 ? myIdx + 1 : null;
  const myRecord = myIdx >= 0 ? leaderboard[myIdx] : null;

  ctx.body = {
    code: 0,
    msg: 'ok',
    data: {
      list,
      total: leaderboard.length,
      myRank,
      myBestScore: myRecord?.bestScore || 0,
      myBestTime: myRecord?.bestTime || null,
      page,
      pageSize
    }
  };
});

module.exports = router;
