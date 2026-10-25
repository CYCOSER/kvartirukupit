-- Remove imported source paragraphs independently of editorial copy and line endings.
WITH cleaned AS (
  SELECT property."id",
    COALESCE(string_agg(paragraph, E'\n\n' ORDER BY position) FILTER (
      WHERE paragraph !~* '(нмаркет|nmarket|(наш\.)?дом\.рф|https?://|www\.)'
        AND btrim(paragraph, E' \t\r\n') <> 'Наличие и стоимость квартир необходимо уточнить перед покупкой.'
    ), '') AS description
  FROM "Property" AS property
  CROSS JOIN LATERAL regexp_split_to_table(property."description", E'\\r?\\n\\s*\\r?\\n') WITH ORDINALITY AS parts(paragraph, position)
  WHERE property."sourceId" IN ('curated:zhk-adres-schastya', 'curated:zhk-ratskhof-dom', 'curated:zhk-tikhiy-dom')
    AND property."description" ~* '(нмаркет|nmarket|(наш\.)?дом\.рф|https?://|www\.|Наличие и стоимость квартир необходимо уточнить перед покупкой\.)'
  GROUP BY property."id"
)
UPDATE "Property" AS property SET "description" = cleaned.description
FROM cleaned WHERE property."id" = cleaned."id" AND property."description" IS DISTINCT FROM cleaned.description;

-- Correct only known source fragments; preserve any surrounding editorial text.

UPDATE "Property" SET "description" = replace("description", 'с полноценно жилой средой', 'с полноценной жилой средой')
WHERE "sourceId" = 'curated:zhk-adres-schastya' AND position('с полноценно жилой средой' in "description") > 0;

UPDATE "Property" SET "description" = replace("description", 'Вся застройка отвечает трем ключевым принципам: разнообразие типов жилья, общественных пространств и социальной инфраструктуры.', 'Застройка сочетает разнообразные типы жилья, общественные пространства и социальную инфраструктуру.')
WHERE "sourceId" = 'curated:zhk-adres-schastya' AND position('Вся застройка отвечает трем ключевым принципам: разнообразие типов жилья, общественных пространств и социальной инфраструктуры.' in "description") > 0;

UPDATE "Property" SET "description" = replace("description", 'соседствующих европейских стран', 'соседних европейских стран')
WHERE "sourceId" = 'curated:zhk-adres-schastya' AND position('соседствующих европейских стран' in "description") > 0;

UPDATE "Property" SET "description" = replace("description", 'Гармоничный и эффектный не только внешне, но практичный и универсальный, с точки зрения последующей эксплуатации в течении долгих десятилетий, жилья эко комфорт-класса.', 'Жильё экокомфорт-класса сочетает гармоничный облик, практичность и удобство эксплуатации в течение долгих десятилетий.')
WHERE "sourceId" = 'curated:zhk-adres-schastya' AND position('Гармоничный и эффектный не только внешне, но практичный и универсальный, с точки зрения последующей эксплуатации в течении долгих десятилетий, жилья эко комфорт-класса.' in "description") > 0;

UPDATE "Property" SET "description" = replace("description", 'детская поликлиник.', 'детская поликлиника.')
WHERE "sourceId" = 'curated:zhk-adres-schastya' AND position('детская поликлиник.' in "description") > 0;

UPDATE "Property" SET "description" = replace("description", 'Потолки 3 метра.', 'Высота потолков — 3 метра.')
WHERE "sourceId" = 'curated:zhk-adres-schastya' AND position('Потолки 3 метра.' in "description") > 0;

UPDATE "Property" SET "description" = replace("description", 'со всей семьей', 'со всей семьёй')
WHERE "sourceId" = 'curated:zhk-tikhiy-dom' AND position('со всей семьей' in "description") > 0;

UPDATE "Property" SET "description" = replace("description", 'есть все для удобства жизни', 'есть всё для удобства жизни')
WHERE "sourceId" = 'curated:zhk-tikhiy-dom' AND position('есть все для удобства жизни' in "description") > 0;

UPDATE "Property" SET "description" = replace("description", 'и все остальное, что поможет создать здоровой ритм вашей жизни', 'и всё остальное для комфортной жизни')
WHERE "sourceId" = 'curated:zhk-tikhiy-dom' AND position('и все остальное, что поможет создать здоровой ритм вашей жизни' in "description") > 0;

UPDATE "Property" SET "description" = replace("description", '6-этажный кирпичный жилой дом с закрытой территорией по периметру.', 'Шестиэтажный кирпичный жилой дом с закрытой территорией.')
WHERE "sourceId" = 'curated:zhk-ratskhof-dom' AND position('6-этажный кирпичный жилой дом с закрытой территорией по периметру.' in "description") > 0;

UPDATE "Property" SET "description" = replace("description", 'В непосредственной близости вся необходимая инфраструктура:', 'В непосредственной близости есть вся необходимая инфраструктура:')
WHERE "sourceId" = 'curated:zhk-ratskhof-dom' AND position('В непосредственной близости вся необходимая инфраструктура:' in "description") > 0;

UPDATE "Property" SET "description" = replace("description", 'от одно- до четырехкомнатных квартир', 'от одно- до четырёхкомнатных квартир')
WHERE "sourceId" = 'curated:zhk-ratskhof-dom' AND position('от одно- до четырехкомнатных квартир' in "description") > 0;

UPDATE "Property" SET "description" = regexp_replace("description", E'кладовыми для каждой квартиры(\\r?\\n|$)', E'кладовыми для каждой квартиры.\\1', 'g')
WHERE "sourceId" = 'curated:zhk-tikhiy-dom' AND "description" ~ E'кладовыми для каждой квартиры(\\r?\\n|$)';
