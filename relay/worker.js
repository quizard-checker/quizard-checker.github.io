// Quizard relay — Cloudflare Worker.
// The static GitHub Pages app calls this worker for the optional AI features;
// the worker holds the provider API keys as secrets and rotates across them
// when one hits its limit. Keys never reach the client.
//
// Routes (any prefix works — routed on the last path segment, so the legacy
// /.netlify/functions/... paths keep working too):
//   POST /gemini  { prompt, images?, json?, maxOutputTokens?, temperature?, responseSchema?, shape? }
//                 -> 200 text/plain (the model's answer)
//                 `shape` is 'array' when the caller parses a top-level JSON
//                 array (all question authoring), else 'object' (the default).
//                 Provider order: Gemini (rotating keys, model fallback
//                 lite↔flash on capacity) → Groq (gpt-oss, shape-aware JSON
//                 handling) as the last-resort provider when every Gemini
//                 attempt failed.
//   POST /tts     { text, speed? } -> 200 audio/mpeg (Fish Audio wizard voice)
//
// Secrets (npx wrangler secret put ...):
//   GEMINI_KEYS     one or more Gemini API keys, comma/newline separated
//   GROQ_API_KEY    optional Groq key(s) (console.groq.com) — fallback
//                   provider; comma/newline separated, rotated the same way
//   FISH_API_KEY    https://fish.audio/app/api-keys/
//   FISH_VOICE_ID   the designed "wise old wizard" voice model id
// Vars (wrangler.toml [vars]):
//   GEMINI_MODEL    primary model (default gemini-3.5-flash-lite; the worker
//                   falls back to the sibling model on 503 high demand)
//   GROQ_MODEL      defaults to openai/gpt-oss-120b
//   FISH_MODEL      defaults to s2.1-pro-free

const GEMINI_ENDPOINT_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'
const FISH_ENDPOINT = 'https://api.fish.audio/v1/tts'
import { htmlToText, pickTitle, youTubeVideoId, extractPlayerResponse, pickCaptionTrack, json3ToText, timedXmlToText } from './lib.js'
const THROTTLE_MS = 60 * 1000

// worker environment (secrets + vars), assigned on each request in fetch()
let env = {}

const ALLOWED_ORIGINS = new Set([
  'https://quizard-checker.github.io',
  'https://quizard-app.github.io',
  // legacy home that may still have open tabs
  'https://quizforge-app.github.io',
  // local dev servers + the Capacitor Android WebView origin
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://localhost:4200',
  'http://127.0.0.1:4200',
  'http://localhost:4301',
  'http://127.0.0.1:4301',
  'http://localhost:4302',
  'http://127.0.0.1:4302',
  'http://localhost:4310',
  'http://127.0.0.1:4310',
  'https://localhost'
])

function corsHeaders(origin) {
  const base = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-quizard-key',
    Vary: 'Origin',
    'X-Content-Type-Options': 'nosniff'
  }
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    base['Access-Control-Allow-Origin'] = origin
    base['Cross-Origin-Resource-Policy'] = 'cross-origin'
  }
  return base
}

// No Origin header = same-origin or a non-browser client: respond without
// ACAO so browsers enforce the allowlist while servers still work.
function isAllowedOrigin(origin) {
  return !origin || ALLOWED_ORIGINS.has(origin)
}

function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || 'unknown'
}

// Fixed-window counter, best-effort: worker isolates each hold their own
// counters, so this caps per-isolate abuse rather than providing a global quota.
const buckets = new Map()
function rateLimit(ip, max = 40, windowMs = 60000) {
  const now = Date.now()
  const b = buckets.get(ip)
  if (!b || now > b.reset) {
    buckets.set(ip, { count: 1, reset: now + windowMs })
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (now > v.reset) buckets.delete(k)
    }
    return true
  }
  if (b.count >= max) return false
  b.count++
  return true
}

function tooLarge(request, limit = 2_000_000) {
  const len = Number(request.headers.get('content-length') || 0)
  return len > limit
}

// ── Gemini key rotation ──
const gemThrottled = new Map()

function getGemKeys() {
  return (env.GEMINI_KEYS || '').split(/[\n\r,]+/).map(k => k.trim()).filter(Boolean)
}
function getGemModel() {
  return (env.GEMINI_MODEL || 'gemini-3.5-flash-lite').trim()
}
// Capacity fallback: when the primary model answers "high demand" (503), the
// request is retried once on the sibling model — lite and flash draw from
// separate capacity pools, so one hot model stops breaking generation.
function getFallbackModel(primary) {
  return /lite/i.test(primary) ? 'gemini-3.5-flash' : 'gemini-3.5-flash-lite'
}
function gemIsThrottled(key) {
  const exp = gemThrottled.get(key)
  if (!exp) return false
  if (Date.now() > exp) { gemThrottled.delete(key); return false }
  return true
}
function gemMarkThrottled(key) { gemThrottled.set(key, Date.now() + THROTTLE_MS) }
// Enhanced key cycling: distribute load more evenly across all available keys
// and implement smarter throttling detection.
let lastUsedKeyIndex = 0;
let keyUsageCount = new Map();

function gemCombo(extra) {
  const keys = getGemKeys()
  if (extra && !keys.includes(extra)) keys.push(extra)
  
  // Separate live and parked keys
  const live = keys.filter(k => !gemIsThrottled(k))
  const parked = keys.filter(k => gemIsThrottled(k))
  
  // Sort live keys by health (better keys first) and then by usage count
  const sortedLive = live.sort((a, b) => {
    // Prefer healthier keys
    const healthDiff = getKeyHealth(b) - getKeyHealth(a);
    if (healthDiff !== 0) return healthDiff;
    
    // If health is equal, prefer less used keys
    const usageA = (keyUsageCount.get(a) || { successes: 0, failures: 0 }).successes;
    const usageB = (keyUsageCount.get(b) || { successes: 0, failures: 0 }).successes;
    return usageA - usageB;
  });
  
  // Rotate the starting position periodically for better load distribution
  if (sortedLive.length > 0) {
    lastUsedKeyIndex = (lastUsedKeyIndex + 1) % Math.max(1, sortedLive.length);
    const rotatedLive = [
      ...sortedLive.slice(lastUsedKeyIndex),
      ...sortedLive.slice(0, lastUsedKeyIndex)
    ];
    return [...rotatedLive, ...parked];
  }
  
  return [...live, ...parked];
}

// Track key performance for better decision making
function recordKeyUsage(key, success) {
  const count = keyUsageCount.get(key) || { successes: 0, failures: 0 };
  if (success) {
    count.successes++;
  } else {
    count.failures++;
  }
  // Prevent the map from growing too large and implement decay
  const total = count.successes + count.failures;
  if (total > 1000) {
    count.successes = Math.floor(count.successes * 0.9);
    count.failures = Math.floor(count.failures * 0.9);
  }
  keyUsageCount.set(key, count);
}

// Get key health score (higher is better)
function getKeyHealth(key) {
  const count = keyUsageCount.get(key) || { successes: 0, failures: 0 };
  const total = count.successes + count.failures;
  if (total === 0) return 1.0; // No data, assume healthy
  return count.successes / Math.max(1, total); // Success rate
}

// Reset key usage statistics (for periodic cleanup)
function cleanupKeyUsageStats() {
  // Decay very old statistics to prevent memory growth
  for (const [key, stats] of keyUsageCount.entries()) {
    const total = stats.successes + stats.failures;
    // If stats are very large, decay them
    if (total > 10000) {
      stats.successes = Math.floor(stats.successes * 0.8);
      stats.failures = Math.floor(stats.failures * 0.8);
    }
  }
}



function isQuota(msg, status) {
  if (status === 429) return true
  const m = (msg || '').toLowerCase()
  // True per-key quota signals: park the key and rotate to the next one.
  return /quota|rate[\s_-]?limit|resource_exhausted|exceeded.*limit|too many requests/.test(m)
}
// Model-capacity signals ("high demand" 503, overload): the KEY is fine —
// parking it would burn the pool for nothing. These trigger the model
// fallback instead (lite ↔ flash draw from separate capacity pools).
function isCapacity(msg, status) {
  if (status === 503) return true
  const m = (msg || '').toLowerCase()
  return /high demand|overloaded|temporarily unavailable/.test(m)
}

// One slow key must not stall the whole pool, but real quiz generation
// (JSON, thousands of output tokens) routinely needs >12s — 12s killed every
// attempt mid-stream, burned the whole key list, then surfaced as 502/error.
const KEY_TIMEOUT_MS = 25_000

async function callGemini(model, key, payload) {
  let res
  try {
    res = await fetch(`${GEMINI_ENDPOINT_BASE}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(KEY_TIMEOUT_MS)
    })
  } catch (err) {
    const msg = String(err?.message || err || '')
    // Record the failed attempt
    recordKeyUsage(key, false);
    // Timeout means the model (or network) is slow for this payload — not a
    // per-key problem. Rotating through every remaining key just multiplies
    // the wait and the client aborts first. Stop after the first timeout.
    if (err?.name === 'TimeoutError' || /timeout|abort/i.test(msg)) {
      return { stop: true, networkError: msg || 'timeout' }
    }
    return { networkError: msg }
  }
  if (!res.ok) {
    let msg = `gemini_http_${res.status}`
    try { const b = await res.json(); msg = b?.error?.message || msg } catch { /* keep */ }
    if (isCapacity(msg, res.status)) return { capacity: msg }
    if (isQuota(msg, res.status)) { gemMarkThrottled(key); recordKeyUsage(key, false); return { error: msg } }
    recordKeyUsage(key, false);
    return { fatal: msg }
  }
  const data = await res.json()
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') ?? ''
  // Record the successful attempt
  recordKeyUsage(key, true);
  return { text }
}

async function handleGemini(request, sec) {
  let body
  try {
    body = await request.json()
  } catch {
    return fail(400, 'invalid_json', sec)
  }
  const prompt = body.prompt
  const images = Array.isArray(body.images) ? body.images : []
  const json = body.json !== false
  const maxOutputTokens = Number(body.maxOutputTokens) || 2048
  const temperature = typeof body.temperature === 'number' ? body.temperature : 0.4
  // Expected top-level JSON shape: 'array' (question authoring — parsed with
  // extractJSONArray) or 'object' (everything else). Anything else (or an
  // absent shape) keeps the historical object behaviour.
  const shape = body.shape === 'array' ? 'array' : 'object'

  const parts = [{ text: prompt }]
  for (const im of images) {
    if (im?.data && im?.mimeType) parts.push({ inlineData: { mimeType: im.mimeType, data: im.data } })
  }
  // Optional strict JSON schema (Gemini structured output) — when present it
  // forces responseMimeType too, since the API requires the pair.
  const schema = body.responseSchema && typeof body.responseSchema === 'object' ? body.responseSchema : null
  const payload = {
    contents: [{ parts }],
    generationConfig: {
      temperature,
      maxOutputTokens,
      ...(schema
        ? { responseMimeType: 'application/json', responseSchema: schema }
        : json ? { responseMimeType: 'application/json' } : {})
    }
  }

  const personal = (request.headers.get('x-quizard-key') || '').trim().slice(0, 300) || null
  const groqAvailable = getGroqKeys().length > 0
  if (!getGemKeys().length && !personal && !groqAvailable) {
    return fail(503, 'no_keys_configured', sec)
  }

  let groqTried = false
  if (shape === 'array' && images.length === 0 && groqAvailable) {
    groqTried = true
    const fast = await callGroq(prompt, Math.min(maxOutputTokens, 8192), temperature, json, shape)
    if (fast?.text) return ok(fast.text, sec)
  }

  const model = getGemModel()
  const combos = gemCombo(personal)
  let lastErr = null
  let quotaSeen = false
  let capacitySeen = false
  // One pass across every live key on the given model. Returns the answer
  // text, or null when every key failed (lastErr/quotaSeen/capacitySeen say why).
  const runPool = async (modelName) => {
    for (const key of combos) {
      if (gemIsThrottled(key)) continue
      const r = await callGemini(modelName, key, payload)
      if (r.stop) { lastErr = r.networkError; break }
      if (r.networkError) { lastErr = r.networkError; continue }
      // One bad or exhausted key must never poison the rest of the pool:
      // park it briefly and try the next one. Only when every key has failed
      // do we answer with an error.
      if (r.capacity) { lastErr = r.capacity; capacitySeen = true; continue }
      if (r.error) { lastErr = r.error; quotaSeen = true; continue }
      if (r.fatal) { lastErr = r.fatal; gemMarkThrottled(key); continue }
      return r.text
    }
    return null
  }
  let text = await runPool(model)
  // Primary model out of capacity (503 high demand)? The keys are fine —
  // retry the same request on the sibling model (lite ↔ flash) once.
  if (text == null && capacitySeen) {
    text = await runPool(getFallbackModel(model))
  }
  if (text == null && !groqTried) {
    const g = await callGroq(prompt, Math.min(maxOutputTokens, 8192), temperature, json, shape)
    if (g?.text) return ok(g.text, sec)
  }
  if (text != null) return ok(text, sec)
  if (quotaSeen) return fail(429, lastErr || 'all_keys_throttled', sec)
  // Upstream timeout / non-quota failure: 502 so clients can map it to a
  // busy/retryable state instead of a generic unknown error.
  if (/timeout|abort/i.test(String(lastErr || ''))) return fail(504, 'upstream_timeout', sec)
  return fail(502, lastErr || 'all_keys_throttled', sec)
}

// ── Groq fallback provider (gpt-oss, OpenAI-compatible) ──
// Used only when every Gemini attempt failed (quota, capacity or upstream
// timeout). Groq's infrastructure is independent of Google's, so its bad
// days never line up with Gemini's. GROQ_API_KEY may hold several keys
// (comma/newline separated, one per Groq account — limits are per
// organization, so extra keys from the same account add nothing); a key
// that answers 429 is parked for 60s while the rest take over.
const groqThrottled = new Map()

function getGroqKeys() {
  return (env.GROQ_API_KEY || '').split(/[\n\r,]+/).map(k => k.trim()).filter(Boolean)
}
function groqIsThrottled(key) {
  const exp = groqThrottled.get(key)
  if (!exp) return false
  if (Date.now() > exp) { groqThrottled.delete(key); return false }
  return true
}
function groqMarkThrottled(key) { groqThrottled.set(key, Date.now() + THROTTLE_MS) }

// Enhanced key cycling for Groq keys too
let groqLastUsedKeyIndex = 0;

function getGroqKeyOrder() {
  const keys = getGroqKeys();
  const live = keys.filter(k => !groqIsThrottled(k));
  const parked = keys.filter(k => groqIsThrottled(k));
  
  // Rotate the starting position for better load distribution
  if (live.length > 0) {
    groqLastUsedKeyIndex = (groqLastUsedKeyIndex + 1) % Math.max(1, live.length);
    const rotatedLive = [
      ...live.slice(groqLastUsedKeyIndex),
      ...live.slice(0, groqLastUsedKeyIndex)
    ];
    return [...rotatedLive, ...parked];
  }
  
  return [...live, ...parked];
}

async function callGroq(prompt, maxOutputTokens, temperature, json, shape = 'object') {
  const keys = getGroqKeys()
  if (!keys.length) return null
  const model = (env.GROQ_MODEL || 'openai/gpt-oss-120b').trim()
  // gpt-oss is a reasoning model: it spends completion tokens thinking before
  // it answers, so a small max_tokens comes back with empty content (all
  // budget eaten by reasoning). Keep the effort low and guarantee a budget
  // that always leaves room for the actual answer.
  const isReasoner = /gpt-oss/i.test(model)
  const budget = Math.max(isReasoner ? 2048 : 256, maxOutputTokens)
  // Array callers (question authoring) parse a top-level JSON array, which
  // json_object mode forbids outright — it coerces the reply into an object
  // (or 400s array-shaped answers as failed_generation), and the client then
  // parses the wreckage into zero usable questions. So array requests go out
  // with NO response_format: the prompt already says "Reply ONLY with a JSON
  // array", and the reply is verified to contain one before it is accepted.
  const wantArray = json && shape === 'array'
  // Groq's json_object mode hard-requires the word "json" in the messages —
  // otherwise it 400s instantly. Every generation prompt mentions JSON, but a
  // caller that relies on the relay's default (json !== false) might not, so
  // make the request self-sufficient.
  const groqPrompt = !wantArray && json && !/json/i.test(prompt) ? prompt + '\n\nRespond with valid JSON.' : prompt
  const order = getGroqKeyOrder()
  let lastErr = null
  for (const key of order) {
    let res
    try {
      res = await fetch(GROQ_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: groqPrompt }],
          temperature,
          max_tokens: budget,
          ...(isReasoner ? { reasoning_effort: 'low' } : {}),
          ...(!wantArray && json ? { response_format: { type: 'json_object' } } : {})
        }),
        signal: AbortSignal.timeout(KEY_TIMEOUT_MS)
      })
    } catch (err) {
      lastErr = String(err?.message || err || 'groq_error')
      recordKeyUsage(key, false);
      continue
    }
    if (!res.ok) {
      let msg = `groq_http_${res.status}`
      try { const b = await res.json(); msg = b?.error?.message || msg } catch { /* keep */ }
      // Strict object-mode JSON rejects the ENTIRE completion when the model's
      // answer isn't parseable JSON ("failed_generation"). One retry with a
      // blunt JSON-only instruction usually un-sticks the model. (Array
      // requests never set response_format, so this error can't occur for
      // them — their shape is verified on success below instead.)
      if (!wantArray && json && res.status === 400 && /failed_generation|generate json/i.test(msg)) {
        try {
          const retry = await fetch(GROQ_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({
              model,
              messages: [{ role: 'user', content: groqPrompt + '\n\nIMPORTANT: Your ENTIRE reply must be one valid JSON object. No prose, no markdown, nothing outside the JSON.' }],
              temperature,
              max_tokens: budget,
              ...(isReasoner ? { reasoning_effort: 'low' } : {}),
              response_format: { type: 'json_object' }
            }),
            signal: AbortSignal.timeout(KEY_TIMEOUT_MS)
          })
          if (retry.ok) {
            const rd = await retry.json().catch(() => null)
            const rt = rd?.choices?.[0]?.message?.content ?? ''
            if (rt) { 
              recordKeyUsage(key, true);
              return { text: rt } 
            }
          }
        } catch { 
          recordKeyUsage(key, false);
          /* fall through to the error path */ 
        }
      }
      lastErr = msg
      // Rate limited on this account: park the key, let the next one through.
      if (res.status === 429 || /rate[\s_-]?limit|quota|too many requests/i.test(msg)) {
        groqMarkThrottled(key)
        recordKeyUsage(key, false);
        continue
      }
      // Auth/other hard errors are key-specific too, but a 401 is likely a
      // bad key — skip it rather than returning failure while others remain.
      if (res.status === 401 || res.status === 403) {
        recordKeyUsage(key, false);
        continue
      }
      recordKeyUsage(key, false);
      return { error: msg }
    }
    const data = await res.json().catch(() => null)
    let text = data?.choices?.[0]?.message?.content ?? ''
    // Array contract: the reply must contain a JSON array, otherwise the
    // client's extractJSONArray yields nothing and the whole fallback was
    // wasted. One retry with a blunt array-only instruction, mirroring the
    // object-mode retry above (failure-path only — never on success).
    if (wantArray && !/\[[\s\S]*\]/.test(text)) {
      try {
        const retry = await fetch(GROQ_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: groqPrompt + '\n\nIMPORTANT: Your ENTIRE reply must be one valid JSON array. No prose, no markdown, nothing outside the array.' }],
            temperature,
            max_tokens: budget,
            ...(isReasoner ? { reasoning_effort: 'low' } : {})
          }),
          signal: AbortSignal.timeout(KEY_TIMEOUT_MS)
        })
        if (retry.ok) {
          const rd = await retry.json().catch(() => null)
          const rt = rd?.choices?.[0]?.message?.content ?? ''
          if (rt) text = rt
        }
      } catch { 
        recordKeyUsage(key, false);
        /* fall through with the original text */ 
      }
    }
    recordKeyUsage(key, true);
    return { text: text || null }
  }
  return { error: lastErr || 'groq_error' }
}

// ── Web page extraction (public pages → study text) ──
// The browser cannot read cross-origin pages (CORS), so the worker fetches
// and strips the HTML. Public article-style pages only: logged-in walls and
// JS-only apps yield nothing readable and the client says so.
const EXTRACT_MAX_BYTES = 2 * 1024 * 1024

function json(payload, sec) {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json', ...sec } })
}

async function handleExtract(request, sec) {
  let body
  try { body = await request.json() } catch { return fail(400, 'invalid_json', sec) }
  const url = String(body?.url || '').trim()
  if (!/^https?:\/\/.+/i.test(url) || url.length > 2048) return fail(400, 'bad_url', sec)

  // YouTube links take the transcript path: captions are the study text.
  const ytId = youTubeVideoId(url)
  if (ytId) return handleYouTube(ytId, sec)

  let res
  try {
    res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; QuizardStudyBot/1.0; +https://quizard-checker.github.io)',
        'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
        'Accept-Language': 'en-US, en;q=0.9, *;q=0.5'
      }
    })
  } catch (err) {
    return fail(504, 'fetch_failed: ' + String(err?.message || err || '').slice(0, 80), sec)
  }
  if (!res.ok) return fail(502, `site_http_${res.status}`, sec)

  const ct = (res.headers.get('content-type') || '').toLowerCase()
  if (/^text\/plain|^application\/(json|ld\+json)/.test(ct)) {
    const raw = (await res.text()).slice(0, EXTRACT_MAX_BYTES)
    if (raw.replace(/\s+/g, '').length < 80) return fail(422, 'no_readable_text', sec)
    return json({ title: '', text: raw, words: (raw.match(/\S+/g) || []).length }, sec)
  }
  if (!/text\/html|application\/xhtml/.test(ct)) return fail(415, 'unsupported_content_type', sec)

  // HTMLRewriter drops non-content containers with their subtrees before we
  // strip tags in lib.js (keeps nav junk out of the study text). Title comes
  // from the raw HTML first — cleanup may remove the element holding the h1.
  let html = await res.text()
  if (html.length > EXTRACT_MAX_BYTES) html = html.slice(0, EXTRACT_MAX_BYTES)
  const title = pickTitle(html).slice(0, 120)
  let rewriterError = null
  try {
    const cleaned = new HTMLRewriter()
      .on('script,style,noscript,template,svg,iframe,nav,aside,form,footer,header,menu,[role="navigation"],[role="banner"],[role="search"],[role="complementary"],[aria-hidden="true"]' +
        ',.reflist,.refbegin,.mw-references-wrap,.navbox,.infobox,.catlinks,.side-box,.sistersitebox,.metadata,.mw-editsection,sup.reference,.mw-jump-link,.ambox', {
        element(e) { e.remove() }
      })
      .transform(new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }))
    const cleanedHtml = await cleaned.text()
    if (cleanedHtml && cleanedHtml.length > 200) html = cleanedHtml
  } catch (err) {
    rewriterError = String(err?.message || err || '').slice(0, 120)
  }

  const text = htmlToText(html, { maxChars: 400_000 })
  if (text.replace(/\s+/g, '').length < 80) return fail(422, 'no_readable_text', sec)
  const out = { title, text, words: (text.match(/\S+/g) || []).length }
  if (body?.debug) out.debug = { rewriterError, rawLen: html.length }
  return json(out, sec)
}

// ── YouTube transcript extraction ──
// YouTube rate-limits datacenter IPs on watch pages, so the player response
// is fetched via the InnerTube ANDROID client first, watch-page HTML second.
// The best caption track (English human → English asr → any) is flattened
// into readable lines; the transcript becomes an ordinary document so the
// same reviewer/quiz pipeline and formats apply as for uploaded files.
const YT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
// Public InnerTube key used by the official Android client.
const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'

async function fetchYouTubePlayer(videoId) {
  try {
    const r = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
        'X-Youtube-Client-Name': '5',
        'X-Youtube-Client-Version': '20.10.4',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      body: JSON.stringify({
        context: { client: { clientName: 'IOS', clientVersion: '20.10.4', deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.3.2.22D82', hl: 'en', gl: 'US', utcOffsetMinutes: 0 } },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true
      }),
      signal: AbortSignal.timeout(20_000)
    })
    if (r.ok) {
      const j = await r.json()
      if (j?.captions || j?.playabilityStatus?.status === 'OK') return { pr: j, via: 'innertube' }
    }
  } catch { /* fall through to the watch page */ }
  try {
    const r = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en&bpctr=9999999999&has_verified=1`, {
      headers: { 'User-Agent': YT_UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+cb' },
      signal: AbortSignal.timeout(20_000)
    })
    if (r.ok) {
      const pr = extractPlayerResponse(await r.text())
      if (pr) return { pr, via: 'watch' }
    }
  } catch { /* handled below */ }
  return {}
}

async function handleYouTube(videoId, sec) {
  const { pr, via } = await fetchYouTubePlayer(videoId)
  const track = pickCaptionTrack(pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks)
  if (!track?.baseUrl) {
    const status = String(pr?.playabilityStatus?.status || '')
    if (status === 'LOGIN_REQUIRED') return fail(422, 'yt_login_required', sec)
    return fail(via ? 422 : 502, via ? 'no_captions' : 'youtube_unreachable', sec)
  }

  const capHeaders = { 'User-Agent': YT_UA, 'Accept-Language': 'en-US,en;q=0.9' }
  let capText = ''
  try {
    const j3 = await fetch(track.baseUrl + '&fmt=json3', { headers: capHeaders, signal: AbortSignal.timeout(20_000) })
    if (j3.ok) capText = json3ToText(await j3.text())
  } catch { /* fall through to the XML form */ }
  if (!capText) {
    try {
      const xml = await fetch(track.baseUrl, { headers: capHeaders, signal: AbortSignal.timeout(20_000) })
      if (xml.ok) capText = timedXmlToText(await xml.text())
    } catch { /* handled below */ }
  }
  if (capText.replace(/\s+/g, '').length < 80) return fail(422, 'no_captions', sec)

  const title = String(pr?.videoDetails?.title || '').slice(0, 120) || 'YouTube video'
  const author = String(pr?.videoDetails?.author || '')
  const header = author ? `${title}\n${author}\n\n` : `${title}\n\n`
  const text = header + capText
  return json({ title, text, words: (text.match(/\S+/g) || []).length, kind: 'youtube' }, sec)
}

// ── Sync locker (encrypted library snapshots) ──
// op 'status' — does this code have a locker? (no verifier needed)
// op 'push'   — upsert the snapshot; existing lockers only accept a matching
//               verifier, so a claimed code can't be hijacked
// op 'pull'   — hand out the snapshot to whoever holds code + verifier
// The verifier is a SHA-256 of code+passphrase computed on the client: the
// passphrase itself never crosses the network, and the blob is AES-GCM
// ciphertext the worker cannot read.
const SYNC_TTL_SECONDS = 180 * 24 * 3600
const SYNC_MAX_BLOB = 8_000_000
const SYNC_CODE_RE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/

function normalizeSyncCode(v) {
  const raw = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return raw.length === 8 ? raw.slice(0, 4) + '-' + raw.slice(4) : raw
}

async function handleSync(request, sec) {
  const kv = env.SYNC
  if (!kv?.get) return fail(503, 'sync_not_configured', sec)
  let body
  try { body = await request.json() } catch { return fail(400, 'invalid_json', sec) }
  const op = String(body?.op || '')
  const code = normalizeSyncCode(body?.code)
  if (!SYNC_CODE_RE.test(code)) return fail(400, 'bad_code', sec)
  const verifier = String(body?.verifier || '')
  if (op !== 'status' && !/^[0-9a-f]{64}$/.test(verifier)) return fail(400, 'bad_verifier', sec)
  const key = 'sync:' + code

  if (op === 'status') {
    const rec = await kv.get(key, 'json')
    return json({ exists: !!rec, updatedAt: rec?.updatedAt || null, docs: rec?.docs ?? null }, sec)
  }
  if (op === 'push') {
    const blob = String(body?.blob || '')
    if (!blob) return fail(400, 'empty_blob', sec)
    if (blob.length > SYNC_MAX_BLOB) return fail(413, 'blob_too_large', sec)
    // Optional newVerifier: a password change. The request must still be
    // authorized with the CURRENT verifier; the replacement replaces it, so
    // the old password stops working everywhere immediately.
    let newVerifier = null
    if (body?.newVerifier != null) {
      newVerifier = String(body.newVerifier)
      if (!/^[0-9a-f]{64}$/.test(newVerifier)) return fail(400, 'bad_verifier', sec)
    }
    const existing = await kv.get(key, 'json')
    if (existing?.verifier && existing.verifier !== verifier) return fail(403, 'code_pass_mismatch', sec)
    const rec = {
      verifier: newVerifier || verifier,
      blob,
      docs: Number(body?.docs) || null,
      words: Number(body?.words) || null,
      updatedAt: new Date().toISOString()
    }
    await kv.put(key, JSON.stringify(rec), { expirationTl: SYNC_TTL_SECONDS })
    return json({ ok: true, updatedAt: rec.updatedAt }, sec)
  }
  if (op === 'pull') {
    const rec = await kv.get(key, 'json')
    if (!rec) return fail(404, 'code_not_found', sec)
    if (rec.verifier !== verifier) return fail(403, 'bad_pass', sec)
    return json({ blob: rec.blob, docs: rec.docs, words: rec.words, updatedAt: rec.updatedAt }, sec)
  }
  return fail(400, 'bad_op', sec)
}

// ── Fish Audio wizard voice ──
async function handleTts(request, sec) {
  const key = (env.FISH_API_KEY || '').trim()
  const voiceId = (env.FISH_VOICE_ID || '').trim()
  if (!key || !voiceId) {
    return fail(503, 'fish_not_configured', sec)
  }
  let body
  try {
    body = await request.json()
  } catch {
    return fail(400, 'invalid_json', sec)
  }
  const text = String(body.text || '').slice(0, 2000).trim()
  if (!text) return fail(400, 'empty_text', sec)
  const speed = Math.min(2, Math.max(0.5, Number(body.speed) || 0.95))

  // Fish Audio's free tier occasionally answers 503/429 — retry briefly.
  let res = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      res = await fetch(FISH_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          model: (env.FISH_MODEL || 's2.1-pro-free').trim()
        },
        body: JSON.stringify({
          text,
          reference_id: voiceId,
          format: 'mp3',
          prosody: { speed, volume: 0 }
        })
      })
      if (res.ok) break
      if (attempt < 3 && (res.status === 503 || res.status === 429)) {
        await new Promise(r => setTimeout(r, 900 * attempt))
        continue
      }
      return fail(502, `fish_error_${res.status}`, sec)
    } catch {
      if (attempt === 3) return fail(502, 'fish_unreachable', sec)
      await new Promise(r => setTimeout(r, 900 * attempt))
    }
  }
  return new Response(res.body, {
    status: 200,
    headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, max-age=86400', ...sec }
  })
}

// ── Docs ratings ──
// One anonymous rating per browser id, stored in the same KV namespace as the
// sync locker under a different prefix. The aggregate is a five-slot count
// array so reading the average costs one KV read. This is a low-traffic docs
// page; a rare concurrent write can lose one vote, which is acceptable here.
const RATING_SUMMARY_KEY = 'ratings:summary'
const RATING_CLIENT_RE = /^[A-Za-z0-9_-]{8,64}$/

function ratingCounts(raw) {
  return Array.isArray(raw) && raw.length === 5
    ? raw.map(n => Math.max(0, Number(n) || 0))
    : [0, 0, 0, 0, 0]
}

function ratingPayload(raw) {
  const counts = ratingCounts(raw)
  const count = counts.reduce((a, b) => a + b, 0)
  const sum = counts.reduce((total, n, i) => total + n * (i + 1), 0)
  return {
    average: count ? Math.round((sum / count) * 10) / 10 : 0,
    count,
    counts
  }
}

async function handleRatings(request, sec, method) {
  const kv = env.SYNC
  if (!kv?.get) return fail(503, 'ratings_not_configured', sec)
  if (method === 'GET') {
    const stored = await kv.get(RATING_SUMMARY_KEY, 'json')
    return json(ratingPayload(stored?.counts), sec)
  }

  let body
  try { body = await request.json() } catch { return fail(400, 'invalid_json', sec) }
  const stars = Number(body?.stars)
  const clientId = String(body?.clientId || '')
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return fail(400, 'bad_stars', sec)
  if (!RATING_CLIENT_RE.test(clientId)) return fail(400, 'bad_client', sec)

  const key = 'rating:' + clientId
  const prior = await kv.get(key, 'json')
  const stored = await kv.get(RATING_SUMMARY_KEY, 'json')
  const counts = ratingPayload(stored?.counts).counts
  // A browser changing its rating updates the tally instead of adding a vote.
  if (prior?.stars >= 1 && prior.stars <= 5) {
    counts[prior.stars - 1] = Math.max(0, counts[prior.stars - 1] - 1)
  }
  counts[stars - 1]++

  await kv.put(key, JSON.stringify({ stars, at: new Date().toISOString() }))
  await kv.put(RATING_SUMMARY_KEY, JSON.stringify({ counts }))
  return json({ ...ratingPayload(counts), yourRating: stars }, sec)
}

function ok(text, headers = {}) {
  return new Response(text, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...headers } })
}
function fail(status, msg, headers = {}) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

// Periodic cleanup flag
let lastCleanupTime = 0;
const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour

export default {
  async fetch(request, workerEnv) {
    env = workerEnv
    const origin = request.headers.get('origin')
    const sec = corsHeaders(origin)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: sec })
    if (!isAllowedOrigin(origin)) return fail(403, 'origin_not_allowed', sec)

    // Periodic cleanup of key usage stats
    const now = Date.now();
    if (now - lastCleanupTime > CLEANUP_INTERVAL) {
      cleanupKeyUsageStats();
      lastCleanupTime = now;
    }

    const route = (new URL(request.url).pathname.replace(/\/+$/, '').split('/').pop() || '').toLowerCase()
    if (route === 'ratings') {
      // Public, anonymous docs ratings. GET is the average; POST records one
      // browser's rating and returns the updated average.
      if (request.method === 'GET') {
        if (rateLimit(clientIp(request), 60) === false) return fail(429, 'rate_limited', sec)
        return handleRatings(request, sec, 'GET')
      }
      if (request.method === 'POST') {
        if (rateLimit(clientIp(request), 10) === false) return fail(429, 'rate_limited', sec)
        if (tooLarge(request, 2000)) return fail(413, 'payload_too_large', sec)
        return handleRatings(request, sec, 'POST')
      }
      return fail(405, 'method_not_allowed', sec)
    }
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: sec })
    if (route === 'gemini') {
      if (rateLimit(clientIp(request), 40) === false) return fail(429, 'rate_limited', sec)
      if (tooLarge(request)) return fail(413, 'payload_too_large', sec)
      return handleGemini(request, sec)
    }
    if (route === 'extract') {
      // Public page → clean text for the study pipeline (the browser cannot
      // read cross-origin pages itself). Cheap: no AI involved.
      if (rateLimit(clientIp(request), 30) === false) return fail(429, 'rate_limited', sec)
      return handleExtract(request, sec)
    }
    if (route === 'sync') {
      // Sync locker: end-to-end encrypted library snapshots keyed by a random
      // code. The worker stores ciphertext + a passphrase verifier — it can
      // neither read a library nor accept overwrites without the verifier.
      if (rateLimit(clientIp(request), 30) === false) return fail(429, 'rate_limited', sec)
      return handleSync(request, sec)
    }
    if (route === 'tts') {
      if (rateLimit(clientIp(request), 60) === false) return fail(429, 'rate_limited', sec)
      if (tooLarge(request, 100_000)) return fail(413, 'payload_too_large', sec)
      return handleTts(request, sec)
    }
    return fail(404, 'unknown_route', sec)
  }
}
