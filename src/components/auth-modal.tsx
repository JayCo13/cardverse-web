'use client';

import { useState, createContext, useContext } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLocalization } from '@/context/localization-context';
import { useAuth } from '@/lib/supabase';

// Auth Modal Context
interface AuthModalContextType {
  isOpen: boolean;
  setOpen: (open: boolean) => void;
  openModal: (tab?: 'login' | 'signup') => void;
  activeTab: 'login' | 'signup';
  setActiveTab: (tab: 'login' | 'signup') => void;
}

const AuthModalContext = createContext<AuthModalContextType>({
  isOpen: false,
  setOpen: () => { },
  openModal: () => { },
  activeTab: 'login',
  setActiveTab: () => { },
});

export function useAuthModal() {
  return useContext(AuthModalContext);
}

export function AuthModalProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'login' | 'signup'>('login');

  const openModal = (tab: 'login' | 'signup' = 'login') => {
    setActiveTab(tab);
    setOpen(true);
  };

  return (
    <AuthModalContext.Provider value={{ isOpen, setOpen, openModal, activeTab, setActiveTab }}>
      {children}
    </AuthModalContext.Provider>
  );
}

export function AuthModal() {
  const { t, locale } = useLocalization();
  const { isOpen, setOpen, activeTab, setActiveTab } = useAuthModal();
  const { signInWithGoogle, signInWithFacebook, signInWithEmail, signUpWithEmail, verifyOtp, resendOtp } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);

  // Dynamic schemas with translations
  const loginSchema = z.object({
    email: z.string().email(t('auth_invalid_email')),
    password: z.string().min(6, t('auth_password_min')),
  });

  const signupSchema = z.object({
    username: z.string().min(2, t('auth_username_min')),
    email: z.string().email(t('auth_invalid_email')),
    password: z.string().min(8, t('auth_password_min_8')),
    confirmPassword: z.string().min(8, t('auth_confirm_password')),
  }).refine((data) => data.password === data.confirmPassword, {
    message: t('auth_passwords_no_match'),
    path: ["confirmPassword"],
  });

  type LoginData = z.infer<typeof loginSchema>;
  type SignupData = z.infer<typeof signupSchema>;

  const loginForm = useForm<LoginData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const signupForm = useForm<SignupData>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      username: '',
      email: '',
      password: '',
      confirmPassword: '',
    },
  });

  const handleLogin = async (data: LoginData) => {
    setError(null);
    try {
      const { error: authError } = await signInWithEmail(data.email, data.password);
      if (authError) {
        setError(authError.message);
        return;
      }
      setOpen(false);
      loginForm.reset();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('auth_error_generic'));
    }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    try {
      await signInWithGoogle();
      setOpen(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('auth_error_generic'));
    }
  };

  const handleFacebookLogin = async () => {
    setError(null);
    try {
      await signInWithFacebook();
      setOpen(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('auth_error_generic'));
    }
  };

  const handleSignup = async (data: SignupData) => {
    setError(null);
    setSuccessMessage(null);
    try {
      const { error: authError } = await signUpWithEmail(data.email, data.password, data.username, locale);
      if (authError) {
        setError(authError.message);
        return;
      }
      // Show OTP verification form
      setPendingVerificationEmail(data.email);
      signupForm.reset();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('auth_error_generic'));
    }
  };

  const handleVerifyOtp = async () => {
    if (!pendingVerificationEmail || otpCode.length !== 6) return;
    setError(null);
    setIsVerifying(true);
    try {
      const { error: verifyError, session } = await verifyOtp(pendingVerificationEmail, otpCode);
      if (verifyError) {
        setError(t('auth_otp_invalid'));
        setIsVerifying(false);
        return;
      }
      // Success - user is now logged in
      setSuccessMessage(t('auth_verification_success'));
      setPendingVerificationEmail(null);
      setOtpCode('');
      setTimeout(() => {
        setOpen(false);
        setSuccessMessage(null);
      }, 1500);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('auth_error_generic'));
    }
    setIsVerifying(false);
  };

  const handleResendOtp = async () => {
    if (!pendingVerificationEmail) return;
    setError(null);
    setIsResending(true);
    try {
      const { error: resendError } = await resendOtp(pendingVerificationEmail);
      if (resendError) {
        setError(resendError.message);
      } else {
        setSuccessMessage(t('auth_otp_resent'));
        setTimeout(() => setSuccessMessage(null), 3000);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('auth_error_generic'));
    }
    setIsResending(false);
  };

  const handleOpenChange = (open: boolean) => {
    setOpen(open);
    if (!open) {
      setError(null);
      setSuccessMessage(null);
      setPendingVerificationEmail(null);
      setOtpCode('');
      loginForm.reset();
      signupForm.reset();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px] w-[95vw] max-w-[425px] max-h-[90vh] overflow-y-auto rounded-xl">
        <DialogHeader>
          <DialogTitle>{t('auth_modal_title')}</DialogTitle>
          <DialogDescription>{t('auth_modal_description')}</DialogDescription>
        </DialogHeader>
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'login' | 'signup')} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login">{t('auth_login_tab')}</TabsTrigger>
            <TabsTrigger value="signup">{t('auth_signup_tab')}</TabsTrigger>
          </TabsList>
          <TabsContent value="login">
            <form onSubmit={loginForm.handleSubmit(handleLogin)} className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="login-email">{t('auth_email_label')}</Label>
                <Input id="login-email" type="email" placeholder="your@email.com" {...loginForm.register('email')} />
                {loginForm.formState.errors.email && (
                  <p className="text-destructive text-sm">{loginForm.formState.errors.email.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-password">{t('auth_password_label')}</Label>
                <Input id="login-password" type="password" placeholder="••••••••" {...loginForm.register('password')} />
                {loginForm.formState.errors.password && (
                  <p className="text-destructive text-sm">{loginForm.formState.errors.password.message}</p>
                )}
              </div>
              {error && <p className="text-destructive text-sm">{error}</p>}
              <Button type="submit" className="w-full bg-orange-500 hover:bg-orange-600" disabled={loginForm.formState.isSubmitting}>
                {t('auth_login_button')}
              </Button>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">{t('or')}</span>
                </div>
              </div>
              <Button type="button" variant="outline" className="w-full" onClick={handleGoogleLogin}>
                <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                {t('auth_continue_google')}
              </Button>
              <Button type="button" variant="outline" className="w-full" onClick={handleFacebookLogin}>
                <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="#1877F2">
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                </svg>
                {t('auth_continue_facebook')}
              </Button>
            </form>
          </TabsContent>
          <TabsContent value="signup">
            <form onSubmit={signupForm.handleSubmit(handleSignup)} className="space-y-4 py-4">
              {successMessage ? (
                <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30 text-center">
                  <p className="text-green-500 font-medium">{successMessage}</p>
                </div>
              ) : pendingVerificationEmail ? (
                <div className="space-y-4">
                  <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/30 text-center">
                    <p className="text-blue-400 text-sm">{t('auth_otp_sent')}</p>
                    <p className="text-muted-foreground text-xs mt-1">{pendingVerificationEmail}</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="otp-code">{t('auth_otp_label')}</Label>
                    <Input
                      id="otp-code"
                      type="text"
                      placeholder="123456"
                      maxLength={6}
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      className="text-center text-2xl tracking-widest font-mono"
                    />
                  </div>
                  {error && <p className="text-destructive text-sm text-center">{error}</p>}
                  <Button
                    type="button"
                    className="w-full bg-orange-500 hover:bg-orange-600"
                    onClick={handleVerifyOtp}
                    disabled={otpCode.length !== 6 || isVerifying}
                  >
                    {isVerifying ? t('auth_verifying') : t('auth_verify_button')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full"
                    onClick={handleResendOtp}
                    disabled={isResending}
                  >
                    {isResending ? t('auth_resending') : t('auth_resend_code')}
                  </Button>
                  <Button
                    type="button"
                    variant="link"
                    className="w-full text-muted-foreground"
                    onClick={() => {
                      setPendingVerificationEmail(null);
                      setOtpCode('');
                      setError(null);
                    }}
                  >
                    {t('auth_use_different_email')}
                  </Button>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="signup-username">{t('auth_username_label')} *</Label>
                    <Input id="signup-username" placeholder="johndoe" {...signupForm.register('username')} />
                    {signupForm.formState.errors.username && (
                      <p className="text-destructive text-sm">{signupForm.formState.errors.username.message}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-email">{t('auth_email_label')} *</Label>
                    <Input id="signup-email" type="email" placeholder="your@email.com" {...signupForm.register('email')} />
                    {signupForm.formState.errors.email && (
                      <p className="text-destructive text-sm">{signupForm.formState.errors.email.message}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password">{t('auth_password_label')} *</Label>
                    <Input id="signup-password" type="password" placeholder="••••••••" {...signupForm.register('password')} />
                    {signupForm.formState.errors.password && (
                      <p className="text-destructive text-sm">{signupForm.formState.errors.password.message}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-confirm">{t('auth_confirm_password_label')} *</Label>
                    <Input id="signup-confirm" type="password" placeholder="••••••••" {...signupForm.register('confirmPassword')} />
                    {signupForm.formState.errors.confirmPassword && (
                      <p className="text-destructive text-sm">{signupForm.formState.errors.confirmPassword.message}</p>
                    )}
                  </div>
                  {error && <p className="text-destructive text-sm">{error}</p>}
                  <Button type="submit" className="w-full bg-orange-500 hover:bg-orange-600" disabled={signupForm.formState.isSubmitting}>
                    {t('auth_create_account')}
                  </Button>
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-background px-2 text-muted-foreground">{t('or')}</span>
                    </div>
                  </div>
                  <Button type="button" variant="outline" className="w-full" onClick={handleGoogleLogin}>
                    <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                    </svg>
                    {t('auth_signup_google')}
                  </Button>
                  <Button type="button" variant="outline" className="w-full" onClick={handleFacebookLogin}>
                    <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="#1877F2">
                      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                    </svg>
                    {t('auth_signup_facebook')}
                  </Button>
                </>
              )}
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

