'use strict';
const Router = require('koa-router');
const crypto = require('crypto');
const { get, set } = require('../db/kv');
const { authMiddleware } = require('../middleware/auth');

const router = new Router({ prefix: '/api/ad' });
router.use(authMiddleware);

const TOKEN_TTL_SECONDS = 5 * 60; // 5 分钟有效期

/**
 * POST /api/ad/verify
 * 请求广告奖励令牌（观看广告前调用）
 * Body: { adUnitId }
 */
router.post('/verify', async (ctx) => {
  const { userId } = ctx.state.user;
  const { adUnitId } = ctx.request.body;

  if (!adUnitId) {
    ctx.status = 400;
    ctx.body = { code: 400, msg: '缺少 adUnitId 参数' };
    return;
  }

  const token = crypto.randomBytes(32).toString('hex');
  const tokenKey = `adtoken:${token}`;
  await set(tokenKey, {
    userId,
    adUnitId,
    rewarded: false,
    createdAt: Date.now()
  }, TOKEN_TTL_SECONDS);

  ctx.body = { code: 0, msg: 'ok', data: { token } };
});

/**
 * POST /api/ad/reward
 * 校验令牌并发放奖励（观看广告完成后调用）
 * Body: { token }
 */
router.post('/reward', async (ctx) => {
  const { userId } = ctx.state.user;
  const { token } = ctx.request.body;

  if (!token) {
    ctx.status = 400;
    ctx.body = { code: 400, msg: '缺少 token 参数' };
    return;
  }

  const tokenKey = `adtoken:${token}`;
  const record = await get(tokenKey);

  if (!record) {
    ctx.status = 400;
    ctx.body = { code: 400, msg: '无效或已过期的令牌' };
    return;
  }

  if (record.userId !== userId) {
    ctx.status = 403;
    ctx.body = { code: 403, msg: '令牌不属于当前用户' };
    return;
  }

  if (record.rewarded) {
    ctx.status = 400;
    ctx.body = { code: 400, msg: '奖励已发放，请勿重复领取' };
    return;
  }

  // 标记已发放（保留 60 秒防重复）
  record.rewarded = true;
  await set(tokenKey, record, 60);

  ctx.body = {
    code: 0,
    msg: '奖励发放成功',
    data: { reward: { hints: 3 } }
  };
});

module.exports = router;
