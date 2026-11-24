export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event);
  const base = config.public.siteUrl.replace(/\/$/, '');
  const siteName = config.public.siteName;
  const escape = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

  const [properties, articles, pages] = await Promise.all([
    db.property.findMany({
      where: { published: true },
      select: {
        slug: true,
        title: true,
        type: true,
        location: true,
        price: true,
        area: true,
        bedrooms: true,
        status: true,
        readiness: true,
        description: true,
        elite: true,
        complex: { where: { published: true }, select: { title: true, slug: true } },
      },
      orderBy: { updatedAt: 'desc' },
    }),
    db.article.findMany({
      where: {
        published: true,
        OR: [{ publishedAt: null }, { publishedAt: { lte: new Date() } }],
      },
      select: {
        slug: true,
        title: true,
        excerpt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
    }),
    Promise.resolve([
      { path: '', title: 'Главная', description: 'Новостройки Калининграда: жилые комплексы, квартиры, подбор и сопровождение сделки.' },
      { path: '/catalog', title: 'Каталог новостроек', description: 'Жилые комплексы и квартиры в новостройках Калининграда с фильтрами и картой.' },
      { path: '/elite', title: 'Готовые квартиры', description: 'Каталог готовых квартир с ремонтом в Калининграде.' },
      { path: '/tours', title: 'Туры по новостройкам', description: 'Ознакомительные туры по жилым комплексам Калининграда и побережья.' },
      { path: '/ipoteka', title: 'Ипотека', description: 'Программы ипотеки на новостройки в Калининграде, расчёт и подбор условий.' },
      { path: '/blog', title: 'Журнал', description: 'Статьи о покупке квартиры: проверка застройщика, ДДУ, планировка, район.' },
      { path: '/privacy', title: 'Конфиденциальность', description: 'Политика обработки персональных данных и использования Cookie.' },
    ]),
  ]);

  const lines: string[] = [];
  lines.push(`# ${siteName}`);
  lines.push('');
  lines.push(`> ${escape(config.public.legalName || siteName)} — недвижимость Калининграда: новостройки, квартиры, ипотека, туры и журнал о покупке.`);
  lines.push('');
  lines.push('## Description');
  lines.push('');
  lines.push('Сайт о недвижимости Калининграда и Калининградской области. Каталог жилых комплексов и квартир с картой, фильтрами, калькулятором ипотеки, блогом и формой заявки на личный просмотр.');
  lines.push('');
  lines.push('## Details');
  lines.push('');
  lines.push(`- Site: ${siteName}`);
  lines.push(`- URL: ${base}`);
  lines.push(`- Language: ru`);
  lines.push(`- Contacts: ${config.public.phone || 'через форму на сайте'}, ${config.public.legalEmail || 'по запросу'}`);
  lines.push('');
  lines.push('## Navigation');
  lines.push('');
  for (const page of pages) {
    lines.push(`- [${page.title}](${base}${page.path}): ${escape(page.description)}`);
  }
  lines.push('');
  lines.push('## Catalog');
  lines.push('');
  lines.push(`Всего объектов: ${properties.length}`);
  lines.push('');
  for (const property of properties) {
    const complexPart = property.complex ? ` · ЖК ${property.complex.title}` : '';
    const typeLabel = property.type === 'complex' ? 'Жилой комплекс' : 'Квартира';
    const eliteLabel = property.elite ? ' [Элит]' : '';
    const summary = [
      typeLabel,
      property.location,
      property.area != null ? `${property.area} м²` : '',
      property.bedrooms != null ? `${property.bedrooms === 0 ? 'студия' : property.bedrooms + '-комн.'}` : '',
      property.price != null ? `${new Intl.NumberFormat('ru-RU').format(property.price)} ₽` : 'цена по запросу',
      property.readiness,
    ].filter(Boolean).join(' · ');
    const description = (property.description || '').trim().replace(/\s+/g, ' ').slice(0, 200);
    lines.push(`- [${property.title}${eliteLabel}](${base}/catalog/${property.slug}): ${escape(summary)}${complexPart}. ${escape(description)}`);
  }
  lines.push('');
  lines.push('## Blog');
  lines.push('');
  lines.push(`Статьей: ${articles.length}`);
  lines.push('');
  for (const article of articles) {
    const summary = (article.excerpt || '').trim().replace(/\s+/g, ' ').slice(0, 200);
    lines.push(`- [${article.title}](${base}/blog/${article.slug}): ${escape(summary)}`);
  }
  lines.push('');
  lines.push('## Contact');
  lines.push('');
  lines.push(`- Форма заявки: ${base}/#contact`);
  lines.push(`- Туры: ${base}/tours#tour-request`);
  lines.push(`- Ипотека: ${base}/ipoteka#contact`);
  lines.push('');
  lines.push('## Robots');
  lines.push('');
  lines.push(`- Sitemap: ${base}/sitemap.xml`);
  lines.push(`- llms.txt: ${base}/llms.txt`);
  lines.push('');

  setHeader(event, 'Content-Type', 'text/plain; charset=utf-8');
  return lines.join('\n');
});
