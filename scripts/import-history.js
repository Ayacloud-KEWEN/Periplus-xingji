// 导入 Cliopatria 历史疆域数据
// 用法：npm run import:history -- <geojson 路径> [--reset]
//
// 文件约 200MB，逐行流式读取（每行一个 Feature），树莓派上不会占用大量内存。
import fs from 'node:fs';
import readline from 'node:readline';
import { pool } from '../server/db.js';

const BATCH_SIZE = 200;
const SIMPLIFY_TOLERANCE = 0.01; // 单位：度，约 1 公里

const args = process.argv.slice(2);
const filePath = args.find(arg => !arg.startsWith('--'));
const reset = args.includes('--reset');

if (!filePath) {
    console.error('用法: npm run import:history -- <cliopatria_polities_only.geojson> [--reset]');
    process.exit(1);
}

function toRow(feature) {
    const props = feature.properties || {};
    const geometry = feature.geometry;
    if (!geometry || !Number.isInteger(props.FromYear) || !Number.isInteger(props.ToYear)) return null;
    return [
        props.Name || 'Unknown',
        props.FromYear,
        props.ToYear,
        props.Wikipedia || null,
        JSON.stringify(geometry)
    ];
}

async function insertBatch(rows) {
    const placeholders = rows.map((_, i) => {
        const base = i * 5;
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($${base + 5}), 4326)))`;
    });
    await pool.query(
        `INSERT INTO historical_territories (polity_name, start_year, end_year, wikipedia_url, geom)
         VALUES ${placeholders.join(', ')}`,
        rows.flat()
    );
}

async function main() {
    const { rows: [{ count }] } = await pool.query('SELECT count(*)::int AS count FROM historical_territories');
    if (count > 0 && !reset) {
        console.error(`表中已有 ${count} 条数据。如需重新导入，请加 --reset 参数。`);
        process.exitCode = 1;
        return;
    }
    if (reset) await pool.query('TRUNCATE historical_territories RESTART IDENTITY');

    const lines = readline.createInterface({ input: fs.createReadStream(filePath, 'utf8'), crlfDelay: Infinity });
    let batch = [];
    let imported = 0;
    let skipped = 0;

    for await (const rawLine of lines) {
        const line = rawLine.trim().replace(/,$/, '');
        if (!line.startsWith('{ "type": "Feature"') && !line.startsWith('{"type":"Feature"')) continue;

        const row = toRow(JSON.parse(line));
        if (!row) {
            skipped++;
            continue;
        }
        batch.push(row);
        if (batch.length === BATCH_SIZE) {
            await insertBatch(batch);
            imported += batch.length;
            batch = [];
            process.stdout.write(`\r已导入 ${imported} 条`);
        }
    }
    if (batch.length > 0) {
        await insertBatch(batch);
        imported += batch.length;
    }
    console.log(`\r已导入 ${imported} 条，跳过 ${skipped} 条`);

    // 预先计算简化几何：前端显示用，数据量大约只有原来的几分之一
    console.log('正在生成简化几何（树莓派上可能需要几分钟）...');
    await pool.query(
        `UPDATE historical_territories t
         SET geom_simple = s.g
         FROM (
             SELECT id, ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SimplifyPreserveTopology(geom, $1)), 3)) AS g
             FROM historical_territories
         ) s
         WHERE t.id = s.id AND NOT ST_IsEmpty(s.g)`,
        [SIMPLIFY_TOLERANCE]
    );
    await pool.query('ANALYZE historical_territories');
    console.log('完成');
}

try {
    await main();
} catch (err) {
    console.error('\n导入失败:', err.message);
    process.exitCode = 1;
} finally {
    await pool.end();
}
