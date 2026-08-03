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

    const prompt = `You write product descriptions for a trading-card marketplace. Using ONLY the facts below, write an engaging, honest listing description in ENGLISH.

Rules:
- Between 300 and 550 characters (must be at least 300).
- Plain paragraphs only — no markdown, no headings, no bullet points, no emojis.
- Highlight the card's appeal, its set/edition, condition or grading, and collectibility.
- Do NOT invent any fact that is not listed. Do NOT mention or guess a price.
- Write in a confident, appealing but trustworthy tone for collectors.

Facts:
${facts}`;

    try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqApiKey}` },
            body: JSON.stringify({
                model: 'meta-llama/llama-4-scout-17b-16e-instruct',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.7,
                max_tokens: 400,
            }),
        });

        if (!res.ok) {
            const detail = await res.text().catch(() => '');
            console.error('Groq generate-description failed:', res.status, detail);
            return NextResponse.json({ error: 'ai_failed' }, { status: 502 });
        }

        const data = await res.json();
        const description = (data?.choices?.[0]?.message?.content || '').trim();
        if (!description) {
            return NextResponse.json({ error: 'empty' }, { status: 502 });
        }
        return NextResponse.json({ description });
    } catch (err: any) {
        console.error('generate-description error:', err);
        return NextResponse.json({ error: 'ai_failed' }, { status: 502 });
    }
}
