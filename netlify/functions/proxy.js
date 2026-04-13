import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const body = JSON.parse(event.body);

    // ── ROUTE: validate-code ─────────────────────────────────────────────
    // Called by the InviteGate — validates access_code against DB
    // Returns org info so frontend never needs VITE_ORG_ID
    if (body.action === 'validate-code') {
      const { access_code } = body;
      if (!access_code) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'access_code is required' }),
        };
      }

      const { data, error } = await supabase
        .from('organizations')
        .select('id, name, plan, credits_remaining, credits_total, is_active')
        .eq('access_code', access_code.trim().toUpperCase())
        .single();

      if (error || !data) {
        return {
          statusCode: 401,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'Invalid access code. Contact us to request access.' }),
        };
      }

      if (!data.is_active) {
        return {
          statusCode: 403,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'This account has been suspended. Please contact support.' }),
        };
      }

      // Update last_used_at on login
      await supabase
        .from('organizations')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', data.id);

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          org_id: data.id,
          org_name: data.name,
          plan: data.plan,
          credits_remaining: data.credits_remaining,
          credits_total: data.credits_total,
        }),
      };
    }

    // ── ROUTE: refresh-credits ───────────────────────────────────────────
    // Called by the status bar to get latest credit balance
    if (body.action === 'refresh-credits') {
      const { org_id } = body;
      if (!org_id) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'org_id is required' }),
        };
      }

      const { data, error } = await supabase
        .from('organizations')
        .select('name, plan, credits_remaining, credits_total, is_active')
        .eq('id', org_id)
        .single();

      if (error || !data) {
        return {
          statusCode: 404,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'Organization not found' }),
        };
      }

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          org_name: data.name,
          plan: data.plan,
          credits_remaining: data.credits_remaining,
          credits_total: data.credits_total,
          is_active: data.is_active,
        }),
      };
    }

    // ── ROUTE: Anthropic proxy (default) ────────────────────────────────
    const { org_id, model, max_tokens, messages, system } = body;

    // ── 1. Credit check ──────────────────────────────────────────────────
    let org = null;
    if (org_id) {
      const { data, error: fetchError } = await supabase
        .from('organizations')
        .select('id, name, credits_remaining, is_active')
        .eq('id', org_id)
        .single();

      if (fetchError || !data) {
        return {
          statusCode: 404,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'Organization not found. Check your org_id.' }),
        };
      }

      if (!data.is_active) {
        return {
          statusCode: 403,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'Organization account is suspended.' }),
        };
      }

      if (data.credits_remaining <= 0) {
        return {
          statusCode: 402,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            error: 'Insufficient credits. Please contact us to top up your account.',
            credits_remaining: 0,
          }),
        };
      }

      org = data;
    }

    // ── 2. Anthropic API call ────────────────────────────────────────────
    const params = {
      model: model || 'claude-haiku-4-5-20251001',
      max_tokens: max_tokens || 1024,
      messages: messages,
    };
    if (system) params.system = system;

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(params),
    });

    if (!anthropicRes.ok) {
      const errBody = await anthropicRes.text();
      console.error('Anthropic API error:', anthropicRes.status, errBody);
      return {
        statusCode: anthropicRes.status,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: { message: errBody } }),
      };
    }

    const msg = await anthropicRes.json();

    // ── 3. Deduct credit + log usage ─────────────────────────────────────
    if (org) {
      const newBalance = org.credits_remaining - 1;

      await supabase
        .from('organizations')
        .update({
          credits_remaining: newBalance,
          last_used_at: new Date().toISOString(),
        })
        .eq('id', org.id);

      await supabase.from('usage_log').insert({
        org_id: org.id,
        model: params.model,
        input_tokens: msg.usage?.input_tokens || 0,
        output_tokens: msg.usage?.output_tokens || 0,
        credits_used: 1,
        endpoint: 'proxy',
      });

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          content: msg.content,
          usage: msg.usage,
          credits_remaining: newBalance,
        }),
      };
    }

    // No org_id — dev/internal passthrough (no billing)
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ content: msg.content, usage: msg.usage }),
    };

  } catch (err) {
    console.error('Proxy Error:', err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: { message: err.message || 'Internal server error' } }),
    };
  }
};
