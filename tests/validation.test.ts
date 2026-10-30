import test from "node:test";
import assert from "node:assert/strict";
import {
  leadSchema,
  propertySchema,
  money,
  isCoastalLocation,
  seaDistanceLabel,
  apartmentTitle,
  withPublicTitle,
  formatReadiness,
  propertyAddress,
} from "../shared/property";

test("commissioning dates use Roman quarters and show the construction status only once", () => {
  for (const [index, roman] of ["I", "II", "III", "IV"].entries()) {
    assert.equal(formatReadiness(`Сдан, ${index + 1} кв. 2024`, "сдан"), `${roman} кв. 2024`);
    assert.equal(formatReadiness(`${roman} кв. 2024`), `${roman} кв. 2024`);
  }
  assert.equal(formatReadiness("  4 квартал 2027  "), "IV кв. 2027");
  assert.equal(formatReadiness("Сдан", "Сдан"), "");
  assert.equal(formatReadiness("Сдан — 2024", "Сдан"), "2024");
  assert.equal(formatReadiness("Сдан частично", "Сдан"), "Сдан частично");
  assert.equal(formatReadiness("Разные сроки по корпусам"), "Разные сроки по корпусам");
});

test("property addresses include the city without duplicating an existing city prefix", () => {
  const location = "Калининград";
  assert.equal(propertyAddress({ location, address: "Сержанта Мишина ул., д. 81" }), "Калининград, Сержанта Мишина ул., д. 81");
  for (const address of ["Калининград, ул. Мира", "г. Калининград, ул. Мира", "город Калининград, ул. Мира", "Калининград"]) {
    assert.equal(propertyAddress({ location, address }), address);
  }
  assert.equal(propertyAddress({ location, address: "Калининградская ул., д. 1" }), "Калининград, Калининградская ул., д. 1");
  assert.equal(propertyAddress({ location, address: "" }), location);
  assert.equal(propertyAddress({ location: "", address: "ул. Мира" }), "ул. Мира");
});
test("apartment titles stay compact for rooms, studios and missing characteristics", () => {
  assert.equal(apartmentTitle(2, 55.4), "2-к кв. 55.4 м²");
  assert.equal(apartmentTitle(0, 24), "Студия 24 м²");
  assert.equal(apartmentTitle(null, 55.4), "Квартира 55.4 м²");
  assert.equal(apartmentTitle(2, null), "2-к кв.");
  assert.equal(apartmentTitle(undefined, undefined), "Квартира");
});

test("public titles shorten legacy generated NMarket names without changing stored, manual or complex titles", () => {
  const property = { title: "2-комнатная квартира · 55.4 м² · Тихий дом", type: "apartment", bedrooms: 2, area: 55.4, sourceMode: "nmarket-copy" };
  assert.equal(withPublicTitle(property).title, "2-к кв. 55.4 м²");
  assert.equal(withPublicTitle({ ...property, title: "2-комнатная квартира · 55.4 м²" }).title, "2-к кв. 55.4 м²");
  assert.equal(withPublicTitle({ ...property, title: "Студия · 24 м² · Тихий дом", bedrooms: 0, area: 24 }).title, "Студия 24 м²");
  for (const sourceMode of [null, "manual", "curated-copy", "nmarket-copy", "rf39-copy"]) {
    const manual = { ...property, sourceMode, title: "Квартира у моря" };
    assert.equal(withPublicTitle(manual), manual);
  }
  const rf39 = { ...property, sourceMode: "rf39-copy" };
  assert.equal(withPublicTitle(rf39), rf39);
  const complex = { ...property, type: "complex", title: "Тихий дом" };
  assert.equal(withPublicTitle(complex), complex);
  assert.equal(property.title, "2-комнатная квартира · 55.4 м² · Тихий дом");
});

test("lead requires explicit consent and valid phone", () => {
  const lead = {
    name: "Анна",
    phone: "+7 (999) 123-45-67",
    comment: "",
    consent: true,
  };
  assert.equal(leadSchema.safeParse(lead).success, true);
  assert.equal(
    leadSchema.safeParse({ ...lead, consent: false }).success,
    false,
  );
  assert.equal(leadSchema.safeParse({ ...lead, phone: "123" }).success, false);
  assert.equal(
    leadSchema.safeParse({ ...lead, comment: "a".repeat(2001) }).success,
    false,
  );
});
test("lead accepts an omitted or blank name while limiting supplied names", () => {
  const lead = { phone: "+7 (999) 123-45-67", consent: true };
  assert.equal(leadSchema.parse(lead).name, "");
  assert.equal(leadSchema.parse({ ...lead, name: "" }).name, "");
  assert.equal(leadSchema.parse({ ...lead, name: "   " }).name, "");
  assert.equal(leadSchema.parse({ ...lead, name: " Анна " }).name, "Анна");
  assert.equal(leadSchema.safeParse({ ...lead, name: "а".repeat(101) }).success, false);
});
test("property rejects invalid slug, price and missing attributes", () => {
  const p = {
    title: "Дом у моря",
    slug: "dom-u-morya",
    type: "apartment",
    location: "Зеленоградск",
    price: null,
    status: "available",
    area: 120,
    landArea: 4,
    bedrooms: 3,
    floors: 2,
    readiness: "Готов",
    finish: "Чистовая",
    seaDistance: 500,
    description: "Современный дом с собственной террасой.",
    utilities: [],
    published: true,
    featured: false,
    demo: true,
  };
  assert.equal(propertySchema.safeParse(p).success, true);
  assert.equal(propertySchema.parse(p).elite, false);
  for (const housingMarket of ["newbuild", "secondary", null, undefined]) {
    assert.equal(propertySchema.safeParse({ ...p, housingMarket }).success, true);
  }
  assert.equal(propertySchema.safeParse({ ...p, housingMarket: "other" }).success, false);
  assert.equal(propertySchema.safeParse({ ...p, type: "complex", housingMarket: "newbuild" }).success, false);
  assert.equal(propertySchema.safeParse({ ...p, elite: true }).success, true);
  assert.equal(
    propertySchema.safeParse({ ...p, type: "complex", elite: true }).success,
    false,
  );
  assert.equal(
    propertySchema.safeParse({ ...p, slug: "../admin" }).success,
    false,
  );
  assert.equal(propertySchema.safeParse({ ...p, price: -1 }).success, false);
  assert.equal(propertySchema.safeParse({ ...p, area: 0 }).success, false);
  assert.equal(propertySchema.safeParse({ ...p, type: "flat" }).success, false);
  assert.equal(
    propertySchema.safeParse({ ...p, type: "house" }).success,
    false,
  );
  assert.equal(
    propertySchema.safeParse({
      ...p,
      type: "complex",
      area: null,
      landArea: null,
      bedrooms: null,
      floors: null,
    }).success,
    true,
  );
  assert.equal(
    "sourceUrl" in
      propertySchema.parse({ ...p, sourceUrl: "https://fake.example" }),
    false,
  );
  assert.equal(
    leadSchema.safeParse({
      name: "Анна",
      phone: "+79991234567",
      consent: true,
      purpose: "seller",
    }).success,
    false,
  );
  for (const seaDistance of [null, undefined, 0, 500]) {
    const parsed = propertySchema.parse({
      ...p,
      location: "Калининград",
      seaDistance,
    });
    assert.equal(parsed.seaDistance, seaDistance);
  }
  for (const seaDistance of [-1, 100001, "", "500"]) {
    assert.equal(
      propertySchema.safeParse({ ...p, seaDistance }).success,
      false,
    );
  }
  assert.equal(money(null), "Цена по запросу");
});
test("sea distance applies to coastal towns, including locations in addresses", () => {
  for (const location of [
    "Зеленоградск",
    "Светлогорск",
    "Пионерский",
    "Балтийск",
    "Янтарный",
    "Малиновка",
    "Сокольники",
    "г. ЗЕЛЕНОГРАДСК, ул. Морская, 1",
    "Калининградская область, пос. Лесной",
  ]) {
    assert.equal(isCoastalLocation(location), true, location);
  }
  for (const location of [
    "Калининград",
    "Гурьевск",
    "Зеленоградский район",
    "Светлогорский городской округ",
    "Лесной переулок, Калининград",
  ]) {
    assert.equal(isCoastalLocation(location), false, location);
  }
  const coast = { location: "Зеленоградск", seaDistance: 1200 };
  assert.equal(seaDistanceLabel(coast), "1,2 км до моря");
  assert.equal(seaDistanceLabel({ ...coast, seaDistance: 0 }), "0 м до моря");
  assert.equal(
    seaDistanceLabel({ ...coast, seaDistance: 500 }),
    "500 м до моря",
  );
  assert.equal(seaDistanceLabel({ ...coast, seaDistance: null }), null);
  assert.equal(seaDistanceLabel({ location: "Зеленоградск" }), null);
  assert.equal(seaDistanceLabel({ ...coast, location: "Калининград" }), null);
});
