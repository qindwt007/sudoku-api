'use strict';
/**
 * 抖音云 KV 存储封装
 * 
 * 抖音云托管内置 KV 存储，通过 HTTP API 访问：
 * 内网地址: http://cloud-kv.bytedance.net
 * 
 * 数据结构设计：
 * - user:{openId}          → 用户信息 { id, openId, nickname, avatarUrl, createdAt }
 * - sync:{openId}          → 用户同步数据 { settings, saveData, stats }
 * - checkin:{openId}       → 签到记录 { lastDate, streak, total }
 * - rank:easy              → 简单难度排行榜 (sorted set via JSON array)
 * - rank:medium            → 中等难度排行榜
 * - rank:hard              → 困难难度排行榜
 * - adtoken:{token}        → 广告令牌 { userId, adUnitId, rewarded, expiresAt }
 */

const axios = require('axios');

// 抖音云 KV 内网地址（云托管内部可直接访问）
const KV_BASE = process.env.KV_BASE_URL || 'http://cloud-kv.bytedance.net';
const ENV_ID = process.env.ENV_ID || 'env-jyWSi1WbGv';

const kvClient = axios.create({
  baseURL: KV_BASE,
  timeout: 3000,
  headers: {
    'X-TT-ENV-ID': ENV_ID,
    'Content-Type': 'application/json'
  }
});

/**
 * 获取 KV 值
 */
async function kvGet(key) {
  try {
    const res = await kvClient.get('/kv/get', { params: { key } });
    if (res.data && res.data.data && res.data.data.value !== undefined) {
      const val = res.data.data.value;
      try {
        return JSON.parse(val);
      } catch {
        return val;
      }
    }
    return null;
  } catch (e) {
    // KV 不可用时返回 null，降级为内存存储
    return null;
  }
}

/**
 * 设置 KV 值
 */
async function kvSet(key, value, ttlSeconds = 0) {
  try {
    const body = {
      key,
      value: JSON.stringify(value)
    };
    if (ttlSeconds > 0) {
      body.ttl = ttlSeconds;
    }
    await kvClient.post('/kv/set', body);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 删除 KV 值
 */
async function kvDel(key) {
  try {
    await kvClient.post('/kv/del', { key });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 批量获取多个 key
 */
async function kvMGet(keys) {
  try {
    const res = await kvClient.post('/kv/mget', { keys });
    if (res.data && res.data.data) {
      const result = {};
      for (const [k, v] of Object.entries(res.data.data)) {
        try {
          result[k] = JSON.parse(v);
        } catch {
          result[k] = v;
        }
      }
      return result;
    }
    return {};
  } catch (e) {
    return {};
  }
}

// ============================================================
// 内存降级存储（当 KV 服务不可用时使用，重启后数据丢失）
// ============================================================
const memStore = new Map();

async function get(key) {
  const val = await kvGet(key);
  if (val !== null) return val;
  return memStore.get(key) || null;
}

async function set(key, value, ttlSeconds = 0) {
  const ok = await kvSet(key, value, ttlSeconds);
  if (!ok) {
    memStore.set(key, value);
    if (ttlSeconds > 0) {
      setTimeout(() => memStore.delete(key), ttlSeconds * 1000);
    }
  }
  return true;
}

async function del(key) {
  await kvDel(key);
  memStore.delete(key);
  return true;
}

module.exports = { get, set, del, kvMGet };
