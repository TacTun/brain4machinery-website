import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

export async function GET(context) {
  const blog = await getCollection('blog', ({ data }) => !data.draft);
  const guides = await getCollection('guides', ({ data }) => !data.draft);
  const news = await getCollection('news', ({ data }) => !data.draft);

  const items = [...blog, ...guides, ...news]
    .map((entry) => ({
      title: entry.data.title,
      pubDate: entry.data.publishedDate,
      description: entry.data.description,
      link: `/${entry.collection}/${entry.slug}/`,
      author: entry.data.author,
    }))
    .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());

  return rss({
    title: 'TACTUN — brain4machinery',
    description:
      'Field notes on AI-native control electronics, FPGA + Jetson architecture, and building the spine for intelligent machines.',
    site: context.site,
    items,
    customData: '<language>en-us</language>',
  });
}
