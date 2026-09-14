# Periplus · 行纪

**自托管的个人地图。** Periplus 是古希腊的航海游记，记录一路经过的港口和见闻；行纪，就是一路行走的记录。

一个装在自己电脑或树莓派上的个人地图：打卡记录足迹和照片，自动统计去过的国家、地区和世界遗产；导入跑步、徒步、骑行等运动轨迹；拖动时间轴浏览公元前 3400 年至今的历史疆域，重温历史上旅行家的路线。电脑和手机上都能用，所有数据都保存在你自己的设备里。

## 亮点

### 足迹和照片

- **一键打卡**：在手机上点一下，就用当前位置记下一个地点，可以马上加照片和描述。
- **从照片批量生成足迹**：一次选几百张照片，自动读取拍摄地点和时间，生成对应的标注。支持 iPhone 的 HEIC 格式。
- **照片墙**：所有照片按时间铺开，可以按分类筛选（比如只看"山"和"博物馆"），点一张就跳到拍摄地点。
- **足迹统计**：自动统计去过的大洲、国家和地区、省 / 州、市、县 / 区、镇 / 乡，以及去过的**世界遗产**（共 1263 处）。点任意一项，地图就跳到对应的标注。
- **点亮地图**：把去过的国家、省份按去的次数涂上颜色，还能导出一张"我的足迹"海报。
- **我的旅程**：按日期自动把足迹分成一次次旅行，画出路线，算出天数和里程；分得不合意时可以手动拆分、合并、改名。
- **年度回顾**：每年一张卡片，汇总当年去了哪些新国家和城市、走了多少路、到过哪些世界遗产，可以导出成图片分享。
- **个人时间轴**：拖动时间轴，回放自己的足迹和运动轨迹是怎样一点点铺开的。

### 运动轨迹

- 导入佳明等运动手表导出的 GPX，支持跑步、徒步、步行、骑行、游泳，按运动类型分色显示。
- 三种画法：普通、**热力图**（常走的路线颜色更深）、**配速色带**（哪一段快、哪一段慢一目了然）。
- **个人纪录**（最长距离、最长时间、最大爬升、各项运动的最快配速、连续运动天数）、**重复路线对比**（同一条路线跑了几次、每次快慢多少）、每年里程、沿途拍的照片。

### 历史和壮游

- **历史地图**：拖动时间轴，看任意一年的世界疆域（公元前 3400 年至今，15,690 条疆域记录），可以自动播放王朝的兴衰。
- **历史上的这里**：打开任何一个足迹，都能看到这个地方先后属于哪些政权（比如春秋时的吴国、秦朝、汉朝……），点一项就跳到当时的历史地图。
- **壮游**：
  - 历史旅行家：玄奘、马可·波罗、伊本·白图泰、郑和、徐霞客、凯鲁亚克，路线随历史时间轴一段段展开。
  - 著名徒步路线：圣地亚哥朝圣之路（法国之路）、环勃朗峰、熊野古道、印加古道、珠峰大本营、西高地之路、GR20、阿巴拉契亚步道。
  - 可以自己添加路线，见[自己增加或编辑壮游路线](#自己增加或编辑壮游路线)。

### 电脑和手机都能用

- 电脑上是侧边面板，手机上是底部抽屉，操作都适配了触屏（时间轴支持惯性拖动、双指缩放）。
- 可以**添加到手机桌面**，像 App 一样打开（PWA）；服务器暂时连不上时也能打开，查看上次的足迹。
- 支持深色模式（跟随系统），界面有中文、English、Français 三种语言。
- 底图可选 OpenStreetMap、地形图；填上 MapTiler key 后还能用卫星图、户外图等。

### 数据在自己手里

- **自托管**：不需要注册任何云服务，标注、照片、轨迹都存在你自己的电脑或树莓派上。
- **一键备份**：导出一个 zip，包含所有标注、照片、运动轨迹和手动调整，换机器时导入即可。
- **会联网的地方都写清楚了**，并且可以关掉，见[隐私](#隐私)。
- **轻量**：树莓派 5 就能流畅运行；实测 1 万个标注仍然可以正常使用。

> ⚠️ **这个应用没有登录功能**，设计上只在家里的局域网或 [Tailscale](https://tailscale.com/) 这类私有网络里使用。**不要**把端口映射到公网，否则任何人都能看到、修改和删除你的数据。

## 快速开始（在电脑上试用）

需要 [Node.js](https://nodejs.org/) 20 以上和 [Docker](https://www.docker.com/)。

```bash
git clone https://github.com/Ayacloud-KEWEN/Periplus-xingji.git && cd Periplus-xingji
docker run -d --name mapweb-pg -e POSTGRES_USER=mapweb -e POSTGRES_PASSWORD=mapweb \
  -e POSTGRES_DB=mapweb -p 55432:5432 postgis/postgis:16-3.4
cp .env.example .env   # 把 DATABASE_URL 改成 postgres://mapweb:mapweb@localhost:55432/mapweb
npm install
npm run dev
```

打开 http://localhost:8080 就能开始记录足迹。

历史地图和点亮地图需要额外导入数据（各运行一次即可）：

```bash
npm run import:history -- <cliopatria_polities_only.geojson>   # 历史地图、历史上的这里
npm run import:regions                                          # 点亮地图
```

历史疆域数据从 [Cliopatria](https://github.com/Seshat-Global-History-Databank/cliopatria) 下载（`cliopatria_polities_only.geojson`，约 207MB）。

## 隐私

下面这些地方会访问外部服务，其余数据都不会离开你的设备：

| 功能 | 访问的服务 | 发送了什么 | 怎么关掉 |
|---|---|---|---|
| 地图底图 | OpenStreetMap、OpenTopoMap，或 MapTiler | 你正在看的地图区域 | 无法关闭（地图需要底图） |
| 足迹统计的行政区识别 | OpenStreetMap Nominatim（由服务器发出） | 每个标注的坐标 | `.env` 里设置 `GEOCODER=off` |
| 地名搜索 | Nominatim 或 MapTiler | 你输入的搜索词（只在按回车时发送） | 不使用地名搜索即可 |

世界遗产统计、历史地图、照片处理（读取 GPS、HEIC 转换、压缩）都在本地完成。

## 部署到树莓派 5

需要 64 位的 Raspberry Pi OS。已经在 Debian 13 版本（Trixie）的系统上部署成功。其他 Debian / Ubuntu 系统的电脑或服务器也可以参考。

### 1. 获取代码

```bash
git clone https://github.com/Ayacloud-KEWEN/Periplus-xingji.git && cd Periplus-xingji
```

树莓派不方便访问 GitHub 时，也可以在电脑上打包后拷过去。注意要写成 `--exclude=Periplus-xingji/data`：如果写成 `--exclude=data`，会把 `server/data`、`public/data` 也一起排除掉。

```powershell
tar -czf Periplus-xingji.tgz --exclude=node_modules --exclude=.env --exclude=Periplus-xingji/data Periplus-xingji
```

> 为了让已经部署的机器平滑升级，系统服务名、数据库名、备份目录仍然叫 `mapweb`（比如 `sudo systemctl restart mapweb`），备份 zip 里的文件名也保持 `MapWeb_*.json`。

### 2. 一键安装

```bash
bash deploy/setup-pi.sh
```

脚本会：安装 PostgreSQL、PostGIS 和 Node.js 22；创建数据库并生成随机密码，写入 `.env`；安装依赖、建表；注册 systemd 服务，开机自动启动。

完成后在局域网里打开 `http://<树莓派主机名>.local:8080`。如果 8080 端口已经被占用，见下面的"常见问题"。

#### 常见问题

| 现象 | 原因和解决办法 |
|---|---|
| 安装时提示"PostgreSQL 16 可以升级到 18" | 树莓派上原来就装过 PostgreSQL。选 **No**，保留原来的版本，然后安装和它版本匹配的 PostGIS：`sudo apt install -y postgresql-16-postgis-3`（16 换成 `pg_lsclusters` 里显示的版本号） |
| `extension "postgis" is not available` | 同上：装的 PostGIS 和正在运行的 PostgreSQL 版本不一致 |
| `connection to server on socket ... failed` | 数据库没有在运行：先 `pg_lsclusters` 看状态，再运行 `sudo pg_ctlcluster 16 main start` |
| 提示 `.env 已存在，跳过`，之后服务连不上数据库 | `.env` 是从电脑拷过来的，里面是电脑上的数据库地址。改个名字 `mv .env .env.from-pc` 后重新运行脚本，再把 `MAPTILER_KEY` 抄过去 |
| `.env: Permission denied` | 项目目录不属于当前用户（比如解压时用了 `sudo`）：运行 `sudo chown -R "$USER": <项目目录>` |
| 提示符前面有 `(base)` | 开着 conda 环境，脚本可能找到 conda 里的 Node，而 systemd 服务只认 `/usr/bin/node`。先运行 `conda deactivate`，再运行安装脚本 |
| 8080 端口被占用 | 运行脚本前执行 `sed -i 's/^PORT=8080/PORT=8788/' deploy/setup-pi.sh`；已经装好的话，改 `.env` 里的 `PORT`，然后 `sudo systemctl restart mapweb` |

### 3. 导入历史疆域数据（一次即可）

把 `cliopatria_polities_only.geojson`（207MB）拷到树莓派上，然后运行：

```bash
npm run import:history -- ~/cliopatria_polities_only.geojson
```

在 PC 上约需 1 分钟，树莓派 5 上预计几分钟。要重新导入时加 `--reset`。

### 4. 导入国家和省份边界（"点亮地图"需要，一次即可）

```bash
npm run import:regions
```

脚本会从 GitHub 下载 Natural Earth 的边界数据（约 54MB），然后导入数据库，大约需要一两分钟。可以重复运行，每次都会清空后重新导入；边界数据的处理方式有更新时，要再运行一次。如果树莓派不方便联网，可以先在电脑上下载好 `ne_10m_admin_0_countries.geojson` 和 `ne_10m_admin_1_states_provinces.geojson` 两个文件，拷到树莓派上的某个目录里，再运行 `npm run import:regions -- <目录>`。

### 5. 导入已有的数据

左侧工具栏 → **数据**：

- **导入照片**：一次选多张带 GPS 信息的照片，自动生成标注。
- **导入备份**：导入本应用导出的 zip（标注、照片、运动轨迹、旅程的手动调整）。已经存在的标注不会重复创建。已经解压过的导出文件夹，重新压缩成 zip 就能导入，Windows 自带的"压缩"也可以。

运动轨迹在**运动轨迹**面板里导入 GPX 文件。

## 在手机上使用：HTTPS

浏览器只在 HTTPS 下才允许**定位**（一键打卡需要）和**添加到桌面**。通过 `http://` 在局域网里访问时，这两项不可用，其他功能都正常。

推荐用 [Tailscale](https://tailscale.com/)。它可以自动配好有效的 HTTPS 证书，而且在外面也能安全地访问家里的树莓派，不用在路由器上开端口：

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
sudo tailscale serve --bg 8080   # 换成实际用的端口
```

第一次运行 `tailscale serve` 时，如果提示 tailnet 还没开启 HTTPS，按提示打开链接，在 Tailscale 管理后台启用 HTTPS 证书即可。

之后手机装上 Tailscale 并登录同一个账号，就能通过 `https://<主机名>.<你的 tailnet>.ts.net` 访问（`tailscale serve status` 会显示这个地址）。**要用这个 https 地址打开**：用 `http://主机名:8080` 或 `http://100.x.x.x:8080` 打开时，浏览器不允许定位，会提示 "Origin does not have permission to use Geolocation service"。

> ⚠️ **不要**在路由器上把端口映射到公网：这个应用没有登录，任何能访问到它的人都可以修改和删除数据。

## 足迹统计

**行政区**
- 服务会在后台把每个标注的坐标发给 OpenStreetMap 的 Nominatim，查询它所在的国家、省、市、县、镇。每秒最多查 1 次，每个标注只查一次，结果存在数据库里。300 个标注大约需要 6–10 分钟；以后新加或移动过的标注会自动补查。
- Nominatim 暂时拒绝访问或出故障时，会在 5 分钟后重试，不会把标注记成"无法定位"。
- Nominatim 返回的中国地址里没有地级市，所以要额外查一次上级行政区。查询结果按"省 + 县"缓存，同一个县只查一次。
- 香港、澳门作为单独的"地区"统计；北京、上海等直辖市同时计入省级和市级。
- **不想把坐标发给第三方**：在 `.env` 里设置 `GEOCODER=off`。这样行政区统计就不可用了；世界遗产统计是在本地计算的，不受影响。

**世界遗产**
- 数据来自 Wikidata，保存在 `server/data/world-heritage.json`，共 1263 处，包括组合遗产的 4400 多个组成部分。
- 标注落在遗产点周围一定范围内就算去过，范围按遗产面积估算。沿河、沿运河分布的遗产（比如巴黎塞纳河畔、大运河）只有一个坐标点，这类遗产的匹配只是近似。
- 教科文组织每年更新一次名录，更新后运行 `npm run build:heritage` 重新生成数据。

**手动修改**
- 自动识别的结果不对时，在标注的编辑界面里修改"所在地区"（国家/地区、省、市、县、镇）。改过的会带上"手动"标记。
- 手动修改的结果不会被自动识别覆盖，`npm run places:reset` 也会保留。
- 导出备份时，自动识别出来的地区也会一起导出（标记为 `regionAuto`），换机器导入后不用重新查一遍；它们仍然算"自动"，`places:reset` 后会重新识别。
- 勾选"恢复自动识别"可以撤销手动修改。把标注拖到新位置后，也会按新位置重新自动识别。

调整了行政区识别规则后，可以运行 `npm run places:reset` 清空自动识别的结果，服务会重新查询。

### 特殊地区

有些地方被 OpenStreetMap 归入了某个国家，但你想把它单独统计。这类规则写在 [`config/special-regions.json`](config/special-regions.json) 里，自带三条：

| 地区 | 怎么识别 |
|---|---|
| 北塞浦路斯 | 国家代码是 `cy`，而 OSM 返回的国名是"北塞浦路斯" |
| 索马里兰 | 国家代码是 `so`，而 OSM 返回的国名是"索马里兰" |
| 西撒哈拉 | 国家代码是 `ma`，并且位于北纬 27°40′ 以南（OSM 把这一片算作摩洛哥） |

每条规则的字段：

```json
{
  "code": "north-cyprus",                  // 自定义代码：小写字母、数字、连字符；有 ISO 代码的可以直接用（如西撒哈拉用 eh）
  "name": { "zh": "北塞浦路斯", "en": "Northern Cyprus", "fr": "Chypre du Nord" },
  "continent": "AS",                       // AF 非洲、AS 亚洲、EU 欧洲、NA 北美、SA 南美、OC 大洋洲、AN 南极
  "match": {                               // 下面的条件可以任选几个，写了的都要满足
    "countryCodes": ["cy"],                // OSM 返回的国家代码，满足其中一个即可
    "countryNames": ["北塞浦路斯", "Northern Cyprus"],  // OSM 返回的国名（不区分大小写），满足其中一个即可
    "stateNames": ["克里米亚共和国"],      // OSM 返回的省级名称，满足其中一个即可
    "bbox": [-17.2, 20.7, -8.6, 27.667]    // 经纬度范围：[西经度, 南纬度, 东经度, 北纬度]
  }
}
```

- 修改后**重启服务生效**，不需要重新查询行政区：规则在统计时实时套用，数据库里存的识别结果不变。
- OSM 返回的国名跟随查询语言（本应用用中文查询），所以 `countryNames` 里最好把简体、繁体和英文写法都列上。
- 手动修改过地区的标注不套用规则，以你的选择为准；编辑时的国家下拉列表里也会出现这些特殊地区。
- 规则写错时（比如 `continent` 拼错），服务启动日志里会提示原因并忽略这一条，其余规则照常生效。

## 自己增加或编辑壮游路线

应用里没有编辑界面，直接改 JSON 文件：

- 旅行家：`public/data/travelers/`
- 著名徒步路线：`public/data/trails/`

每条路线一个 `.json` 文件，文件名就是 id。**新增的文件要把 id 加进同目录的 `index.json`**，面板按它的顺序显示。

### 徒步路线格式

参考 `public/data/trails/camino-frances.json`：

```json
{
    "name": { "en": "...", "zh": "...", "fr": "..." },
    "description": { "en": "...", "zh": "...", "fr": "..." },
    "stats": { "en": "≈ 100 km · 5 days", "zh": "约 100 公里 · 5 天", "fr": "≈ 100 km · 5 jours" },
    "color": "#2e86de",
    "locations": [
        {
            "name": { "en": "...", "zh": "...", "fr": "..." },
            "lat": 45.89,
            "lng": 6.79,
            "description": { "en": "...", "zh": "...", "fr": "..." }
        }
    ]
}
```

- 站点按行走顺序排列，地图上的编号和箭头按这个顺序画。站点的 `description` 可以省略。
- `lat` 纬度、`lng` 经度，都是小数。
- 徒步路线没有年份，不会打开历史地图。

### 旅行家格式

参考 `public/data/travelers/xuxiake.json`。和徒步路线的区别：

- 名字写在 `traveler` 里（不是 `name`），另有 `timePeriod`（`start`、`end` 年份）和 `historicalContext`。
- 每个站点要有 `year`，路线随历史时间轴展开；公元前用负数。
- 站点可以加 `duration`，比如"出发"、"终点"。

### 注意

- 三种语言都尽量填上。
- JSON 格式很严格：最后一项后面不能有逗号，引号必须是英文引号。写错一处，整个壮游面板都会加载失败。用 VS Code 打开，有错会标红。
- 这些是静态文件，改完不用重启服务，浏览器按 Ctrl+F5 刷新即可。
- 如果服务部署在树莓派上，建议在电脑上修改、确认显示正常后提交，树莓派上 `git pull`。直接在树莓派上改的话，下次 `git pull` 可能冲突。

## 容量与性能

用合成数据实测的结果。测试机器是一台 Windows 台式机，树莓派 5 大约慢 2–3 倍（估计值）。

| 标注数量 | 加载到地图 | 足迹统计 | 服务内存 | 体验 |
|---|---|---|---|---|
| 1 千 | 0.1 秒 | 0.03 秒 | 71 MB | 很流畅，手机上也一样 |
| 1 万 | 0.7 秒 | 0.24 秒 | 123 MB | 正常使用，要保持"聚合标注"开启 |
| 5 万 | 4.7 秒 | 1.0 秒 | 345 MB | 能用，但每次打开都要等几秒 |

- **照片数量不影响地图速度**，因为只有打开标注时才会加载照片。它受限于硬盘空间，每张约 0.35 MB，1 万张约 3.5 GB。
- **在应用里导出备份**：zip 由服务器边生成边下载，不占浏览器内存，照片再多也不会失败。`deploy/backup.sh` 仍然可用于定时备份（备份的是数据库 dump 和照片目录，适合无人值守）。
- **首次统计行政区**：每个标注需要 1–2 秒，1 万个标注第一次大约要 3–6 小时，以后只查新增的。

## 日常运维

```bash
journalctl -u mapweb -f            # 查看日志
sudo systemctl restart mapweb      # 重启
bash deploy/backup.sh              # 备份标注和照片到 ~/mapweb-backups（保留 30 份）
```

每天自动备份：运行 `crontab -e`，添加一行：

```
0 3 * * * bash <项目目录>/deploy/backup.sh
```

（`<项目目录>` 换成实际路径，比如 `/home/pi/Periplus-xingji`。）

从备份恢复：

```bash
set -a; . .env; set +a
pg_restore --clean --if-exists -d "$DATABASE_URL" ~/mapweb-backups/points_日期.dump
tar -xzf ~/mapweb-backups/uploads_日期.tar.gz -C data/
```

### 更新代码

在项目目录里运行：

```bash
git pull && npm ci --omit=dev && sudo systemctl restart mapweb
```

- 数据库结构会在服务启动时自动更新，不需要手动建表。新建索引时，第一次启动可能要多等几十秒。
- 新版本如果需要导入新数据，会在提交说明里写明。
- 如果改了前端，请同时修改 `public/sw.js` 里的 `VERSION`，已经安装的 PWA 会提示刷新。

### 配置（`.env`）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `HOST` | `0.0.0.0` | 监听地址 |
| `PORT` | `8080` | 端口 |
| `DATABASE_URL` | — | PostgreSQL 连接串 |
| `UPLOAD_DIR` | `./data/uploads` | 照片存放目录 |
| `MAPTILER_KEY` | 空 | 可选。填写后可以切换到 MapTiler 底图（包括卫星图）和地名搜索。key 会发送到浏览器，建议在 MapTiler 后台限制允许的来源 |
| `GEOCODER` | `on` | 足迹统计的行政区查询。设为 `off` 则不向 Nominatim 发送任何坐标 |
| `GEOCODER_EMAIL` | 空 | 可选。Nominatim 在请求异常时可以通过这个邮箱联系你 |

## 技术实现

```
浏览器 ──► Express（server/）──► PostgreSQL + PostGIS
   │            ├──► data/uploads/（照片）
   │            └──► Nominatim（后台识别行政区，可关闭）
   └──► OSM / MapTiler 瓦片、地名搜索（直接访问，不经过服务器）
```

### 目录结构

```
Periplus-xingji/
├── server/
│   ├── index.js            # 入口：静态文件、API 路由、错误处理
│   ├── config.js  db.js  errors.js
│   ├── geocoder.js         # 后台逆地理编码（Nominatim）
│   ├── heritage.js         # 世界遗产匹配
│   ├── special-regions.js  # 特殊地区规则
│   ├── continents.js  cn-provinces.js
│   ├── data/world-heritage.json、data/polity-names.json
│   └── routes/
│       ├── points.js       # 标注增删改查、照片上传
│       ├── tracks.js       # 运动轨迹
│       ├── history.js      # 历史疆域（按年份缓存）、历史上的这里
│       ├── stats.js        # 足迹统计
│       ├── regions.js      # 点亮地图（边界 + 标注数量）
│       ├── backup.js       # 导出备份 zip
│       └── settings.js     # 应用设置（旅程的手动调整）
├── scripts/
│   ├── init-db.js          # 建表
│   ├── import-history.js   # 流式导入 GeoJSON，生成简化几何
│   ├── import-regions.js   # 导入 Natural Earth 国家和省份边界
│   ├── build-heritage.js   # 从 Wikidata 生成世界遗产数据
│   ├── build-polity-names.js # 生成历史政权的中文、法文名称
│   └── reset-places.js     # 清空行政区信息，重新统计
├── config/special-regions.json
├── db/schema.sql
├── deploy/                 # setup-pi.sh、mapweb.service、backup.sh
└── public/                 # 前端（ES 模块，无需构建）
    ├── index.html  sw.js  manifest.webmanifest
    ├── css/app.css
    ├── js/
    │   ├── main.js         # 启动、工具栏事件
    │   ├── map.js          # 地图、底图、定位
    │   ├── pins.js         # 标注图层、详情和编辑面板、一键打卡
    │   ├── gallery.js      # 照片墙
    │   ├── stats.js        # 足迹统计面板
    │   ├── lighten.js      # 点亮地图、导出海报
    │   ├── trips.js        # 我的旅程
    │   ├── review.js       # 年度回顾
    │   ├── tracks.js  gpx.js  # 运动轨迹、GPX 解析
    │   ├── history.js      # 历史疆域图层
    │   ├── journeys.js     # 壮游（旅行家、徒步路线）
    │   ├── route.js        # 路线图层（壮游和我的旅程共用）
    │   ├── timebar.js      # 时间轴（历史地图、个人时间轴共用）
    │   ├── categories.js   # 分类图标（Lucide）和颜色
    │   ├── search.js  io.js  photos.js  panels.js
    │   └── api.js  i18n.js  ui.js  settings.js
    ├── lang/               # zh、en、fr
    ├── data/travelers/  data/trails/
    ├── img/  pages/
    └── vendor/             # Leaflet 等第三方库（本地文件）
```

### API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/points` | 所有标注；加 `?ids=1,2,3` 只取指定的几个 |
| POST | `/api/points` | 新建 `{ lat, lng, title?, description?, emoji?, visited_at? }` |
| POST | `/api/points/batch` | 批量新建（1–5000 条，一个事务） |
| PATCH | `/api/points/:id` | 修改任意字段，包括坐标和所在地区（`place` 传对象为手动修改，传 `null` 为恢复自动识别） |
| DELETE | `/api/points/:id` | 删除（照片文件一起删） |
| POST | `/api/points/:id/photos` | 添加一张照片（multipart，字段名 `image`，≤20MB，jpeg/png/webp/gif，每个标注最多 50 张） |
| DELETE | `/api/points/:id/photos/:photoId` | 删除一张照片 |
| GET | `/api/tracks` | 所有运动轨迹（几何已简化） |
| POST | `/api/tracks` | 导入一条轨迹（按开始时间去重） |
| DELETE | `/api/tracks/:id` | 删除轨迹 |
| GET | `/api/history?year=Y` | 该年份的疆域 GeoJSON |
| GET | `/api/history/range` | 数据覆盖的年份范围 |
| GET | `/api/history/at?lat=&lng=` | 这个坐标在历史上先后属于哪些政权（同一政权相连的时期合并成一段） |
| GET | `/api/history/names` | 历史政权的中文、法文名称（按英文维基百科标题） |
| GET | `/api/regions?level=0` | 所有国家和地区的边界，以及每个区域里的标注数量 |
| GET | `/api/regions?level=1&country=cn,jp` | 指定国家的省 / 州边界，以及每个区域里的标注数量 |
| GET | `/api/stats` | 足迹统计：各级行政区、世界遗产、后台查询进度 |
| GET | `/api/backup` | 导出备份 zip（标注、照片、轨迹、设置） |
| GET / PUT | `/api/settings/:key` | 应用设置（目前是 `trips`：旅程的拆分、合并、改名） |
| GET | `/api/config` | 前端配置（MapTiler key） |
| GET | `/api/countries` | 国家 / 地区代码列表（手动修改所在地区时使用） |
| GET | `/api/health` | 健康检查 |

### 性能要点

- **历史疆域**：导入时预先生成简化几何（容差 0.01°，约 1km），每个年份的返回体积在 gzip 后为 16–195KB；结果按年份缓存在内存里；前端用 canvas 渲染，拖动时只渲染最后一次请求的结果
- **运动轨迹**：数据库存完整轨迹，读取时按 1 米容差简化（2400 个点的跑步约简化成 200 个点）
- **照片**：上传前在浏览器里压缩到 1MB / 1920px 以内；文件名唯一，浏览器缓存一年
- **前端**：第三方库缓存 30 天；自己的代码每次用 ETag 校验，改完刷新即可生效

### 数据库

- `points`：个人标注。坐标存为 `geometry(Point, 4326)`；`place`（JSONB）是所在地区，`place_manual` 标记是否为手动修改
- `point_photos`：标注的照片，一个标注可以有多张，存相对路径
- `tracks`：运动轨迹（`MultiLineString`）和配速数据
- `historical_territories`：历史疆域。`geom` 是原始几何（带空间索引，供"历史上的这里"查询），`geom_simple` 是用于显示的简化几何
- `admin_regions`：现代国家和省份边界（Natural Earth），供"点亮地图"使用
- `cn_prefectures`：中国"县 → 地级市"的缓存
- `app_settings`：应用设置和手动调整

## 本地开发

环境搭建见[快速开始](#快速开始在电脑上试用)。`npm run dev` 会在修改服务端代码后自动重启；前端没有构建步骤，改完浏览器刷新即可。

`server/data/` 里的两份数据已经提交在仓库里，一般不需要重新生成：

```bash
npm run build:heritage       # 世界遗产（Wikidata），教科文组织每年更新名录后运行
npm run build:polity-names   # 历史政权的中文、法文名称（需要先导入历史疆域）
```

## 依赖和数据来源

| 类别 | 依赖 |
|---|---|
| 服务端 | express 5、pg 8、multer 2、compression、dotenv、yazl |
| 系统 | Node.js ≥ 20、PostgreSQL 15 以上、PostGIS 3 |
| 前端（本地文件） | Leaflet 1.9.4、Leaflet.markercluster、exifr、heic2any 0.4.5、browser-image-compression 2.0.2、JSZip 3.10.1 |
| 外部服务 | OpenStreetMap / OpenTopoMap 瓦片、Nominatim，以及可选的 MapTiler |
| 数据 | [Cliopatria](https://github.com/Seshat-Global-History-Databank/cliopatria) 历史疆域（CC BY 4.0）；[Wikidata](https://www.wikidata.org) 世界遗产（CC0）；[OpenStreetMap](https://www.openstreetmap.org/copyright) 行政区（ODbL）；[Natural Earth](https://www.naturalearthdata.com) 国家和省份边界（公共领域）；历史政权中文名来自 Wikipedia / Wikidata |
| 图标 | [Lucide](https://lucide.dev)（ISC） |

## 许可证

代码以 [MIT 许可证](LICENSE) 发布。第三方库和数据沿用各自的许可证，见上表。
