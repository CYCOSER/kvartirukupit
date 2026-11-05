export const rf39Offer = (id: number, extra = '', internalId = `J${id}`, category = 'квартира') =>
  `<offer internal-id="${internalId}"><type>продажа</type><property-type>жилая</property-type><category>${category}</category>
  <url>https://rf39.ru/catalog/sale/vtorichka/object/${id}</url>
  <location><locality-name>Калининград</locality-name><address>Тестовая улица, 1</address></location>
  <price><value>9200000</value><currency>RUR</currency></price><area><value>90.5</value><unit>кв. м</unit></area>
  <rooms>3</rooms><floors-total>7</floors-total><description>Описание квартиры</description>${extra}</offer>`;
export const rf39Xml = (...offers: string[]) => `<realty-feed xmlns="http://webmaster.yandex.ru/schemas/feed/realty/2010-06">
  <generation-date>2026-11-03T17:23:00+03:00</generation-date>${offers.join('')}</realty-feed>`;
export async function* rf39Chunks(xml: string) {
  const bytes = Buffer.from(xml);
  for (let index = 0; index < bytes.length; index += 7) yield bytes.subarray(index, index + 7);
}
