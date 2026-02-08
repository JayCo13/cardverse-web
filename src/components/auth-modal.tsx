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
import { Upload } from 'lucide-react';

// Auth Modal Context
interface AuthModalContextType {
  isOpen: boolean;
  setOpen: (open: boolean) => void;
}

const AuthModalContext = createContext<AuthModalContextType>({
  isOpen: false,
  setOpen: () => { },
});

export function useAuthModal() {
  return useContext(AuthModalContext);
}

export function AuthModalProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  return (
    <AuthModalContext.Provider value={{ isOpen, setOpen }}>
      {children}
    </AuthModalContext.Provider>
  );
}

const loginSchema = z.object({
  email: z.string().email('Email không hợp lệ'),
  password: z.string().min(6, 'Mật khẩu phải có ít nhất 6 ký tự'),
});

const signupSchema = z.object({
  displayName: z.string().min(2, 'Tên phải có ít nhất 2 ký tự'),
  email: z.string().email('Email không hợp lệ'),
  password: z.string().min(8, 'Mật khẩu phải có ít nhất 8 ký tự'),
  phoneNumber: z.string().min(10, 'Số điện thoại phải có ít nhất 10 số'),
  address: z.string().optional(),
  city: z.string().optional(),
});

type LoginData = z.infer<typeof loginSchema>;
type SignupData = z.infer<typeof signupSchema>;

export function AuthModal() {
  const { t } = useLocalization();
  const { isOpen, setOpen } = useAuthModal();
  const { signInWithGoogle, signInWithFacebook, signInWithEmail, signUpWithEmail } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [signupStep, setSignupStep] = useState<1 | 2>(1);

  const loginForm = useForm<LoginData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const signupForm = useForm<SignupData>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      displayName: '',
      email: '',
      password: '',
      phoneNumber: '',
      address: '',
      city: '',
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
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    try {
      await signInWithGoogle();
      setOpen(false);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleFacebookLogin = async () => {
    setError(null);
    try {
      await signInWithFacebook();
      setOpen(false);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleSignup = async (data: SignupData) => {
    setError(null);
    try {
      const { error: authError } = await signUpWithEmail(data.email, data.password, data.displayName);
      if (authError) {
        setError(authError.message);
        return;
      }
      setOpen(false);
      signupForm.reset();
      setSignupStep(1);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleOpenChange = (open: boolean) => {
    setOpen(open);
    if (!open) {
      setError(null);
      loginForm.reset();
      signupForm.reset();
      setSignupStep(1);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px] w-[95vw] max-w-[425px] max-h-[90vh] overflow-y-auto rounded-xl">
        <DialogHeader>
          <DialogTitle>{t('auth_modal_title')}</DialogTitle>
          <DialogDescription>{t('auth_modal_description')}</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="login" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login">{t('auth_login_tab')}</TabsTrigger>
            <TabsTrigger value="signup">{t('auth_signup_tab')}</TabsTrigger>
          </TabsList>
          <TabsContent value="login">
            <form onSubmit={loginForm.handleSubmit(handleLogin)} className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="login-email">{t('auth_email_label')}</Label>
                <Input id="login-email" type="email" {...loginForm.register('email')} />
                {loginForm.formState.errors.email && (
                  <p className="text-destructive text-sm">{loginForm.formState.errors.email.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-password">{t('auth_password_label')}</Label>
                <Input id="login-password" type="password" {...loginForm.register('password')} />
                {loginForm.formState.errors.password && (
                  <p className="text-destructive text-sm">{loginForm.formState.errors.password.message}</p>
                )}
              </div>
              {error && <p className="text-destructive text-sm">{error}</p>}
              <Button type="submit" className="w-full" disabled={loginForm.formState.isSubmitting}>
                {t('auth_login_button')}
              </Button>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">Hoặc</span>
                </div>
              </div>
              <Button type="button" variant="outline" className="w-full" onClick={handleGoogleLogin}>
                <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                  <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Đăng nhập với Google
              </Button>
              <Button type="button" variant="outline" className="w-full" onClick={handleFacebookLogin}>
                <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                </svg>
                Đăng nhập với Facebook
              </Button>
            </form>
          </TabsContent>
          <TabsContent value="signup">
            <form onSubmit={signupForm.handleSubmit(handleSignup)} className="space-y-4 py-4">
              {signupStep === 1 ? (
                <>
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="signup-name">Tên *</Label>
                      <Input id="signup-name" {...signupForm.register('displayName')} />
                      {signupForm.formState.errors.displayName && (
                        <p className="text-destructive text-sm">{signupForm.formState.errors.displayName.message}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signup-email">Email *</Label>
                      <Input id="signup-email" type="email" {...signupForm.register('email')} />
                      {signupForm.formState.errors.email && (
                        <p className="text-destructive text-sm">{signupForm.formState.errors.email.message}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signup-password">Mật khẩu *</Label>
                      <Input id="signup-password" type="password" {...signupForm.register('password')} />
                      {signupForm.formState.errors.password && (
                        <p className="text-destructive text-sm">{signupForm.formState.errors.password.message}</p>
                      )}
                    </div>
                  </div>
                  <Button type="button" className="w-full" onClick={() => setSignupStep(2)}>
                    Tiếp theo
                  </Button>
                </>
              ) : (
                <>
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="signup-phone">Số điện thoại (Zalo) *</Label>
                      <Input id="signup-phone" type="tel" {...signupForm.register('phoneNumber')} />
                      {signupForm.formState.errors.phoneNumber && (
                        <p className="text-destructive text-sm">{signupForm.formState.errors.phoneNumber.message}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signup-address">Địa chỉ</Label>
                      <Input id="signup-address" {...signupForm.register('address')} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signup-city">Thành phố</Label>
                      <Input id="signup-city" {...signupForm.register('city')} />
                    </div>
                  </div>
                  {error && <p className="text-destructive text-sm">{error}</p>}
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" className="flex-1" onClick={() => setSignupStep(1)}>
                      Quay lại
                    </Button>
                    <Button type="submit" className="flex-1" disabled={signupForm.formState.isSubmitting}>
                      Đăng ký
                    </Button>
                  </div>
                </>
              )}
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
