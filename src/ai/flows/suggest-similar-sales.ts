'use server';

/**
 * @fileOverview An AI agent that suggests similar trading cards for sale based on a user's search.
 *
 * - suggestSimilarSales - A function that suggests similar trading cards based on a user's search.
 * - SuggestSimilarSalesInput - The input type for the suggestSimilarSales function.
 * - SuggestSimilarSalesOutput - The return type for the suggestSimilarSales function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const SuggestSimilarSalesInputSchema = z.object({
  searchTerm: z
    .string()
    .describe('The search term used to find trading cards, e.g., "Charizard Base Set".'),
});
export type SuggestSimilarSalesInput = z.infer<typeof SuggestSimilarSalesInputSchema>;

const SuggestSimilarSalesOutputSchema = z.object({
  suggestions: z
    .array(z.string())
    .describe('An array of suggested similar trading cards based on the search term.'),
});
export type SuggestSimilarSalesOutput = z.infer<typeof SuggestSimilarSalesOutputSchema>;

export async function suggestSimilarSales(
  input: SuggestSimilarSalesInput
): Promise<SuggestSimilarSalesOutput> {
  return suggestSimilarSalesFlow(input);
}

const prompt = ai.definePrompt({
  name: 'suggestSimilarSalesPrompt',
  input: {schema: SuggestSimilarSalesInputSchema},
  output: {schema: SuggestSimilarSalesOutputSchema},
  prompt: `You are an expert trading card enthusiast. A user has searched for "{{{searchTerm}}}". Suggest other similar trading cards that they might be interested in. Return the suggestions in an array. Be as specific as possible.  Do not suggest cards directly related to the search term, as the user has already searched for it. Only suggest cards that are plausibly related to the card the user searched for.

Suggestions:`,
});

const suggestSimilarSalesFlow = ai.defineFlow(
  {
    name: 'suggestSimilarSalesFlow',
    inputSchema: SuggestSimilarSalesInputSchema,
    outputSchema: SuggestSimilarSalesOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
