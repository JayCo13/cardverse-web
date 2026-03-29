import { NextRequest, NextResponse } from 'next/server';

// AI-powered KYC verification: Cross-check CCCD name with Bank app screenshot
export async function POST(request: NextRequest) {
    try {
        const { cccd_image, bank_image } = await request.json();
        if (!cccd_image) return NextResponse.json({ error: 'Missing CCCD image' }, { status: 400 });
        if (!bank_image) return NextResponse.json({ error: 'Missing Bank screenshot' }, { status: 400 });

        const groqApiKey = process.env.GROQ_API_KEY;
        if (!groqApiKey) return NextResponse.json({ error: 'GROQ_API_KEY not configured' }, { status: 500 });

        const cccdPrompt = `You are a Vietnamese ID card (CCCD/CMND) analyzer. Look at this image of a Vietnamese Citizen Identity Card (Căn Cước Công Dân).

Extract the following information and return ONLY a valid JSON object:
1. "full_name": The full name on the card (Họ và tên). Read the Vietnamese text carefully with diacritics.
2. "id_number": The 12-digit ID number (Số CCCD / Số CMND)
3. "date_of_birth": Date of birth (Ngày sinh) in DD/MM/YYYY format
4. "is_valid_id": true if this appears to be a real Vietnamese CCCD/CMND, false if it looks fake, blurry, or is not an ID card

Example: {"full_name":"NGUYEN VAN ANH","id_number":"079123456789","date_of_birth":"15/03/1995","is_valid_id":true}`;

        const bankPrompt = `You are analyzing a screenshot of a Vietnamese banking app showing account information.

Extract the following information and return ONLY a valid JSON object:
1. "account_holder_name": The name of the account holder (Tên chủ tài khoản / Tên tài khoản). This is usually displayed in UPPERCASE.
2. "account_number": The bank account number (Số tài khoản)
3. "bank_name": The name of the bank if visible (e.g., "Vietcombank", "MB Bank", "Techcombank")
4. "is_valid_screenshot": true if this appears to be a legitimate banking app screenshot, false if it looks edited or is not a bank app

Example: {"account_holder_name":"NGUYEN VAN ANH","account_number":"0123456789012","bank_name":"MB Bank","is_valid_screenshot":true}`;

        // Run both AI calls in parallel
        const [cccdResponse, bankResponse] = await Promise.all([
            fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${groqApiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
                    messages: [{
                        role: 'user',
                        content: [
                            { type: 'text', text: cccdPrompt },
                            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${cccd_image}` } }
                        ]
                    }],
                    max_tokens: 200,
                    temperature: 0,
                }),
            }),
            fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${groqApiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
                    messages: [{
                        role: 'user',
                        content: [
                            { type: 'text', text: bankPrompt },
                            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${bank_image}` } }
                        ]
                    }],
                    max_tokens: 200,
                    temperature: 0,
                }),
            })
        ]);

        if (!cccdResponse.ok) throw new Error(`Groq CCCD error: ${cccdResponse.status}`);
        if (!bankResponse.ok) throw new Error(`Groq Bank error: ${bankResponse.status}`);

        const cccdData = await cccdResponse.json();
        const bankData = await bankResponse.json();

        // Parse AI responses
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parseAIResponse = (data: any): any => {
            let content = data.choices?.[0]?.message?.content || '';
            content = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) content = jsonMatch[0];
            return JSON.parse(content);
        };

        let cccdResult, bankResult;
        try {
            cccdResult = parseAIResponse(cccdData);
        } catch {
            return NextResponse.json({
                error: 'Không thể đọc được ảnh CCCD. Vui lòng chụp lại rõ hơn.',
                step: 'cccd'
            }, { status: 400 });
        }

        try {
            bankResult = parseAIResponse(bankData);
        } catch {
            return NextResponse.json({
                error: 'Không thể đọc được ảnh ngân hàng. Vui lòng chụp lại rõ hơn.',
                step: 'bank'
            }, { status: 400 });
        }

        // Cross-check names
        const normalizeName = (name: string): string => {
            return name
                .toUpperCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^A-Z\s]/g, '')
                .replace(/\s+/g, ' ')
                .trim();
        };

        const cccdName = cccdResult.full_name || '';
        const bankName = bankResult.account_holder_name || '';
        const normalizedCCCD = normalizeName(cccdName);
        const normalizedBank = normalizeName(bankName);
        const isNameMatch = normalizedCCCD === normalizedBank;

        // Calculate confidence
        let confidence = 0;
        if (cccdResult.is_valid_id) confidence += 0.3;
        if (bankResult.is_valid_screenshot) confidence += 0.3;
        if (isNameMatch) confidence += 0.4;

        return NextResponse.json({
            cccd_name: cccdName,
            cccd_id_number: cccdResult.id_number || null,
            cccd_dob: cccdResult.date_of_birth || null,
            is_valid_cccd: cccdResult.is_valid_id || false,
            bank_account_name: bankName,
            bank_account_number: bankResult.account_number || '',
            bank_name_detected: bankResult.bank_name || null,
            is_valid_bank: bankResult.is_valid_screenshot || false,
            is_name_match: isNameMatch,
            confidence: Math.round(confidence * 100) / 100,
        });

    } catch (error: any) {
        console.error('AI KYC check error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}
