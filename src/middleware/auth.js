'use strict';
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'sudoku_challenge_secret_change_in_prod';
const JWT_EXPIRES = '30d';

/**
 * 生成 JWT Token
 */
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

/**
 * 验证 JWT Token
 */
function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/**
 * Koa 认证中间件 — 验证请求头中的 Authorization: Bearer <token>
 */
async function authMiddleware(ctx, next) {
  const authHeader = ctx.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    ctx.status = 401;
    ctx.body = { code: 401, msg: '未登录，请先授权' };
    return;
  }

  try {
    const decoded = verifyToken(token);
    ctx.state.user = decoded; // { userId, openId }
    await next();
  } catch (e) {
    ctx.status = 401;
    ctx.body = { code: 401, msg: 'Token 已过期，请重新登录' };
  }
}

module.exports = { signToken, verifyToken, authMiddleware };
