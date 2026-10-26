import { join, dirname } from 'node:path';
import { createApp } from './app.mjs';

process.umask(0o077);
const { server, store } = createApp();
if (!store.read().members.length) {
  store.close();
  throw new Error('尚未初始化老师账号，请先运行 npm run init-admin');
}
const host = process.env.HOST || '127.0.0.1', port = Number(process.env.PORT || 4173);
let backingUp = false;
async function backup() {
  if (backingUp) return;
  backingUp = true;
  try {
    await store.backup(join(dirname(store.path), 'backups', `lab-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`));
    console.log('数据库备份完成并通过完整性检查');
  } catch (error) { console.error('数据库备份失败', error.code || error.message); }
  finally { backingUp = false; }
}
server.listen(port, host, () => { console.log(`芯栈 Lab 已启动：http://${host}:${port}`); void backup(); });
const timer = setInterval(backup, 86400000); timer.unref();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  clearInterval(timer);
  server.close(() => { store.close(); process.exit(0); });
});
