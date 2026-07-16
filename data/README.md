# 服务端数据目录

此目录保存随服务发布的高频题库与远程配置模板。

开发测试建议通过 `DATA_FILE=/tmp/magic-number-maze-records.json` 保存临时排行榜、匿名事件和 OCR 日次数，不要将运行时生成的 `records.json` 提交到 Git。

生产环境应将 `readStore/writeStore` 替换为正式数据库或持久化存储，避免实例重启后数据丢失。
