/**
 * 透明反向代理：将 /v1/* 转发到 https://api.redpanda-lab.xyz/v1/...
 */

import https from 'https';
import { URL } from 'url';

const UPSTREAM_ORIGIN = 'https://api.redpanda-lab.xyz';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
]);

function parseUrl(req) {
  const raw = req.url || '/';
  try {
    return new URL(raw, 'http://localhost');
  } catch {
    return new URL('/', 'http://localhost');
  }
}

function buildTargetUrl(req) {
  const u = parseUrl(req);
  const pathParam = u.searchParams.get('path') || '';
  const safePath = String(pathParam).replace(/^\/+/, '');
  u.searchParams.delete('path');
  const qs = u.searchParams.toString();
  const base = `${UPSTREAM_ORIGIN}/v1/${safePath}`;
  if (!safePath) {
    const err = new Error('缺少 path');
    err.code = 'BAD_PATH';
    throw err;
  }
  return qs ? `${base}?${qs}` : base;
}

function forwardRequestHeaders(req) {
  const out = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (!key || HOP_BY_HOP.has(key.toLowerCase())) continue;
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

function filterResponseHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    const lk = key.toLowerCase();
    if (HOP_BY_HOP.has(lk)) continue;
    if (lk.startsWith('access-control-')) continue;
    out[key] = value;
  }
  return out;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
      'Authorization, Content-Type, X-Requested-With, X-Api-Key, Accept, Accept-Encoding',
    'Access-Control-Expose-Headers': '*',
  };
}

function mergeHeaders(base, extra) {
  return Object.assign({}, base, extra);
}

function isBenignStreamError(err) {
  if (!err) return true;
  const code = err.code;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    code === 'ERR_STREAM_WRITE_AFTER_END' ||
    code === 'EPIPE' ||
    code === 'ECONNRESET' ||
    code === 'ECONNABORTED' ||
    code === 'ERR_STREAM_DESTROYED' ||
    msg.includes('write after end')
  );
}

function pumpRequestToUpstream(req, upstreamReq) {
  return new Promise((resolve, reject) => {
    let settled = false;
    function done(err) {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    }

    req.on('error', (e) => {
      if (!upstreamReq.destroyed) upstreamReq.destroy();
      done(e);
    });

    req.on('aborted', () => {
      if (!upstreamReq.destroyed) upstreamReq.destroy();
      done();
    });

    req.on('data', (chunk) => {
      if (upstreamReq.destroyed || upstreamReq.writableEnded) {
        req.pause();
        return;
      }
      try {
        const ok = upstreamReq.write(chunk);
        if (!ok) req.pause();
      } catch (e) {
        if (!upstreamReq.destroyed) upstreamReq.destroy();
        done(e);
      }
    });

    upstreamReq.on('drain', () => {
      try {
        req.resume();
      } catch {
        /* noop */
      }
    });

    req.on('end', () => {
      if (upstreamReq.destroyed || upstreamReq.writableEnded) {
        done();
        return;
      }
      try {
        upstreamReq.end();
      } catch (e) {
        done(e);
        return;
      }
      done();
    });
  });
}

function pumpUpstreamToResponse(upstreamRes, res) {
  return new Promise((resolve, reject) => {
    let settled = false;
    function done(err) {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    }

    res.on('close', () => {
      upstreamRes.destroy();
    });

    upstreamRes.on('data', (chunk) => {
      if (res.writableEnded || res.destroyed) {
        upstreamRes.destroy();
        return;
      }
      try {
        const ok = res.write(chunk);
        if (!ok) upstreamRes.pause();
      } catch (e) {
        upstreamRes.destroy();
        if (isBenignStreamError(e)) done();
        else done(e);
      }
    });

    res.on('drain', () => {
      try {
        upstreamRes.resume();
      } catch {
        /* noop */
      }
    });

    upstreamRes.on('end', () => {
      if (res.writableEnded || res.destroyed) {
        done();
        return;
      }
      try {
        res.end();
      } catch (e) {
        if (isBenignStreamError(e)) done();
        else done(e);
        return;
      }
      done();
    });

    upstreamRes.on('error', (e) => {
      if (isBenignStreamError(e) && (res.headersSent || res.writableEnded)) {
        done();
        return;
      }
      done(e);
    });

    res.on('error', (e) => {
      upstreamRes.destroy();
      if (isBenignStreamError(e)) done();
      else done(e);
    });
  });
}

function proxyWithHttps(req, res, targetUrlStr) {
  const u = new URL(targetUrlStr);
  const headers = forwardRequestHeaders(req);
  headers.host = u.host;

  const options = {
    hostname: u.hostname,
    port: u.port || 443,
    path: u.pathname + u.search,
    method: req.method,
    headers,
    rejectUnauthorized: true,
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    function finish(err) {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    }

    const upstreamReq = https.request(options, (upstreamRes) => {
      try {
        const outHeaders = mergeHeaders(corsHeaders(), filterResponseHeaders(upstreamRes.headers));
        res.writeHead(upstreamRes.statusCode || 502, outHeaders);
      } catch (e) {
        finish(e);
        return;
      }

      void (async () => {
        try {
          await pumpUpstreamToResponse(upstreamRes, res);
          finish();
        } catch (e) {
          if (res.headersSent && isBenignStreamError(e)) {
            finish();
            return;
          }
          if (!res.headersSent) {
            try {
              res.status(502);
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
              res.end(JSON.stringify({ error: '上游代理失败', detail: e instanceof Error ? e.message : String(e) }));
            } catch {
              /* noop */
            }
          }
          finish(e);
        }
      })();
    });

    upstreamReq.on('error', (e) => {
      if (res.headersSent && isBenignStreamError(e)) {
        finish();
        return;
      }
      if (!res.headersSent) {
        res.status(502);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
        res.end(JSON.stringify({ error: '上游代理失败', detail: e.message }));
      }
      finish(e);
    });

    req.on('error', (e) => {
      if (!upstreamReq.destroyed) upstreamReq.destroy();
      if (!res.headersSent) {
        res.status(502);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
        res.end(JSON.stringify({ error: '客户端连接错误', detail: e.message }));
      }
      finish(e);
    });

    void (async () => {
      try {
        await pumpRequestToUpstream(req, upstreamReq);
      } catch (e) {
        if (isBenignStreamError(e)) {
          finish();
          return;
        }
        if (!res.headersSent) {
          try {
            res.status(502);
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
            res.end(JSON.stringify({ error: '上游代理失败', detail: e instanceof Error ? e.message : String(e) }));
          } catch {
            /* noop */
          }
        }
        finish(e);
      }
    })();
  });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
    res.setHeader(
      'Access-Control-Allow-Headers',
      req.headers['access-control-request-headers'] ||
        'Authorization, Content-Type, X-Requested-With, X-Api-Key, Accept, Accept-Encoding',
    );
    return res.status(204).end();
  }

  let targetUrl;
  try {
    targetUrl = buildTargetUrl(req);
  } catch (e) {
    Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
    if (e && e.code === 'BAD_PATH') {
      return res.status(400).setHeader('Content-Type', 'application/json; charset=utf-8').end(
        JSON.stringify({ error: '缺少 path 参数（应由 /v1/* 重写注入）' }),
      );
    }
    return res.status(400).setHeader('Content-Type', 'application/json; charset=utf-8').end(
      JSON.stringify({ error: '无效的请求 URL' }),
    );
  }

  try {
    await proxyWithHttps(req, res, targetUrl);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!res.headersSent) {
      res.status(502);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
      res.end(JSON.stringify({ error: '上游代理失败', detail: msg }));
    }
  }
}
