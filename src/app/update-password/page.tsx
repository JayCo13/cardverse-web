"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth, useUser } from "@/lib/supabase/auth-provider";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Lock, CheckCircle, Eye, EyeOff } from "lucide-react";

export default function UpdatePasswordPage() {
    const router = useRouter();
    const { updatePassword } = useAuth();
    const { user, isLoading: isUserLoading } = useUser();

    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    // Redirect if not authenticated (no recovery session)
    useEffect(() => {
        if (!isUserLoading && !user) {
            router.push("/reset-password");
        }
    }, [user, isUserLoading, router]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (password.length < 6) {
            setError("Password must be at least 6 characters");
            return;
        }

        if (password !== confirmPassword) {
            setError("Passwords do not match");
            return;
        }

        setIsLoading(true);

        try {
            const { error } = await updatePassword(password);
            if (error) {
                setError(error.message);
            } else {
                setSuccess(true);
                // Redirect to profile after 2 seconds
                setTimeout(() => {
                    router.push("/profile");
                }, 2000);
            }
        } catch (err) {
            setError("An unexpected error occurred");
        } finally {
            setIsLoading(false);
        }
    };

    if (isUserLoading) {
        return (
            <>
                <Header />
                <main className="container mx-auto px-4 py-16 min-h-[60vh] flex items-center justify-center">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                        <p className="mt-4 text-muted-foreground">Loading...</p>
                    </div>
                </main>
                <Footer />
            </>
        );
    }

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
                                <Lock className="h-6 w-6 text-primary" />
                            )}
                        </div>
                        <CardTitle className="text-2xl">
                            {success ? "Password Updated!" : "Set New Password"}
                        </CardTitle>
                        <CardDescription>
                            {success
                                ? "Your password has been successfully updated. Redirecting..."
                                : "Enter your new password below."
                            }
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {!success && (
                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="password">New Password</Label>
                                    <div className="relative">
                                        <Input
                                            id="password"
                                            type={showPassword ? "text" : "password"}
                                            placeholder="Enter new password"
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            required
                                            minLength={6}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword(!showPassword)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                        >
                                            {showPassword ? (
                                                <EyeOff className="h-4 w-4" />
                                            ) : (
                                                <Eye className="h-4 w-4" />
                                            )}
                                        </button>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="confirmPassword">Confirm Password</Label>
                                    <Input
                                        id="confirmPassword"
                                        type={showPassword ? "text" : "password"}
                                        placeholder="Confirm new password"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        required
                                    />
                                </div>

                                {error && (
                                    <p className="text-sm text-red-500 text-center">{error}</p>
                                )}

                                <Button
                                    type="submit"
                                    className="w-full"
                                    disabled={isLoading || !password || !confirmPassword}
                                >
                                    {isLoading ? "Updating..." : "Update Password"}
                                </Button>
                            </form>
                        )}
                    </CardContent>
                </Card>
            </main>
            <Footer />
        </>
    );
}
