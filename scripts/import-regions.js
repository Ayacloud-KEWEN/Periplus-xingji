// 导入现代行政区边界（Natural Earth，公共领域），用于"点亮地图"
// 用法：npm run import:regions [-- <目录>]
//   不写目录：从 GitHub 下载（约 54MB）
//   写目录：读取目录里已经下载好的两个文件（树莓派不方便联网时，可以先在电脑上下载好再拷过去）
// 可以重复运行：每次都会清空后重新导入。
import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../server/db.js';

const BASE_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
// 国家也用 1:1000 万：1:5000 万的海岸线太粗，海边、港口、小岛上的标注有两成落在所有国家之外
const FILES = {
    0: 'ne_10m_admin_0_countries.geojson',        // 国家和地区（1:1000 万）
    1: 'ne_10m_admin_1_states_provinces.geojson'  // 省 / 州（1:1000 万）
};
const SIMPLIFY_TOLERANCE = { 0: 0.02, 1: 0.01 }; // 单位：度，用于前端显示的简化几何
const BATCH_SIZE = 50;

// Natural Earth 里没有 ISO 代码的地区，用和 config/special-regions.json 一致的代码
const SPECIAL_A3 = { CYN: 'north-cyprus', SOL: 'somaliland' };

// 这几个国家 Natural Earth 的"省"比足迹统计（Nominatim 的 state）细一级：
// 法国是省（département）而不是大区，意大利是省而不是大区，西班牙是省而不是自治区，
// 比利时是省而不是大区，英国是郡而不是英格兰 / 苏格兰等。按所给字段合并成上一级，两边才数得一样。
// 其他国家的 region 字段是统计分区（英国、葡萄牙、爱尔兰的 NUTS，中国的"华东"等），不能用。
const GROUP_FIELD = { fr: 'region', it: 'region', es: 'region', be: 'region', gb: 'geonunit' };
const GROUP_NAMES = {
    // 法国（2016 年后的 13 个大区 + 海外）
    'Auvergne-Rhône-Alpes': ['奥弗涅-罗讷-阿尔卑斯', 'Auvergne-Rhône-Alpes', 'Auvergne-Rhône-Alpes'],
    'Bourgogne-Franche-Comté': ['勃艮第-弗朗什-孔泰', 'Bourgogne-Franche-Comté', 'Bourgogne-Franche-Comté'],
    'Bretagne': ['布列塔尼', 'Brittany', 'Bretagne'],
    'Centre-Val de Loire': ['中央-卢瓦尔河谷', 'Centre-Val de Loire', 'Centre-Val de Loire'],
    'Corse': ['科西嘉', 'Corsica', 'Corse'],
    'Grand Est': ['大东部', 'Grand Est', 'Grand Est'],
    'Hauts-de-France': ['上法兰西', 'Hauts-de-France', 'Hauts-de-France'],
    'Île-de-France': ['法兰西岛', 'Île-de-France', 'Île-de-France'],
    'Normandie': ['诺曼底', 'Normandy', 'Normandie'],
    'Nouvelle-Aquitaine': ['新阿基坦', 'Nouvelle-Aquitaine', 'Nouvelle-Aquitaine'],
    'Occitanie': ['奥克西塔尼', 'Occitania', 'Occitanie'],
    'Pays de la Loire': ['卢瓦尔河地区', 'Pays de la Loire', 'Pays de la Loire'],
    "Provence-Alpes-Côte-d'Azur": ['普罗旺斯-阿尔卑斯-蓝色海岸', "Provence-Alpes-Côte d'Azur", "Provence-Alpes-Côte d'Azur"],
    'Guadeloupe': ['瓜德罗普', 'Guadeloupe', 'Guadeloupe'],
    'Martinique': ['马提尼克', 'Martinique', 'Martinique'],
    'Guyane française': ['法属圭亚那', 'French Guiana', 'Guyane'],
    'Réunion': ['留尼汪', 'Réunion', 'La Réunion'],
    'Mayotte': ['马约特', 'Mayotte', 'Mayotte'],
    // 意大利（20 个大区）
    "Valle d'Aosta": ['瓦莱达奥斯塔', 'Aosta Valley', "Vallée d'Aoste"],
    'Piemonte': ['皮埃蒙特', 'Piedmont', 'Piémont'],
    'Lombardia': ['伦巴第', 'Lombardy', 'Lombardie'],
    'Trentino-Alto Adige': ['特伦蒂诺-上阿迪杰', 'Trentino-South Tyrol', 'Trentin-Haut-Adige'],
    'Veneto': ['威尼托', 'Veneto', 'Vénétie'],
    'Friuli-Venezia Giulia': ['弗留利-威尼斯朱利亚', 'Friuli-Venezia Giulia', 'Frioul-Vénétie julienne'],
    'Liguria': ['利古里亚', 'Liguria', 'Ligurie'],
    'Emilia-Romagna': ['艾米利亚-罗马涅', 'Emilia-Romagna', 'Émilie-Romagne'],
    'Toscana': ['托斯卡纳', 'Tuscany', 'Toscane'],
    'Umbria': ['翁布里亚', 'Umbria', 'Ombrie'],
    'Marche': ['马尔凯', 'Marche', 'Marches'],
    'Lazio': ['拉齐奥', 'Lazio', 'Latium'],
    'Abruzzo': ['阿布鲁佐', 'Abruzzo', 'Abruzzes'],
    'Molise': ['莫利塞', 'Molise', 'Molise'],
    'Campania': ['坎帕尼亚', 'Campania', 'Campanie'],
    'Apulia': ['普利亚', 'Apulia', 'Pouilles'],
    'Basilicata': ['巴西利卡塔', 'Basilicata', 'Basilicate'],
    'Calabria': ['卡拉布里亚', 'Calabria', 'Calabre'],
    'Sicily': ['西西里', 'Sicily', 'Sicile'],
    'Sardegna': ['撒丁', 'Sardinia', 'Sardaigne'],
    // 西班牙（17 个自治区 + 2 个自治市）
    'Andalucía': ['安达卢西亚', 'Andalusia', 'Andalousie'],
    'Aragón': ['阿拉贡', 'Aragon', 'Aragon'],
    'Asturias': ['阿斯图里亚斯', 'Asturias', 'Asturies'],
    'Islas Baleares': ['巴利阿里群岛', 'Balearic Islands', 'Îles Baléares'],
    'Canary Is.': ['加那利群岛', 'Canary Islands', 'Îles Canaries'],
    'Cantabria': ['坎塔布里亚', 'Cantabria', 'Cantabrie'],
    'Castilla y León': ['卡斯蒂利亚-莱昂', 'Castile and León', 'Castille-et-León'],
    'Castilla-La Mancha': ['卡斯蒂利亚-拉曼恰', 'Castilla–La Mancha', 'Castille-La Manche'],
    'Cataluña': ['加泰罗尼亚', 'Catalonia', 'Catalogne'],
    'Valenciana': ['瓦伦西亚', 'Valencian Community', 'Communauté valencienne'],
    'Extremadura': ['埃斯特雷马杜拉', 'Extremadura', 'Estrémadure'],
    'Galicia': ['加利西亚', 'Galicia', 'Galice'],
    'Madrid': ['马德里', 'Madrid', 'Madrid'],
    'Murcia': ['穆尔西亚', 'Murcia', 'Murcie'],
    'Foral de Navarra': ['纳瓦拉', 'Navarre', 'Navarre'],
    'País Vasco': ['巴斯克', 'Basque Country', 'Pays basque'],
    'La Rioja': ['拉里奥哈', 'La Rioja', 'La Rioja'],
    'Ceuta': ['休达', 'Ceuta', 'Ceuta'],
    'Melilla': ['梅利利亚', 'Melilla', 'Melilla'],
    // 比利时
    'Flemish': ['弗拉芒大区', 'Flanders', 'Flandre'],
    'Walloon': ['瓦隆大区', 'Wallonia', 'Wallonie'],
    'Capital Region': ['布鲁塞尔首都大区', 'Brussels-Capital Region', 'Région de Bruxelles-Capitale'],
    // 英国
    'England': ['英格兰', 'England', 'Angleterre'],
    'Scotland': ['苏格兰', 'Scotland', 'Écosse'],
    'Wales': ['威尔士', 'Wales', 'Pays de Galles'],
    'Northern Ireland': ['北爱尔兰', 'Northern Ireland', 'Irlande du Nord']
};

const slug = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const dir = process.argv.slice(2).find(arg => !arg.startsWith('--'));

// 国家文件的字段是大写，省级文件是小写
const prop = (props, key) => props[key] ?? props[key.toUpperCase()];

function countryCodeOf(props) {
    const iso = String(prop(props, 'iso_a2_eh') ?? prop(props, 'iso_a2') ?? '').toLowerCase();
    if (/^[a-z]{2}$/.test(iso)) return iso;
    const a3 = String(prop(props, 'adm0_a3') ?? '').toUpperCase();
    return SPECIAL_A3[a3] || `x-${a3.toLowerCase()}`;
}

function toRow(level, feature) {
    const props = feature.properties || {};
    if (!feature.geometry) return null;
    const country = countryCodeOf(props);
    const names = {
        zh: prop(props, 'name_zh') || null,
        en: prop(props, 'name_en') || (level === 0 ? prop(props, 'admin') : prop(props, 'name')) || null,
        fr: prop(props, 'name_fr') || null
    };
    let code = level === 0 ? country : (prop(props, 'iso_3166_2') || `${country}-${names.en}`);
    // 要合并的省：先用上一级的代码和名称导入，之后按代码合并几何
    const group = level === 1 && GROUP_FIELD[country] ? props[GROUP_FIELD[country]] : null;
    if (group) {
        code = `${country}-${slug(group)}`;
        const [zh, en, fr] = GROUP_NAMES[group] || [null, group, group];
        names.zh = zh;
        names.en = en;
        names.fr = fr;
    }
    return [level, code, country, JSON.stringify(names), JSON.stringify(feature.geometry)];
}

// 同一代码的多块融合成一个区域，名称取面积最大的那块：
// 省级是上面要合并的省；国家级是 1:1000 万数据里单独列出的海外部分（法国和克利珀顿岛、澳大利亚和几个岛屿领地等），
// 不合并的话一个国家会被数成两个
async function mergeDuplicates(level) {
    const { rows: [{ max }] } = await pool.query('SELECT max(id) AS max FROM admin_regions');
    const { rows } = await pool.query(
        `WITH dup AS (SELECT code FROM admin_regions WHERE level = $1 GROUP BY code HAVING count(*) > 1)
         INSERT INTO admin_regions (level, code, country, names, geom)
         SELECT $1, code, (array_agg(country ORDER BY ST_Area(geom) DESC))[1], (array_agg(names ORDER BY ST_Area(geom) DESC))[1],
                ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Union(geom)), 3))
         FROM admin_regions WHERE level = $1 AND code IN (SELECT code FROM dup)
         GROUP BY code
         RETURNING code`,
        [level]
    );
    await pool.query('DELETE FROM admin_regions WHERE level = $1 AND code = ANY($2) AND id <= $3', [level, rows.map(r => r.code), max]);
    if (rows.length) console.log(`合并同一代码的多块：${rows.length} 个${level === 0 ? '国家和地区' : '省 / 州'}`);
}

async function load(fileName) {
    if (dir) return JSON.parse(await fs.readFile(path.join(dir, fileName), 'utf8'));
    console.log(`正在下载 ${fileName}...`);
    const response = await fetch(BASE_URL + fileName);
    if (!response.ok) throw new Error(`下载失败 ${response.status}: ${fileName}`);
    return response.json();
}

async function insertBatch(rows) {
    const placeholders = rows.map((_, i) => {
        const b = i * 5;
        // 个别边界自相交，先修复成合法几何，再只保留面
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}::jsonb,
                 ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($${b + 5}), 4326)), 3)))`;
    });
    await pool.query(
        `INSERT INTO admin_regions (level, code, country, names, geom) VALUES ${placeholders.join(', ')}`,
        rows.flat()
    );
}

async function main() {
    const collections = {};
    for (const level of [0, 1]) collections[level] = await load(FILES[level]);

    await pool.query('TRUNCATE admin_regions RESTART IDENTITY');
    for (const level of [0, 1]) {
        const rows = collections[level].features.map(feature => toRow(level, feature)).filter(Boolean);
        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
            await insertBatch(rows.slice(i, i + BATCH_SIZE));
            process.stdout.write(`\r${level === 0 ? '国家和地区' : '省 / 州'}：已导入 ${Math.min(i + BATCH_SIZE, rows.length)} / ${rows.length}`);
        }
        console.log();
        await mergeDuplicates(level);
        await pool.query(
            `UPDATE admin_regions SET geom_simple = s.g
             FROM (SELECT id, ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SimplifyPreserveTopology(geom, $2)), 3)) AS g
                   FROM admin_regions WHERE level = $1) s
             WHERE admin_regions.id = s.id AND NOT ST_IsEmpty(s.g)`,
            [level, SIMPLIFY_TOLERANCE[level]]
        );
    }
    await pool.query('ANALYZE admin_regions');
    const { rows } = await pool.query('SELECT level, count(*)::int AS count FROM admin_regions GROUP BY level ORDER BY level');
    console.log(`完成：${rows.map(r => `${r.level === 0 ? '国家和地区' : '省 / 州'} ${r.count} 个`).join('，')}`);
}

try {
    await main();
} catch (err) {
    console.error('\n导入失败:', err.message);
    process.exitCode = 1;
} finally {
    await pool.end();
}
