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

在 Muster 中打开「扩展中心」即可浏览与安装。索引和安装包均可匿名读取。

## 发布版本

1. 在扩展仓更新清单版本，运行该仓的构建和测试。
2. 使用 Muster 主仓的 `node scripts/pack-extension-release.mjs <扩展目录> <扩展仓>/releases/<版本>.json [前版目录 ...]` 生成安装包与校验字段。保留已知的官方安装包指纹用于更新。
3. 提交扩展仓并推送版本标签。在 `catalog.json` 中更新元数据，`packageUrl` 使用 Contents API 并用 `ref` 指向已推送的提交 SHA。索引中的 `sha256` 校验下载字节，`fingerprint` 校验安装内容。

## Pages 分发

[Pages 镜像](https://muster-extension-center.pages.dev/catalog.json) 使用与 GitHub 目录相同的版本、校验字段和包字节。合并已批准的目录变更后，Publish the extension mirror 工作流生成同源文件，部署并核验生产目录及每个包的 SHA-256。

Discover extension versions 定期发现已登记来源的新标签。标签对应提交需包含 `releases/X.Y.Z.json`。发现新版本后，工作流生成审查分支，报告固定提交、文件摘要、权限和入口差异。合并后的目录变更触发发布。

## 社区投稿

[提交社区扩展](https://github.com/zhanghexie/muster-extension-index/issues/new?template=extension-submission.yml) 只需填写一个公开的 GitHub 仓库地址。维护者核对投稿后，在 Discover extension versions 的手动运行中填入该地址，确认生成的候选版本，再合并目录变更。社区包发布到 Pages，发布身份使用 GitHub 仓库所有者和扩展 ID。扩展 ID 需在目录中全局唯一。
