/**
 * 合并上游订阅与用量；失败时尝试 /v1/models 做连通性检测。
 * 支持: POST JSON { "token": "sk-..." } 或 Header Authorization: Bearer ...
 */

const UPSTREAM = 'https://api.redpanda-lab.xyz';
const SUBSCRIPTION_URL = `${UPSTREAM}/v1/dashboard/billing/subscription`;
const USAGE_URL = `${UPSTREAM}/v1/dashboard/billing/usage`;
const MODELS_URL = `${UPSTREAM}/v1/models`;

async function readJsonBody(req) {
  if (req.body != null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
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
  res.setHeader('Access-Control-Allow-Origin', '*');
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

/** 上游在额度用尽时仍可能返回 JSON body，其中 error.message 含「用尽」。 */
function responseIndicatesQuotaExhausted(fetchResult) {
  const d = fetchResult && fetchResult.data;
  const msg = d && d.error && d.error.message;
  return typeof msg === 'string' && msg.includes('用尽');
}

async function fetchConnectivity(token) {
  const r = await fetch(MODELS_URL, {
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
    data = { _raw: text ? text.slice(0, 500) : '' };
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

    if (responseIndicatesQuotaExhausted(subRes) || responseIndicatesQuotaExhausted(usageRes)) {
      return json(res, 200, {
        ok: true,
        mode: 'exhausted',
        message: '令牌额度已用尽',
        data: {
          remaining_usd: 0,
          usage_percent: 100,
        },
      });
    }

    if (subRes.ok && usageRes.ok) {
      const sub = subRes.data || {};
      const usage = usageRes.data || {};

      const GROUP_MULTIPLIER_SCALE = 1;

      const hard_limit_usd =
        typeof sub.hard_limit_usd === 'number' && !Number.isNaN(sub.hard_limit_usd)
          ? sub.hard_limit_usd * GROUP_MULTIPLIER_SCALE
          : null;

      let access_until = 0;
      const rawAu = sub.access_until;
      if (typeof rawAu === 'number' && !Number.isNaN(rawAu)) {
        access_until = Math.trunc(rawAu);
      } else if (typeof rawAu === 'string' && rawAu.trim() !== '') {
        const p = parseInt(rawAu, 10);
        if (!Number.isNaN(p)) access_until = p;
      }

      let total_usage_raw = null;
      if (typeof usage.total_usage === 'number' && !Number.isNaN(usage.total_usage)) {
        total_usage_raw = usage.total_usage;
      } else if (typeof usage.total_usage === 'string' && usage.total_usage.trim() !== '') {
        const p = parseFloat(usage.total_usage);
        if (!Number.isNaN(p)) total_usage_raw = p;
      }

      const round2 = (n) => Math.round(Number(n) * 100) / 100;
      const used_usd =
        total_usage_raw !== null ? round2((Number(total_usage_raw) / 100) * GROUP_MULTIPLIER_SCALE) : null;

      const FIXED_QUOTA_LIMIT = 999999;

      let remaining_usd = null;
      let usage_percent = null;
      if (hard_limit_usd !== null && used_usd !== null && hard_limit_usd <= FIXED_QUOTA_LIMIT) {
        remaining_usd = round2(Math.max(0, hard_limit_usd - used_usd));
        if (hard_limit_usd > 0) {
          usage_percent = (used_usd / hard_limit_usd) * 100;
        } else {
          usage_percent = used_usd > 0 ? 100 : 0;
        }
      }

      const dataPayload = {
        hard_limit_usd,
        access_until,
        total_usage_raw: total_usage_raw !== null ? round2(total_usage_raw) : null,
        used_usd,
        remaining_usd,
        usage_percent,
      };
      if (sub.group !== undefined && sub.group !== null) {
        dataPayload.group = sub.group;
      }

      return json(res, 200, {
        ok: true,
        data: dataPayload,
      });
    }

    const conn = await fetchConnectivity(token);
    if (conn.ok) {
      return json(res, 200, {
        ok: true,
        mode: 'connectivity',
        message: '账单接口不可用或格式变更，已通过模型列表接口确认 Token 可用。',
        data: {
          models_http_status: conn.status,
          models_preview:
            conn.data && typeof conn.data === 'object'
              ? Object.keys(conn.data).slice(0, 8)
              : typeof conn.data,
        },
      });
    }

    return json(res, 502, {
      ok: false,
      error: '订阅/用量与连通性检测均失败',
      subscription: { ok: subRes.ok, status: subRes.status, detail: subRes.data },
      usage: { ok: usageRes.ok, status: usageRes.status, detail: usageRes.data },
      models: { ok: conn.ok, status: conn.status, detail: conn.data },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json(res, 500, { ok: false, error: '服务器内部错误', detail: message });
  }
}
