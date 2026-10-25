// Editable example, not a bank offer. Deposit/rate reference: Cian calculator
// search excerpt, 2026-09-17, https://www.cian.ru/ipoteka/calculator.
// 20 years is our example term; rates are not refreshed automatically.
export const mortgageDefaults = { depositPercent: 20, years: 20, rate: 16.9 };

export function calculateMortgage(
  price: number,
  depositPercent: number,
  years: number,
  rate: number,
) {
  if (
    ![price, depositPercent, years, rate].every(Number.isFinite) ||
    price <= 0 ||
    price > 2_000_000_000 ||
    depositPercent < 0 ||
    depositPercent > 100 ||
    years < 1 ||
    years > 30 ||
    !Number.isInteger(years) ||
    rate < 0 ||
    rate > 50
  )
    return null;
  const deposit = (price * depositPercent) / 100;
  const principal = price - deposit;
  const months = years * 12;
  const monthlyRate = rate / 1200;
  const monthly =
    monthlyRate === 0
      ? principal / months
      : (principal * monthlyRate) /
        -Math.expm1(-months * Math.log1p(monthlyRate));
  return {
    deposit,
    principal,
    monthly,
    total: monthly * months,
    interest: Math.max(0, monthly * months - principal),
  };
}
