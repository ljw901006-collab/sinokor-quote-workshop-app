// 로컬 개발 서버. public/ 정적 파일을 서빙하고 /api/* 요청은 api/ 폴더의 함수로 넘긴다.
// Vercel에서는 public/이 정적 호스팅, api/*.js가 서버리스 함수로 각각 처리되므로
// 이 파일은 로컬에서만 쓰인다.
import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, extname, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const publicDir = join(root, 'public');

// .env를 읽어 process.env에 채운다 (이미 있는 값은 덮어쓰지 않는다).
function loadEnv() {
  const envPath = join(root, '.env');
  if (!existsSync(envPath)) return;
  for (const raw of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnv();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (urlPath === '/') urlPath = '/index.html';

  // 상위 폴더 탈출 방지
  const safe = normalize(urlPath);
  const filePath = join(publicDir, safe);
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    await access(filePath);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('찾을 수 없습니다');
    return;
  }

  const body = await readFile(filePath);
  res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
  res.end(body);
}

// 요청 본문을 JSON으로 파싱해 Vercel 핸들러와 같은 req.body 모양을 만든다.
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(raw);
      }
    });
  });
}

// Vercel 핸들러가 기대하는 res.status().json() 형태를 로컬에서도 쓸 수 있게 덧붙인다.
function decorate(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
    return res;
  };
  return res;
}

async function handleApi(req, res, name) {
  const modPath = join(root, 'api', `${name}.js`);
  if (!existsSync(modPath)) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'API를 찾을 수 없습니다.' }));
    return;
  }
  const mod = await import(`file://${modPath}?t=${Date.now()}`);
  req.body = await readBody(req);
  await mod.default(req, decorate(res));
}

const server = createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname.startsWith('/api/')) {
      const name = pathname.slice('/api/'.length).replace(/\/+$/, '');
      if (!/^[a-z0-9-]+$/i.test(name)) {
        res.writeHead(400).end('Bad request');
        return;
      }
      await handleApi(req, res, name);
      return;
    }
    await serveStatic(req, res);
  } catch (err) {
    console.error('[server]', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '서버 오류가 발생했습니다.' }));
    }
  }
});

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, () => {
  console.log(`\n  알파카 물류 견적 검토 앱`);
  console.log(`  http://localhost:${PORT}\n`);
});
