export function safeGreeting(name: string) {
  const cleaned = name.trim();
  return `Hello, ${cleaned}!`;
}

if (require.main === module) {
  console.log(safeGreeting("world"));
}
