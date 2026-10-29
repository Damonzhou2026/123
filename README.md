# 掉了么

拍张照，AI 帮你把丢的东西找回来。微信原生小程序 + 微信云开发。

## 第一版已经有的

- 首页：“我丢了东西”（橙色）和“我捡到东西”（蓝色）两个入口，以及附近 3 公里内“刚捡到的”和“有人在找”两个列表，点开进物品详情
- 物品详情（`pages/item`，云函数 `getPost`）：谁都能看，也是转发卡片打开的页面。别人捡到的：失主直接回答核验问题认领，还没登记失物的先去登记（类别和地点自动带上），登记完回到这里接着认领。别人丢的：点“我捡到了”去发布，发布后直接提醒这位失主（不看 AI 分数），这条拾物在失主的匹配页排第一（`forLostPostId`）
- 转发到微信群：物品详情和自己的匹配页都能转发，卡片标题像“有人在图书馆捡到了一串钥匙，是你的吗？”
- 发布页：拾得者可以选东西在哪：在我这里 / 交到服务台 / 宿管 / 保安室 / 其他（其他要填地点，前三个可以补充一句）。交到别处的，具体地点只在认领通过后显示在聊天页，失主自己去取（`posts.handover`）
- 发布页：上传 1～3 张照片（提示多拍几个角度，AI 认得更准）、名称、类别、位置；失主可以自愿设置感谢金（证件类不设）；拾得者必须设置一个核验问题，防止冒领
- 匹配页：AI 看图比对照片，再结合类别、距离（5 公里内）、时间（14 天内）打分，列出最可能的物品
- 认领核验：失主在匹配页回答拾得者的核验问题，拾得者对比两张照片和答案后确认或拒绝；确认后两条发布配对成功，其他人的认领自动拒绝

- 私信：配对成功后双方在应用里聊天，约交接时间和地点，不暴露手机号；聊天页每 3 秒拉一次新消息
- 新消息提醒：对方不在聊天页时，用微信订阅消息提醒他（见下面“新消息提醒”）
- 我的发布：首页右上角进入，查看自己发过的失物和拾物，已配对的直接进聊天；每条可以点“管理”撤回（东西找到了 / 不需要了）或彻底删除，页面底部可以注销账号（`managePost`）
- 举报：匹配页的每件物品、拾得者看到的每个认领人、聊天页的对方都可以举报，记在 `reports` 集合；同一条发布被 3 个不同的人举报会自动下架（`report`）
- 首页“附近刚捡到的”里，证件、钱包、手机类不显示照片，只显示类别（照片可能拍到证件号、卡号）
- 取消配对：配对后任一方可以在聊天页“取消配对”（认错人、对方失联、没来交接），两条发布回到匹配中，之前被自动拒绝的人可以重新认领（`reviewClaim` 的 `action: 'cancel'`）
- 我已交还：拾得者在聊天页点“我已交还”，提醒失主确认；失主 3 天没确认，定时任务自动算作已归还（`action: 'handedOver'`）
- 防冒领：同一件东西被拾得者拒绝 2 次就不能再答；每人每天最多认领 5 次、发布 10 条
- 确认取回与评星：失主在聊天页点“我已拿回物品”，双方再互相打 1～5 星、选标签；评分累计到对方的档案上，聊天页会显示对方的平均分
- 感谢金托管：认领确认后，失主在聊天页付款，钱由微信支付冻结（分账订单）；失主确认拿回后，扣除平台服务费，其余分到拾得者的微信零钱

还没做：感谢金退款（比如拾得者一直不归还），需要先定好规则和客服流程。

## 跑起来

1. 安装[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)，用“导入项目”打开这个文件夹。
2. 在[微信公众平台](https://mp.weixin.qq.com/)注册小程序，把 AppID 填进 `project.config.json` 的 `appid`。
3. 在开发者工具里点“云开发”，创建一个环境，把环境 ID 填进 `miniprogram/app.js` 的 `CLOUD_ENV`。
4. 在云开发控制台的数据库里新建集合 `posts`、`claims`、`messages`、`ratings`、`users`、`payments`、`reports` 和 `calibration`，并给 `posts` 的 `location` 字段加一个**地理位置索引**（附近查询要用到）。这几个集合的权限都设成“所有用户不可读写”，只让云函数访问。
   云存储保持默认的“仅创建者可读写”就行：别人的照片由云函数换成临时链接再返回（免费套餐也改不了存储权限）。
   再按下面“数据库索引”加几个普通索引。
5. 在 `cloudfunctions` 下面的每个文件夹上分别右键，选“上传并部署：云端安装依赖”。
6. 点“编译”，就能在模拟器或手机上预览。

## 每天的定时任务（`dailyJobs`）

每天上午 10 点自动跑（定时触发器写在 `cloudfunctions/dailyJobs/config.json`）：

- 配对 3 天还没点“我已拿回物品”：提醒失主一次
- 拾得者点了“我已交还”，失主 3 天没确认：自动算作已归还（`claims.autoConfirmed`）
- 发布 30 天还在匹配中：提醒发布者“还在找吗”，点开匹配页可以续期（`managePost` 的 `renew`）
- 提醒后 7 天没续期：自动下架（`status: 'expired'`），之后在匹配页还能“重新上架”

部署：在 `cloudfunctions/dailyJobs` 上右键“上传并部署：云端安装依赖”，再右键“上传触发器”。想马上跑一次看看，在云开发控制台 →“云函数”→ `dailyJobs` →“云端测试”，直接点运行，返回每项处理了几条。只有定时触发器和控制台能运行它，小程序里调用会被拒绝。

## 校准匹配分数（`calibrate`）

`findMatches/scoring.js` 里的 `COS_RANGE` 决定“两张照片多像算像”，现在的数是估的。用真实照片校准一次：

1. 准备 8～10 样常见的东西（钥匙、耳机、水杯、钱包、雨伞……），最好有两三样同类不同款（比如两个不同的黑色钱包）。
2. 微信号 A 给每样东西发一条失物，名称写“校准1 黑钥匙”“校准2 白耳机”……照片用一个角度拍。
3. 微信号 B 给同样的东西发拾物，名称用同一个编号（“校准1 钥匙”），换个角度、换个背景拍。每人每天最多发 10 条，一天发不完第二天接着发。
4. 云开发控制台 →“云函数”→ `calibrate` →“云端测试”，点运行。结果也存在数据库 `calibration` 集合的 `latest` 里。
5. 把结果里的 `same`、`differentSameCategory` 和 `suggested` 发给 Claude，据此调 `COS_RANGE`。测完在“我的发布”里把这些校准发布删掉。

## 数据库索引

数据少的时候没有索引也能跑，到一所学校每周几十上百条时，没有索引的查询会变慢、读库次数也更多。在云开发控制台 →“数据库”→ 点集合 →“索引管理”→“添加索引”，每行加一个（“唯一”都不勾）：

| 集合 | 索引字段 | 用在哪 |
| --- | --- | --- |
| `posts` | `location`（地理位置） | 附近查询、匹配（第一次部署时已加） |
| `posts` | `_openid` 升序、`createdAt` 降序 | 我的发布 |
| `posts` | `mediaCheck.traceIds` 升序 | 照片检测结果回来时找到对应发布 |
| `posts` | `forLostPostId` 升序 | 失主匹配页找“我捡到了”指过来的拾物 |
| `claims` | `foundPostId` 升序、`status` 升序 | 拾得者看认领、自动拒绝其他认领 |
| `claims` | `lostPostId` 升序 | 失主看自己的认领 |
| `claims` | `claimantOpenid` 升序 | 注销 |
| `claims` | `finderOpenid` 升序 | 注销 |
| `messages` | `claimId` 升序、`createdAt` 降序 | 聊天页拉消息 |
| `messages` | `senderOpenid` 升序 | 注销 |
| `ratings` | `raterOpenid` 升序 | 注销 |
| `ratings` | `rateeOpenid` 升序 | 注销 |
| `reports` | `targetId` 升序 | 统计举报人数 |
| `claims` | `status` 升序、`reviewedAt` 升序 | 定时任务：提醒确认拿回 |
| `claims` | `status` 升序、`handedOverAt` 升序 | 定时任务：自动确认 |
| `claims` | `claimantOpenid` 升序、`createdAt` 降序 | 每人每天认领次数 |
| `posts` | `status` 升序、`createdAt` 升序 | 定时任务：30 天提醒续期 |
| `posts` | `status` 升序、`expireAskedAt` 升序 | 定时任务：过期下架 |
| `reports` | `reporterOpenid` 升序、`createdAt` 降序 | 每人每天举报次数 |

## 举报处理

举报记在 `reports` 集合：`targetType` 是 `post`（某条发布）或 `claim`（某次认领，即聊天里的对方），`reason` 是原因，`detail` 是补充说明，`reportedOpenid` 是被举报的人。处理完把 `status` 改成 `done`。

同一条发布被 3 个人举报会自动下架（`posts` 的 `status` 变成 `blocked`，`blockReason` 是 `reports`）。核实是误报的，把 `status` 改回 `open`、删掉 `blockReason` 就恢复了。

## 新消息提醒（微信订阅消息）

会推送这几种提醒：
- 有人认领时，提醒拾得者去核对答案（`submitClaim`）
- 拾得者确认或拒绝后，提醒失主结果（`reviewClaim`）
- 拾得者发布后，在附近 5 公里、14 天内的失物里自动匹配，照片比对成功且分数 80% 以上的提醒失主“有人捡到了可能是你的〇〇”，点开进匹配页（`createPost`）。同一个失主每次只提醒一条，每次最多提醒 5 位失主。结果记在拾物的 `matchPushes` 上
- 聊天里对方发来新消息（`sendMessage`）

小程序不能随便给用户发微信通知，得用户自己点“允许”，**每点一次只能发一条**。所以会在这几个时候弹授权框：发布时（失物和捡到都弹）、失主提交认领时、拾得者确认“是失主”时、在聊天页点“发送”且剩余次数不到 2 次时，以及聊天页上的“开启提醒”。授权框里勾上“总是保持以上选择”后，以后就不再弹框，自动记次数。

新消息的推送规则：对方正开着聊天页就不推（离开聊天页后马上算离线；没正常离开的，1 分钟没刷新也算离线）；推过一次之后，对方回来看过聊天页才会推下一条，避免一连串消息把次数用光。

### 申请模板（只做一次）

1. 登录[微信公众平台](https://mp.weixin.qq.com/)，左侧菜单点“功能”→“订阅消息”（第一次要点“开通”）。
2. 点“公共模板库”，类型选“一次性订阅”，搜索“新消息提醒”。搜不到就换“留言提醒”“私信通知”“回复通知”试试。
3. 挑一个，点“选用”，勾选关键词：选“发送人”“消息内容”“发送时间”这类（有“物品名称”“备注”也可以勾）。场景说明写：“失主和拾得者在小程序里私信约交接，对方发来新消息时提醒”。提交。
4. 回到“我的模板”，复制这个模板的“模板 ID”（一长串字母数字），填进 `miniprogram/utils/constants.js` 的 `MESSAGE_TEMPLATE_ID`。

三种提醒共用这一个模板，字段由云函数自动读取模板内容来填，不用改代码。推送代码在 `push.js`，`sendMessage`、`submitClaim`、`reviewClaim`、`createPost`、`dailyJobs` 里各有一份（连同 `template.js`），改的时候五份一起改。`createPost` 里还有一份 `findMatches/scoring.js` 的副本，打分规则改了也要同步。每次推送的结果记在 `claims` 的 `lastPush` 上。

### 部署

在 `cloudfunctions/sendMessage`、`listMessages`、`subscribe`、`submitClaim`、`reviewClaim` 上分别右键，“上传并部署：云端安装依赖”。需要推送的云函数在各自的 `config.json` 里已经声明了订阅消息接口的权限。

推送打开的是用户授权时用的那个版本（开发版、体验版或正式版）。用开发版测试时，提醒点开进的是开发版，过一段时间开发版失效后可能打不开，属正常。

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

## AI 图片匹配

发布时，`createPost` 让 AI 看照片，把结果变成特征向量存进 `posts` 的 `embeddings` 字段（来源记在 `embeddingSource`）。`findMatches` 拿两边的向量比较，取最像的一对，再和类别、距离、时间一起打分（照片占 60%）。支持两家，在 `createPost` 云函数的环境变量里配一个 Key 就行：

| | 智谱（`ZHIPU_API_KEY`） | 阿里云百炼（`DASHSCOPE_API_KEY`） |
| --- | --- | --- |
| 做法 | 免费的 GLM-4.6V-Flash 看图写一段物品描述（种类、颜色、牌子、特征），再用 embedding-3 变成向量 | 通义多模态向量直接把每张照片变成向量 |
| 费用 | 看图免费，向量 0.5 元 / 百万 Token，基本为零 | 每张照片约 0.0002 元，1 万张约 2 元 |
| 擅长 | 认得出“是什么、什么颜色、什么牌子、有什么字” | 外观细节（花纹、形状、挂件）更敏感 |
| 速度 | 发布时多等 2～5 秒 | 发布时多等 1～2 秒 |

两个都配时用百炼。两家的向量不能互相比，所以中途换了以后，旧帖子只能和旧帖子比照片。

### 用智谱（已有 Key 就用这个）

1. 登录[智谱开放平台](https://bigmodel.cn/)，右上角头像 →“API Key”，复制一个已有的 Key（或新建一个）。这个 Key 不要发给别人，也不要写进代码。
2. 账户里留一点余额（几块钱足够很久），embedding-3 要扣费；看图用的 GLM-4.6V-Flash 免费。
3. 打开微信开发者工具，点上方“云开发”进入云开发控制台 →“云函数”→ 点 `createPost` →“配置”（或“版本与配置”）→ 找到“环境变量”，新增一项：名称 `ZHIPU_API_KEY`，值填第 1 步的 Key，保存。
4. 回到开发者工具，在 `cloudfunctions/createPost` 和 `cloudfunctions/findMatches` 文件夹上分别右键，“上传并部署：云端安装依赖”。（`createPost` 的超时已在 `config.json` 里设为 60 秒。）
5. 发一条新的失物和一条新的拾物试试。如果看图失败，数据库里那条记录的 `embeddingError` 会写出原因（免费套餐看不到云函数日志）。匹配卡片上写“看图匹配 xx%”就说明用上了；写“匹配度 xx%”说明没比对照片（没配好 Key，或者是配置之前发的旧帖子）。想看 AI 把照片看成了什么，可以在云开发控制台的数据库里打开 `posts`，看那条记录的 `photoDescription`。

### 用阿里云百炼

1. 登录[阿里云](https://www.aliyun.com/)，完成实名认证。
2. 打开[百炼控制台](https://bailian.console.aliyun.com/)，开通服务，地域选“华北 2（北京）”。
3. 创建 API-KEY，复制 `sk-` 开头的那串字符；在阿里云账户里充几块钱。
4. 按上面第 3～5 步操作，环境变量名称换成 `DASHSCOPE_API_KEY`。

接口出错时（Key 填错、余额不足）不影响发布，只是这条不比照片，错误会记在 `createPost` 的云函数日志里。

打分逻辑在 `cloudfunctions/findMatches/scoring.js`。测试：

```
node cloudfunctions/findMatches/scoring.test.js
node cloudfunctions/createPost/embedding.test.js
node cloudfunctions/createPost/notifyMatches.test.js
node cloudfunctions/rateUser/validate.test.js
node cloudfunctions/reward/reward.test.js
node cloudfunctions/sendMessage/template.test.js
node cloudfunctions/createPost/secCheck.test.js
```

## 内容安全检测

用户填的文字和上传的照片都要过微信的内容安全接口（微信审核要求）：

| 内容 | 在哪检测 | 违规时 |
| --- | --- | --- |
| 发布的物品名称、自填类别、地点、核验问题 | `createPost`，`security.msgSecCheck` | 不让发布，提示修改 |
| 认领时回答的核验问题 | `submitClaim`，`msgSecCheck` | 不让提交 |
| 私信 | `sendMessage`，`msgSecCheck` | 消息不发出 |
| 发布的照片 | `createPost` 提交 `security.mediaCheckAsync`，结果推给 `mediaCheckCallback` | 已发布的这条下架（`status` 改成 `blocked`），“我的发布”里显示“照片未通过审核” |

评价只有星级和固定标签，没有自由文字，不用检测。

照片是异步检测的：先发布，几秒到几分钟后微信把结果推回来，违规的再下架。每条发布的检测情况记在 `posts` 的 `mediaCheck` 字段上（`result` 为 `pending` / `pass` / `risky`；`error` 不为空说明没提交成功，比如接口权限没生效）。检测接口本身出错时文字直接放行，不会让用户卡住。

检测代码在 `secCheck.js`，`createPost`、`submitClaim`、`sendMessage` 各有一份，改的时候三份一起改。接口权限已经写在这三个云函数的 `config.json` 里。

### 配置照片检测结果推送（只做一次）

1. 在 `cloudfunctions/mediaCheckCallback` 上右键，“上传并部署：云端安装依赖”。
2. 打开云开发控制台，进“设置”→“全局设置”→“消息推送”，点“添加消息推送”。
3. 消息类型选 `event`，事件类型填 `wxa_media_check`，云函数选 `mediaCheckCallback`，保存。

没配这一步的话，照片照样会提交检测，只是收不到结果，违规照片不会被自动下架。

## 上线前必须做

- 感谢金必须用微信支付“分账”，钱不能进平台自己的账户；拾得者不能定价，只有失主能自愿设置

## 隐私政策和用户协议

- 内容在 `miniprogram/utils/legal.js`：运营主体名称、地址、联系邮箱写在最上面的 `OPERATOR` 里，照营业执照填。
- `pages/legal/legal` 显示政策全文，首页和“我的发布”底部有入口。
- 首次打开时，`components/privacy-popup` 弹框请用户同意《用户协议》和《隐私政策》。它同时接管微信的隐私授权（`wx.onNeedPrivacyAuthorization`）：用户同意前，定位、选照片等接口会挂起，同意后才继续。首页和发布页各放了一个，以后别的页面要调用定位、相机、相册时也要放一个。
- 改了政策内容，把 `LEGAL_VERSION` 和 `EFFECTIVE_DATE` 改成新日期，用户下次打开会重新弹框；公众平台的“用户隐私保护指引”也要同步改。
- 如果换了看图服务（比如改用阿里云百炼），政策第三条里的智谱要改成对应的公司。
