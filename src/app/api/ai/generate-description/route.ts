import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

// Generate an English marketplace description for a card listing from the
// attributes the seller already filled in. Groq (OpenAI-compatible) text model.
export async function POST(req: NextRequest) {
    const groqApiKey = process.env.GROQ_API_KEY;
    if (!groqApiKey) {
        return NextResponse.json({ error: 'GROQ_API_KEY not configured' }, { status: 500 });
    }

    // Require an authenticated user (sellers only reach this form anyway).
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const {
        name, category, publisher, setName, season, condition, cardNumber,
        language, gradingCompany, grade, finish, isBundle, quantity,
    } = body || {};

    const facts = [
        name && `Title: ${name}`,
        category && `Category: ${category}`,
        publisher && `Publisher: ${publisher}`,
        setName && `Set / Collection: ${setName}`,
        season && `Season: ${season}`,
        cardNumber && `Card number: ${cardNumber}`,
        language && `Language: ${language === 'jp' ? 'Japanese' : 'English'}`,
        condition && `Condition: ${condition}`,
        gradingCompany && gradingCompany !== 'raw' && `Graded: ${String(gradingCompany).toUpperCase()}${grade ? ` ${grade}` : ''}`,
        finish && finish !== 'normal' && `Finish: ${finish}`,
        isBundle && `This is a bundle / lot containing ${quantity || 'multiple'} cards.`,
    ].filter(Boolean).join('\n');

    if (!facts.trim()) {
        return NextResponse.json({ error: 'no_facts', message: 'Fill in the card details first.' }, { status: 400 });
    }

    const prompt = `You write product descriptions for a trading-card marketplace. Using ONLY the facts below, write ONE listing description in ENGLISH.

Rules:
- About 100 characters. Never more than 160.
- One sentence, plain text. No markdown, no headings, no bullets, no emojis, no quotes.
- Use only plain ASCII hyphens and apostrophes.
- Name what it is and what stands out: the player or title, the set, the season, the condition or grade.
- Do NOT invent any fact that is not listed. Do NOT mention or guess a price.

Facts:
${facts}`;

    /**
     * Groq retires models on short notice, and the previous hardcoded one
     * (llama-3.3-70b-versatile) had been decommissioned — every request came
     * back 404 model_not_found while the UI reported a generic failure. The
     * list is tried in order so one retirement degrades quality rather than
     * breaking the feature, and the name can be overridden without a deploy.
     */
    const models = [
        process.env.GROQ_TEXT_MODEL,
        'openai/gpt-oss-20b',
        'qwen/qwen3.8-27b',
        'groq/compound-mini',
    ].filter(Boolean) as string[];

    let lastDetail = '';

    for (const model of models) {
        try {
            const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqApiKey}` },
                body: JSON.stringify({
                    model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.6,
                    // Generous next to a ~100-character answer on purpose. These
                    // are reasoning models: they spend tokens thinking before
                    // they write, and a budget sized to the answer is consumed
                    // entirely by the thinking, returning finish_reason
                    // "length" with an empty message.
                    max_tokens: 400,
                    reasoning_effort: 'low',
                }),
                signal: AbortSignal.timeout(8_000),
            });

            if (!res.ok) {
                lastDetail = `${model}: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`;
                console.error('[AI] generate-description rejected —', lastDetail);
                continue;
            }

            const data = await res.json();
            const choice = data?.choices?.[0];
            const description = normalise(choice?.message?.content || '');

            if (!description) {
                lastDetail = `${model}: empty content (finish_reason=${choice?.finish_reason})`;
                console.error('[AI] generate-description returned nothing —', lastDetail);
                continue;
            }

            return NextResponse.json({ description });
        } catch (error) {
            lastDetail = `${model}: ${(error as Error)?.message || 'request failed'}`;
            console.error('[AI] generate-description request failed —', lastDetail);
        }
    }

    // The seller cannot act on which model died, but the operator must be able
    // to tell a retired model from a bad key without reproducing it.
    console.error('[AI] generate-description exhausted every model. Last:', lastDetail);
    return NextResponse.json({ error: 'ai_failed' }, { status: 502 });
}

/**
 * Models reach for typographic characters — non-breaking hyphens, curly quotes,
 * em dashes — which survive into the listing and look like mojibake once the
 * text is echoed somewhere with a different font. Fold them back to ASCII and
 * flatten any line breaks, since this is meant to be one sentence.
 */
function normalise(raw: string) {
    return raw
        .replace(/[\u2010-\u2015\u2212]/g, '-')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/\s+/g, ' ')
        .replace(/^["']|["']$/g, '')
        .trim();
}
