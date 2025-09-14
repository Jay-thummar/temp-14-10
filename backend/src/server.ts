import { createServer } from 'http';
import { app } from './app.js';
import { loadEnv } from './config/env.js';

const env = loadEnv();
const port = Number(env.PORT || 4000);

const server = createServer(app);
server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on http://0.0.0.0:${port}`);
});

