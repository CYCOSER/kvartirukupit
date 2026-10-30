ALTER TABLE "Property" ADD COLUMN "housingMarket" TEXT;

ALTER TABLE "Property" ADD CONSTRAINT "Property_housing_market_check"
CHECK ("housingMarket" IS NULL OR ("type" = 'apartment' AND "housingMarket" IN ('newbuild', 'secondary')));

UPDATE "Property" SET "housingMarket" = 'newbuild'
WHERE "type" = 'apartment' AND "sourceMode" = 'nmarket-copy';
