# 服务端数据目录

开发模式默认在此目录生成 `records.json`，保存跨端排行榜和 OCR 日次数。

生产环境建议通过 `DATA_FILE` 指向持久化磁盘，或将 `readStore/writeStore` 替换为正式数据库。

