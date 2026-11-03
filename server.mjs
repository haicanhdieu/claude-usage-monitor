#!/usr/bin/env node
import { startServer } from './src/server.mjs';
startServer({ port: Number(process.env.PORT || 4319) }).then(s => console.log(`Claude usage dashboard: http://127.0.0.1:${s.port}`));
