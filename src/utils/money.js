export function formatCents(cents) {
  return (cents / 100).toFixed(2);
}

export function moneyView(cents) {
  return {
    amountCents: cents,
    amount: formatCents(cents),
    currency: 'PEN',
  };
}

export function balanceView(cents) {
  return {
    balanceCents: cents,
    balance: formatCents(cents),
  };
}
