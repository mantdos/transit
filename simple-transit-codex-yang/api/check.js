/**
 * Vercel Serverless: 合并上游订阅与用量接口，返回给落地页。
 * 支持: POST JSON { "token": "sk-..." } 或 Header Authorization: Bearer ...
 */

const SUBSCRIPTION_URL =
  'https://weiwanga.top/v1/dashboard/billing/subscription';
const USAGE_URL = 'https://weiwanga.top/v1/dashboard/billing/usage';

async function readJsonBody(req) {
  if (req.body != null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  /** 使用 data/end 聚合，避免在 Windows + vercel dev 下 async iterator 与底层句柄关闭竞态触发 libuv 断言。 */
  let buf;
  try {
    buf = await new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  } catch (e) {
    throw new Error('读取请求体失败: ' + (e instanceof Error ? e.message : String(e)));
  }
  const raw = buf.toString('utf8');
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

    const sub = subRes.data || {};
    const usage = usageRes.data || {};

    /** 分组倍率为 0.1：上游额度/用量均被缩小，展示前统一乘以 10 还原真实美元。 */
    const GROUP_MULTIPLIER_SCALE = 10;

    const hard_limit_usd =
      typeof sub.hard_limit_usd === 'number' && !Number.isNaN(sub.hard_limit_usd)
        ? sub.hard_limit_usd * GROUP_MULTIPLIER_SCALE
        : null;


    /** 订阅接口 `access_until`：秒级 Unix 时间戳；透传至前端（兼容字符串）。 */
    let access_until = 0;
    const rawAu = sub.access_until;
    if (typeof rawAu === 'number' && !Number.isNaN(rawAu)) {
      access_until = Math.trunc(rawAu);
    } else if (typeof rawAu === 'string' && rawAu.trim() !== '') {
      const p = parseInt(rawAu, 10);
      if (!Number.isNaN(p)) access_until = p;
    }

    /** New-API：`total_usage` 为上游数值（如 3.4536），需除以 10 才是真实美元累计消耗。 */
    let total_usage_raw = null;
    if (typeof usage.total_usage === 'number' && !Number.isNaN(usage.total_usage)) {
      total_usage_raw = usage.total_usage;
    } else if (typeof usage.total_usage === 'string' && usage.total_usage.trim() !== '') {
      const p = parseFloat(usage.total_usage);
      if (!Number.isNaN(p)) total_usage_raw = p;
    }

    const round2 = (n) => Math.round(Number(n) * 100) / 100;
    const used_usd =
      total_usage_raw !== null ? round2(Number(total_usage_raw) / 100 * GROUP_MULTIPLIER_SCALE) : null;

    /** `hard_limit_usd` 极大值表示系统「不限量」占位；日限额套餐不在此展示比例与剩余。 */
    const FIXED_QUOTA_LIMIT = 999999;

    let remaining_usd = null;
    let usage_percent = null;
    if (
      hard_limit_usd !== null &&
      used_usd !== null &&
      hard_limit_usd <= FIXED_QUOTA_LIMIT
    ) {
      remaining_usd = round2(Math.max(0, hard_limit_usd - used_usd));
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
        total_usage_raw: total_usage_raw !== null ? round2(total_usage_raw) : null,
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
