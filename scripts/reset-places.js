// 清空自动识别的所在地区，服务会在后台重新查询：npm run places:reset
// 调整了行政区识别规则后使用。手动修改过的地区保持不变。310 个标注重新查询大约需要 6–10 分钟。
import { pool } from '../server/db.js';

try {
    const { rowCount } = await pool.query('UPDATE points SET place = NULL, place_checked_at = NULL WHERE NOT place_manual');
    await pool.query('TRUNCATE cn_prefectures');
    console.log(`已清空 ${rowCount} 个标注的所在地区（手动修改过的保持不变），服务会在约 1 分钟内开始重新查询`);
} catch (err) {
    console.error('操作失败:', err.message);
    process.exitCode = 1;
} finally {
    await pool.end();
}
