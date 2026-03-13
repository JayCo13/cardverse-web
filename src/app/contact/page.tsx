"use client";
import React, { useState } from 'react';

import { useLocalization } from "@/context/localization-context";
import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";
import { ThemeProvider } from "next-themes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Mail, MapPin, Phone } from "lucide-react";

export default function ContactPage() {
  const { t } = useLocalization();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    message: ''
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const mailtoLink = `mailto:cardversehubsupport@gmail.com?subject=${encodeURIComponent(
      formData.subject || 'Contact from CardVerseHub'
    )}&body=${encodeURIComponent(
      `Name: ${formData.name}\nEmail: ${formData.email}\n\nMessage:\n${formData.message}`
    )}`;
    window.location.href = mailtoLink;
  };

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <div className="flex min-h-screen flex-col bg-background">
        <Header />
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
                        <label className="text-sm font-medium">{t('contact_name')}</label>
                        <Input 
                          placeholder="John Doe" 
                          required
                          value={formData.name}
                          onChange={(e) => setFormData({...formData, name: e.target.value})}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">{t('contact_email')}</label>
                        <Input 
                          type="email" 
                          placeholder="john@example.com" 
                          required
                          value={formData.email}
                          onChange={(e) => setFormData({...formData, email: e.target.value})}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t('contact_subject')}</label>
                      <Input 
                        placeholder="How can we help?" 
                        required
                        value={formData.subject}
                        onChange={(e) => setFormData({...formData, subject: e.target.value})}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t('contact_message')}</label>
                      <Textarea 
                        placeholder="Type your message here..." 
                        className="min-h-[220px] resize-y" 
                        required
                        value={formData.message}
                        onChange={(e) => setFormData({...formData, message: e.target.value})}
                      />
                    </div>
                    <Button type="submit" className="w-full text-lg h-12 mt-4">{t('contact_send')}</Button>
                  </form>
                </div>
              </div>

            </div>
          </div>
        </main>
        <Footer />
      </div>
    </ThemeProvider>
  );
}
