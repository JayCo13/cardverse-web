
"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { suggestSimilarSales } from "@/ai/flows/suggest-similar-sales";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Wand2, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { useLocalization } from "@/context/localization-context";

const getFormSchema = (t: (key: string) => string) => z.object({
  searchTerm: z.string().min(3, { message: t('ai_tool_search_validation') }),
});


export function AiTool() {
  const { t } = useLocalization();
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formSchema = getFormSchema(t);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { searchTerm: "" },
  });

  useEffect(() => {
    // We need to reset the form resolver when the language changes
    // so that the validation message gets updated.
    form.reset(form.getValues(), {
      keepValues: true,
      keepDirty: true,
      keepErrors: false, 
    });
  }, [t, form]);


  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoading(true);
    setError(null);
    setSuggestions([]);
    try {
      const result = await suggestSimilarSales(values);
      if (result.suggestions && result.suggestions.length > 0) {
        setSuggestions(result.suggestions);
      } else {
        setError(t('ai_tool_no_suggestions'));
      }
    } catch (e) {
      setError(t('ai_tool_error'));
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section id="ai-tool" className="py-16 md:py-24">
      <div className="container mx-auto px-4">
        <Card className="max-w-3xl mx-auto overflow-hidden bg-card/50">
          <CardHeader className="text-center">
            <Wand2 className="mx-auto h-12 w-12 text-primary mb-4" />
            <CardTitle className="text-3xl md:text-4xl font-bold">{t('ai_tool_title')}</CardTitle>
            <CardDescription className="text-lg">
              {t('ai_tool_description')}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col sm:flex-row gap-2">
                <FormField
                  control={form.control}
                  name="searchTerm"
                  render={({ field }) => (
                    <FormItem className="flex-grow">
                      <FormControl>
                        <Input placeholder={t('ai_tool_placeholder')} {...field} className="text-base" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" disabled={isLoading} className="w-full sm:w-auto">
                  {isLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Wand2 className="mr-2 h-4 w-4" />
                  )}
                  {t('ai_tool_button')}
                </Button>
              </form>
            </Form>

            {error && !isLoading && (
              <Alert variant="destructive" className="mt-6">
                <AlertTitle>{t('error')}</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {suggestions.length > 0 && !isLoading && (
              <div className="mt-6">
                <h4 className="font-semibold mb-3 text-center">{t('ai_tool_suggestions_title')}</h4>
                <div className="flex flex-wrap gap-2 justify-center">
                  {suggestions.map((suggestion, index) => (
                    <Badge key={index} variant="secondary" className="text-sm px-3 py-1 cursor-pointer hover:bg-accent hover:text-accent-foreground">
                      {suggestion}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
