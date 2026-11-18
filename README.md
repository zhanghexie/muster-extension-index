# Muster 扩展中心索引

`catalog.json` 维护扩展身份、版本、源码入口、安装包和兼容性。工作日报由 Muster 随应用提供。

| 扩展 | 独立仓库 |
| --- | --- |
| 代码动画 | [muster-extension-code-animation](https://github.com/zhanghexie/muster-extension-code-animation) |
| 媒体创作台 | [muster-extension-dsh-media-desk](https://github.com/zhanghexie/muster-extension-dsh-media-desk) |
| 五子棋 | [muster-extension-gomoku](https://github.com/zhanghexie/muster-extension-gomoku) |
| 歸藏设计 | [muster-extension-guizang-design](https://github.com/zhanghexie/muster-extension-guizang-design) |
| 书房 | [muster-extension-library](https://github.com/zhanghexie/muster-extension-library) |
| 魔方 | [muster-extension-rubiks-cube](https://github.com/zhanghexie/muster-extension-rubiks-cube) |

## 客户端访问

为上述六个扩展仓库及本索引授予细粒度 GitHub token 的 Contents 只读权限。通过 Muster 的启动环境设置 `MUSTER_EXTENSION_CENTER_GITHUB_TOKEN`，重启应用后打开扩展中心。

## 发布版本

1. 在扩展仓更新清单版本，运行该仓的构建和测试。
2. 使用 Muster 主仓的 `node scripts/pack-extension-release.mjs <扩展目录> <扩展仓>/releases/<版本>.json [前版目录 ...]` 生成安装包与校验字段。保留已知的官方安装包指纹用于更新。
3. 提交扩展仓并推送版本标签。在 `catalog.json` 中更新元数据，`packageUrl` 使用 Contents API 并用 `ref` 指向已推送的提交 SHA。索引中的 `sha256` 校验下载字节，`fingerprint` 校验安装内容。
