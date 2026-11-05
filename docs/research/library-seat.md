# 浙大图书馆座位预约系统 接口调研（2026-11-04）

调研方式：GitHub 开源实现 + 直接读取 `booking.lib.zju.edu.cn/h5/` 当前线上前端静态 JS（构建号 `1782805514175` ≈ 2026-06-30）。
只读，未登录，未调用任何预约 / 写接口。匿名调用过两个页面自身在未登录时也会调的公开只读接口：`/api/index/config`、`/api/index/booking_rules`。

标记说明：
- **[ZJU 线上前端]**：本次从 booking.lib.zju.edu.cn 当前线上 JS 读到（最可信）
- **[ZJU 开源]**：针对浙大本站、作者实际跑过的开源代码
- **[他校同系统]**：同一厂商系统在别校的实现（同济 space.tongji.edu.cn、华东师大 seat-lib.ecnu.edu.cn、曲阜师大 libyy.qfnu.edu.cn、西建大、浙中医大等）

---

## 0. 系统身份

- 主机：**`https://booking.lib.zju.edu.cn`**，H5 前端 `/h5/index.html`（Vue 3 + Vant/Element Plus，页面标题「图书馆空间预约系统」，配置里的名称是「浙江大学图书馆预约平台」）。校外能访问（Elychron 2026-10-01 实测，本次 curl 也返回 200）。
- 不是利昂（leosys `/rest/v2`）、图创、IC 空间（ic.lib）。它是一套商业「图书馆空间预约系统」，多所学校在用，标志是 `/api/Seat/tree|date|seat|confirm`、`/reserve/index/quickSelect`，AES IV 为 `ZZWBKJ_ZHIHUAWEI`（厂商名不详，只能从 IV 推测前缀 "ZZWBKJ"）。
- 另有 `api.lib.zju.edu.cn`（Aleph / 移动图书馆：借阅、续借）和 `m.lib.zju.edu.cn`，与座位无关，鉴权方式不同（login-ZJU 注释："api.lib.zju.edu.cn和booking.lib.zju.edu.cn的API鉴权方式是不一样的"）。

## 1. 主要来源（按可信度）

| 来源 | 内容 | 时间 |
|---|---|---|
| booking.lib.zju.edu.cn/h5/assets/index.1782805514175.js 及懒加载块 `seatSelectCom` `region-select` `QuickChoose` `seat-map` `AppointmentItem` `CAS` | 线上前端，axios 拦截器、加密、各页面调用参数 | 线上构建 ≈2026-06-30，读于 2026-11-04 |
| [5dbwat4/login-ZJU](https://github.com/5dbwat4/login-ZJU) `src/bookingLib.ts` | CAS → cas 码 → token，Authorization 头实验结论 | commit 69f5f5e / 5dff3a1，2026-04-14 |
| [Elyyyyyyyyxer/Elychron](https://github.com/Elyyyyyyyyxer/Elychron)（Celechron 分支）`docs/CAMPUS_SERVICES_PLAN.md` §4、`docs/LIBRARY_RESERVATIONS_SPEC.md`、`lib/mod/library_web_session.dart` | 真机抓到的 CAS 链、AES、config 解密、单设备登录、`/api/Member/*` 字段 | commit 9539e2b，2026-10-01 |
| [richardrren/zju_library_booking_tool](https://github.com/richardrren/zju_library_booking_tool) `main.py` | 完整的 浙大 CAS → quickSelect → Seat/date → Seat/seat → Seat/confirm（AES）流程 | 2024-01-05（较旧，但与线上前端一致） |
| [Lucent-Snow/zju-scholar](https://github.com/Lucent-Snow/zju-scholar) `scripts/zju_library.py` | CAS 登录 + `/api/cas/user` 换 JWT（座位余量部分用的 `/api/room/list`，与前端对不上，疑为臆测） | 2026-06-02 |
| [ChenyuHeee/Libot](https://github.com/ChenyuHeee/Libot) `src/libot/client.py` | 用浏览器 Cookie 调 `/api/Seat/tree`、`/api/Seat/seat`、`/api/seat/map`（浙大空位提醒） | 2026-01-08（已归档） |
| [Beetlesliu/ZJU-Life](https://github.com/Beetlesliu/ZJU-Life) `lib/services/library_service.dart`、`docs/booking_bundle.js`（2025-02 构建的前端整包） | `/reserve/index/list` 字段 | 2026-05-21 |
| [他校] [Mike-Zhuang/tongji-library-monitor](https://github.com/Mike-Zhuang/tongji-library-monitor) `src/provider.mjs` | 同济，同系统，完整只读 + confirm，限流判断 | 2026-11-03 |
| [他校] [yangzhang0215/XAUAT-autolib](https://github.com/yangzhang0215/XAUAT-autolib) `docs/reservation-encryption-and-flow.md` | 加密细节、请求头 | 2026-04-19 |
| [他校] [azazo1/ecnu-campus-plugins](https://github.com/azazo1/ecnu-campus-plugins) `assets/development-references/confirm_subscribe.js` | 华东师大前端加密名单 | 2025-01-07 |
| [他校] [xiaoshengyvlin/ZCMU-Auto-Tool](https://github.com/xiaoshengyvlin/ZCMU-Auto-Tool) `zcmu-auto-book.user.js` | 浙中医大油猴脚本 | 2026-07-16 |

---

## 2. 登录 / 会话

### 2.1 走浙大统一身份认证（CAS）—— [ZJU 线上前端 + ZJU 开源，多方一致]

- 解密后的 `/api/index/config` 写明 `config.cas_url = "https://booking.lib.zju.edu.cn/api/cas/cas"`，`config.login = "4"`（本次 2026-11-04 实测解密）。
- **CAS service = `https://booking.lib.zju.edu.cn/api/cas/cas`**
  （Elychron："GET https://booking.lib.zju.edu.cn/api/cas/cas → 302 http://zjuam.zju.edu.cn/cas/login?service=https%3A%2F%2Fbooking.lib.zju.edu.cn%2Fapi%2Fcas%2Fcas（同时下发 PHPSESSID）"）。注意它 302 到的是 **http://** zjuam，要升成 https（Elychron 真机发现 http 页提交后会被弹回）。
- 完整链路：
  1. `GET https://zjuam.zju.edu.cn/cas/login?service=https%3A%2F%2Fbooking.lib.zju.edu.cn%2Fapi%2Fcas%2Fcas`
     —— **带着现有的 `iPlanetDirectoryPro` cookie 直接 302 回 service 并附 `ticket=ST-…`，不用填表**（login-ZJU 的 `zjuam.loginSvc(service)` 就是这样做的；Elychron："CAS 里 SSO 还有效 → 直接跳回业务站并出 token（不用填表）"）。
  2. `GET /api/cas/cas?ticket=ST-…`（phpCAS 在服务端验票，假票据返回 `500 CAS Authentication failed!`）→ 302 → … → 最终落到
     **`https://booking.lib.zju.edu.cn/h5/index.html#/cas/?cas=<一次性码>`**（zju-scholar 跟了两跳 r2、r3 才拿到）。
  3. `POST /api/cas/user`，JSON `{"cas": "<一次性码>"}`（线上前端 `CasLogin` 还会带 `open_id`，localStorage 有时）→ `{code:1, member:{token, …}}`。
  4. 前端把 `member.token` 存进 `sessionStorage.token`，`member` 存进 `sessionStorage.UserInfo`。Elychron 记录的 token 长 735 字符；zju-scholar 称之为 JWT。

  login-ZJU（2026-04-14）原文：
  ```ts
  const service = "https://booking.lib.zju.edu.cn/api/cas/cas";
  const finalPattern =
    /https\:\/\/booking\.lib\.zju\.edu\.cn\/h5\/index\.html#\/cas\/\?cas=([^&]+)/;
  ...
  const token = await fetch("https://booking.lib.zju.edu.cn/api/cas/user",{
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cas: cas_n }),
    }).then(v=>v.json()).then(data=> data?.member?.token)
  ```
  线上前端 CAS 页（`CAS.1782805514175.js`）：读 `route.query.cas` → `CasLogin(cas)`；`CasLogin`：
  ```js
  let y=localStorage.getItem("openId")||"",k={cas:g};y&&(k.open_id=y);
  const j=await getCasLogin(k);            // POST /api/cas/user
  if(j.code!=1) ...
  sessionStorage.setItem("token",j.member.token),sessionStorage.setItem("UserInfo",JSON.stringify(j.member))
  ```
  > 注意：ZJU-Life 把 ST 票据本身当作 `cas` 发给 `/api/cas/user`，Elychron 文档也写 `{cas: ticket}`；但 login-ZJU、zju-scholar、richardrren 与线上前端都是用**最终 hash 里的 `cas=` 值**。以后者为准。

- 其他登录方式：`POST /api/login/login`（账号密码，body 加密，配 `/api/Captcha/verify`）、`/api/login/wxlogin`、`/api/login/dingtalksns`、`/api/login/wxwork`、`GET /api/jwt/login`（`jwtAppLogin`，疑为 App 内嵌）。浙大 config 里钉钉 / 微信参数为空，实际只用 CAS。

### 2.2 token 的使用方式 —— [ZJU 线上前端]

axios 实例默认头 `Content-Type: application/json`、`X-Requested-With: XMLHttpRequest`。请求拦截器（原文节选）：
```js
token=sessionStorage.getItem("token")||"",lang=localStorage.getItem("lang")||"zh";
if(token){ config.headers.authorization=`bearer${token}`, config.headers.lang=lang, ...
  if(encryptRequest.includes(config.url)){let g=encrypt("encrypt",config.data);config.data={aesjson:g}}
  config.data={...eval(config.data),authorization:config.headers.authorization}}
```
- 请求头 **`authorization: bearer<token>`（"bearer" 与 token 之间没有空格）**，另带 `lang: zh`。
- body 里同时再放一份 `authorization` 字段；login-ZJU 实测**删掉 body 里那份也行，删掉请求头那份就不行**，GET + query 参数也能用（`/api/Space/often?type=1`）。
- 未登录统一返回 `{code: 10001, msg: "您尚未登录"}`（前端遇到会清空存储跳 `/pageVerify`）。
- 绝大多数接口成功为 `code == 1`；**`/reserve/index/quickSelect`、`/reserve/index/detail`、`/reserve/seminar/signout` 成功是 `code == 0`**（线上前端判断如此）。

### 2.3 会话注意点

- **单设备登录** [ZJU 开源，Elychron 真机]：在浏览器 / 微信再登一次，旧端会被顶掉，服务端原话「请注意,您的账号在其他设备登录！」。也就是说我们取 token 会把用户手机上的登录挤掉，反之亦然。
- Elychron 另报告：从 WebView 里取出的 token 放到 Dart HttpClient 里用会被判 `10001`，只好全部在 WebView 内同源 fetch。这与 login-ZJU / zju-scholar / richardrren（直接用 token 发请求）矛盾。可能的解释：token 与发放它的那次 `/api/cas/user`（及 `/api/cas/cas` 下发的 `PHPSESSID`）绑定，换了 cookie 罐或被别处顶掉就失效。**建议：在同一 cookie 分区里走完 CAS 链（保留 PHPSESSID），自己调 `/api/cas/user` 拿 token，之后请求都带同一套 cookie 与 UA**。未登录实测验证。

---

## 3. 加密（`aesjson`）—— [ZJU 线上前端，已实测解密]

线上前端原文：
```js
function encrypt(g,y){var k=exchangeDateTime(new Date,41);k=`${k}${k.split("").reverse().join("")}`;
  var j=k,pe="ZZWBKJ_ZHIHUAWEI";
  if(g=="encrypt")return crypto.encrypt(JSON.stringify(y),j,pe); ...}
// crypto.encrypt: CryptoJS.AES.encrypt(g, Utf8(key), {iv: Utf8(iv), mode: CBC, padding: Pkcs7}).toString()
// exchangeDateTime(d, 41) => moment(d).format("YYYYMMDD")
```
- AES-128-CBC / PKCS7，输出 Base64。
- **key = 客户端本地日期 `YYYYMMDD` + 其倒序**（16 字节，如 2026-11-04 → `2026110440110202`）；**IV = `ZZWBKJ_ZHIHUAWEI`**。
- 本次用 key `2026110440110202` 成功解密了 `/api/index/config` 的返回（见 §8），证明今天仍有效。零点前后客户端与服务器日期不一致可能失败（推测）。
- 需要加密的接口（线上前端 `encryptRequest`，与华东师大前端完全相同）：
  `/api/login/resetpass` `/api/login/login` `/api/login/forget` **`/api/Seat/confirm`** `/api/Seminar/confirm` `/reserve/index/confirm` `/api/Enter/confirm` `/api/Seat/touch_qr_books` `/api/seat/qrcode` `/api/seat/qrcode_not_card` `/api/Study/StudyOrder` `/api/login/updateUserInfo` `/api/seat/xuzuoconfirm`
  这些接口的 body 变成 `{"aesjson": "<base64>", "authorization": "bearer<token>"}`。
- 解密的响应：只有 `/api/index/config` 的 `data` 是密文（拦截器 `y=["/api/index/config"]` 时 `JSON.parse(encrypt("decrypt", g.data.data))`）。
- `/api/index/time` 返回的时间做了混淆：前端 `new Date((k.data.time/29-509)*1e3)`，即**服务器 Unix 秒 = time / 29 − 509**（可用来校准抢座时钟）。
- 没发现 sign 头、时间戳签名或请求级验证码；`/api/Seat/confirm` 不经验证码（`/api/Captcha/verify` 只在账号密码登录里）。index.html 里有一段被注释掉的反调试 `debugger` 循环。

richardrren（浙大，2024）confirm 构造：
```python
date=datetime.now().strftime("%Y%m%d")
key = str(date+date[::-1]).encode('utf-8')
iv = 'ZZWBKJ_ZHIHUAWEI'.encode('utf-8')
plaintext = f'{{"seat_id":"{user_select_seat}","segment":"{segment}"}}'.encode('utf-8')
...
booking_confirm_data={'aesjson': ciphertext_base64, 'authorization': booking_user_authorization}
```

---

## 4. 层级：馆 → 层 → 区域 → 座位

### 4.1 `POST /api/Seat/tree` —— [ZJU 线上前端 + Libot]
- 参数：`{}`，或 `{date: "YYYY-MM-DD"}`（选座首页 `region-select` 在拿到日期列表后带 `date`）。
- 返回 `data[]`：馆舍节点，`children` = 楼层，楼层 `children` = 区域 / 房间。
- 节点字段：`id` `name` `children` `sort` `tag`（==1 为默认选中）`isValid`（**0 暂停预约 / 1 有空余 / 2 约满**）`TotalCount`（界面在状态文字后显示，推测为余座或总座数，未确认）`image_url`（楼层平面图）；Libot 还用到 `levels`（"1" 馆 / "3" 房间）与 `type`（房间节点 `levels=3, type=1`）。英文界面用 `filterTreeEn` 换成 `enname`。
- Libot 说该接口不登录也能取；Elychron 实测未登录返回 10001。以登录为准。

### 4.2 `POST /reserve/index/quickSelect`（"快速选座"，带余座统计）—— [ZJU 线上前端 + richardrren]
- 线上前端参数：
  ```js
  x={id:T.reserveType,date:i,premisesIds:_,categoryIds:h,storeyIds:B,noiseId:f,boutiqueIds:C,startTime:$,endTime:S,members:Q}
  ```
  座位 `id: "1"`；richardrren 只发 `{id:'1'}` 拿日期、再 `{id:'1', date}` 拿馆舍。同济用 `{id:'1', date, categoryIds:['1'], members:0}`。
- 返回 `data = {date: [...日期], premises: [...], storey: [...], area: [...]}`，成功 `code == 0`。
  - `premises[]`（馆）：`id` `name` **`free_num` `total_num`**
  - `storey[]`（层）：`id` `name` `topId`（所属馆 id）`free_num` `total_num`
  - `area[]`（区域）：`id` `name` `parentId`（所属层 id）`free_num` `total_num` `Fully_Booked`（0 未约满）
  richardrren 原文：`print('ID:'+i['id']+' 名称:'+i['name']+' 余量:'+str(i['free_num'])+'/'+str(i['total_num']))`
- **这就是按区域取余座数（free/total）的现成接口**，一次返回全部馆 / 层 / 区，不用逐区查座位。

### 4.3 `POST /reserve/index/list`（区域卡片列表）—— [ZJU 开源：ZJU-Life，未在线上前端核对调用参数]
- 参数 `{premisesIds:[], categoryIds:[], page, limit}`；字段 `id` `name` `nameMerge` `type_name` `storeyName` `premisesName` `free_num` `total_num` `img` `boutique[]`，分页 `totalPage`，ZJU-Life 判断 `code == 0`。

### 4.4 区域详情 `POST /reserve/index/detail` —— [ZJU 线上前端]
- 选座页调用 `{id: "1", areaId}`，成功 `code == 0`，`data.is_reducible == "1"` 才能点「立即预约」（否则按钮显示「无预约权限」），`data.nameMerge` / `ennameMerge` 为完整地点名。

### 4.5 座位底图 `POST /api/seat/map` —— [ZJU 线上前端 + Libot]
- 参数 `{id: <区域 id>}`（注意参数名是 `id`）；`data` 为各状态底图 URL：`config`（选中）`free` `use` `book` `leave` `close` `not`。
- 座位标签 `POST /api/seat/label`（筛选用，`data[]` 有 `id` `name`），选座时可带 `label_id: "1,2"`。

---

## 5. 时段与座位

### 5.1 `POST /api/Seat/date` —— [ZJU 线上前端]
- 参数 **`{build_id: <区域 id>}`**（线上前端 `fetchSeatDate({build_id: area})`，同济、浙中医大一样；richardrren 写死 `'59'`）。不带参数时返回全局可约日期（选座首页用）。
- 返回 `data[]`：`{day: "YYYY-MM-DD", times: [{id, start: "HH:mm", end: "HH:mm", status}]}`；`times[].status == 1` 可选，`start`/`end` 为空显示「暂停预约」。
- `times[].id` 就是 **segment**（库里的真实 id，不是序号；Libot 默认用 "1" 不可靠）。浙大普通座位规则是"全日段有效"，实际通常每天一个时段（推测）。

### 5.2 `POST /api/Seat/seat`（区域内座位状态）—— [ZJU 线上前端 + richardrren + Libot]
- 线上前端原文：
  ```js
  let s={area:u==null?void 0:u.area,segment:e.timeList[e.timeIndex].id,day:e.dateActive.day,
         startTime:e.timeList[e.timeIndex].start,endTime:e.timeList[e.timeIndex].end};
  if(filterActive.length) s.label_id=r.join(",");
  const n=await fetchSeatList(s);
  ```
- 返回 `data[]`：`id` `no` `name` `area` `area_name` `status` `status_name` `in_label` `labels[]` `point_x` `point_y` `width` `height`（百分比坐标）`donate`（捐赠席位信息）。
- **status**（线上 `seat-map` 映射）：`1` 空闲 / `7` 临时离开 / `2,10,11` 已预约 / `6,8,9` 使用中 / `3,4,5` 关闭；`in_label != 1` 显示为不可用。可选条件 `status == 1 && in_label == 1`。区域空余数 = `status == 1` 的个数（页面右上角就是这么算的）。

---

## 6. 预约、取消、签到

### 6.1 预约 `POST /api/Seat/confirm`（加密）—— [ZJU 线上前端 + richardrren]
- 线上前端明文 payload 只有两项：
  ```js
  let s={seat_id:(t=e.seatSelected)==null?void 0:t.id,segment:e.timeList[e.timeIndex].id};
  const n=await SubmitConfirm(s);   // POST /api/Seat/confirm，拦截器包成 {aesjson}
  ```
  → `{"aesjson": AES(JSON.stringify({seat_id, segment})), "authorization": "bearer…"}`。成功 `code == 1`，`msg` 显示为「预约提醒」。
  （浙中医大脚本多带了 `area/day/startTime/endTime`，同济注释"Official confirm accepts only seat_id + segment"。）
- 前端按钮禁用条件（线上 `seatSelectCom`）：
  - 当前是日期列表最后一天（即"次日"）且未到 `config.new`（**07:00**）→ 倒计时、禁用；
  - 过了 `config.close`（23:00）/ `config.end`（23:59）→ 禁用；
  - `is_reducible != "1"` → 无权限。
- **写接口一律不能在调试中调用**。

### 6.2 我的预约 —— [ZJU 线上前端 + Elychron]
- `POST /api/index/subscribe`（首页"我的预约"卡片，`code == 1`）：条目 `type`（"1" 座位 / "2" 空间 / "3" 研习座 …）`id` `space_id` `areaName` `no` `nameMerge` `flag_in` `flag_out` `flag_leave` `oksign` `xuzuoflag` `xuzuosegment` `earlierPeriods` 等。
- `POST /api/Member/seat`（座位预约记录，`code == 1`，`data` 为数组）：Elychron 实测字段 `id` `title` `nameMerge` `beginTime` `endTime` `statusname`（"已使用"等）`timelist`（小时段，不是独立预约）。同济用 `{page, limit: 50}` 分页。
- `POST /api/Member/my`（我是谁）。

### 6.3 取消 / 离开 / 签到（参数均为 `{id: <预约 id>}`）—— [ZJU 线上前端 `AppointmentItem`]
| 动作 | 接口 | 前端显示条件 |
|---|---|---|
| 取消预约 | `POST /api/Space/cancel` `{id}` | `oksign == 1` |
| 签到 | `POST /api/Space/signin` `{id}` | `config.notice.signin == 1 && flag_in == 1 && flag_leave != 1`；**浙大 `notice.signin = "0"`，网页签到入口关闭** |
| 临时离开 | `POST /api/Space/leave` `{id}` | `notice.rightback == 1 && flag_out == 1`（浙大开） |
| 完全离开 | `POST /api/Space/checkout` `{id}` | `notice.leave == 1 && flag_out == 1`（浙大开） |
| 续座 | `POST /api/seat/xuzuoconfirm` `{seat_id: space_id, segment: xuzuosegment}`（加密） | `xuzuoflag == 1` |
| 扫码签到 / 换座 | `/api/seat/qrcode`、`/api/seat/qrcode_not_card`（加密）、`/api/Seat/qr_book_check`、`/api/Seat/touch_qr_books`（加密，`{method:"checkout"}` 等） | 现场扫码 |

### 6.4 规则（官方 `/api/index/booking_rules` 的 `seat_rule`，2026-11-04 匿名读取，以下为概括）
- 可约时段：当日及次日 8:30–22:30；**每天 7:00 开放次日座位**；主馆二楼全天学习空间只能约当日，24 小时开放。
- 当日预约即时生效；次日预约次日 8:30 生效，全日段有效。
- **每人每天只能取消一次**已生效未签到的预约。
- 预约生效后 **30 分钟内要刷卡入馆**（"签到"= 刷卡入馆，不在网页上签），否则失效并记违约一次；馆内当日预约即时生效、无须刷卡。
- 中途刷卡出馆，座位保留 20 分钟；午餐 10:30–13:00、晚餐 16:30–19:00 出馆保留 1 小时。
- 违约累计 3 次冻结一周，每年 1 月 1 日清零。
- config：`seatcancel = "-30"`、`roomcancel = "30"`、`cancel = "-30"`（含义推测：座位可在开始后 30 分钟内取消 / 研讨间须提前 30 分钟取消），`change_seat = "1"`（允许换座），`map_type = "1"`。

### 6.5 限流 / 反爬
- 没找到服务端限流的公开说明；同济实现把 `code == 429` 或 msg 含「频繁 / 限流 / 稍后再试」当限流处理，自己按 1.2 秒（`/api/Seat/seat` 1.5 秒）间隔发请求 [他校同系统]。
- 反爬只有：confirm 等写接口的日期 AES、单设备登录、隐藏的反调试代码（已注释）。没有验证码，没有请求签名。

---

## 7. 其他接口（线上前端提取，供参考）
- 公开：`/api/index/notice` `/api/index/noticeDetail` `/api/index/banner` `/api/index/time` `/api/index/config`（加密）`/api/index/booking_rules` `/api/index/category` `/api/index/lang`
- 座位：`/api/Seat/tree` `/api/Seat/date` `/api/Seat/seat` `/api/Seat/confirm` `/api/Seat/change_seat` `/api/Seat/coordinate` `/api/seat/map` `/api/seat/label` `/api/seat/xuzuoconfirm` `/api/Seat/qr_book_check` `/api/Seat/qr_change_seat` `/api/Seat/touch_qr_books` `/api/seat/qrcode` `/api/seat/qrcode_not_card`
- 空间：`/api/Space/cancel|signin|leave|checkout` `/api/space/seminarCancel` `/reserve/index/index|quickSelect|detail|confirm|list`
- 研讨间 / 自习区 / 入馆：`/api/Seminar/*` `/api/Room/list|detail|mylist` `/api/Study/*` `/api/Enter/date|list|quantum|confirm`
- 我的：`/api/Member/my|seat|room|seminar|isQuickSelect|reneges|lang|removeOpenid` `/api/member/invitations`
- 登录：`/api/cas/user` `/api/jwt/login`(GET) `/api/login/login|wxlogin|dingtalksns|wxwork|forget|resetpass|updateUserInfo` `/api/Captcha/verify`

---

## 8. 解密后的 `/api/index/config`（2026-11-04，匿名）
```json
{
 "notice": {"notice":"1","signin":"0","leave":"1","rightback":"1","rightbackleave":"1","activity":"1", ...},
 "web": {"title":"浙江大学图书馆预约平台","seatcancel":"-30","roomcancel":"30","cancel":"-30", ...},
 "config": {"start":"07:00","end":"23:59","close":"23:00","new":"07:00",
            "cas_url":"https://booking.lib.zju.edu.cn/api/cas/cas","login":"4",
            "change_seat":"1","my_qrcode":"0","map_type":"1", ...}
}
```

---

## 9. 已确认 vs 推测

**ZJU 本站已确认**（线上前端代码 / 多个浙大开源实现一致 / 本次匿名实测）：
主机；CAS service；`cas=` 一次性码 → `/api/cas/user` → `member.token`；`authorization: bearer<token>` 头；10001 未登录；AES 方案与加密名单；`/api/index/time` 混淆公式；quickSelect 的参数与 `free_num/total_num/topId/parentId`；`Seat/date {build_id}`；`Seat/seat` 参数与座位状态码；`Seat/confirm` 明文 `{seat_id, segment}`；取消 / 离开 / 签到接口与 `{id}` 参数；config 里的时间（7:00 开放次日）与官方规则文字。

**推测 / 未验证**：
- 用独立 HTTP 客户端拿 token 能否稳定用（Elychron 说不行，另三个项目说可以）；
- `TotalCount` 是余座还是总座；`seatcancel = -30` 的确切含义；
- 每天几个 segment（推测一个全日段）；
- 服务端是否校验开放时刻、限流阈值多少；
- 零点前后用哪天的日期作 AES key。

**他校同系统佐证**（同济 2026-11、西建大 2026-04、华东师大 2025-01、浙中医大 2026-07、曲阜师大）：加密名单、key/IV、`bearer` 无空格、header 与 body 都带 authorization、`lang: zh`、`X-Requested-With`、Seat/date→Seat/seat→Seat/confirm 的流程、`/api/Space/cancel`，全部和浙大一致。

---

## 10. 本应用的实现（ZJU All in One「图书馆预约」v0.1，2026-11-04）

代码：类型与通道 `src/shared/library.ts`，服务 `src/main/services/library.ts`（不 import electron / node，桌面与安卓共用），
通道 `services/libraryApi.ts` + 桌面接线 `main/libIpc.ts`，订阅 `main/libwatch.ts`，MCP `main/mcpLibrary.ts`，演示数据 `services/demoLibrary.ts`，界面 `renderer/src/components/library/`。

- 登录：经应用共用的 `persist:zju` 会话（`zjuFetch`，带 `upgradeHttp`）访问 `zjuam /cas/login?service=…/api/cas/cas`，从最终地址的 hash 取 `cas=`，再 `POST /api/cas/user` 取 token 存在内存。整条链在同一 cookie 分区里走完（含 PHPSESSID），即上面 §2.3 的建议做法。
  - **推测**：Electron `net.request` 的 `redirect` 事件给出的地址带 hash 片段（`zjuFetch` 以它为最终地址）；安卓 `nativeFetch` 逐跳 `new URL(location)` 也会保留。
  - token 失效（10001）时重登一次再试；后台订阅（`quiet`）遇到「在其他设备登录」不重登，歇 10 分钟，免得和用户手机上的网页互相顶掉。
- 请求头：`authorization: bearer<token>`、`lang: zh`、`X-Requested-With: XMLHttpRequest`，body 里也放一份 authorization。quickSelect 以 `code 0` 为成功，其余 `code 1`。
- 余座：`quickSelect {id:'1', date}` 一次取全部馆 / 层 / 区域；订阅也只调这一个接口。
- 时段：`Seat/date {build_id: 区域 id}`，只取 `status == 1` 且有起止时刻的。
- 座位：`Seat/seat`，状态按 §5.2 映射为 free / away / closed / busy（`in_label` 存在且不为 1 视为 closed）。
- 预约：`Seat/confirm {aesjson}`，明文 `{seat_id, segment}`，key 取北京时间当天日期（WebCrypto AES-CBC，已用 Node `aes-128-cbc` 参考实现对拍一致）。不重试；`code` 非 1 视为被拒，原话显示。
- 我的预约：`Member/seat {page:1, limit:20}`；能否取消取自 `index/subscribe` 里 `type == '1'` 条目的 `oksign`。**推测**：subscribe 的 `id` 与 Member/seat 的 `id` 是同一个预约 id；对不上时按状态文字（待签到 / 预约成功…）猜。
- 取消：`Space/cancel {id}`。
- 签到：浙大关闭了网页签到（`notice.signin = 0`），应用不做签到、临时离开、续座。
- 套餐（只在桌面端，userData/lib-presets.json）：一组范围 + 时段，界面与 MCP 一键订阅 / 自动预约。
- 订阅（只在桌面端）：订阅＝正在查询，停止即结束；「每天定时」可选，不开时从开始查到当天结束，开了只在用户设的时段内查；45–90 秒随机间隔查一次；满座变有空座时通知；授权自动预约的挑空座最多的区域、当天最早还没结束的时段、第一个空座提交一次，成功后停掉全部自动预约（一天一般只许一个座位预约），失败关掉自动只通知。
- 未以登录态实测：以上全部。写接口（预约、取消）只能由用户本人验证。
