export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

export class Calculator {
  total = 0;
  add(n: number): void {
    this.total += n;
  }
}
