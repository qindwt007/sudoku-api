'use strict';
const Router = require('koa-router');
const { get, set } = require('../db/kv');
const { authMiddleware } = require('../middleware/auth');

const router = new Router({ prefix: '/api/sync' });
router.use(authMiddleware);

/**
 * GET /api/sync/pull
 * 拉取用户云端数据（设置、存档、统计）
 */
router.get('/pull', async (ctx) => {
  const { openId } = ctx.state.user;
  const syncKey = `sync:${openId}`;
  const data = await get(syncKey) || {
    settings: {},
    saveData: null,
    stats: { totalGames: 0, wins: 0, bestTimes: {} }
  };
  ctx.body = { code: 0, msg: 'ok', data };
});

/**
 * POST /api/sync/push
 * 推送用户数据到云端（全量覆盖）
 * Body: { settings?, saveData?, stats? }
 */
router.post('/push', async (ctx) => {
  const { openId } = ctx.state.user;
  const { settings, saveData, stats } = ctx.request.body;
  const syncKey = `sync:${openId}`;
  const existing = await get(syncKey) || {};
  const merged = {
    settings: settings !== undefined ? settings : (existing.settings || {}),
    saveData: saveData !== undefined ? saveData : (existing.saveData || null),
    stats: stats !== undefined ? stats : (existing.stats || { totalGames: 0, wins: 0, bestTimes: {} }),
    updatedAt: Date.now()
  };
  await set(syncKey, merged);
  ctx.body = { code: 0, msg: 'ok', data: { updatedAt: merged.updatedAt } };
});

/**
 * POST /api/sync/record
 * 上传游戏完成记录（用于排行榜）
 * Body: { difficulty, score, timeUsed, completed }
 */
router.post('/record', async (ctx) => {
  const { openId, userId } = ctx.state.user;
  const { difficulty, score, timeUsed, completed } = ctx.request.body;
  if (!difficulty || score === undefined || timeUsed === undefined) {
    ctx.status = 400;
    ctx.body = { code: 400, msg: '缺少必要参数' };
    return;
  }
  if (!completed) {
    ctx.body = { code: 0, msg: 'ok', data: {} };
    return;
  }
  const diffMap = { 1: 'easy', 2: 'medium', 3: 'hard' };
  const diffKey = diffMap[difficulty] || 'easy';
  const rankKey = `rank:${diffKey}`;
  const userKey = `user:${openId}`;
  const userInfo = await get(userKey) || {};
  let leaderboard = await get(rankKey) || [];
  const existingIdx = leaderboard.findIndex(r => r.openId === openId);
  const newRecord = {
    openId, userId,
    nickname: userInfo.nickname || '数独玩家',
    avatarUrl: userInfo.avatarUrl || '',
    bestScore: score,
    bestTime: timeUsed,
    updatedAt: Date.now()
  };
  if (existingIdx >= 0) {
    const ex = leaderboard[existingIdx];
    if (score > ex.bestScore || (score === ex.bestScore && timeUsed < ex.bestTime)) {
      leaderboard[existingIdx] = newRecord;
    }
  } else {
    leaderboard.push(newRecord);
  }
  leaderboard.sort((a, b) => b.bestScore - a.bestScore || a.bestTime - b.bestTime);
  if (leaderboard.length > 200) leaderboard = leaderboard.slice(0, 200);
  await set(rankKey, leaderboard);
  ctx.body = { code: 0, msg: 'ok', data: {} };
});

/**
 * GET /api/sync/checkin
 * 获取签到状态
 */
router.get('/checkin', async (ctx) => {
  const { openId } = ctx.state.user;
  const checkinKey = `checkin:${openId}`;
  const checkin = await get(checkinKey) || { lastDate: null, streak: 0, total: 0 };
  const today = new Date().toISOString().slice(0, 10);
  ctx.body = {
    code: 0, msg: 'ok',
    data: {
      checkedToday: checkin.lastDate === today,
      streak: checkin.streak,
      total: checkin.total,
      lastDate: checkin.lastDate
    }
  };
});

/**
 * POST /api/sync/checkin
 * 执行签到
 */
router.post('/checkin', async (ctx) => {
  const { openId } = ctx.state.user;
  const checkinKey = `checkin:${openId}`;
  const checkin = await get(checkinKey) || { lastDate: null, streak: 0, total: 0 };
  const today = new Date().toISOString().slice(0, 10);
  if (checkin.lastDate === today) {
    ctx.body = { code: 0, msg: '今日已签到', data: { checkedToday: true, streak: checkin.streak, total: checkin.total, reward: 0 } };
    return;
  }
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const newStreak = checkin.lastDate === yesterday ? checkin.streak + 1 : 1;
  const newTotal = checkin.total + 1;
  const reward = newStreak % 7 === 0 ? 3 : 1;
  await set(checkinKey, { lastDate: today, streak: newStreak, total: newTotal });
  ctx.body = {
    code: 0, msg: '签到成功',
    data: { checkedToday: true, streak: newStreak, total: newTotal, reward, isWeekBonus: newStreak % 7 === 0 }
  };
});

module.exports = router;
