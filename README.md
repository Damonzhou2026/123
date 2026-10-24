# 掉了么

拍张照，AI 帮你把丢的东西找回来。微信原生小程序 + 微信云开发。

## 第一版已经有的

- 首页：“我丢了东西”（橙色）和“我捡到东西”（蓝色）两个入口，以及附近 3 公里内刚捡到的物品列表
- 发布页：上传照片、名称、类别、位置；失主可以自愿设置感谢金（证件类不设）；拾得者必须设置一个核验问题，防止冒领
- 匹配页：AI 看图比对照片，再结合类别、距离（5 公里内）、时间（14 天内）打分，列出最可能的物品
- 认领核验：失主在匹配页回答拾得者的核验问题，拾得者对比两张照片和答案后确认或拒绝；确认后两条发布配对成功，其他人的认领自动拒绝

- 私信：配对成功后双方在应用里聊天，约交接时间和地点，不暴露手机号；聊天页每 3 秒拉一次新消息
- 我的发布：首页右上角进入，查看自己发过的失物和拾物，已配对的直接进聊天
- 确认取回与评星：失主在聊天页点“我已拿回物品”，双方再互相打 1～5 星、选标签；评分累计到对方的档案上，聊天页会显示对方的平均分
- 感谢金托管：认领确认后，失主在聊天页付款，钱由微信支付冻结（分账订单）；失主确认拿回后，扣除平台服务费，其余分到拾得者的微信零钱

还没做：感谢金退款（比如拾得者一直不归还），需要先定好规则和客服流程。

## 跑起来

1. 安装[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)，用“导入项目”打开这个文件夹。
2. 在[微信公众平台](https://mp.weixin.qq.com/)注册小程序，把 AppID 填进 `project.config.json` 的 `appid`。
3. 在开发者工具里点“云开发”，创建一个环境，把环境 ID 填进 `miniprogram/app.js` 的 `CLOUD_ENV`。
4. 在云开发控制台的数据库里新建集合 `posts`、`claims`、`messages`、`ratings`、`users` 和 `payments`，并给 `posts` 的 `location` 字段加一个**地理位置索引**（附近查询要用到）。这几个集合的权限都设成“所有用户不可读写”，只让云函数访问。
   云存储保持默认的“仅创建者可读写”就行：别人的照片由云函数换成临时链接再返回（免费套餐也改不了存储权限）。
5. 在 `cloudfunctions` 下面的每个文件夹上分别右键，选“上传并部署：云端安装依赖”。
6. 点“编译”，就能在模拟器或手机上预览。

## 感谢金（微信支付分账）

> 目前托管是关着的（`miniprogram/utils/constants.js` 里 `ESCROW_ENABLED = false`）。普通商户的分账比例上限是 30%，不够把 90% 分给拾得者，所以第一版感谢金由失主线下直接给。接好持牌分账服务商后再打开。

代码在 `cloudfunctions/reward`。商户号要先开通“分账”，并且绑定这个小程序的 AppID。

在云开发控制台给 `reward` 云函数配置这些**环境变量**（不要写进代码）：

| 变量 | 内容 |
| --- | --- |
| `WXPAY_MCHID` | 商户号 |
| `WXPAY_APPID` | 小程序 AppID |
| `WXPAY_SERIAL_NO` | 商户 API 证书序列号 |
| `WXPAY_PRIVATE_KEY` | 商户 API 证书私钥 `apiclient_key.pem` 的全文，换行写成 `\n` |
| `WXPAY_NOTIFY_URL` | 支付结果通知地址（必须是 https）。现在的代码靠主动查询订单，不依赖这个通知 |
| `REWARD_FEE_RATE` | 平台服务费比例，默认 `0.1`（10%） |

`reward` 和 `confirmReturn` 的超时时间已经在各自的 `config.json` 里设成 20 秒，上传时选“上传并部署：云端安装依赖”就会生效。

需要注意：

- 分账比例有上限。微信支付默认最多分出订单金额的 30%，我们要分给拾得者 90%，需要在商户平台申请提高比例，否则分账会失败。
- 现在没有校验微信支付返回的应答签名。正式上线前应该下载平台证书，加上应答验签。

## AI 图片匹配（阿里云百炼 · 通义多模态向量）

发布时，`createPost` 把每张照片发给阿里云百炼的图片向量模型（`tongyi-embedding-vision-plus-2026-03-06`，512 维），拿回特征向量存进 `posts` 的 `embeddings` 字段。`findMatches` 把两边的照片两两比较，取最像的一对，再和类别、距离、时间一起打分（照片占 60%）。

费用：每张照片约 0.0002 元（0.0005 元 / 千 Token，一张图默认约 400 Token）。1 万张照片大约 2 元。

开通步骤：

1. 用支付宝或手机号登录[阿里云](https://www.aliyun.com/)，完成实名认证（个人或企业都行）。
2. 打开[百炼控制台](https://bailian.console.aliyun.com/)，按提示开通“阿里云百炼”服务（开通免费，按用量付费），地域选“华北 2（北京）”。
3. 在控制台左下角或右上角找到“API-KEY”，点“创建 API-KEY”，复制那串 `sk-` 开头的字符。这个 Key 等于付款密码，不要发给别人，也不要写进代码。
4. 在阿里云“费用与成本”里充值几块钱，并建议设一个“余额预警”。
5. 打开微信开发者工具，点上方“云开发”进入云开发控制台 →“云函数”→ 点 `createPost` →“配置”（或“版本与配置”）→ 找到“环境变量”，新增一项：名称 `DASHSCOPE_API_KEY`，值填第 3 步的 Key，保存。
6. 回到开发者工具，在 `cloudfunctions/createPost` 和 `cloudfunctions/findMatches` 文件夹上分别右键，“上传并部署：云端安装依赖”。（`createPost` 的超时已在 `config.json` 里设为 20 秒。）
7. 发一条新的失物和一条新的拾物试试。匹配卡片上写“看图匹配 xx%”就说明用上了；写“匹配度 xx%”说明没比对照片（没配好 Key，或者是配置之前发的旧帖子）。

可选环境变量：`EMBEDDING_MODEL`（换模型，比如更便宜的 `tongyi-embedding-vision-flash-2026-03-06`）、`EMBEDDING_DIMENSION`（向量维度，默认 512）。换模型后旧帖子的向量就不能和新帖子比了，最好别中途换。

接口出错时（Key 填错、余额不足）不影响发布，只是这条不比照片，错误会记在 `createPost` 的云函数日志里。

打分逻辑在 `cloudfunctions/findMatches/scoring.js`。测试：

```
node cloudfunctions/findMatches/scoring.test.js
node cloudfunctions/createPost/embedding.test.js
node cloudfunctions/rateUser/validate.test.js
node cloudfunctions/reward/reward.test.js
```

## 上线前必须做

- 用户上传的图片和文字要过微信内容安全接口（`security.imgSecCheck` / `msgSecCheck`）
- 隐私政策和用户协议（涉及位置、照片）
- 感谢金必须用微信支付“分账”，钱不能进平台自己的账户；拾得者不能定价，只有失主能自愿设置
