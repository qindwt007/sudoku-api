'use strict';
const Router = require('koa-router');
const axios = require('axios');
const crypto = require('crypto');
const { get, set } = require('../db/kv');
const { signToken, authMiddleware } = require('../middleware/auth');

const router = new Router({ prefix: '/api/auth' });
const APP_ID = process.env.APP_ID || 'ttffeb8956618f26a001';
const APP_SECRET = process.env.APP_SECRET || '';

/**
 * POST /api/auth/login
 * 抖音小程序登录：接收 code，换取 openId，返回 JWT token
 * Body: { code, nickname?, avatarUrl? }
 */
router.post('/login', async (ctx) => {
  const { code, nickname = '', avatarUrl = '' } = ctx.request.body;
  if (!code) {
    ctx.status = 400;
    ctx.body = { code: 400, msg: '缺少 code 参数' };
    return;
  }

  let openId;

  // 调用抖音 code2session 接口
  try {
    const res = await axios.get('https://developer.toutiao.com/api/apps/jscode2session', {
      params: { appid: APP_ID, secret: APP_SECRET, code },
      timeout: 8000
    });
    const data = res.data;
    if (data.error || !data.openid) {
      ctx.status = 400;
      ctx.body = { code: 400, msg: `抖音 code2session 失败: ${data.errmsg || JSON.stringify(data)}` };
      return;
    }
    openId = data.openid;
  } catch (e) {
    ctx.status = 500;
    ctx.body = { code: 500, msg: '调用抖音 API 失败，请稍后重试' };
    return;
  }

  // 从 KV 查询或创建用户
  const userKey = `user:${openId}`;
  let user = await get(userKey);

  if (!user) {
    const userId = crypto.randomBytes(8).toString('hex');
    user = {
      id: userId,
      openId,
      nickname: nickname || '数独玩家',
      avatarUrl: avatarUrl || '',
      createdAt: Date.now()
    };
    await set(userKey, user);
  } else {
    let updated = false;
    if (nickname && nickname !== user.nickname) { user.nickname = nickname; updated = true; }
    if (avatarUrl && avatarUrl !== user.avatarUrl) { user.avatarUrl = avatarUrl; updated = true; }
    if (updated) await set(userKey, user);
  }

  const token = signToken({ userId: user.id, openId: user.openId });

  ctx.body = {
    code: 0,
    msg: 'ok',
    data: {
      token,
      userInfo: { id: user.id, nickname: user.nickname, avatarUrl: user.avatarUrl }
    }
  };
});

/**
 * POST /api/auth/update-profile
 * 更新用户昵称和头像
 * Body: { nickname, avatarUrl }
 */
router.post('/update-profile', authMiddleware, async (ctx) => {
  const { openId } = ctx.state.user;
  const { nickname, avatarUrl } = ctx.request.body;

  const userKey = `user:${openId}`;
  let user = await get(userKey);
  if (!user) {
    ctx.status = 404;
    ctx.body = { code: 404, msg: '用户不存在' };
    return;
  }

  if (nickname) user.nickname = nickname;
  if (avatarUrl) user.avatarUrl = avatarUrl;
  user.updatedAt = Date.now();
  await set(userKey, user);

  ctx.body = {
    code: 0,
    msg: 'ok',
    data: { userInfo: { id: user.id, nickname: user.nickname, avatarUrl: user.avatarUrl } }
  };
});

module.exports = router;
