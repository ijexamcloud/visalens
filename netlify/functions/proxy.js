import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

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
    const { org_id, model, max_tokens, messages, system } = body;

    // ── 1. Credit check ─────────────────────────────────────────────────
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
            error: 'Insufficient credits. Please top up your account.',
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

    const msg = await anthropic.messages.create(params);

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
