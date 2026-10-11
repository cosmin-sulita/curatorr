import { buildApp } from './app.js';
import { config } from './config.js';
import { scheduleTogether } from './services/together.js';

const { app, ctx } = await buildApp();

if (!config.demo) {
  ctx.library.schedule();
  scheduleTogether(ctx.store, app.log);
}

await app.listen({ port: config.port, host: config.host });
app.log.info(
  `Curatorr ${config.version} listening on http://${config.host}:${config.port}` +
    `${config.demo ? ' (demo mode)' : ''}, config in ${config.configDir}`,
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info(`${signal} received, shutting down`);
    app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}
