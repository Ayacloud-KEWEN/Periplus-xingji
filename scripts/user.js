// 命令行管理账户（第一个管理员、忘了密码时用）：
//   npm run user -- list
//   npm run user -- add <用户名> [--admin]      会提示输入密码
//   npm run user -- passwd <用户名>             重设密码，这个用户的所有登录都会失效
//   npm run user -- admin <用户名> on|off
// 密码也可以用环境变量 PASSWORD 传入（脚本里批量建号时用），避免交互输入
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { ROOT_DIR } from '../server/config.js';
import { pool } from '../server/db.js';
import { createUser, hashPassword, validatePassword, adoptOrphanData } from '../server/auth.js';

async function askPassword() {
    if (process.env.PASSWORD) return process.env.PASSWORD;
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
        const first = await rl.question('密码（至少 8 位）：');
        const second = await rl.question('再输入一次：');
        if (first !== second) throw new Error('两次输入的密码不一样');
        return first;
    } finally {
        rl.close();
    }
}

async function findUser(username) {
    const { rows } = await pool.query('SELECT id, username FROM users WHERE lower(username) = lower($1)', [username]);
    if (!rows.length) throw new Error(`没有这个用户：${username}`);
    return rows[0];
}

const [command, username, ...rest] = process.argv.slice(2);

try {
    // 服务还没启动过时表可能还不存在，先应用一遍结构（可重复执行）
    await pool.query(await fs.readFile(path.join(ROOT_DIR, 'db', 'schema.sql'), 'utf8'));

    if (command === 'list') {
        const { rows } = await pool.query(
            `SELECT u.username, u.is_admin, u.created_at, (SELECT count(*) FROM points p WHERE p.user_id = u.id)::int AS points
             FROM users u ORDER BY u.id`);
        if (!rows.length) console.log('还没有任何账户');
        for (const row of rows) {
            console.log(`${row.username}${row.is_admin ? '（管理员）' : ''}  ${row.points} 个标注  创建于 ${row.created_at.toISOString().slice(0, 10)}`);
        }
    } else if (command === 'add' && username) {
        const password = await askPassword();
        const user = await createUser(username, password, rest.includes('--admin'));
        console.log(`已创建 ${user.username}${user.is_admin ? '（管理员）' : ''}`);
        const adopted = await adoptOrphanData();
        if (adopted) console.log(`原有的 ${adopted} 条数据已归到最早的管理员名下`);
    } else if (command === 'passwd' && username) {
        const user = await findUser(username);
        const password = await askPassword();
        validatePassword(password);
        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(password), user.id]);
        await pool.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
        console.log(`已重设 ${user.username} 的密码`);
    } else if (command === 'admin' && username && ['on', 'off'].includes(rest[0])) {
        const user = await findUser(username);
        await pool.query('UPDATE users SET is_admin = $1 WHERE id = $2', [rest[0] === 'on', user.id]);
        console.log(`${user.username} ${rest[0] === 'on' ? '已设为管理员' : '已取消管理员'}`);
    } else {
        console.log('用法：npm run user -- list | add <用户名> [--admin] | passwd <用户名> | admin <用户名> on|off');
        process.exitCode = 1;
    }
} catch (err) {
    console.error('操作失败:', err.message);
    process.exitCode = 1;
} finally {
    await pool.end();
}
