-- 数独挑战抖音小程序 · 数据库初始化脚本
-- 在抖音云托管 MySQL 控制台中执行本文件

CREATE DATABASE IF NOT EXISTS sudoku_challenge DEFAULT CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE sudoku_challenge;

-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  open_id     VARCHAR(128) NOT NULL UNIQUE COMMENT '抖音 openId',
  nickname    VARCHAR(64)  DEFAULT '' COMMENT '昵称',
  avatar_url  VARCHAR(512) DEFAULT '' COMMENT '头像',
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_open_id (open_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 游戏历史记录表
CREATE TABLE IF NOT EXISTS game_records (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED NOT NULL,
  difficulty  TINYINT UNSIGNED NOT NULL COMMENT '难度: 1简单 2中等 3困难 4专家',
  time_used   INT UNSIGNED NOT NULL COMMENT '用时（秒）',
  score       INT UNSIGNED NOT NULL DEFAULT 0,
  hints_used  TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '使用提示次数',
  errors      TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '错误次数',
  completed   TINYINT(1) NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_id (user_id),
  INDEX idx_difficulty_score (difficulty, score DESC),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 用户设置与存档表（跨设备同步）
CREATE TABLE IF NOT EXISTS user_data (
  user_id       BIGINT UNSIGNED PRIMARY KEY,
  settings      JSON COMMENT '用户设置（音效、背景音乐、难度等）',
  current_game  JSON COMMENT '当前进行中的游戏存档',
  stats         JSON COMMENT '统计数据（总局数、总用时等）',
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 签到记录表
CREATE TABLE IF NOT EXISTS checkin_records (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED NOT NULL,
  checkin_date DATE NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_date (user_id, checkin_date),
  INDEX idx_user_id (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 广告奖励记录表（防作弊）
CREATE TABLE IF NOT EXISTS ad_rewards (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED NOT NULL,
  ad_unit_id  VARCHAR(128) NOT NULL,
  token       VARCHAR(256) NOT NULL UNIQUE COMMENT '一次性校验令牌',
  rewarded    TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否已发放奖励',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at  DATETIME NOT NULL COMMENT '令牌过期时间（5分钟）',
  INDEX idx_user_id (user_id),
  INDEX idx_token (token),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
