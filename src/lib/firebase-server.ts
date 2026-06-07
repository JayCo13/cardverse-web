const FIREBASE_LOOKUP_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup';

type FirebaseLookupResponse = {
    users?: Array<{
        phoneNumber?: string;
    }>;
};

export async function verifyFirebasePhoneIdToken(idToken: string) {
    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    if (!apiKey) {
        throw new Error('Firebase API key is not configured');
    }

    const response = await fetch(`${FIREBASE_LOOKUP_URL}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
    });

    const data = await response.json().catch(() => ({})) as FirebaseLookupResponse & { error?: { message?: string } };
    if (!response.ok) {
        throw new Error(data.error?.message || 'Failed to verify Firebase ID token');
    }

    const phoneNumber = data.users?.[0]?.phoneNumber;
    if (!phoneNumber) {
        throw new Error('Verified Firebase token does not contain a phone number');
    }

    return phoneNumber;
}
