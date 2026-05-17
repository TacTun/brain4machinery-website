import { defineCollection, z } from 'astro:content';

const baseFields = {
  title: z.string().max(70),
  description: z.string().max(160),
  publishedDate: z.date(),
  updatedDate: z.date().optional(),
  author: z.string().default('Rafayel Ghasabyan'),
  draft: z.boolean().default(false),
  canonical: z.string().url().optional(),
  primaryKeyword: z.string(),
  secondaryKeywords: z.array(z.string()).default([]),
  tlDr: z.string().min(40).max(400).optional(),
  faq: z
    .array(
      z.object({
        q: z.string(),
        a: z.string(),
      })
    )
    .default([]),
};

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    ...baseFields,
    jsonLdType: z.enum(['BlogPosting', 'TechArticle']).default('BlogPosting'),
    tags: z.array(z.string()).default([]),
    heroImage: z.string().optional(),
  }),
});

const guides = defineCollection({
  type: 'content',
  schema: z.object({
    ...baseFields,
    jsonLdType: z.enum(['TechArticle', 'HowTo']).default('TechArticle'),
    difficulty: z.enum(['intro', 'intermediate', 'advanced']).default('intro'),
    estimatedReadMinutes: z.number().int().positive().default(8),
  }),
});

const glossary = defineCollection({
  type: 'content',
  schema: z.object({
    ...baseFields,
    jsonLdType: z.enum(['DefinedTerm']).default('DefinedTerm'),
    term: z.string(),
    relatedTerms: z.array(z.string()).default([]),
  }),
});

const compare = defineCollection({
  type: 'content',
  schema: z.object({
    ...baseFields,
    jsonLdType: z.enum(['Article']).default('Article'),
    products: z
      .array(
        z.object({
          name: z.string(),
          vendor: z.string(),
          url: z.string().url().optional(),
        })
      )
      .min(2),
  }),
});

const useCases = defineCollection({
  type: 'content',
  schema: z.object({
    ...baseFields,
    jsonLdType: z.enum(['Article']).default('Article'),
    industry: z.string(),
    machineExamples: z.array(z.string()).default([]),
  }),
});

const news = defineCollection({
  type: 'content',
  schema: z.object({
    ...baseFields,
    jsonLdType: z.enum(['NewsArticle']).default('NewsArticle'),
  }),
});

export const collections = {
  blog,
  guides,
  glossary,
  compare,
  'use-cases': useCases,
  news,
};
