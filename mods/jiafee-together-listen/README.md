# Jiafee 一起听 Folium 1.4.2

1.4.2 修复准备阶段的 `PLAYBACK_TRACK_NOT_READY`：官方 0.7.28 的 seek 会恢复播放并取消待完成的暂停，适配层改为先 seek 再 pause。等待至少 250ms，并观察公开暂停位置稳定 100ms 后才发送 READY。准备位置允许固定淡出造成的最多 0.5 秒偏移，GO 按权威时钟校正一次；普通 PLAY 不重新归零。这是暂停快照验证，不是底层媒体就绪保证。

1.4.1 修复普通恢复播放被旧暂停快照拉回零进度：忙碌期间保留播放意图，确认前不校正进度；只有双方都在播放且没有待确认操作才进行时钟校正。快速暂停或断开会取消未提交的恢复播放。

本版是重新移植后的联调版。最低要求稳定 Folium 1.7（清单 Folia >=0.7.22），以本地官方 0.7.28 源码检查。不要把自动化测试通过当作双端真实音源验收完成。

## 实现边界

- client.mjs 仅组装 UI、RPC、账号监听。原有分散的播放判定、计时窗口和旧轮询路径已移除。
- playbackSession.mjs 把 Folium 播放事件转换为原协议操作，管理双人会话与同步计时器。
- vendorPlaybackCore.mjs 从当前 Jiafee-FX-Patcher 的 playback-controller-core.js 移植，复用会话版本、操作去重、预测与 READY/GO；适配异步队列、待确认播放意图及 Folia 的 seek 自动恢复语义。
- foliumPlayerAdapter.mjs 只调用公开播放器和 Omni API。queue-sync.mjs 保留公开队列条件替换、解析与拒绝处理。
- lib/ 网络层重新取自当前 Mineradio payload/desktop/together-listen，保留原有协议、TCP/WebSocket、字节预算、入房确认、重连、授权与房间状态。配置读写改用 Folium storage；HTTPS 头像可通过 profile 同步。vendor/ws 随包提供 ws 8.21.3 及其许可证。
- styles.mjs 完整保留；面板结构保留，仅账号资料改成自动同步和只读。

## 账号同步

调用 folium.account.getState('netease'/'qq')，网易云优先，QQ 回退。监听 account.changed；连接前刷新昵称、头像，连接中通过原 PRESENCE 同步变化。两个来源都未登录时显示“未登录用户”。不读取 Cookie、Token 或本地登录文件，不二次登录。

官方 accountKey 仅保证本机安装内稳定，不能用于跨设备同账号判断。公开接口没有会员字段，因此本版不显示推测的 VIP、不宣称完成 Folium 端同账号校验。网络层保留 Mineradio 原有身份字段和校验实现，但 Folium 只能提供公开昵称和头像，跨端身份约束尚未完整适配。

## 播放与限制

单人房间不接管本体。双人会话先暂停归零、清空普通队列；用户点首曲才提交暂停快照和 NEXT。准备、开始和进度校正由一个控制器处理，页面卸载不影响会话计时器，模组卸载会关闭资源。

公开 API 无法完全复刻 Mineradio 的以下能力：

- 没有不自动播放的曲目预备与媒体就绪确认；seek(0) 会播放，pause 有约 200ms 淡出。当前先 seek 再 pause 并核对稳定快照，准备位置可能略大于零，GO 时仅校正一次；不能证明底层媒体已经 canplay，也不能保证加载过程绝无短暂出声。暂停拒绝、位置持续变化或超过 0.5 秒仍会停止准备，不假报 READY。
- 没有可靠自然结束事件；本版不通过时长猜测结束。宿主自动切歌仍可能被当作点歌，尚不能保证原协议“双方自然播完才切歌”。
- 没有清除当前曲目上下文、无播放副作用恢复当前曲目/索引的接口。普通队列清空不等于封面消失；退出恢复原曲目和进度尚未完整适配。
- 不访问 Folia 私有 Store、DOM 播放器或修改宿主来填补以上缺口。

## 安装与检查

安装 dist/jiafee-together-listen-1.4.2.zip，启用后在播放器控制面板打开“一起听”。支持 IP:端口、tcp://、ws://、wss://；公网填写服务器授权码。账号变化自动更新资料。

检查：

```powershell
node --test mods/jiafee-together-listen/test/*.test.*
# 在官方 0.7.28 源码目录执行，替换为本模组绝对路径
node dev/folium/check.mjs '<本模组绝对路径>'

运行本目录 build.ps1 生成安装 ZIP，验证记录见 TESTING.md。后续 Folium 能力需求直接在上游 Issue 中按实际测试证据说明，不再随源码维护独立草稿。源码沿用原补丁项目 GPL-3.0 许可证，见 LICENSE；随包 ws 的 MIT 许可证在 vendor/ws/LICENSE。
```
## 原一起听项目

https://github.com/JiafeeJF/Mineradio-Jiafee-Patche 现版本`v2.4.0`
