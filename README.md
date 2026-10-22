# 掉了么

拍张照，AI 帮你把丢的东西找回来。微信原生小程序 + 微信云开发。

## 第一版已经有的

- 首页：“我丢了东西”（橙色）和“我捡到东西”（蓝色）两个入口，以及附近 3 公里内刚捡到的物品列表
- 发布页：上传照片、名称、类别、位置；失主可以自愿设置感谢金（证件类不设）；拾得者必须设置一个核验问题，防止冒领
- 匹配页：按图片相似度、类别、距离（5 公里内）、时间（14 天内）打分，列出最可能的物品
- 认领核验：失主在匹配页回答拾得者的核验问题，拾得者对比两张照片和答案后确认或拒绝；确认后两条发布配对成功，其他人的认领自动拒绝

- 私信：配对成功后双方在应用里聊天，约交接时间和地点，不暴露手机号；聊天页每 3 秒拉一次新消息
- 我的发布：首页右上角进入，查看自己发过的失物和拾物，已配对的直接进聊天
- 确认取回与评星：失主在聊天页点“我已拿回物品”，双方再互相打 1～5 星、选标签；评分累计到对方的档案上，聊天页会显示对方的平均分

还没做：感谢金托管（需要微信支付商户号并开通分账）。

## 跑起来

1. 安装[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)，用“导入项目”打开这个文件夹。
2. 在[微信公众平台](https://mp.weixin.qq.com/)注册小程序，把 AppID 填进 `project.config.json` 的 `appid`。
3. 在开发者工具里点“云开发”，创建一个环境，把环境 ID 填进 `miniprogram/app.js` 的 `CLOUD_ENV`。
4. 在云开发控制台的数据库里新建集合 `posts`、`claims`、`messages`、`ratings` 和 `users`，并给 `posts` 的 `location` 字段加一个**地理位置索引**（附近查询要用到）。这几个集合的权限都设成“所有用户不可读写”，只让云函数访问。
5. 在 `cloudfunctions` 下面的每个文件夹上分别右键，选“上传并部署：云端安装依赖”。
6. 点“编译”，就能在模拟器或手机上预览。

## AI 图片匹配

`createPost` 云函数会把照片发给一个图像特征服务，拿回特征向量后存起来，`findMatches` 用余弦相似度比较两张图。

- 在 `createPost` 云函数的环境变量里配置 `EMBEDDING_API_URL`。服务约定是：`POST {"imageUrl": "..."}`，返回 `{"embedding": [...]}`。可以用 CLIP 一类的模型自己部署，也可以接云厂商的图像特征接口。
- 没配置的时候，匹配只按类别、距离和时间打分，结果里 `imageCompared` 为 `false`。

打分逻辑在 `cloudfunctions/findMatches/scoring.js`。测试：

```
node cloudfunctions/findMatches/scoring.test.js
node cloudfunctions/rateUser/validate.test.js
```

## 上线前必须做

- 用户上传的图片和文字要过微信内容安全接口（`security.imgSecCheck` / `msgSecCheck`）
- 隐私政策和用户协议（涉及位置、照片）
- 感谢金必须用微信支付“分账”，钱不能进平台自己的账户；拾得者不能定价，只有失主能自愿设置
