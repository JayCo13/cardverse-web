"use client";
import React, { useRef, useState } from 'react';

import { useLocalization } from "@/context/localization-context";
import { ThemeProvider } from "next-themes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Mail, MapPin, Phone } from "lucide-react";

/**
 * These mirror the checks in `src/app/api/contact/route.ts` exactly. Keep the
 * two in step: the server trims first and then measures, so the client has to
 * trim before measuring too, or " a " looks like two characters here and one
 * character there.
 */
const LIMITS = {
  name: { min: 2, max: 100 },
  subject: { min: 3, max: 160 },
  message: { min: 10, max: 4000 },
  email: { max: 254 },
} as const;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FieldName = 'name' | 'email' | 'subject' | 'message';
type FieldErrors = Partial<Record<FieldName, string>>;

export default function ContactPage() {
  const { t, locale } = useLocalization();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    message: ''
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitState, setSubmitState] = useState<'idle' | 'success' | 'error' | 'rate_limited' | 'invalid'>('idle');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitLockRef = useRef(false);

  const validate = (data: typeof formData): FieldErrors => {
    const next: FieldErrors = {};
    const name = data.name.trim();
    const email = data.email.trim().toLowerCase();
    const subject = data.subject.trim();
    const message = data.message.trim();

    if (/[\r\n]/.test(name)) {
      next.name = t('contact_error_no_newline');
    } else if (name.length < LIMITS.name.min || name.length > LIMITS.name.max) {
      next.name = t('contact_error_name', { min: String(LIMITS.name.min), max: String(LIMITS.name.max) });
    }

    if (!EMAIL_PATTERN.test(email) || email.length > LIMITS.email.max) {
      next.email = t('contact_error_email');
    }

    if (/[\r\n]/.test(subject)) {
      next.subject = t('contact_error_no_newline');
    } else if (subject.length < LIMITS.subject.min || subject.length > LIMITS.subject.max) {
      next.subject = t('contact_error_subject', { min: String(LIMITS.subject.min), max: String(LIMITS.subject.max) });
    }

    if (message.length < LIMITS.message.min || message.length > LIMITS.message.max) {
      next.message = t('contact_error_message', { min: String(LIMITS.message.min), max: String(LIMITS.message.max) });
    }

    return next;
  };

  const updateField = (field: FieldName, value: string) => {
    const nextData = { ...formData, [field]: value };
    setFormData(nextData);
    // Only correct a message already on screen; do not start scolding someone
    // who is still typing their first character.
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: validate(nextData)[field] }));
    }
  };

  const blurField = (field: FieldName) => {
    setErrors(prev => ({ ...prev, [field]: validate(formData)[field] }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current) return;

    const found = validate(formData);
    const firstInvalid = (Object.keys(found) as FieldName[]).find(field => found[field]);
    if (firstInvalid) {
      setErrors(found);
      setSubmitState('invalid');
      document.getElementById(`contact-${firstInvalid}`)?.focus();
      return;
    }

    setErrors({});
    submitLockRef.current = true;
    setIsSubmitting(true);
    setSubmitState('idle');
    // Send exactly what was validated, so trailing spaces cannot turn a valid
    // field into a rejected one on the way over.
    const payload = {
      name: formData.name.trim(),
      email: formData.email.trim().toLowerCase(),
      subject: formData.subject.trim(),
      message: formData.message.trim(),
    };
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-cardverse-locale': locale,
        },
        body: JSON.stringify(payload),
      });

      if (response.status === 429) {
        setSubmitState('rate_limited');
        return;
      }
      // A 400 here means the two rule sets have drifted apart. Say something the
      // user can act on rather than the generic "try again later".
      if (response.status === 400) {
        setSubmitState('invalid');
        return;
      }
      if (!response.ok) throw new Error('Contact request failed');

      setFormData({ name: '', email: '', subject: '', message: '' });
      setSubmitState('success');
    } catch {
      setSubmitState('error');
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <div className="flex flex-1 flex-col bg-background">
        <main className="flex-1 bg-muted/30">
          <div className="container mx-auto px-4 py-16">
            <div className="max-w-6xl mx-auto">
              <div className="text-center space-y-4 mb-12">
                <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
                  {t('page_contact_title')}
                </h1>
                <p className="text-xl text-muted-foreground">
                  {t('page_contact_desc')}
                </p>
              </div>

              <div className="grid lg:grid-cols-[1fr_1.2fr] gap-12 items-start">
                {/* Left Column: Contact Information & Map */}
                <div className="space-y-8">
                  <div className="bg-card border rounded-2xl p-8 space-y-6 shadow-sm">
                    <h3 className="text-2xl font-semibold">{t('contact_info_title')}</h3>
                    <p className="text-muted-foreground">{t('contact_form_desc')}</p>

                    <div className="space-y-6 pt-4">
                      <div className="flex items-center gap-4">
                        <div className="h-12 w-12 bg-primary/10 rounded-full flex items-center justify-center shrink-0">
                          <Mail className="h-6 w-6 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium">{t('contact_email_label')}</p>
                          <p className="text-muted-foreground">{t('contact_email_value')}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="h-12 w-12 bg-primary/10 rounded-full flex items-center justify-center shrink-0">
                          <Phone className="h-6 w-6 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium">{t('contact_phone_label')}</p>
                          <p className="text-muted-foreground">{t('contact_phone_value')}</p>
                        </div>
                      </div>

                      <div className="flex items-start gap-4">
                        <div className="h-12 w-12 bg-primary/10 rounded-full flex items-center justify-center shrink-0 mt-1">
                          <MapPin className="h-6 w-6 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium">{t('contact_address_label')}</p>
                          <p className="text-muted-foreground leading-relaxed">{t('contact_address_value')}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Google Map Embed */}
                  <div className="bg-card border rounded-2xl overflow-hidden shadow-sm h-[300px]">
                    <iframe 
                      src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d15673.359216010045!2d106.62125791771966!3d10.861730032906803!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x31752a12a32ec4e3%3A0xcda8ddb80e461b2b!2zQ2jhu6MgVMOibiBDaMOhbmggSGnhu4dw!5e0!3m2!1svi!2s!4v1709458920193!5m2!1svi!2s" 
                      width="100%" 
                      height="100%" 
                      style={{ border: 0 }} 
                      allowFullScreen={true} 
                      loading="lazy" 
                      referrerPolicy="no-referrer-when-downgrade"
                      title="Google Map Location"
                    ></iframe>
                  </div>
                </div>

                {/* Right Column: Contact Form */}
                <div className="bg-card border rounded-2xl p-8 shadow-sm">
                  <h3 className="text-2xl font-semibold mb-6">{t('contact_get_in_touch')}</h3>
                  <form className="space-y-6" onSubmit={handleSubmit}>
                    <div className="grid sm:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label htmlFor="contact-name" className="text-sm font-medium">{t('contact_name')}</label>
                        <Input
                          id="contact-name"
                          name="name"
                          autoComplete="name"
                          placeholder={t('contact_name_placeholder')}
                          required
                          maxLength={LIMITS.name.max}
                          disabled={isSubmitting}
                          aria-invalid={!!errors.name}
                          aria-describedby={errors.name ? 'contact-name-error' : undefined}
                          className={errors.name ? 'border-destructive focus-visible:ring-destructive' : undefined}
                          value={formData.name}
                          onChange={(e) => updateField('name', e.target.value)}
                          onBlur={() => blurField('name')}
                        />
                        {errors.name && (
                          <p id="contact-name-error" className="text-xs text-destructive">{errors.name}</p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <label htmlFor="contact-email" className="text-sm font-medium">{t('contact_email')}</label>
                        <Input
                          id="contact-email"
                          name="email"
                          type="email"
                          inputMode="email"
                          autoComplete="email"
                          placeholder={t('contact_email_placeholder')}
                          required
                          maxLength={LIMITS.email.max}
                          disabled={isSubmitting}
                          aria-invalid={!!errors.email}
                          aria-describedby={errors.email ? 'contact-email-error' : undefined}
                          className={errors.email ? 'border-destructive focus-visible:ring-destructive' : undefined}
                          value={formData.email}
                          onChange={(e) => updateField('email', e.target.value)}
                          onBlur={() => blurField('email')}
                        />
                        {errors.email && (
                          <p id="contact-email-error" className="text-xs text-destructive">{errors.email}</p>
                        )}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="contact-subject" className="text-sm font-medium">{t('contact_subject')}</label>
                      <Input
                        id="contact-subject"
                        name="subject"
                        placeholder={t('contact_subject_placeholder')}
                        required
                        maxLength={LIMITS.subject.max}
                        disabled={isSubmitting}
                        aria-invalid={!!errors.subject}
                        aria-describedby={errors.subject ? 'contact-subject-error' : undefined}
                        className={errors.subject ? 'border-destructive focus-visible:ring-destructive' : undefined}
                        value={formData.subject}
                        onChange={(e) => updateField('subject', e.target.value)}
                        onBlur={() => blurField('subject')}
                      />
                      {errors.subject && (
                        <p id="contact-subject-error" className="text-xs text-destructive">{errors.subject}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="contact-message" className="text-sm font-medium">{t('contact_message')}</label>
                      <Textarea
                        id="contact-message"
                        name="message"
                        placeholder={t('contact_message_placeholder')}
                        className={`min-h-[220px] resize-y ${errors.message ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                        required
                        maxLength={LIMITS.message.max}
                        disabled={isSubmitting}
                        aria-invalid={!!errors.message}
                        aria-describedby={errors.message ? 'contact-message-error' : 'contact-message-hint'}
                        value={formData.message}
                        onChange={(e) => updateField('message', e.target.value)}
                        onBlur={() => blurField('message')}
                      />
                      <div className="flex items-start justify-between gap-3">
                        {errors.message ? (
                          <p id="contact-message-error" className="text-xs text-destructive">{errors.message}</p>
                        ) : (
                          <p id="contact-message-hint" className="text-xs text-muted-foreground">
                            {t('contact_message_hint', { min: String(LIMITS.message.min) })}
                          </p>
                        )}
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {formData.message.trim().length}/{LIMITS.message.max}
                        </span>
                      </div>
                    </div>
                    {submitState !== 'idle' && (
                      <p
                        role="status"
                        className={submitState === 'success' ? 'text-sm text-emerald-600 dark:text-emerald-400' : 'text-sm text-destructive'}
                      >
                        {submitState === 'success'
                          ? t('contact_submit_success')
                          : submitState === 'rate_limited'
                            ? t('contact_submit_rate_limited')
                            : submitState === 'invalid'
                              ? t('contact_submit_check_fields')
                              : t('contact_submit_error')}
                      </p>
                    )}
                    <Button type="submit" className="w-full text-lg h-12 mt-4" loading={isSubmitting}>
                      {isSubmitting ? t('contact_sending') : t('contact_send')}
                    </Button>
                  </form>
                </div>
              </div>

            </div>
          </div>
        </main>
      </div>
    </ThemeProvider>
  );
}
