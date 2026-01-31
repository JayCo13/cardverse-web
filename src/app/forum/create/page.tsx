
'use client';

import { useEffect, useState } from 'react';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useLocalization } from '@/context/localization-context';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSupabase, useUser } from '@/lib/supabase';
import { useAuthModal } from '@/components/auth-modal';
import { ShieldAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';

export default function CreatePostPage() {
  const { t, locale } = useLocalization();
  const { user } = useUser();
  const [isClient, setIsClient] = useState(false);
  const { setOpen } = useAuthModal();
  const supabase = useSupabase();
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (isClient && !user) {
      setOpen(true);
    }
  }, [isClient, user, setOpen]);

  const categories = locale === 'en-US'
    ? ['General Discussion', 'Card Care', 'Authentication', 'Pokémon', 'Soccer', 'Magic', 'Other']
    : ['Thảo luận chung', 'Chăm sóc thẻ', 'Xác thực', 'Pokémon', 'Bóng đá', 'Ma thuật', 'Khác'];

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) {
      setOpen(true);
      return;
    }
    const formData = new FormData(event.currentTarget);
    const title = formData.get('title') as string;
    const category = formData.get('category') as string;
    const content = formData.get('content') as string;

    if (!title || !category || !content) {
      toast({
        variant: 'destructive',
        title: 'Missing fields',
        description: 'Please fill out all fields.',
      });
      return;
    }

    try {
      // Forum posts table not yet created - placeholder for future implementation
      toast({
        title: 'Feature coming soon',
        description: 'Forum posts will be available after the forum table is created.',
      });
      router.push('/forum');

    } catch (error) {
      console.error("Error creating post: ", error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'There was an error creating your post.',
      });
    }
  };


  const renderContent = () => {
    if (!isClient || !user) {
      return (
        <div className="flex flex-col items-center justify-center text-center py-16">
          <ShieldAlert className="h-16 w-16 text-primary mb-4" />
          <h2 className="text-2xl font-semibold mb-2">{t('auth_required_title')}</h2>
          <p className="text-muted-foreground">{t('auth_required_desc_forum')}</p>
        </div>
      );
    }

    return (
      <form className="space-y-8" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="title" className='text-lg font-semibold'>{t('post_title_label')}</Label>
          <Input id="title" name="title" placeholder={t('post_title_placeholder')} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="category" className='text-lg font-semibold'>{t('category_label')}</Label>
          <Select name="category">
            <SelectTrigger id="category">
              <SelectValue placeholder={t('category_placeholder')} />
            </SelectTrigger>
            <SelectContent>
              {categories.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="content" className='text-lg font-semibold'>{t('content_label')}</Label>
          <Textarea id="content" name="content" placeholder={t('content_placeholder')} rows={10} />
        </div>

        <div className="flex justify-end pt-4">
          <Button size="lg" type="submit">{t('submit_post_button')}</Button>
        </div>
      </form>
    );
  };

  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle className="text-3xl" style={{ fontFamily: "'Orbitron', sans-serif" }}>{t('create_post_title')}</CardTitle>
              <CardDescription>{t('create_post_description')}</CardDescription>
            </CardHeader>
            <CardContent>
              {renderContent()}
            </CardContent>
          </Card>
        </div>
      </main>
      <Footer />
    </div>
  );
}
