'use strict';
require('dotenv').config();

const Koa = require('koa');
const Router = require('koa-router');
const bodyParser = require('koa-bodyparser');
const cors = require('@koa/cors');

const authRouter = require('./routes/auth');
const syncRouter = require('./routes/sync');
const leaderboardRouter = require('./routes/leaderboard');
const adRouter = require('./routes/ad');

const app = new Koa();
const PORT = process.env.PORT || 8080;

// ── 全局错误处理 ──────────────────────────────────────────────
app.on('error', (err, ctx) => {
  console.error('[app error]', err.message, ctx?.url);
});

app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    console.error('[unhandled error]', err);
    ctx.status = err.status || 500;
    ctx.body = {
      code: ctx.status,
      msg: err.message || '服务器内部错误'
    };
  }
});

// ── 中间件 ────────────────────────────────────────────────────
app.use(cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization']
}));

app.use(bodyParser({
  jsonLimit: '1mb',
  formLimit: '1mb'
}));

// ── 健康检查 ──────────────────────────────────────────────────
const rootRouter = new Router();
rootRouter.get('/health', (ctx) => {
  ctx.body = { code: 0, msg: 'ok', timestamp: Date.now(), version: '2.0.0-kv' };
});
rootRouter.get('/', (ctx) => {
  ctx.body = { code: 0, msg: '数独挑战云托管服务 (KV版)', timestamp: Date.now() };
});

app.use(rootRouter.routes());

// ── 业务路由 ──────────────────────────────────────────────────
app.use(authRouter.routes()).use(authRouter.allowedMethods());
app.use(syncRouter.routes()).use(syncRouter.allowedMethods());
app.use(leaderboardRouter.routes()).use(leaderboardRouter.allowedMethods());
app.use(adRouter.routes()).use(adRouter.allowedMethods());

// ── 404 处理 ──────────────────────────────────────────────────
app.use((ctx) => {
  ctx.status = 404;
  ctx.body = { code: 404, msg: `路由不存在: ${ctx.method} ${ctx.url}` };
});

// ── 启动服务 ──────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[sudoku-server] 服务已启动，监听端口 ${PORT}`);
  console.log(`[sudoku-server] 环境: ${process.env.NODE_ENV || 'production'}`);
});

module.exports = app;
