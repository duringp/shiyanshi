import { randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';
import { openStore } from './store.mjs';

process.umask(0o077);
const store = openStore();
try {
  if (process.argv[2] === 'backup') {
    const output = process.argv[3] || join(dirname(store.path), 'backups', `manual-${Date.now()}.sqlite`);
    await store.backup(output); console.log(`备份完成且完整性检查通过：${output}`);
  } else {
    const password = process.env.ADMIN_PASSWORD || `Lab-${randomBytes(18).toString('base64url')}-9`;
    const teacher = store.initialize({ username: process.env.ADMIN_USERNAME || 'teacher', name: process.env.ADMIN_NAME || '实验室老师', password });
    console.log(`老师账号已初始化：${teacher.username}`);
    if (!process.env.ADMIN_PASSWORD) console.log(`随机初始密码（仅显示一次）：${password}`);
    console.log('首次登录后请在个人中心修改密码。数据库再次初始化会被拒绝。');
  }
} finally { store.close(); }
