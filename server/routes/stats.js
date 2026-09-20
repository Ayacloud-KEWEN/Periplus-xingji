// 足迹统计：各级行政区的数量、按"大洲 → 国家 → 省 → 市 → 县 → 镇"组织的层级树，以及世界遗产
import { Router } from 'express';
import { pool } from '../db.js';
import { geocoderStatus } from '../geocoder.js';
import { heritageTotal, matchHeritage } from '../heritage.js';
import { resolvePlace } from '../special-regions.js';
import { matchTcc, tccMeta } from '../tcc.js';

const router = Router();
const LEVELS = ['continent', 'country', 'state', 'city', 'county', 'town'];

const byCount = (a, b) => b.count - a.count || new Date(a.firstVisit) - new Date(b.firstVisit);

function newNode(info) {
    // ownPins：路径停在这个节点的标注（比如只识别到省、没有市的标注停在省这一层）
    return { ...info, count: 0, firstVisit: null, ownPins: [], children: new Map() };
}

function countPoint(node, point) {
    node.count++;
    if (!node.firstVisit || point.visited_at < node.firstVisit) node.firstVisit = point.visited_at;
}

// 每个标注的 id 只出现在它路径的最后一个节点上，上级节点的标注由前端从下级汇总。
// 5 万个标注时，响应体积比每一级都带完整 id 列表小好几倍
function serialize(parent) {
    return [...parent.children.values()].sort(byCount).map(({ children, ownPins, ...rest }) => ({
        ...rest,
        pins: ownPins,
        children: serialize({ children })
    }));
}

// 一个标注在树里经过的路径；缺少的层级跳过，比如大峡谷没有"市"就直接挂在州下面
function chainOf(place) {
    const chain = [];
    if (place.continent) chain.push({ level: 'continent', id: place.continent, info: { code: place.continent } });
    chain.push({ level: 'country', id: place.countryCode, info: { code: place.countryCode, name: place.country } });
    for (const level of ['state', 'city', 'county', 'town']) {
        if (place[level]) chain.push({ level, id: place[level], info: { name: place[level] } });
    }
    return chain;
}

router.get('/', async (req, res) => {
    const { rows } = await pool.query(
        `SELECT id, ST_Y(geom) AS lat, ST_X(geom) AS lng, visited_at, place, place_manual FROM points`
    );

    // 各级去重计数（顶部数字卡片）：用完整路径去重，不同省的同名区县分开算
    const seen = Object.fromEntries(LEVELS.map(level => [level, new Set()]));
    const tree = newNode({});
    const tccPoints = []; // TCC 名单用：套用过特殊地区规则的国家代码，外加省名和坐标（细分条目要用）
    let located = 0;
    let pending = 0;

    for (const point of rows) {
        const place = resolvePlace(point.place, point.lat, point.lng, point.place_manual); // 套用特殊地区规则
        if (!place) {
            pending++;
            continue;
        }
        if (!place.countryCode) continue; // 海上等无法定位的地点
        located++;
        tccPoints.push({
            id: Number(point.id), countryCode: place.countryCode, state: place.state,
            lat: point.lat, lng: point.lng, visitedAt: point.visited_at
        });

        let node = tree;
        let path = '';
        for (const step of chainOf(place)) {
            path += `|${step.id}`;
            seen[step.level].add(path);
            // 直辖市的市级和省级同名，在树里合并成一层（数字卡片里仍然各算一次）
            if (step.info.name && step.info.name === node.name) continue;
            if (!node.children.has(step.id)) node.children.set(step.id, newNode({ key: path, level: step.level, ...step.info }));
            node = node.children.get(step.id);
            countPoint(node, point);
        }
        // BIGINT 从 pg 读出来是字符串，前端的标注 id 是数字，不转的话"在地图上显示"匹配不到任何标注
        node.ownPins.push(Number(point.id));
    }

    res.json({
        totals: { pins: rows.length, located, pending, unlocated: rows.length - located - pending },
        geocoder: geocoderStatus(),
        counts: Object.fromEntries(LEVELS.map(level => [level, seen[level].size])),
        tree: serialize(tree),
        heritage: { total: heritageTotal(), visited: matchHeritage(rows) },
        tcc: { ...tccMeta(), visited: matchTcc(tccPoints) }
    });
});

export default router;
