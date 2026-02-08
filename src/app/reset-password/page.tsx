"use client";

import { useState } from "react";
import { useAuth } from "@/lib/supabase/auth-provider";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Mail, ArrowLeft, CheckCircle } from "lucide-react";
import Link from "next/link";

export default function ResetPasswordPage() {
    const { resetPasswordForEmail } = useAuth();
    const [email, setEmail] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsLoading(true);

        try {
            const { error } = await resetPasswordForEmail(email);
            if (error) {
                setError(error.message);
            } else {
                setSuccess(true);
            }
        } catch (err) {
            setError("An unexpected error occurred");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <>
            <Header />
            <main className="container mx-auto px-4 py-16 min-h-[60vh] flex items-center justify-center">
                <Card className="w-full max-w-md">
                    <CardHeader className="text-center">
                        <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                            {success ? (
                                <CheckCircle className="h-6 w-6 text-green-500" />
                            ) : (
                                <Mail className="h-6 w-6 text-primary" />
                            )}
                        </div>
                        <CardTitle className="text-2xl">
                            {success ? "Check Your Email" : "Reset Password"}
                        </CardTitle>
                        <CardDescription>
                            {success
                                ? "We've sent a password reset link to your email address."
                                : "Enter your email address and we'll send you a link to reset your password."
                            }
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {success ? (
                            <div className="space-y-4">
                                <p className="text-sm text-center text-muted-foreground">
                                    Didn't receive the email? Check your spam folder or try again.
                                </p>
                                <Button
                                    variant="outline"
                                    className="w-full"
                                    onClick={() => setSuccess(false)}
                                >
                                    Try Again
                                </Button>
                                <Link href="/" className="block">
                                    <Button variant="ghost" className="w-full">
                                        <ArrowLeft className="h-4 w-4 mr-2" />
                                        Back to Home
                                    </Button>
                                </Link>
                            </div>
                        ) : (
                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="email">Email</Label>
                                    <Input
                                        id="email"
                                        type="email"
                                        placeholder="your@email.com"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        required
                                    />
                                </div>

                                {error && (
                                    <p className="text-sm text-red-500 text-center">{error}</p>
                                )}

                                <Button
                                    type="submit"
                                    className="w-full"
                                    disabled={isLoading || !email}
                                >
                                    {isLoading ? "Sending..." : "Send Reset Link"}
                                </Button>

                                <Link href="/" className="block">
                                    <Button variant="ghost" className="w-full">
                                        <ArrowLeft className="h-4 w-4 mr-2" />
                                        Back to Home
                                    </Button>
                                </Link>
                            </form>
                        )}
                    </CardContent>
                </Card>
            </main>
            <Footer />
        </>
    );
}
