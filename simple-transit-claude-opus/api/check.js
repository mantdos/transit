/**
 * Vercel Serverless: 合并上游订阅与用量接口，返回给落地页。
 * 支持: POST JSON { "token": "sk-..." } 或 Header Authorization: Bearer ...
 */

const SUBSCRIPTION_URL =
  'https://api.opusclaw.me/v1/dashboard/billing/subscription';
const USAGE_URL = 'https://api.opusclaw.me/v1/dashboard/billing/usage';

async function readJsonBody(req) {
  if (req.body != null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  const chunks = [];
  try {
    for await (const chunk of req) {
      chunks.push(chunk);
    }
  } catch (e) {
    throw new Error('读取请求体失败: ' + (e instanceof Error ? e.message : String(e)));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('请求体不是合法 JSON');
  }
}

function getTokenFromAuth(req) {
  const auth = req.headers.authorization;
  if (auth && /^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, '').trim();
  }
  return '';
}

function json(res, status, payload) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(status).end(JSON.stringify(payload));
}

async function fetchJson(url, token) {
  const r = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  const text = await r.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { _raw: text };
  }
  return { ok: r.ok, status: r.status, data };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'Method Not Allowed. Use POST.' });
  }

  let body = {};
  try {
    body = await readJsonBody(req);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json(res, 400, { ok: false, error: message });
  }

  const token = getTokenFromAuth(req) || (typeof body.token === 'string' ? body.token.trim() : '');
  if (!token) {
    return json(res, 400, {
      ok: false,
      error: '缺少 Token：请在 JSON body 中提供 token 字段，或使用 Authorization: Bearer。',
    });
  }

  try {
    const [subRes, usageRes] = await Promise.all([
      fetchJson(SUBSCRIPTION_URL, token),
      fetchJson(USAGE_URL, token),
    ]);

    if (!subRes.ok) {
      return json(res, 502, {
        ok: false,
        error: '订阅信息获取失败',
        upstream: 'subscription',
        status: subRes.status,
        detail: subRes.data,
      });
    }
    if (!usageRes.ok) {
      return json(res, 502, {
        ok: false,
        error: '用量信息获取失败',
        upstream: 'usage',
        status: usageRes.status,
        detail: usageRes.data,
      });
    }

    // 20264.17 新增，需要进行一个中转的倍率换算。
    // 由于下游的倍率乘以了3，为了让用户体验上消耗慢一点，因此需要将总量和使用量都除以3。
    // 当然，在充值的后台也需要进行相应的倍率换算。

    //定义换算变量
    const conversion_rate = 3;

    const sub = subRes.data || {};
    const usage = usageRes.data || {};

    const hard_limit_usd =
      typeof sub.hard_limit_usd === 'number' && !Number.isNaN(sub.hard_limit_usd)
        ? sub.hard_limit_usd / conversion_rate
        : null;
    const access_until =
      typeof sub.access_until === 'number' && !Number.isNaN(sub.access_until)
        ? sub.access_until
        : 0;

    const total_usage_raw =
      typeof usage.total_usage === 'number' && !Number.isNaN(usage.total_usage)
        ? usage.total_usage / conversion_rate
        : null;

    const used_usd = total_usage_raw !== null ? total_usage_raw / 100 : null;

    let remaining_usd = null;
    let usage_percent = null;
    if (hard_limit_usd !== null && used_usd !== null) {
      remaining_usd = Math.max(0, hard_limit_usd - used_usd);
      if (hard_limit_usd > 0) {
        usage_percent = (used_usd / hard_limit_usd) * 100;
      } else {
        usage_percent = used_usd > 0 ? 100 : 0;
      }
    }

    return json(res, 200, {
      ok: true,
      data: {
        hard_limit_usd,
        access_until,
        total_usage_raw,
        used_usd,
        remaining_usd,
        usage_percent,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json(res, 500, { ok: false, error: '服务器内部错误', detail: message });
  }
}
