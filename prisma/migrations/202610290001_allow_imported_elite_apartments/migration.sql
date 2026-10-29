ALTER TABLE "Property"
  DROP CONSTRAINT "Property_elite_manual_apartment_check",
  ADD CONSTRAINT "Property_elite_apartment_check"
    CHECK (NOT "elite" OR "type" = 'apartment');
