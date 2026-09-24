// 服务端打包备份：GET /api/backup
// 格式和应用里"导出备份"一致（MapWeb_Export.json + img/），可以直接再导入回来。
// zip 是流式写出的，照片再多也不占内存，不像浏览器里打包那样有 1–2 GB 的上限。
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import yazl from 'yazl';
import { pool } from '../db.js';
import { config } from '../config.js';
import { resolvePlace } from '../special-regions.js';

const router = Router();

function pickRegion(place) {
    const { countryCode, state, city, county, town } = place;
    return { countryCode, state: state ?? null, city: city ?? null, county: county ?? null, town: town ?? null };
}

// 旅程的手动调整以标注 id 为锚点，但导入到别的库时标注 id 会变。
// 备份里改成记"第几条标注"（MapWeb_Export.json 里的序号），导入时再换成新的 id
function tripsForBackup(value, entryIndex) {
    const toIndex = (id) => entryIndex.get(String(id));
    const indexes = (list) => (Array.isArray(list) ? list.map(toIndex).filter(index => index !== undefined) : []);
    const names = {};
    for (const [id, name] of Object.entries(value?.names || {})) {
        const index = toIndex(id);
        if (index !== undefined) names[index] = name;
    }
    return { anchor: 'entryIndex', breaks: indexes(value?.breaks), joins: indexes(value?.joins), names };
}

router.get('/', async (req, res) => {
    const { rows } = await pool.query(
        `SELECT p.id, p.title, p.description, p.emoji, ST_Y(p.geom) AS lat, ST_X(p.geom) AS lng,
                p.visited_at, p.place, p.place_manual,
                COALESCE((SELECT json_agg(ph.path ORDER BY ph.sort, ph.id) FROM point_photos ph WHERE ph.point_id = p.id), '[]') AS photos
         FROM points p WHERE p.user_id = $1 ORDER BY p.visited_at`,
        [req.user.id]
    );

    const zip = new yazl.ZipFile();
    const entries = [];
    const entryIndex = new Map(); // 标注 id → 在 MapWeb_Export.json 里的序号
    for (const row of rows) {
        entryIndex.set(String(row.id), entries.length);
        const photoPaths = [];
        for (const relativePath of row.photos) {
            const absolutePath = path.resolve(config.uploadDir, relativePath);
            // 防止路径穿越；文件丢失的跳过，不影响整份备份
            if (!absolutePath.startsWith(config.uploadDir + path.sep) || !fs.existsSync(absolutePath)) continue;
            const name = `img/${path.basename(relativePath)}`;
            zip.addFile(absolutePath, name, { compress: false }); // 照片已经压缩过，再压一遍只会更慢
            photoPaths.push(name);
        }
        // 自动识别出来的地区也一起导出（带 regionAuto 标记），换机器后不用重新查一遍
        const place = resolvePlace(row.place, row.lat, row.lng, row.place_manual);
        entries.push({
            locationName: row.title,
            notes: row.description,
            latitude: row.lat,
            longitude: row.lng,
            emojiCategory: row.emoji,
            photoPaths,
            date: row.visited_at,
            ...(place?.countryCode ? { region: pickRegion(place), ...(row.place_manual ? {} : { regionAuto: true }) } : {})
        });
    }
    zip.addBuffer(Buffer.from(JSON.stringify(entries, null, 2)), 'MapWeb_Export.json');

    // 运动轨迹单独放一个文件：旧版本的导入只认 MapWeb_Export.json，多这个文件不影响它
    const { rows: trackRows } = await pool.query(
        `SELECT name, sport, started_at, ended_at, distance_m, ascent_m, pace_profile,
                ST_AsGeoJSON(geom, 6)::json AS geometry
         FROM tracks WHERE user_id = $1 ORDER BY started_at`,
        [req.user.id]
    );
    if (trackRows.length) {
        const tracks = trackRows.map(row => ({
            name: row.name,
            sport: row.sport,
            started_at: row.started_at,
            ended_at: row.ended_at,
            distance_m: row.distance_m,
            ascent_m: row.ascent_m,
            pace_profile: row.pace_profile,
            segments: row.geometry.coordinates
        }));
        zip.addBuffer(Buffer.from(JSON.stringify(tracks)), 'MapWeb_Tracks.json');
    }

    // 手动调整（旅程的拆分 / 合并 / 改名）也一起备份
    const { rows: settingRows } = await pool.query('SELECT key, value FROM app_settings WHERE user_id = $1', [req.user.id]);
    if (settingRows.length) {
        const settings = Object.fromEntries(settingRows.map(row =>
            [row.key, row.key === 'trips' ? tripsForBackup(row.value, entryIndex) : row.value]));
        zip.addBuffer(Buffer.from(JSON.stringify(settings)), 'MapWeb_Settings.json');
    }

    // zip 本身按新名字命名；里面的 MapWeb_*.json 文件名保持不变，旧备份和旧版本都还能互相导入
    const filename = `Periplus_Export_${new Date().toISOString().slice(0, 10)}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    zip.outputStream.on('error', (err) => {
        console.error('备份打包失败:', err);
        res.destroy();
    });
    zip.outputStream.pipe(res);
    zip.end();
});

export default router;
