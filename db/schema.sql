-- Periplus · 行纪 数据库结构（可重复执行）
CREATE EXTENSION IF NOT EXISTS postgis;

-- 个人标注
CREATE TABLE IF NOT EXISTS points (
    id          BIGSERIAL PRIMARY KEY,
    title       TEXT        NOT NULL DEFAULT '',
    description TEXT        NOT NULL DEFAULT '',
    emoji       TEXT        NOT NULL DEFAULT '📍',
    image_path  TEXT,                                   -- 相对 UPLOAD_DIR 的路径
    geom        geometry(Point, 4326) NOT NULL,
    visited_at  TIMESTAMPTZ NOT NULL DEFAULT now(),     -- 到访时间（照片导入时为拍摄时间）
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS points_geom_idx ON points USING GIST (geom);
CREATE INDEX IF NOT EXISTS points_visited_at_idx ON points (visited_at);

-- 所在的国家、省、市、镇（后台通过 Nominatim 逆地理编码填写；坐标改变时清空，重新查询）
ALTER TABLE points ADD COLUMN IF NOT EXISTS place JSONB;
ALTER TABLE points ADD COLUMN IF NOT EXISTS place_checked_at TIMESTAMPTZ;
-- 用户手动修改过所在地区：自动识别不会覆盖，places:reset 也会保留
ALTER TABLE points ADD COLUMN IF NOT EXISTS place_manual BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS points_place_pending_idx ON points (id) WHERE place IS NULL;

-- 标注的照片，一个标注可以有多张；sort 小的排在前面，第一张作为封面
CREATE TABLE IF NOT EXISTS point_photos (
    id         BIGSERIAL PRIMARY KEY,
    point_id   BIGINT      NOT NULL REFERENCES points(id) ON DELETE CASCADE,
    path       TEXT        NOT NULL,                    -- 相对 UPLOAD_DIR 的路径
    sort       INTEGER     NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS point_photos_point_idx ON point_photos (point_id, sort, id);

-- 以前每个标注只有一张照片，存在 points.image_path。搬到 point_photos 后清空原字段，
-- 否则每次启动都会再搬一次（照片被删掉后又冒出来）
INSERT INTO point_photos (point_id, path)
SELECT id, image_path FROM points WHERE image_path IS NOT NULL;
UPDATE points SET image_path = NULL WHERE image_path IS NOT NULL;

-- 应用里的一些设置和手动调整（目前用于"我的旅程"的拆分 / 合并 / 改名）。
-- 存在服务端而不是浏览器里：换设备、换浏览器都保持一致，也能跟着备份一起导出
CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT        PRIMARY KEY,
    value      JSONB       NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 中国"县 → 地级市"缓存：Nominatim 的逆地理编码不返回地级市，要额外查一次上级行政区，查过的县不再重复查
CREATE TABLE IF NOT EXISTS cn_prefectures (
    province   TEXT NOT NULL,
    county     TEXT NOT NULL,
    prefecture TEXT,
    PRIMARY KEY (province, county)
);

-- 历史疆域（Cliopatria 数据集）
CREATE TABLE IF NOT EXISTS historical_territories (
    id            SERIAL PRIMARY KEY,
    polity_name   TEXT    NOT NULL,
    start_year    INTEGER NOT NULL,
    end_year      INTEGER NOT NULL,
    wikipedia_url TEXT,
    geom          geometry(MultiPolygon, 4326) NOT NULL,
    geom_simple   geometry(MultiPolygon, 4326)          -- 简化后的几何，用于前端显示
);

CREATE INDEX IF NOT EXISTS historical_years_idx ON historical_territories (start_year, end_year);
-- "历史上的这里"按坐标查询所属政权要用空间索引（第一次建立需要几十秒）
CREATE INDEX IF NOT EXISTS historical_geom_idx ON historical_territories USING GIST (geom);

-- GPX 轨迹（跑步、徒步、骑行等）。几何是 MultiLineString：一次活动中间暂停会分成多段，
-- 用 MultiLineString 才不会把暂停的两端连成一条直线
CREATE TABLE IF NOT EXISTS tracks (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT        NOT NULL DEFAULT '',
    sport       TEXT        NOT NULL DEFAULT 'other',   -- running / hiking / walking / cycling / other
    started_at  TIMESTAMPTZ NOT NULL,
    ended_at    TIMESTAMPTZ,
    distance_m  DOUBLE PRECISION NOT NULL DEFAULT 0,
    ascent_m    DOUBLE PRECISION,
    geom        geometry(MultiLineString, 4326) NOT NULL,
    geom_simple geometry(MultiLineString, 4326),        -- 保留但不再写入：显示用的简化在读取时做（见 routes/tracks.js）
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 配速色带用的速度剖面：导入时按约 50 米抽稀，[[[经度, 纬度, 速度(米/秒)], ...], ...]，每段一个数组。
-- 单独存一份是因为显示用的几何是简化过的，点对不上；这份数据本身很小（4 公里的跑步约 90 个点）
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS pace_profile JSONB;
-- 早期版本把"没有配速数据"存成了 jsonb 的 null，那样重新导入时补不上，统一改成真正的 NULL
UPDATE tracks SET pace_profile = NULL WHERE pace_profile = 'null'::jsonb;

CREATE INDEX IF NOT EXISTS tracks_geom_idx ON tracks USING GIST (geom);
CREATE INDEX IF NOT EXISTS tracks_started_idx ON tracks (started_at);
-- 同一次活动只存一条：重复导入同一个 GPX 文件时按开始时间去重
CREATE UNIQUE INDEX IF NOT EXISTS tracks_started_uniq ON tracks (started_at);

-- 现代行政区边界（Natural Earth，公共领域），用于"点亮地图"。导入：npm run import:regions
CREATE TABLE IF NOT EXISTS admin_regions (
    id          SERIAL PRIMARY KEY,
    level       SMALLINT NOT NULL,               -- 0 国家和地区，1 省 / 州
    code        TEXT     NOT NULL,               -- 国家：ISO 3166-1 小写或特殊地区代码；省：ISO 3166-2
    country     TEXT     NOT NULL,               -- 所属国家代码（小写），与足迹统计的国家代码一致
    names       JSONB    NOT NULL,               -- { zh, en, fr }
    geom        geometry(MultiPolygon, 4326) NOT NULL,
    geom_simple geometry(MultiPolygon, 4326)     -- 简化后的几何，用于前端显示
);

CREATE INDEX IF NOT EXISTS admin_regions_geom_idx ON admin_regions USING GIST (geom);
CREATE INDEX IF NOT EXISTS admin_regions_level_idx ON admin_regions (level, country);
